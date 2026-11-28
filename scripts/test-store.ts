// The UiStore contract, run against every store, plus what persistence is for: surviving a restart.
// Run: npx tsx scripts/test-store.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MemoryStore, TurnBusyError, UnknownEventError, createUiCalling, defineSurface, event, implement, type UiCallingOptions, type UiEvent, type UiSession, type UiStore } from "@ui-calling/core";
import { sqliteIdentity, sqliteStore } from "@ui-calling/sqlite";
import { postgresStore } from "@ui-calling/postgres";
import { PGlite } from "@electric-sql/pglite";

const dir = mkdtempSync(join(tmpdir(), "ui-calling-store-"));
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

const session = (id: string, conversationId = "c1"): UiSession => ({
  id,
  conversationId,
  subject: "user-1",
  surface: "ticket",
  input: { ticket_id: "T-1" },
  locale: "es",
  status: "sent",
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});
const ev = (id: string, s: UiSession, type: string): UiEvent => ({
  id, sessionId: s.id, conversationId: s.conversationId, subject: s.subject, surface: s.surface, type, kind: "domain",
  payload: { n: id }, description: type, wake: false, at: new Date().toISOString(),
});

async function contract(name: string, store: UiStore) {
  await check(`${name}: event keys are claimed once per session, freed on failure, reclaimed when stale, and remember their event`, async () => {
    assert.deepEqual(await store.claimEventKey!("s-k", "key-1", 60_000), { status: "claimed" });
    assert.deepEqual(await store.claimEventKey!("s-k", "key-1", 60_000), { status: "running" });
    assert.deepEqual(await store.claimEventKey!("s-other", "key-1", 60_000), { status: "claimed" }, "keys are per session");
    await store.releaseEventKey!("s-k", "key-1");
    assert.deepEqual(await store.claimEventKey!("s-k", "key-1", 60_000), { status: "claimed" }, "a failed action can run again");
    await store.finishEventKey!("s-k", "key-1", "ev-9");
    assert.deepEqual(await store.claimEventKey!("s-k", "key-1", 0), { status: "done", eventId: "ev-9" }, "done is never stale");
    await store.releaseEventKey!("s-k", "key-1");
    assert.deepEqual(await store.claimEventKey!("s-k", "key-1", 60_000), { status: "done", eventId: "ev-9" }, "release can't undo done");
    await store.claimEventKey!("s-k", "key-2", 60_000);
    await store.finishEventKey!("s-k", "key-2", undefined);
    assert.deepEqual(await store.claimEventKey!("s-k", "key-2", 60_000), { status: "done" }, "ctx.unchanged(): done, no event");
    await store.claimEventKey!("s-k", "key-3", 60_000);
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(await store.claimEventKey!("s-k", "key-3", 5), { status: "claimed" }, "an unfinished claim goes stale");
  });
  await check(`${name}: sessions by token hash and id, partial updates, status queries`, async () => {
    const a = session("s-a");
    await store.createSession(a, "hash-a");
    assert.deepEqual(await store.getSessionByTokenHash("hash-a"), a);
    assert.equal(await store.getSessionByTokenHash("nope"), undefined);
    await store.updateSession("s-a", { status: "opened", openedAt: "2026-11-24T10:00:00.000Z" });
    const updated = await store.getSession("s-a");
    assert.equal(updated?.status, "opened");
    assert.equal(updated?.locale, "es", "untouched fields survive an update");
    assert.deepEqual((await store.listSessions!({ status: "opened" })).map((s) => s.id), ["s-a"]);
  });
  await check(`${name}: events keep append order and filter by session and conversation`, async () => {
    const a = (await store.getSession("s-a"))!;
    const b = session("s-b", "c2");
    await store.createSession(b, "hash-b");
    for (const [id, s] of [["e1", a], ["e2", b], ["e3", a]] as const) await store.appendEvent(ev(id, s, `t-${id}`));
    assert.deepEqual((await store.listEvents({ sessionId: "s-a" })).map((e) => e.id), ["e1", "e3"]);
    assert.deepEqual((await store.listEvents({ conversationId: "c2" })).map((e) => e.id), ["e2"]);
    assert.deepEqual((await store.listEvents({ conversationId: "c1", sessionId: "s-a" })).map((e) => e.payload), [{ n: "e1" }, { n: "e3" }]);
  });
  await check(`${name}: \`after\` returns only newer events, \`limit\` pages, and an unknown cursor throws`, async () => {
    const a = (await store.getSession("s-a"))!;
    await store.appendEvent(ev("e4", a, "t-e4"));
    const ids = async (q: Parameters<UiStore["listEvents"]>[0]) => (await store.listEvents(q)).map((e) => e.id);
    assert.deepEqual(await ids({ conversationId: "c1", after: "e1" }), ["e3", "e4"]);
    // The cursor is a position, not a filter: an event from another conversation works too.
    assert.deepEqual(await ids({ conversationId: "c1", after: "e2" }), ["e3", "e4"]);
    assert.deepEqual(await ids({ sessionId: "s-a", after: "e4" }), [], "nothing new yet");
    assert.deepEqual(await ids({ conversationId: "c1", limit: 2 }), ["e1", "e3"]);
    assert.deepEqual(await ids({ conversationId: "c1", after: "e1", limit: 1 }), ["e3"]);
    assert.deepEqual(await ids({ after: "e1" }), ["e2", "e3", "e4"]);
    // Silently returning everything would duplicate the agent's context, so a bad cursor must fail loudly.
    await assert.rejects(store.listEvents({ conversationId: "c1", after: "missing" }), UnknownEventError);
  });
  await check(`${name}: files keep their bytes, list by session in upload order, and delete`, async () => {
    const file = (id: string, sessionId: string) => ({ id, sessionId, slot: "photos", name: `${id}.png`, type: "image/png", size: 3, at: new Date().toISOString() });
    await store.putFile!(file("f1", "s-a"), new Uint8Array([1, 2, 3]));
    await store.putFile!(file("f2", "s-b"), new Uint8Array([4, 5, 6]));
    await store.putFile!(file("f3", "s-a"), new Uint8Array([7, 8, 9]));
    const got = await store.getFile!("f1");
    assert.deepEqual([...got!.bytes], [1, 2, 3]);
    assert.equal(got!.file.name, "f1.png");
    assert.deepEqual((await store.listFiles!("s-a")).map((f) => f.id), ["f1", "f3"]);
    await store.deleteFile!("f1");
    assert.equal(await store.getFile!("f1"), undefined);
    assert.deepEqual((await store.listFiles!("s-a")).map((f) => f.id), ["f3"]);
  });

  await check(`${name}: forget deletes a conversation's, a user's or expired sessions with their events and files`, async () => {
    const mine = { ...session("fg-1", "conv-forget"), subject: "user-9" };
    const other = { ...session("fg-2", "conv-keep"), subject: "user-9" };
    const old = { ...session("fg-3", "conv-old"), subject: "user-8", expiresAt: "2020-01-01T00:00:00.000Z" };
    for (const [s, hash] of [[mine, "h-fg-1"], [other, "h-fg-2"], [old, "h-fg-3"]] as const) {
      await store.createSession(s, hash);
      await store.appendEvent(ev(`e-${s.id}`, s, "opened"));
    }
    await store.putFile!({ id: "f-fg-1", sessionId: "fg-1", slot: "photos", name: "x.png", type: "image/png", size: 1, at: new Date().toISOString() }, new Uint8Array([1]));
    await store.claimEventKey!("fg-1", "key-forget", 60_000);
    await store.finishEventKey!("fg-1", "key-forget", "e-fg-1");
    assert.deepEqual(await store.forget!({ conversationId: "conv-forget" }), { sessions: 1, events: 1, files: 1 });
    assert.deepEqual(await store.claimEventKey!("fg-1", "key-forget", 60_000), { status: "claimed" }, "its event keys go too");
    assert.equal(await store.getSessionByTokenHash("h-fg-1"), undefined, "its link no longer opens");
    assert.equal(await store.getFile!("f-fg-1"), undefined);
    assert.equal((await store.listEvents({ conversationId: "conv-keep" })).length, 1, "other conversations stay");
    assert.equal((await store.forget!({ expiredBefore: new Date().toISOString() })).sessions, 1);
    assert.equal(await store.getSession("fg-3"), undefined);
    assert.equal((await store.forget!({ subject: "user-9" })).sessions, 1);
    assert.equal(await store.getSession("fg-2"), undefined);
  });
  await check(`${name}: one turn lease per conversation, renewed by its holder, free once released or expired`, async () => {
    assert.equal(await store.acquireTurn!("turn-c1", "a", 60_000), true);
    assert.equal(await store.acquireTurn!("turn-c1", "b", 60_000), false, "another holder waits");
    assert.equal(await store.acquireTurn!("turn-c2", "b", 60_000), true, "other conversations don't");
    assert.equal(await store.acquireTurn!("turn-c1", "a", 60_000), true, "the holder renews it");
    await store.releaseTurn!("turn-c1", "b");
    assert.equal(await store.acquireTurn!("turn-c1", "b", 60_000), false, "only the holder releases it");
    await store.releaseTurn!("turn-c1", "a");
    assert.equal(await store.acquireTurn!("turn-c1", "b", 1), true);
    await new Promise((r) => setTimeout(r, 5));
    // A process that died mid-turn doesn't block the conversation for good.
    assert.equal(await store.acquireTurn!("turn-c1", "c", 60_000), true, "an expired lease can be taken");
  });
  await check(`${name}: updateSessionIf moves a session only from the status it names, and only once`, async () => {
    await store.createSession(session("s-c"), "hash-c");
    assert.equal(await store.updateSessionIf!("s-c", "opened", { status: "abandoned" }), false, "not from a status it isn't in");
    assert.equal(await store.updateSessionIf!("s-c", "sent", { status: "opened", openedAt: "2026-11-24T10:00:00.000Z" }), true);
    assert.equal(await store.updateSessionIf!("s-c", "sent", { status: "opened" }), false, "the second one loses");
    const now = await store.getSession("s-c");
    assert.equal(now?.openedAt, "2026-11-24T10:00:00.000Z");
    assert.equal(now?.locale, "es", "untouched fields survive");
    assert.ok((await store.listSessions!({ status: "opened" })).some((s) => s.id === "s-c"), "the status query sees the move");
    assert.equal(await store.updateSessionIf!("nope", "sent", { status: "opened" }), false);
  });
  await check(`${name}: countEvents counts a session's events by kind, wake and time`, async () => {
    const c = (await store.getSession("s-c"))!;
    await store.appendEvent({ ...ev("k1", c, "a"), wake: true, at: "2026-11-24T10:00:00.000Z" });
    await store.appendEvent({ ...ev("k2", c, "b"), wake: true, at: "2026-11-24T10:05:00.000Z" });
    await store.appendEvent({ ...ev("k3", c, "opened"), kind: "lifecycle", at: "2026-11-24T10:06:00.000Z" });
    assert.equal(await store.countEvents!({ sessionId: "s-c" }), 3);
    assert.equal(await store.countEvents!({ sessionId: "s-c", kind: "domain", wake: true }), 2);
    assert.equal(await store.countEvents!({ sessionId: "s-c", wake: false }), 1);
    assert.equal(await store.countEvents!({ sessionId: "s-c", kind: "domain", since: "2026-11-24T10:01:00.000Z" }), 1);
    assert.equal(await store.countEvents!({ sessionId: "nope" }), 0);
  });
}

