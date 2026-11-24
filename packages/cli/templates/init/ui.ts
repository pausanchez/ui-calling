import { createUiCalling } from "@ui-calling/core";
import { sqliteStore } from "@ui-calling/sqlite";
// ui-calling:imports

/**
 * Your UI_calling runtime: the surfaces your agent can open, and where their events go.
 * `npx ui-calling new <name>` scaffolds a surface and registers it here.
 * Guide: `npx ui-calling guide`.
 */
export const ui = createUiCalling({
  // Public origin of this app: links look like `${baseUrl}/s/<token>`.
  baseUrl: process.env.PUBLIC_URL ?? "__BASE_URL__",
  surfaces: [/* ui-calling:surfaces */],
  // Sessions and events in .ui-calling/ui-calling.db (Node's built-in SQLite): links and the agent's context
  // survive restarts. On serverless hosts without a lasting disk, implement UiStore for your database.
  store: sqliteStore(),
  // "button" if your channel sends links as buttons (e.g. WhatsApp); "message" if the model writes them in its reply.
  deliverLinks: "__DELIVER__",
  // Wake the agent if a user opens a screen and does nothing for 10 minutes.
  abandonAfterMs: 10 * 60_000,
  onEvent: async (event) => {
    // The return path to your agent. Store the event with conversation `event.conversationId`;
    // if `event.wake`, run an agent turn with `formatEventsForAgent([...])` from "@ui-calling/core"
    // as a user message, so it can follow up on what happened on the screen.
    console.log(`[ui_calling] ${event.surface} ${event.type}: ${event.description}`);
  },
});
