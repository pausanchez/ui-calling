// The UiStore contract, run against every store, plus what persistence is for: surviving a restart.
// Run: npx tsx scripts/test-store.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { MemoryStore, UnknownEventError, createUiCalling, defineSurface, event, implement, type UiEvent, type UiSession, type UiStore } from "@ui-calling/core";
import { sqliteIdentity, sqliteStore } from "@ui-calling/sqlite";

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
    assert.deepEqual(await store.forget!({ conversationId: "conv-forget" }), { sessions: 1, events: 1, files: 1 });
    assert.equal(await store.getSessionByTokenHash("h-fg-1"), undefined, "its link no longer opens");
    assert.equal(await store.getFile!("f-fg-1"), undefined);
    assert.equal((await store.listEvents({ conversationId: "conv-keep" })).length, 1, "other conversations stay");
    assert.equal((await store.forget!({ expiredBefore: new Date().toISOString() })).sessions, 1);
    assert.equal(await store.getSession("fg-3"), undefined);
    assert.equal((await store.forget!({ subject: "user-9" })).sessions, 1);
    assert.equal(await store.getSession("fg-2"), undefined);
  });
}

await contract("memory", new MemoryStore());
await contract("sqlite", sqliteStore(join(dir, "contract.db")));

// A surface and a helper to build a runtime over a given store, as a fresh process would.
const ticket = defineSurface({
  name: "ticket",
  description: "Shows a ticket.",
  input: z.object({ ticket_id: z.string() }),
  data: z.object({ id: z.string(), closed: z.boolean() }),
  events: { close: event(z.object({}), { describe: () => "User asked to close the ticket", wake: true }) },
});
const boot = (store: UiStore, abandonAfterMs?: number) => {
  const woke: UiEvent[] = [];
  const ui = createUiCalling({
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

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} checks passed`);
