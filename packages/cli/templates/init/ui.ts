import { createUiCalling } from "@ui-calling/core";
import { store } from "./store";
// ui-calling:imports

/**
 * Your UI_calling runtime: the surfaces your agent can open, and where their events go.
 * `npx ui-calling new <name>` scaffolds a surface and registers it here.
 * Guide: `npx ui-calling guide`.
 */
export const ui = createUiCalling({
  // Public origin of this app: links look like `${baseUrl}/s/<token>`.
  baseUrl: process.env.PUBLIC_URL ?? "__BASE_URL__",
  surfaces: [
    /* ui-calling:surfaces */
  ],
  // Sessions, events and files: see store.ts, which your own server code can use too.
  store,
  // "button" if your channel sends links as buttons (e.g. WhatsApp); "message" if the model writes them in its reply.
  deliverLinks: "__DELIVER__",
  // Wake the agent if a user opens a screen and does nothing for 10 minutes.
  abandonAfterMs: 10 * 60_000,
  onEvent: async (event) => {
    console.log(`[ui_calling] ${event.surface} ${event.type}: ${event.description}`);
  },
});

// The return path to your agent lives in your agent's module, which imports `ui`. Subscribe from there, so this
// file doesn't import the agent (an import cycle):
//
//   ui.onEvent((event) => {
//     // Store it with conversation `event.conversationId`; if `event.wake`, run a turn with
//     // formatEventsForAgent([...]) from "@ui-calling/core" as a user message.
//   });
