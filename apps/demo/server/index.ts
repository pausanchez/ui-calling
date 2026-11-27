import { serve } from "@hono/node-server";
import { MODE } from "./agent";
import { app } from "./app";
import { PUBLIC_URL } from "./ui";
import { checkWhatsApp } from "./whatsapp-setup";

serve({ fetch: app.fetch, port: 8787 }, () => {
  console.log(`ui-calling demo API on http://localhost:8787 · agent: ${MODE} · links: ${PUBLIC_URL}/s/…`);
  // tunnel.ts runs its own check once it has pointed the webhook here.
  if (process.env.DEMO_WHATSAPP_CHECK !== "0") void checkWhatsApp(PUBLIC_URL).then((lines) => lines.forEach((l) => console.log(l)));
});
