import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

/**
 * Contract for the "link_account" screen: the user proves who they are with a one-time code, so this chat's
 * subject (e.g. a WhatsApp BSUID) gets linked to their customer or employee record.
 */
export const linkAccount = defineSurface({
  name: "link_account",
  description:
    "Lets the user verify who they are with a one-time code sent to their email, so this chat gets linked to their account. Open it when the user asks about anything personal and their account isn't linked yet. After it's linked, continue with what they asked for.",
  input: z.object({
    continue_with: z.string().max(200).describe("What the user asked for, in a few words, so you can pick it up after linking"),
  }),
  cta: { en: "Verify it's you", es: "Verificar identidad" },
  // Whoever holds this link can link the chat to an account: keep it short-lived.
  ttlSeconds: 15 * 60,
  // Closing it unfinished is worth a nudge: the user wanted something that needs it.
  abandonAfterMs: 10 * 60_000,
  data: z.object({
    stage: z.enum(["start", "code_sent", "linked"]),
    /** Where the code went, masked (e.g. "a***@example.com"). Null until a code is sent. */
    sentTo: z.string().nullable(),
    name: z.string().nullable(),
    continueWith: z.string(),
  }),
  events: {
    code_requested: event(z.object({ identifier: z.string().trim().min(1).max(200) }), {
      describe: () => "User asked for a verification code",
      // The email they typed is personal data the agent doesn't need.
      includePayload: false,
    }),
    code_entered: event(z.object({ code: z.string().trim().max(12) }), {
      // The code never reaches the agent or the event log; the handler still gets it.
      redact: ["code"],
      describe: () => "User entered their verification code",
      includePayload: false,
      wake: true,
    }),
    start_over: event(z.object({}), { describe: () => "User started over" }),
  },
});