await contract("memory", new MemoryStore());
await contract("sqlite", sqliteStore(join(dir, "contract.db")));
// Postgres in-process (PGlite, Postgres compiled to WebAssembly): the same SQL a pg Pool runs, no server to start.
const pg = new PGlite();
await contract("postgres", postgresStore(pg));

// A surface and a helper to build a runtime over a given store, as a fresh process would.
const ticket = defineSurface({
  name: "ticket",
  description: "Shows a ticket.",
  input: z.object({ ticket_id: z.string() }),
  data: z.object({ id: z.string(), closed: z.boolean() }),
  events: { close: event(z.object({}), { describe: () => "User asked to close the ticket", wake: true }) },
});
const boot = (store: UiStore, abandonAfterMs?: number, more: Partial<UiCallingOptions> = {}) => {
  const woke: UiEvent[] = [];
  const ui = createUiCalling({
    ...more,
    baseUrl: "https://ui.example.com",
    store,
    abandonAfterMs,
    onEvent: (e) => void (e.wake && woke.push(e)),
    surfaces: [
      implement(ticket, {
        resolve: async ({ ticket_id }) => ({ id: ticket_id, closed: false }),
        summarize: (d) => `Ticket ${d.id}${d.closed ? " closed" : ""}.`,
        on: { close: async (_p, ctx) => ({ id: String(ctx.session.input.ticket_id), closed: true }) },
      }),
    ],
  });
  return { ui, woke };
};

