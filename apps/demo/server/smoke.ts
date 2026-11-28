// In-process smoke test of the whole loop: chat → link → screen events → agent context.
// No ports, no API key (scripted agent). Run: npm run smoke -w @ui-calling/demo
import assert from "node:assert/strict";
import type { UiEvent } from "@ui-calling/core";

process.env.AGENT = "scripted";
process.env.ABANDON_AFTER_MS = "0";
process.env.UI_CALLING_DB = ":memory:";
// Chats that reach "real-number" are live: their sends hit the stub below instead of Meta.
process.env.WHATSAPP_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "real-number";
const meta: { status: number; body: unknown }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (!String(url).startsWith("https://graph.facebook.com/")) return realFetch(url, init);
  const next = meta.shift() ?? { status: 200, body: { messages: [{ id: `wamid.${crypto.randomUUID()}` }] } };
  return Response.json(next.body, { status: next.status });
}) as typeof fetch;
const { app, CONVERSATION } = await import("./app");
const { settled } = await import("./agent");
const { ui } = await import("./ui");
const { DEMO_CODE, DEMO_PIN } = await import("./identity");
const { createHmac } = await import("node:crypto");

type Chat = {
  chat: { from: string; text: string; cta?: { label: string; url: string } }[];
  timeline: UiEvent[];
  calls: { tool: string; silent?: string; whatsapp?: Json }[];
  silentWakes: number;
  inbound: { match: string; subject: string } | null;
  identity: { bsuid?: string; customer: { id: string } | null };
};
type Json = Record<string, any>;

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Json };
}
const chat = async () => (await call("GET", "/api/chat")).json as Chat;
async function say(text: string) {
  await call("POST", "/api/chat", { text });
  await settled(CONVERSATION);
  const c = await chat();
  return c.chat.filter((m) => m.from === "agent").at(-1)!;
}
const token = (url: string) => url.split("/s/")[1];
const event = (t: string, type: string, payload: unknown = {}) =>
  call("POST", `/api/ui/sessions/${t}/events`, { type, payload }).then(async (r) => (await settled(CONVERSATION), r));
const lastEvent = async (type: string) => (await chat()).timeline.filter((e) => e.type === type).at(-1)!;

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

await check("order: agent sends a link, the screen opens in the chat's language", async () => {
  await call("POST", "/api/chat/reset");
  const reply = await say("Where is my order?");
  assert.equal(reply.cta?.label, "View order");
  const open = await call("GET", `/api/ui/sessions/${token(reply.cta!.url)}`);
  assert.equal(open.status, 200);
  assert.equal(open.json.locale, "en");
});

await check("order: an action returns fresh data and its outcome reaches the agent", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  await event(t, "opened");
  assert.match((await lastEvent("opened")).state ?? "", /Order A-1042/);
  const r = await event(t, "reschedule_delivery", { date: "2026-11-27", window: "16:00–20:00" });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.eta.date, "2026-11-27");
  assert.match((await lastEvent("reschedule_delivery")).state ?? "", /2026-11-27 16:00–20:00/);
  assert.match((await chat()).chat.at(-1)!.text, /2026-11-27/);
});

await check("order: a failing action is an error event with a reason, waking the agent once", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  await call("POST", "/api/demo/failures", { carrierApi: true });
  const r = await event(t, "reschedule_delivery", { date: "2026-11-28", window: "10:00–14:00" });
  assert.equal(r.status, 502);
  assert.equal(r.json.reason, "carrier_timeout");
  const err = await lastEvent("error");
  assert.equal(err.wake, true);
  assert.match(err.description, /did NOT go through\. Attempted: User asked to move the delivery/);
  await event(t, "reschedule_delivery", { date: "2026-11-28", window: "10:00–14:00" });
  assert.equal((await lastEvent("error")).wake, false, "a retry of the same failure doesn't wake the agent again");
});

await check("order: a failing data source makes the page say so, with a reason", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  await call("POST", "/api/demo/failures", { ordersApi: true });
  const r = await call("GET", `/api/ui/sessions/${t}`);
  assert.equal(r.status, 502);
  assert.equal(r.json.reason, "orders_api_unavailable");
});

