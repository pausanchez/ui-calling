import { readFileSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { uiCallingRoutes } from "@ui-calling/server";
import { getConversation, handleUiEvent, handleUserMessage, resetConversation, snapshot } from "./agent";
import { seedOrders } from "./orders";
import { seedShifts } from "./shifts";
import { failures, onUiEvent, ui } from "./ui";

/** The demo has one conversation. */
export const CONVERSATION = "demo";
onUiEvent(handleUiEvent);

/** The whole demo API, without a listener: `app.request(...)` drives it in-process (see smoke.ts). */
export const app = new Hono();

app.route("/api/ui", uiCallingRoutes(ui));

app.get("/api/chat", (c) => c.json(snapshot(getConversation(CONVERSATION))));

app.post("/api/chat", async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: "empty" }, 400);
  const conv = getConversation(CONVERSATION);
  void handleUserMessage(conv, text.trim().slice(0, 2000));
  return c.json(snapshot(conv));
});

app.post("/api/chat/reset", (c) => {
  resetConversation(CONVERSATION);
  seedOrders();
  seedShifts();
  failures.ordersApi = failures.carrierApi = failures.schedulingApi = false;
  return c.json(snapshot(getConversation(CONVERSATION)));
});

app.get("/api/demo/failures", (c) => c.json(failures));
app.post("/api/demo/failures", async (c) => {
  const body = await c.req.json<Partial<typeof failures>>();
  if (typeof body.ordersApi === "boolean") failures.ordersApi = body.ordersApi;
  if (typeof body.carrierApi === "boolean") failures.carrierApi = body.carrierApi;
  if (typeof body.schedulingApi === "boolean") failures.schedulingApi = body.schedulingApi;
  return c.json(failures);
});

if (process.env.NODE_ENV === "production") {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  const html = readFileSync("./dist/index.html", "utf8");
  app.get("*", (c) => c.html(html));
}