await check("lazy: creating the store, an identity and a runtime opens nothing until the first request (next build imports them)", async () => {
  const path = join(dir, "lazy", "app.db");
  const store = sqliteStore(path);
  sqliteIdentity(store);
  const ui = createUiCalling({ baseUrl: "https://ui.example.com", store, abandonAfterMs: 1000, surfaces: [implement(ticket, { resolve: async () => ({ id: "T-1", closed: false }), summarize: () => "" })] });
  assert.equal(existsSync(path), false, "importing ui.ts must not create the database");
  await ui.call("show_ticket", { ticket_id: "T-1" }, { conversationId: "c", subject: "u" });
  assert.equal(existsSync(path), true, "the first request opens it");
  store.close();
});

await check("identity: codes link a subject once, expire, survive a reload, and lock per customer across chats", async () => {
  const store = sqliteStore(":memory:");
  const identity = sqliteIdentity(store, { maxAttempts: 3, codeTtlMs: 60_000 });
  assert.equal(identity.customerFor("wa:1"), undefined);
  const code = identity.startVerification("wa:1", "E-100")!;
  assert.match(code, /^\d{6}$/);
  assert.equal(identity.pending("wa:1")?.customerId, "E-100", "still waiting after a reload");
  assert.deepEqual(identity.verify("wa:1", "000000" === code ? "111111" : "000000"), { ok: false, reason: "wrong_code", attemptsLeft: 2 });
  assert.deepEqual(identity.verify("wa:1", code), { ok: true, customerId: "E-100" });
  assert.equal(identity.customerFor("wa:1"), "E-100");
  assert.equal(identity.verify("wa:1", code).ok, false, "a code works once");
  // Another chat guessing the same customer's code shares the attempt count, and gets locked out.
  identity.startVerification("wa:2", "E-200");
  identity.startVerification("wa:3", "E-200");
  identity.verify("wa:2", "x");
  identity.verify("wa:3", "y");
  assert.equal(identity.startVerification("wa:4", "E-200") !== undefined, true);
  assert.deepEqual(identity.verify("wa:4", "z"), { ok: false, reason: "locked" });
  assert.equal(identity.startVerification("wa:5", "E-200"), undefined, "no new codes while locked");
  // An expired code says so, and a phone-number change keeps the link.
  const short = sqliteIdentity(store, { codeTtlMs: -1 });
  const old = short.startVerification("wa:6", "E-300")!;
  assert.deepEqual(short.verify("wa:6", old), { ok: false, reason: "expired" });
  assert.equal(identity.moveLink("wa:1", "wa:1-new"), true);
  assert.equal(identity.customerFor("wa:1-new"), "E-100");
  assert.equal(identity.customerFor("wa:1"), "E-100", "links already sent to the old number keep working");
  identity.moveLink("wa:1-new", "wa:1-newer", { keepOld: false });
  assert.equal(identity.customerFor("wa:1-new"), undefined);
});