await check("order: a wake with nothing new to say ends in stay_silent, is counted, and sends nothing", async () => {
  await call("POST", "/api/chat/reset");
  const a = token((await say("Where is my order?")).cta!.url);
  const b = token((await say("Where is my order?")).cta!.url);
  await call("POST", "/api/demo/failures", { carrierApi: true });
  const move = { date: "2026-11-28", window: "10:00–14:00" };
  await event(a, "opened");
  await event(a, "reschedule_delivery", move);
  const before = await chat();
  assert.equal(before.silentWakes, 0);
  assert.equal(before.calls.at(-1)?.tool, "show_order_status", "the first failure got an apology");
  // The second screen fails the same way: its error wakes the agent, but the apology was already sent.
  await event(b, "opened");
  await event(b, "reschedule_delivery", move);
  const after = await chat();
  assert.equal(after.chat.length, before.chat.length, "nothing new in the chat");
  assert.equal(after.calls.at(-1)?.tool, "stay_silent");
  assert.match(after.calls.at(-1)?.silent ?? "", /order_status error/);
  assert.equal(after.silentWakes, 1, "ui.onSilentWake counted it");
});

await check("shifts: Spanish chat opens the picker in Spanish", async () => {
  await call("POST", "/api/chat/reset");
  const reply = await say("Hola, ¿qué turnos hay disponibles? Quiero cambiar el mío");
  assert.equal(reply.cta?.label, "Elegir turno");
  assert.equal((await call("GET", `/api/ui/sessions/${token(reply.cta!.url)}`)).json.locale, "es");
});

await check("shifts: the rota needs the worker's PIN; wrong ones are refused quietly, and the data only comes after", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const before = (await call("GET", `/api/ui/sessions/${t}`)).json;
  assert.deepEqual(before.verify, { kind: "pin", attemptsLeft: 5 });
  assert.equal(before.data, undefined, "nothing about the worker before the PIN");
  assert.equal((await event(t, "shift_selected", {})).status, 403, "no actions before the PIN");
  const wrong = await call("POST", `/api/ui/sessions/${t}/verify`, { code: "0000" });
  assert.equal(wrong.status, 422);
  assert.equal(wrong.json.reason, "wrong_code");
  const recorded = await lastEvent("error");
  assert.equal(recorded.wake, false, "a wrong PIN doesn't wake the agent");
  assert.doesNotMatch(JSON.stringify(await chat()), /"0000"/, "what the user typed never reaches the agent");
  const right = await call("POST", `/api/ui/sessions/${t}/verify`, { code: DEMO_PIN });
  assert.equal(right.status, 200);
  assert.ok(right.json.data.open.length, "the rota comes with the right PIN");
  assert.equal((await call("GET", `/api/ui/sessions/${t}`)).json.verify, undefined, "once per link");
  // A link that locks wakes the agent, which says why in the chat's language.
  const locked = token((await say("¿Qué turnos hay?")).cta!.url);
  for (let i = 0; i < 5; i++) await call("POST", `/api/ui/sessions/${locked}/verify`, { code: "9999" });
  await settled(CONVERSATION);
  assert.match((await chat()).chat.at(-1)!.text, /bloqueado/);
});

await check("shifts: a full shift is refused with a reason (422, not an outage); a free one books and the code reaches the agent", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const board = (await call("GET", `/api/ui/sessions/${t}`)).json.data;
  const pick = (s: Json) => ({ shift_id: s.id, date: s.date, start: s.start, end: s.end, location: s.location });
  const full = board.open.find((s: Json) => s.spotsLeft === 0);
  const free = board.open.find((s: Json) => s.spotsLeft > 0);
  assert.ok(full && free, "mock data has full and free shifts");
  const fail = await event(t, "shift_selected", pick(full));
  // A refusal, not an outage: 422 "refused", so monitoring doesn't read it as the scheduling system being down.
  assert.equal(fail.status, 422);
  assert.equal(fail.json.error, "refused");
  assert.equal(fail.json.reason, "shift_full");
  const ok = await event(t, "shift_selected", pick(free));
  assert.equal(ok.status, 200);
  const code = ok.json.data.booking.confirmation;
  assert.match((await lastEvent("shift_selected")).state ?? "", new RegExp(code));
  assert.match((await say("¿Qué turno tengo reservado?")).text, new RegExp(code));
});

