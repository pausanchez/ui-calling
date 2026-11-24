// Session lifecycle in the runtime: what a link still allows once the user is done, and how long it lives.
// Run: npx tsx -C ui-calling-source scripts/test-runtime.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { createUiCalling, defineSurface, event, implement } from "@ui-calling/core";
import { uiCallingHandler } from "@ui-calling/server";

const ticket = defineSurface({
  name: "ticket",
  description: "Shows a support ticket.",
  input: z.object({ ticket_id: z.string() }),
  data: z.object({ id: z.string() }),
  events: { closed: event(z.object({}), { describe: () => "User asked to close the ticket" }) },
});
const verify = defineSurface({
  name: "verify",
  description: "Verifies the user.",
  input: z.object({}),
  data: z.object({}),
  events: {},
  ttlSeconds: 600,
});
const ui = createUiCalling({
  baseUrl: "https://ui.example.com",
  surfaces: [
    implement(ticket, { resolve: async ({ ticket_id }) => ({ id: ticket_id }), summarize: (d) => `Ticket ${d.id}.` }),
    implement(verify, { resolve: async () => ({}), summarize: () => "Verification form." }),
  ],
});
const who = { conversationId: "c1", subject: "user-1" };
const handler = uiCallingHandler(ui);
const token = (url: string) => url.split("/s/")[1];
const http = (path: string, body?: unknown) =>
  handler(
    new Request(`https://ui.example.com/api/ui${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
  );

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

await check("completed: the link stops working for reads, actions and lifecycle events", async () => {
  const t = token((await ui.call("show_ticket", { ticket_id: "T-1" }, who)).url);
  assert.equal((await http(`/sessions/${t}`)).status, 200);
  assert.equal((await http(`/sessions/${t}/events`, { type: "opened" })).status, 200);
  assert.equal((await http(`/sessions/${t}/events`, { type: "completed" })).status, 200);

  for (const res of [
    await http(`/sessions/${t}`),
    await http(`/sessions/${t}/events`, { type: "closed", payload: {} }),
    await http(`/sessions/${t}/events`, { type: "opened" }),
    await http(`/sessions/${t}/events`, { type: "completed" }),
  ]) {
    assert.equal(res.status, 410);
    assert.equal(((await res.json()) as { error: string }).error, "completed", "the screen can tell done from expired");
  }
  const events = await ui.events("c1");
  assert.deepEqual(events.map((e) => e.type), ["opened", "completed"], "nothing is recorded after completion");
});

await check("completed: other links for the same user keep working", async () => {
  const a = token((await ui.call("show_ticket", { ticket_id: "T-2" }, who)).url);
  const b = token((await ui.call("show_ticket", { ticket_id: "T-3" }, who)).url);
  await ui.emit(a, "completed");
  assert.equal((await http(`/sessions/${b}`)).status, 200);
});

await check("ttl: a surface's ttlSeconds overrides the default; others get 1 hour", async () => {
  const minutes = (iso: string) => Math.round((Date.parse(iso) - Date.now()) / 60_000);
  assert.equal(minutes((await ui.call("show_verify", {}, who)).expiresAt), 10);
  assert.equal(minutes((await ui.call("show_ticket", { ticket_id: "T-4" }, who)).expiresAt), 60);
  const run = await ui.runTool("show_verify", {}, who);
  assert.ok(run.ok && minutes(JSON.parse(run.content).expires_at) === 10, "the model is told the real expiry");
});

console.log(`\n${passed} checks passed`);