await check("identity: PIN and code verifiers check the linked customer and share one lockout", async () => {
  const store = sqliteStore(":memory:");
  const identity = sqliteIdentity(store, { maxAttempts: 3 });
  const who = { subject: "wa:pin", conversationId: "c" };
  const pin = identity.pinVerifier();
  assert.equal(await pin.check(who, "1234"), false, "not linked: no PIN to check");
  identity.link("wa:pin", "C-9");
  assert.throws(() => identity.setPin("C-9", "12"), /4 to 8 digits/);
  identity.setPin("C-9", "4821");
  assert.equal(identity.hasPin("C-9"), true);
  assert.notEqual(JSON.stringify(store.db.prepare("SELECT * FROM ui_pins").all()).includes("4821"), true, "stored hashed");
  assert.equal(await pin.check(who, "4821"), true);
  assert.equal(await pin.check({ ...who, subject: "wa:other" }, "4821"), false, "another chat isn't that customer");
  const delivered: string[] = [];
  const code = identity.codeVerifier({ deliver: async (_c, c) => void delivered.push(c) });
  await code.send!(who, "es");
  assert.equal(delivered.length, 1);
  assert.equal(await code.check(who, delivered[0]), true);
  assert.equal(await code.check(who, delivered[0]), false, "a code works once");
  await assert.rejects(code.send!({ ...who, subject: "wa:nobody" }, "es"), { code: "not_linked" });
  // Wrong PINs lock the customer out, for codes too.
  for (let i = 0; i < 3; i++) await pin.check(who, "0000");
  assert.equal(await pin.check(who, "4821"), false, "locked, even with the right PIN");
  await assert.rejects(code.send!(who, "es"), { code: "locked" });
  store.close();
});