await check("returns: what the user said starts the draft, and each step is saved as a quiet event", async () => {
  await call("POST", "/api/chat/reset");
  const reply = await say("The blender arrived cracked, I want to return it");
  assert.equal(reply.cta?.label, "Start return");
  const t = token(reply.cta!.url);
  const draft = (await call("GET", `/api/ui/sessions/${t}`)).json.data.draft;
  assert.deepEqual(draft.lines, [{ sku: "BL-200", qty: 1, reason: "damaged", details: "" }], "the agent prefilled item and reason");
  await event(t, "opened");
  assert.equal((await event(t, "items_chosen", { lines: [{ sku: "KS-1", qty: 1 }] })).json.reason, "item_not_returnable");
  await event(t, "items_chosen", { lines: [{ sku: "BL-200", qty: 1 }] });
  const r = await event(t, "reasons_given", { lines: [{ sku: "BL-200", reason: "damaged", details: "Lid cracked" }] });
  assert.equal(r.json.data.draft.step, "photos", "a damaged item needs photos");
  assert.equal((await event(t, "photos_added", { photos: [] })).json.reason, "photos_required");
  const quiet = (await chat()).timeline.filter((e) => e.surface === "order_return" && e.kind === "domain");
  assert.ok(quiet.every((e) => !e.wake), "steps don't wake the agent");
});

await check("returns: photos upload through the link, a step only takes this user's files, and a new link still shows them", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const body = new FormData();
  body.append("file", new Blob([new Uint8Array(200).fill(9)], { type: "image/jpeg" }), "lid.jpg");
  const up = await app.request(`/api/ui/sessions/${t}/files/photos`, { method: "POST", body });
  assert.equal(up.status, 200);
  const { file } = (await up.json()) as { file: { id: string } };
  assert.equal((await event(t, "photos_added", { photos: [file.id, "someone-elses"] })).json.reason, "unknown_photo");
  const ok = await event(t, "photos_added", { photos: [file.id] });
  assert.equal(ok.json.data.draft.step, "pickup");
  assert.deepEqual(ok.json.data.uploaded.map((f: Json) => f.id), [file.id]);
  assert.match((await lastEvent("photos_added")).state ?? "", /Photos: 1/);
  // The agent opens the screen again: the draft's photo is still there, through the new link.
  const again = token((await ui.call("show_order_return", { order_id: "A-0987" }, { conversationId: "again", subject: (await chat()).inbound!.subject })).url);
  assert.deepEqual((await call("GET", `/api/ui/sessions/${again}`)).json.data.uploaded.map((f: Json) => f.id), [file.id]);
  assert.equal((await app.request(`/api/ui/sessions/${again}/files/${file.id}`)).status, 200);
});

await check("returns: a failed pickup keeps the draft and says why; submitting reaches the agent with the outcome", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const slot = (await call("GET", `/api/ui/sessions/${t}`)).json.data.pickupOptions[1];
  await event(t, "pickup_chosen", { refund: "original_payment", date: slot.date, window: slot.window });
  await call("POST", "/api/demo/failures", { carrierApi: true });
  const fail = await event(t, "return_submitted");
  assert.equal(fail.status, 502);
  assert.equal(fail.json.reason, "carrier_unavailable");
  assert.equal(fail.json.retryable, true);
  assert.match((await chat()).chat.at(-1)!.text, /saved/);
  await call("POST", "/api/demo/failures", { carrierApi: false });
  const ok = await event(t, "return_submitted");
  const id = ok.json.data.submitted.returnId;
  assert.match((await lastEvent("return_submitted")).state ?? "", new RegExp(`Submitted as ${id}: 1× Countertop blender`));
  assert.match((await chat()).chat.at(-1)!.text, new RegExp(`${id}.*€79\\.00`));
});

await check("returns: a later call can still preselect the item, until the user saves their own choice", async () => {
  await call("POST", "/api/chat/reset");
  await say("Hi"); // links the chat by phone
  const who = { conversationId: "prefill", subject: (await chat()).inbound!.subject };
  const first = await ui.call("show_order_return", { order_id: "A-0987" }, who);
  assert.equal((await call("GET", `/api/ui/sessions/${token(first.url)}`)).json.data.draft.lines.length, 0);
  const second = await ui.call("show_order_return", { order_id: "A-0987", sku: "BL-200", reason: "damaged" }, who);
  const t = token(second.url);
  assert.deepEqual((await call("GET", `/api/ui/sessions/${t}`)).json.data.draft.lines.map((l: Json) => l.sku), ["BL-200"]);
  await event(t, "items_chosen", { lines: [{ sku: "GB-3", qty: 1 }] });
  const third = await ui.call("show_order_return", { order_id: "A-0987", sku: "BL-200" }, who);
  const lines = (await call("GET", `/api/ui/sessions/${token(third.url)}`)).json.data.draft.lines;
  assert.deepEqual(lines.map((l: Json) => l.sku), ["GB-3"], "the user's own choice wins");
});

