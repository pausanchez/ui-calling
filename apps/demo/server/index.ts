import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { uiCallingRoutes } from "@ui-calling/server";
import { MODE, getConversation, handleUiEvent, handleUserMessage, resetConversation, snapshot } from "./agent";
import { seedOrders } from "./orders";
import { PUBLIC_URL, onUiEvent, ui } from "./ui";

const CONVERSATION = "demo";
onUiEvent(handleUiEvent);

const app = new Hono();

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
  return c.json(snapshot(getConversation(CONVERSATION)));
});

if (process.env.NODE_ENV === "production") {
  app.use("/assets/*", serveStatic({ root: "./dist" }));
  const html = readFileSync("./dist/index.html", "utf8");
  app.get("*", (c) => c.html(html));
}

serve({ fetch: app.fetch, port: 8787 }, () => {
  console.log(`UI_calling demo API on http://localhost:8787 · agent: ${MODE} · links: ${PUBLIC_URL}/s/…`);
});
