import { serve } from "@hono/node-server";
import { MODE } from "./agent";
import { app } from "./app";
import { PUBLIC_URL } from "./ui";

serve({ fetch: app.fetch, port: 8787 }, () => {
  console.log(`UI_calling demo API on http://localhost:8787 · agent: ${MODE} · links: ${PUBLIC_URL}/s/…`);
});
