import { readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { verifyWhatsAppSignature } from "@ui-calling/core/whatsapp";
import { uiCallingRoutes } from "@ui-calling/server";
import { MODE, getConversation, handleUiEvent, receiveWebhook, resetConversation, snapshot } from "./agent";
import { seedIdentity } from "./identity";
import { seedOrders } from "./orders";
import { seedShifts } from "./shifts";
import { failures, onUiEvent, ui } from "./ui";
import { demoUser, inboundNumberChange, inboundText, seedDemoUser } from "./whatsapp-sim";

/** The demo has one conversation. */
export const CONVERSATION = "demo";
onUiEvent(handleUiEvent);

/** The whole demo API, without a listener: `app.request(...)` drives it in-process (see smoke.ts). */
export const app = new Hono();

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
  void receiveWebhook(CONVERSATION, JSON.parse(raw));
  return c.text("OK");
});

app.get("/api/chat", (c) => c.json(snapshot(getConversation(CONVERSATION))));

/** The simulated phone: the text becomes the webhook Meta would send, and goes the same way as a real one. */
app.post("/api/chat", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "empty" }, 400);
  void receiveWebhook(CONVERSATION, inboundText(text.trim().slice(0, 2000)));
  return c.json(snapshot(getConversation(CONVERSATION)));
});

app.post("/api/chat/reset", (c) => {
  resetConversation(CONVERSATION);
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
  await receiveWebhook(CONVERSATION, inboundNumberChange());
  return c.json(demoUser);
});

if (process.env.NODE_ENV === "production") {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  const html = readFileSync("./dist/index.html", "utf8");
  app.get("*", (c) => c.html(html));
}
