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
  // "button": your code shows each link (a WhatsApp button, a button in your own web chat), so it never depends on the
  // model. "message": the model writes the URL in its reply, for channels you can't attach a button to (MCP, SMS).
  deliverLinks: "__DELIVER__",
  // The business's time zone: times the agent reads are written in it (see moment.time() in summarize).
  timeZone: "UTC",
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
//     // If `event.wake`, run a turn for `event.conversationId` and `event.subject` (the user, for the tools), with
//     // the events since your last turn (ui.events(id, { after })) as formatEventsForAgent(...) in a user message.
//   });
//
// A whole agent module: npx ui-calling guide running.
