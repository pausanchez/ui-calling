import { readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { verifyWhatsAppSignature } from "@ui-calling/core/whatsapp";
import { uiCallingRoutes } from "@ui-calling/server";
import {
  MODE,
  conversationsState,
  getConversation,
  handleUiEvent,
  onTurnEnd,
  receiveWebhook,
  resetConversations,
  snapshot,
} from "./agent";
import { linksState, seedIdentity } from "./identity";
import { ordersState, seedOrders } from "./orders";
import { seedShifts, shiftsState } from "./shifts";
import { failures, onUiEvent, store, ui } from "./ui";
import { demoUser, demoUserState, inboundNumberChange, inboundText, seedDemoUser } from "./whatsapp-sim";

/** The simulated phone's conversation. Real WhatsApp users each get their own, keyed by subject. */
export const CONVERSATION = "demo";
onUiEvent(handleUiEvent);

// The demo's own state (chat, links, mock data) lives next to UI_calling's sessions and events, in the
// same SQLite file, so a restart loses nothing. A real product keeps these in its own database.
store.db.exec("CREATE TABLE IF NOT EXISTS demo_state (key TEXT PRIMARY KEY, json TEXT NOT NULL)");
const STATE = { orders: ordersState, shifts: shiftsState, links: linksState, user: demoUserState, conversations: conversationsState };
const getState = store.db.prepare("SELECT json FROM demo_state WHERE key = ?");
const putState = store.db.prepare(
  "INSERT INTO demo_state (key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json",
);
function saveState() {
  for (const [key, s] of Object.entries(STATE)) putState.run(key, JSON.stringify(s.save()));
}
for (const [key, s] of Object.entries(STATE)) {
  const row = getState.get(key) as { json: string } | undefined;
  if (row) (s.load as (v: unknown) => void)(JSON.parse(row.json));
}
onTurnEnd(saveState);

/** The whole demo API, without a listener: `app.request(...)` drives it in-process (see smoke.ts). */
export const app = new Hono();

app.use("*", async (_c, next) => {
  await next();
  saveState();
});

app.route("/api/ui", uiCallingRoutes(ui));

/**
 * What a real integration exposes to Meta. Set WHATSAPP_APP_SECRET to require a valid signature
 * (always do in production), and WHATSAPP_VERIFY_TOKEN to answer Meta's subscription check.
 */
app.get("/api/whatsapp/webhook", (c) => {
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && c.req.query("hub.mode") === "subscribe" && c.req.query("hub.verify_token") === token) {
    return c.text(c.req.query("hub.challenge") ?? "");
  }
  return c.text("Forbidden", 403);
});

app.post("/api/whatsapp/webhook", async (c) => {
  const raw = await c.req.text();
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret && !(await verifyWhatsAppSignature(raw, c.req.header("x-hub-signature-256"), secret))) {
    return c.text("Invalid signature", 401);
  }
  void receiveWebhook(JSON.parse(raw));
  return c.text("OK");
});

// `?conversation=wa:…` shows a real WhatsApp user's chat; without it, the simulated phone's.
app.get("/api/chat", (c) => c.json(snapshot(getConversation(c.req.query("conversation") ?? CONVERSATION))));

/** The simulated phone: the text becomes the webhook Meta would send, and goes the same way as a real one. */
app.post("/api/chat", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "empty" }, 400);
  void receiveWebhook(inboundText(text.trim().slice(0, 2000)), CONVERSATION);
  return c.json(snapshot(getConversation(CONVERSATION)));
});

app.post("/api/chat/reset", (c) => {
  resetConversations();
  seedOrders();
  seedShifts();
  seedIdentity();
  seedDemoUser();
  failures.ordersApi = failures.carrierApi = failures.schedulingApi = false;
  return c.json(snapshot(getConversation(CONVERSATION)));
});

/** What the model is given: the tool definitions generated from the surface contracts. */
app.get("/api/demo/tools", (c) =>
  c.json({
    agent: MODE,
    model: MODE === "claude" ? "claude-opus-5-5" : null,
    tools: ui.tools(),
    whatsappEndpoint: "POST https://graph.facebook.com/<version>/<phone-number-id>/messages",
  }),
);

app.get("/api/demo/failures", (c) => c.json(failures));
app.post("/api/demo/failures", async (c) => {
  const body = await c.req.json<Partial<typeof failures>>();
  if (typeof body.ordersApi === "boolean") failures.ordersApi = body.ordersApi;
  if (typeof body.carrierApi === "boolean") failures.carrierApi = body.carrierApi;
  if (typeof body.schedulingApi === "boolean") failures.schedulingApi = body.schedulingApi;
  return c.json(failures);
});

/** Who the simulated user is, as WhatsApp would present them. */
app.get("/api/demo/identity", (c) => c.json(demoUser));
app.post("/api/demo/identity", async (c) => {
  const body = await c.req.json<{ phoneShared?: boolean }>();
  if (typeof body.phoneShared === "boolean") demoUser.phoneShared = body.phoneShared;
  return c.json(demoUser);
});
/** The user changes phone number: Meta sends a system message with their new BSUID. */
app.post("/api/demo/identity/change-number", async (c) => {
  await receiveWebhook(inboundNumberChange(), CONVERSATION);
  return c.json(demoUser);
});

if (process.env.NODE_ENV === "production") {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  const html = readFileSync("./dist/index.html", "utf8");
  app.get("*", (c) => c.html(html));
}