await check("returns: a Spanish chat opens the return in Spanish, with the item preselected", async () => {
  await call("POST", "/api/chat/reset");
  const reply = await say("Quiero devolver los boles, no los necesito");
  assert.equal(reply.cta?.label, "Iniciar devolución");
  const open = (await call("GET", `/api/ui/sessions/${token(reply.cta!.url)}`)).json;
  assert.equal(open.locale, "es");
  assert.equal(open.data.draft.lines[0].sku, "GB-3");
});

await check("reset data: the return starts over, and chats and account links stay", async () => {
  const before = await chat();
  assert.ok(before.identity.customer, "the chat is linked");
  const who = { conversationId: "reset-data", subject: before.inbound!.subject };
  const t = token((await ui.call("show_order_return", { order_id: "A-0987", sku: "GB-3" }, who)).url);
  await event(t, "items_chosen", { lines: [{ sku: "GB-3", qty: 2 }] });
  await call("POST", "/api/demo/reset-data");
  const after = await chat();
  assert.equal(after.chat.length, before.chat.length);
  assert.equal(after.identity.customer?.id, before.identity.customer!.id);
  const fresh = (await call("GET", `/api/ui/sessions/${token((await ui.call("show_order_return", { order_id: "A-0987" }, who)).url)}`)).json;
  assert.deepEqual(fresh.data.draft.lines, []);
});

await check("identity: a shared phone number links the BSUID, and replies go to the phone", async () => {
  await call("POST", "/api/chat/reset");
  await say("Where is my order?");
  const c = await chat();
  assert.equal(c.inbound?.match, "linked_by_phone");
  assert.match(c.inbound!.subject, /^wa:PF-1000000001:demo-bsuid-/);
  assert.equal(c.calls.at(-1)?.whatsapp?.to, "34600000000");
});

await check("identity: with the number hidden, only the linking screen is offered and replies go to the BSUID", async () => {
  await call("POST", "/api/chat/reset");
  await call("POST", "/api/demo/identity", { phoneShared: false });
  const reply = await say("¿Dónde está mi pedido?");
  const c = await chat();
  assert.equal(c.inbound?.match, "not_linked");
  assert.equal(c.calls.at(-1)?.tool, "show_link_account");
  assert.equal(reply.cta?.label, "Verificar identidad");
  const wa = c.calls.at(-1)!.whatsapp!;
  assert.equal(wa.recipient, c.identity.bsuid);
  assert.equal(wa.to, undefined);
});

await check("identity: surfaces refuse a WhatsApp user who isn't linked", async () => {
  await assert.rejects(
    ui.call("show_order_status", { order_id: "A-1042" }, { conversationId: "x", subject: "wa:PF-1000000001:stranger" }),
    (err: Json) => err.code === "account_not_linked",
  );
});

await check("identity: a wrong code fails with a reason and is never stored", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  await event(t, "opened");
  const r = await event(t, "verify_identity", { email: "lucia.romero@example.com", code: "999999" });
  assert.equal(r.status, 422);
  assert.equal(r.json.reason, "invalid_code");
  assert.doesNotMatch(JSON.stringify((await chat()).timeline), /999999/);
});

await check("identity: the right code links the chat, redacted, and the agent picks up the question", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const r = await event(t, "verify_identity", { email: "lucia.romero@example.com", code: DEMO_CODE });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.linked, true);
  const e = await lastEvent("verify_identity");
  assert.equal((e.payload as Json).code, "[redacted]");
  assert.doesNotMatch(JSON.stringify(await chat()), new RegExp(DEMO_CODE + "(?!\\d)"), "the code never reaches the agent's context");
  const c = await chat();
  assert.match(c.chat.at(-2)!.text, /Lucía/);
  assert.equal(c.chat.at(-1)!.cta?.label, "Ver pedido");
});

await check("identity: a phone-number change moves the link to the new BSUID", async () => {
  const before = (await chat()).identity.bsuid;
  await call("POST", "/api/demo/identity/change-number");
  const c = await chat();
  assert.notEqual(c.identity.bsuid, before);
  assert.equal(c.inbound?.match, "relinked_after_id_change");
  assert.equal(c.identity.customer?.id, "C-1001");
  assert.equal((await say("¿Hay turnos libres?")).cta?.label, "Elegir turno", "no need to verify again");
});

