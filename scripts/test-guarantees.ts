// What ui-calling promises when things go wrong: retries, crashes, failing storage, stale links and drafts. Each
// scenario runs on every store, over HTTP where the screen would see the difference.
// Run: npx tsx -C ui-calling-source scripts/test-guarantees.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MemoryStore, SurfaceError, createUiCalling, defineSurface, event, implement, type UiCallingOptions, type UiStore } from "@ui-calling/core";
import { uiCallingHandler } from "@ui-calling/server";
import { sqliteStore } from "@ui-calling/sqlite";
import { postgresStore } from "@ui-calling/postgres";
import { PGlite } from "@electric-sql/pglite";

// The steps template keeps drafts in init's store: point it at memory before it's imported.
process.env.UI_CALLING_DB = ":memory:";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const who = { conversationId: "c1", subject: "user-1" };

/** A booking screen whose handler counts its runs and can be made to fail or hang. */
const booking = defineSurface({
  name: "booking",
  description: "Books a seat.",
  input: z.object({ slot: z.string() }),
  data: z.object({ slot: z.string(), booked: z.number() }),
  events: {
    booked: event(z.object({ seats: z.number().int().min(1).max(4) }), { describe: (p) => `Booked ${p.seats} seats`, wake: true }),
  },
});

function boot(store: UiStore, more: Partial<UiCallingOptions> = {}) {
  const runs: (string | undefined)[] = [];
  let booked = 0;
  const behave = { fail: false, hang: undefined as Promise<void> | undefined };
  const ui = createUiCalling({
    baseUrl: "https://ui.example.com",
    store,
    surfaces: [
      implement(booking, {
        resolve: async ({ slot }) => ({ slot, booked }),
        summarize: (d) => `${d.booked} seats booked at ${d.slot}.`,
        on: {
          booked: async ({ seats }, ctx) => {
            runs.push(ctx.eventKey);
            if (behave.hang) await behave.hang;
            if (behave.fail) throw new SurfaceError("seats_api_down", "The seats API timed out", { retryable: true });
            booked += seats;
            return ctx.resolve();
          },
        },
      }),
    ],
    ...more,
  });
  const handler = uiCallingHandler(ui);
  const post = async (t: string, body: unknown) => {
    const res = await handler(
      new Request(`https://ui.example.com/api/ui/sessions/${t}/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    );
    return { status: res.status, json: (await res.json()) as any };
  };
  const open = async () => {
    const run = await ui.runTool("show_booking", { slot: "10:00", locale: "en" }, who);
    assert.ok(run.ok && !run.silent);
    const t = run.link.url.split("/s/")[1];
    await post(t, { type: "opened" });
    return t;
  };
  const domain = async () => (await ui.events("c1")).filter((e) => e.kind === "domain");
  return { ui, post, open, runs, behave, domain, booked: () => booked };
}

/** A store whose event writes fail while `broken` is on: storage down right after the handler ran. */
function breakable(inner: UiStore) {
  const state = { broken: false };
  const store = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "appendEvent") {
        return async (e: Parameters<UiStore["appendEvent"]>[0]) => {
          if (state.broken && e.kind === "domain") throw new Error("connection reset");
          return target.appendEvent(e);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  return { store, state };
}

async function scenarios(name: string, fresh: () => Promise<UiStore>) {
  await check(`${name}: a repeated event (same key) runs its handler once and is recorded once`, async () => {
    const s = boot(await fresh());
    const t = await s.open();
    const first = await s.post(t, { type: "booked", payload: { seats: 2 }, key: "tap-0000001" });
    const again = await s.post(t, { type: "booked", payload: { seats: 2 }, key: "tap-0000001" });
    assert.equal(first.status, 200);
    assert.equal(again.status, 200);
    assert.equal(again.json.repeat, true);
    assert.equal(again.json.event.id, first.json.event.id, "the retry gets the first try's event");
    assert.equal(again.json.data.booked, 2, "and what the screen shows now");
    assert.equal(s.runs.length, 1);
    assert.equal(s.booked(), 2);
    assert.equal((await s.domain()).length, 1, "the agent reads it once");
    // A new tap is a new action.
    await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-0000002" });
    assert.equal(s.booked(), 3);
  });

  await check(`${name}: a retry while the first try is still running gets 409 in_progress, then the result`, async () => {
    const s = boot(await fresh());
    const t = await s.open();
    let finish!: () => void;
    s.behave.hang = new Promise((r) => (finish = r));
    const slow = s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-slow-001" });
    await sleep(20);
    const meanwhile = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-slow-001" });
    assert.equal(meanwhile.status, 409);
    assert.equal(meanwhile.json.error, "in_progress");
    assert.equal(meanwhile.json.retryable, true);
    finish();
    assert.equal((await slow).status, 200);
    assert.equal((await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-slow-001" })).json.repeat, true);
    assert.equal(s.runs.length, 1);
  });

  await check(`${name}: a failed action frees its key, so the retry runs it again and only the success is an event`, async () => {
    const s = boot(await fresh());
    const t = await s.open();
    s.behave.fail = true;
    const failed = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-fail-001" });
    assert.equal(failed.status, 502);
    assert.equal(failed.json.reason, "seats_api_down");
    s.behave.fail = false;
    const retried = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-fail-001" });
    assert.equal(retried.status, 200);
    assert.equal(retried.json.repeat, undefined, "it ran");
    assert.equal(s.runs.length, 2);
    assert.equal((await s.domain()).length, 1);
    const errors = (await s.ui.events("c1")).filter((e) => e.kind === "error");
    assert.equal(errors.length, 1, "the agent still learns the first try failed");
  });

  await check(`${name}: storage failing after the handler never confirms; after eventKeyStaleMs the retry runs with the same key`, async () => {
    const { store, state } = breakable(await fresh());
    const s = boot(store, { eventKeyStaleMs: 80 });
    const t = await s.open();
    state.broken = true;
    const log = console.error;
    console.error = () => {}; // the server logs the failure: expected here
    const lost = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-lost-001" }).finally(() => (console.error = log));
    assert.equal(lost.status, 500, "no false confirmation");
    state.broken = false;
    // Too soon: the first try may still be running somewhere.
    assert.equal((await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-lost-001" })).status, 409);
    await sleep(120);
    const retried = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-lost-001" });
    assert.equal(retried.status, 200);
    // The handler ran twice (at least once is the promise), with the same key both times: an API that takes it
    // as its idempotency key books one seat.
    assert.deepEqual(s.runs, ["tap-lost-001", "tap-lost-001"]);
    assert.equal((await s.domain()).length, 1);
  });

  await check(`${name}: invalid payloads run nothing, record nothing and don't use up the key`, async () => {
    const s = boot(await fresh());
    const t = await s.open();
    const bad = await s.post(t, { type: "booked", payload: { seats: 99 }, key: "tap-bad-0001" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "invalid_payload");
    assert.equal((await s.post(t, { type: "booked", payload: { seats: 1 }, key: "short" })).json.error, "invalid_payload");
    assert.equal(s.runs.length, 0);
    assert.equal((await s.domain()).length, 0);
    assert.equal((await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-bad-0001" })).status, 200);
  });

  await check(`${name}: simultaneous actions with different keys all run and are all recorded, in order`, async () => {
    const s = boot(await fresh());
    const t = await s.open();
    const res = await Promise.all([1, 2, 3].map((n) => s.post(t, { type: "booked", payload: { seats: 1 }, key: `tap-par-00${n}` })));
    assert.deepEqual(res.map((r) => r.status), [200, 200, 200]);
    assert.equal(s.booked(), 3);
    assert.equal((await s.domain()).length, 3);
  });

  await check(`${name}: an expired or completed link reads and acts on nothing, retries included`, async () => {
    const store = await fresh();
    const s = boot(store);
    const t = await s.open();
    await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-exp-0001" });
    const [session] = await store.listSessions!({ status: "opened" });
    await store.updateSession(session.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const late = await s.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-exp-0001" });
    assert.equal(late.status, 410);
    assert.equal(late.json.error, "expired", "not a repeat: an expired link tells the screen nothing");
    const t2 = await s.open();
    await s.post(t2, { type: "completed" });
    assert.equal((await s.post(t2, { type: "booked", payload: { seats: 1 }, key: "tap-exp-0002" })).json.error, "completed");
    assert.equal(s.runs.length, 1);
  });

  await check(`${name}: a restart mid-action: the new instance finishes nothing twice and runs the stale claim again`, async () => {
    const store = await fresh();
    const before = boot(store, { eventKeyStaleMs: 80 });
    const t = await before.open();
    before.behave.hang = new Promise(() => {}); // the instance dies here: the handler never returns
    void before.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-crash-01" });
    await sleep(20);
    const after = boot(store, { eventKeyStaleMs: 80 });
    assert.equal((await after.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-crash-01" })).status, 409);
    await sleep(120);
    assert.equal((await after.post(t, { type: "booked", payload: { seats: 1 }, key: "tap-crash-01" })).status, 200);
    assert.deepEqual(after.runs, ["tap-crash-01"]);
    assert.equal((await after.domain()).length, 1);
  });
}

const dir = mkdtempSync(join(tmpdir(), "ui-calling-guarantees-"));
let n = 0;
await scenarios("memory", async () => new MemoryStore());
await scenarios("sqlite", async () => sqliteStore(join(dir, `g${n++}.db`)));
const pgs: PGlite[] = [];
await scenarios("postgres", async () => {
  const pg = new PGlite();
  pgs.push(pg);
  return postgresStore(pg);
});
for (const pg of pgs) await pg.close();

// The steps template: a draft saved by an older version of the screen, or naming an option that's gone.
const { __const__Impl } = await import("../packages/cli/templates/steps/__name__.server");
const { drafts } = await import("../packages/cli/templates/init/store");
await check("drafts: a stale draft starts over, and a choice that's no longer offered is dropped back to its step", async () => {
  const ui = createUiCalling({ baseUrl: "https://ui.example.com", surfaces: [__const__Impl] });
  const read = async (id: string) => {
    const run = await ui.runTool("show___surface__", { id, locale: "en" }, who);
    assert.ok(run.ok && !run.silent);
    return (await ui.open(run.link.url.split("/s/")[1])).data as { draft: { step: string; choice: string | null; details: string } };
  };
  await drafts.set("__surface__:user-1:R-1", { draft: { step: "review", details: 7 }, submitted: null });
  assert.deepEqual((await read("R-1")).draft, { step: "details", details: "", choice: null });
  await drafts.set("__surface__:user-1:R-2", { draft: { step: "review", details: "Two boxes", choice: "gone" }, submitted: null });
  assert.deepEqual((await read("R-2")).draft, { step: "choice", details: "Two boxes", choice: null });
});

console.log(`\n${passed} guarantees hold`);