await check("restart: a link sent before a restart still opens, and the agent's context is still there", async () => {
  const file = join(dir, "restart.db");
  const before = sqliteStore(file);
  const first = boot(before).ui;
  const run = await first.runTool("show_ticket", { ticket_id: "T-7", locale: "es" }, { conversationId: "conv", subject: "u" });
  assert.ok(run.ok && !run.silent);
  const token = run.link.url.split("/s/")[1];
  await first.emit(token, "opened");
  before.close();

  // New process: new store object, same file.
  const after = sqliteStore(file);
  const second = boot(after).ui;
  const open = await second.open(token);
  assert.equal(open.locale, "es");
  const { event } = await second.emit(token, "close", {});
  assert.match(event?.state ?? "", /Ticket T-7 closed/);
  const all = await second.events("conv");
  assert.deepEqual(all.map((e) => e.type), ["opened", "close"]);
  // The cursor survives the restart: catch up from the last event handled before it.
  assert.deepEqual((await second.events("conv", { after: all[0].id })).map((e) => e.type), ["close"]);
  after.close();
});

await check("restart: an abandon timer that was running is re-armed with the time it had left", async () => {
  const file = join(dir, "abandon.db");
  const before = sqliteStore(file);
  const first = boot(before).ui; // no abandonAfterMs here, so the only timer will be the restored one
  const run = await first.runTool("show_ticket", { ticket_id: "T-8" }, { conversationId: "conv2", subject: "u" });
  assert.ok(run.ok && !run.silent);
  await first.emit(run.link.url.split("/s/")[1], "opened");
  before.close();

  const after = sqliteStore(file);
  const second = boot(after, 150);
  await second.ui.ready;
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(second.woke.map((e) => e.type), ["abandoned"], "the agent is woken once, after the restart");
  assert.equal((await after.listSessions!({ status: "abandoned" })).length, 1);
  after.close();
});