await check("webhook: requests without a valid signature are rejected", async () => {
  process.env.WHATSAPP_APP_SECRET = "test-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const post = (sig?: string) =>
    app.request("/api/whatsapp/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(sig ? { "X-Hub-Signature-256": sig } : {}) },
      body,
    });
  assert.equal((await post()).status, 401);
  assert.equal((await post("sha256=" + "0".repeat(64))).status, 401);
  const good = "sha256=" + createHmac("sha256", "test-secret").update(body).digest("hex");
  assert.equal((await post(good)).status, 200);
  delete process.env.WHATSAPP_APP_SECRET;
});

await check("webhook: each real sender gets their own conversation, apart from the simulated phone", async () => {
  await call("POST", "/api/chat/reset");
  await say("Where is my order?");
  const before = (await chat()).chat.length;
  const bsuid = "ES.real-sender-1";
  await app.request("/api/whatsapp/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entry: [{ id: "waba", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "real-number" },
        messages: [{ id: "m1", type: "text", text: { body: "Where is my order?" }, from_user_id: bsuid }],
      } }] }],
    }),
  });
  const conversation = `wa:PF-1000000001:${bsuid}`;
  await settled(conversation);
  assert.equal((await chat()).chat.length, before, "the simulated chat is untouched");
  const real = (await call("GET", `/api/chat?conversation=${encodeURIComponent(conversation)}`)).json as Chat;
  assert.equal(real.chat[0]?.text, "Where is my order?");
  assert.equal(real.identity.customer, null, "a new sender isn't linked to anyone");
  assert.equal(real.chat.at(-1)?.cta?.label, "Verify it's you");
});

await check("webhook: Meta's verdict on each send reaches the chat, including failures after a 200", async () => {
  const conversation = "wa:PF-1000000001:ES.real-sender-1";
  const webhook = (value: object) =>
    app.request("/api/whatsapp/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "real-number" }, ...value } }] }] }),
    });
  const real = async () => (await call("GET", `/api/chat?conversation=${encodeURIComponent(conversation)}`)).json as Chat;
  const lastAgent = async () => (await real()).chat.filter((m) => m.from === "agent").at(-1)! as Json;
  const flush = () => new Promise((r) => setTimeout(r, 10));

  meta.push({ status: 200, body: { messages: [{ id: "wamid.ok" }] } });
  await webhook({ messages: [{ id: "m2", type: "text", text: { body: "Hello?" }, from_user_id: "ES.real-sender-1" }] });
  await settled(conversation);
  await flush();
  assert.deepEqual((await lastAgent()).delivery, { status: "sent", wamid: "wamid.ok" });

  await webhook({ statuses: [{ id: "wamid.ok", status: "read" }] });
  await webhook({ statuses: [{ id: "wamid.ok", status: "delivered" }] });
  assert.equal((await lastAgent()).delivery.status, "read", "a late 'delivered' doesn't undo 'read'");

  await webhook({ statuses: [{ id: "wamid.ok", status: "failed", errors: [{ code: 131047, title: "Re-engagement message" }] }] });
  assert.match((await lastAgent()).delivery.error, /131047/);

  meta.push({ status: 403, body: { error: { code: 131005, message: "Access denied" } } });
  await webhook({ messages: [{ id: "m3", type: "text", text: { body: "Anyone?" }, from_user_id: "ES.real-sender-1" }] });
  await settled(conversation);
  await flush();
  const failed = (await lastAgent()).delivery;
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /403 \(#131005\)/);
});

await check("security: through a tunnel, the console's API refuses; screens and webhook still answer", async () => {
  const via = (path: string, method = "GET") =>
    app.request(`https://abc.trycloudflare.com${path}`, { method, body: method === "POST" ? "{}" : undefined });
  assert.equal((await via("/api/chat")).status, 403);
  assert.equal((await via("/api/chat?conversation=wa:PF-1000000001:ES.real-sender-1")).status, 403);
  assert.equal((await via("/api/chat/reset", "POST")).status, 403);
  assert.equal((await via("/api/demo/failures")).status, 403);
  assert.equal((await via("/api/demo/reset-data", "POST")).status, 403);
  assert.equal((await via("/api/ui/sessions/not-a-real-token")).status, 404, "screens are public");
  assert.equal((await via("/api/whatsapp/webhook", "POST")).status, 200, "Meta can still reach the webhook");
  assert.equal((await call("GET", "/api/chat")).status, 200, "on localhost the console works");
});

await check("security: an unknown token is rejected", async () => {
  assert.equal((await call("GET", "/api/ui/sessions/not-a-real-token")).status, 404);
});

console.log(`\n${passed} checks passed`);
