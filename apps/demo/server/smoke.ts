// In-process smoke test of the whole loop: chat → link → screen events → agent context.
// No ports, no API key (scripted agent). Run: npm run smoke -w @ui-calling/demo
import assert from "node:assert/strict";
import type { UiEvent } from "@ui-calling/core";

process.env.AGENT = "scripted";
process.env.ABANDON_AFTER_MS = "0";
const { app, CONVERSATION } = await import("./app");
const { settled } = await import("./agent");

type Chat = { chat: { from: string; text: string; cta?: { label: string; url: string } }[]; timeline: UiEvent[] };
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

await check("shifts: Spanish chat opens the picker in Spanish", async () => {
  await call("POST", "/api/chat/reset");
  const reply = await say("Hola, ¿qué turnos hay disponibles? Quiero cambiar el mío");
  assert.equal(reply.cta?.label, "Elegir turno");
  assert.equal((await call("GET", `/api/ui/sessions/${token(reply.cta!.url)}`)).json.locale, "es");
});

await check("shifts: a full shift fails with a reason; a free one books and the code reaches the agent", async () => {
  const t = token((await chat()).chat.find((m) => m.cta)!.cta!.url);
  const board = (await call("GET", `/api/ui/sessions/${t}`)).json.data;
  const pick = (s: Json) => ({ shift_id: s.id, date: s.date, start: s.start, end: s.end, location: s.location });
  const full = board.open.find((s: Json) => s.spotsLeft === 0);
  const free = board.open.find((s: Json) => s.spotsLeft > 0);
  assert.ok(full && free, "mock data has full and free shifts");
  const fail = await event(t, "shift_selected", pick(full));
  assert.equal(fail.status, 502);
  assert.equal(fail.json.reason, "shift_full");
  const ok = await event(t, "shift_selected", pick(free));
  assert.equal(ok.status, 200);
  const code = ok.json.data.booking.confirmation;
  assert.match((await lastEvent("shift_selected")).state ?? "", new RegExp(code));
  assert.match((await say("¿Qué turno tengo reservado?")).text, new RegExp(code));
});

await check("security: an unknown token is rejected", async () => {
  assert.equal((await call("GET", "/api/ui/sessions/not-a-real-token")).status, 404);
});

console.log(`\n${passed} checks passed`);
