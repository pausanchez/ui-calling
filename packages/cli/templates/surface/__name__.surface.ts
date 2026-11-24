import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

/**
 * Contract for the "__surface__" screen, shared by the agent (tool schema), the server
 * (validation) and the UI (typed data and events). Fill in the TODOs; the typechecker
 * points at everything else that has to change.
 */
export const __const__ = defineSurface({
  name: "__surface__",
  // The agent reads this to decide when to open the screen: say what the user sees and can do.
  description: "TODO: what the user can see and do here, and when the agent should open it.",
  // What the agent passes. Keep it to IDs: data is loaded server-side and never travels in the URL.
  input: z.object({
    id: z.string().describe("TODO: the record to show"),
  }),
  // Text of the link button in the chat, per language.
  cta: { en: "Open", es: "Abrir" },
  // Everything the screen renders, loaded by `resolve` when the link is opened.
  data: z.object({
    id: z.string(),
    title: z.string(),
    confirmed: z.boolean(),
  }),
  // What the screen reports back: facts the agent can talk about, not clicks.
  events: {
    confirmed: event(z.object({ note: z.string().max(500) }), {
      // Say what the user asked for. The outcome comes from summarize(); if the handler fails,
      // the agent reads this line as "Attempted: …". Payload fields are user data: keep them small.
      describe: (p) => `User chose to confirm${p.note ? `, with the note "${p.note}"` : ""}`,
      // Start an agent turn right away (e.g. to acknowledge in the chat).
      wake: true,
    }),
  },
});
