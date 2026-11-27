import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { uiCallingRoutes } from "@ui-calling/server";
import { ui } from "__UI_IMPORT__";

/**
 * Your API server. In development Vite proxies /api here (vite.config), so the screens and the CLI reach it at
 * your Vite address. Add your agent's routes (chat, webhook) next to ui-calling's.
 * Run it with `npm run dev:api` next to `npm run dev`.
 */
const app = new Hono();

// The screens' API. In development also the routes `npx ui-calling link` and `events` use (localhost only).
app.route("/api/ui", uiCallingRoutes(ui, { dev: process.env.NODE_ENV !== "production" }));

const port = Number(process.env.API_PORT ?? __API_PORT__);
serve({ fetch: app.fetch, port }, () => console.log(`API on http://localhost:${port}`));
