import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

const mask = (email: string) => email.replace(/^(.).*(@.*)$/, "$1***$2");

/**
 * Contract for the "link_account" screen: the user proves who they are so this WhatsApp
 * user (BSUID) gets linked to their customer account. Needed when Meta doesn't share the
 * phone number, e.g. users who only use a WhatsApp username.
 */
export const linkAccount = defineSurface({
  name: "link_account",
  description:
    "Lets the user verify who they are (email and a one-time code) so this WhatsApp chat gets linked to their customer account. Open it when the user asks about anything personal (orders, shifts, payments) and their account isn't linked yet. After it's linked, continue with what they asked for.",
  input: z.object({
    continue_with: z
      .string()
      .max(200)
      .describe("What the user asked for, in a few words, so you can pick it up after linking"),
  }),
  cta: { en: "Verify it's you", es: "Verificar identidad" },
  // Whoever holds this link can link the chat to an account: keep it short-lived.
  ttlSeconds: 10 * 60,
  data: z.object({
    linked: z.boolean(),
    customerId: z.string().nullable(),
    customerName: z.string().nullable(),
    continueWith: z.string(),
    /** Demo only: stands in for the code a real product would email. */
    demoCode: z.string().nullable(),
  }),
  events: {
    verify_identity: event(z.object({ email: z.string().email().max(200), code: z.string().max(12) }), {
      // The code never reaches the agent or the event log; the handler still gets it.
      redact: ["code"],
      describe: (p) => `User asked to link this chat to the account with email ${mask(p.email)}`,
      wake: true,
    }),
  },
});