await check("turns: two instances on one database never run a conversation's turns at once, and run them all", async () => {
  // Two store objects on one file are two connections, as two processes would have.
  const file = join(dir, "turns.db");
  const [a, b] = [sqliteStore(file), sqliteStore(file)];
  const instances = [boot(a).ui, boot(b).ui];
  let running = 0;
  let most = 0;
  const done: number[] = [];
  const turn = (n: number) => async () => {
    most = Math.max(most, ++running);
    await new Promise((r) => setTimeout(r, 20));
    running--;
    done.push(n);
    return n;
  };
  const results = await Promise.all([0, 1, 2, 3, 4, 5].map((n) => instances[n % 2].turn("conv-turns", turn(n))));
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5]);
  assert.equal(most, 1, "never two at once");
  assert.equal(done.length, 6);
  // A failed turn frees the conversation for the next one.
  await assert.rejects(instances[0].turn("conv-turns", () => Promise.reject(new Error("model down"))), /model down/);
  assert.equal(await instances[1].turn("conv-turns", () => "next"), "next");
  // Waiting has a limit: a turn held elsewhere for too long throws instead of hanging the request.
  await a.acquireTurn!("conv-stuck", "crashed-elsewhere", 60_000);
  await assert.rejects(instances[1].turn("conv-stuck", () => "never", { waitMs: 100 }), TurnBusyError);
  a.close();
  b.close();
});

await check("instances: two on one database record the first open once and the abandon once, with sweep() instead of timers", async () => {
  const file = join(dir, "sweep.db");
  const [a, b] = [sqliteStore(file), sqliteStore(file)];
  const [x, y] = [boot(a, 50, { abandonTimers: false }), boot(b, 50, { abandonTimers: false })];
  const run = await x.ui.runTool("show_ticket", { ticket_id: "T-9" }, { conversationId: "conv-sweep", subject: "u" });
  assert.ok(run.ok && !run.silent);
  const t = run.link.url.split("/s/")[1];
  // Two tabs opening the link at once, each served by a different instance.
  const opens = await Promise.all([x.ui.emit(t, "opened"), y.ui.emit(t, "opened")]);
  assert.deepEqual(opens.map((o) => o.event?.type).sort(), ["opened", "returned"], "only one of them is the first open");
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(x.woke.length + y.woke.length, 0, "no timers ran");
  // A cron on every instance, firing together.
  const swept = await Promise.all([x.ui.sweep(), y.ui.sweep(), x.ui.sweep()]);
  assert.equal(swept.reduce((n, s) => n + s.abandoned, 0), 1, "one of them marks it");
  assert.deepEqual([...x.woke, ...y.woke].map((e) => e.type), ["abandoned"], "the agent is woken once");
  assert.equal((await x.ui.events("conv-sweep")).filter((e) => e.type === "abandoned").length, 1);
  assert.deepEqual(await y.ui.sweep(), { abandoned: 0 }, "nothing left to sweep");
  a.close();
  b.close();
});

await check("postgres: two instances on one database open a link once, abandon it once and take turns", async () => {
  const db = new PGlite();
  const [a, b] = [postgresStore(db), postgresStore(db)];
  const [x, y] = [boot(a, 50, { abandonTimers: false }), boot(b, 50, { abandonTimers: false })];
  const run = await x.ui.runTool("show_ticket", { ticket_id: "T-3" }, { conversationId: "pg-conv", subject: "u" });
  assert.ok(run.ok && !run.silent);
  const t = run.link.url.split("/s/")[1];
  const opens = await Promise.all([x.ui.emit(t, "opened"), y.ui.emit(t, "opened")]);
  assert.deepEqual(opens.map((o) => o.event?.type).sort(), ["opened", "returned"]);
  await new Promise((r) => setTimeout(r, 80));
  const swept = await Promise.all([x.ui.sweep(), y.ui.sweep()]);
  assert.equal(swept.reduce((n, s) => n + s.abandoned, 0), 1);
  assert.deepEqual([...x.woke, ...y.woke].map((e) => e.type), ["abandoned"]);
  // A new runtime on the same database, as after a deploy: the context is all there.
  const z = boot(postgresStore(db));
  assert.deepEqual((await z.ui.events("pg-conv")).map((e) => e.type), ["opened", "returned", "abandoned"]);
  let running = 0;
  let most = 0;
  await Promise.all([0, 1, 2, 3].map((n) => [x, y][n % 2].ui.turn("pg-turns", async () => {
    most = Math.max(most, ++running);
    await new Promise((r) => setTimeout(r, 15));
    running--;
  })));
  assert.equal(most, 1, "never two turns at once");
  await db.close();
});

await pg.close();
rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
