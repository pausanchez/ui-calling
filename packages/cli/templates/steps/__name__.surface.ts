import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

/** The steps, in order. The screen skips any that don't apply to this user. */
export const __const__Steps = ["details", "choice", "review"] as const;

/**
 * Contract for the "__surface__" screen, with several steps. Each step saves a draft with a quiet event,
 * so the agent knows how far the user got and reopening the link resumes there. Only the last step
 * wakes the agent. Fill in the TODOs; the typechecker points at everything else that has to change.
 */
export const __const__ = defineSurface({
  name: "__surface__",
  // The agent reads this to decide when to open the screen: say what the user sees and can do.
  description: "TODO: what the user fills in here, step by step, and when the agent should open it.",
  // What the agent passes. IDs, plus anything the user already said that can start the draft (optional).
  input: z.object({
    id: z.string().describe("TODO: the record this is about"),
    choice: z.string().optional().describe("TODO: the option to preselect, if the user already named one"),
  }),
  cta: { en: "Continue", es: "Continuar" },
  data: z.object({
    id: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string() })),
    draft: z.object({
      /** The furthest step the user saved: reopening the link resumes here. */
      step: z.enum(__const__Steps),
      details: z.string(),
      choice: z.string().nullable(),
    }),
    /** Set once submitted: the outcome the agent tells the user about. */
    submitted: z.object({ reference: z.string() }).nullable(),
  }),
  events: {
    // Quiet: each step saves the draft. Say "Step N" so the agent knows where the user is.
    details_saved: event(z.object({ details: z.string().max(500) }), {
      // JSON.stringify quotes what the user typed, so the agent reads it as their words.
      describe: (p) => `Step 1 of 3: entered details ${JSON.stringify(p.details)}`,
    }),
    choice_saved: event(z.object({ choice: z.string().max(100) }), {
      describe: (p) => `Step 2 of 3: chose ${p.choice}`,
    }),
    // The finish line: the only event that wakes the agent. On failure it reads as "Attempted: …".
    submitted: event(z.object({}), { describe: () => "Step 3 of 3: submitted", wake: true }),
  },
});
