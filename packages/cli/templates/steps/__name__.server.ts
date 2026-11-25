import { SurfaceError, implement, type SurfaceData } from "@ui-calling/core";
import { __const__, __const__Steps } from "./__name__.surface";

type Data = SurfaceData<typeof __const__>;
type Step = Data["draft"]["step"];

// TODO: keep drafts in your database. In memory, a restart loses them. For a prototype, the store `init`
// wrote can hold a table: import { store } from "<your ui-calling folder>/store", then use store.db.
const drafts = new Map<string, Pick<Data, "draft" | "submitted">>();

/** Load the record, start the draft, and apply what the agent already knows until the user saves their own choice. */
function load(id: string, subject: string, prefill?: string): Data {
  // TODO: load from your data source, and only what `subject` (the user the link was sent to) may see.
  const options = [
    { id: "a", label: "Option A" },
    { id: "b", label: "Option B" },
  ];
  const key = `${subject}:${id}`;
  const saved = drafts.get(key) ?? { draft: { step: "details" as Step, details: "", choice: null }, submitted: null };
  if (prefill && options.some((o) => o.id === prefill) && __const__Steps.indexOf(saved.draft.step) < __const__Steps.indexOf("review")) {
    saved.draft = { ...saved.draft, choice: saved.draft.choice ?? prefill };
  }
  drafts.set(key, saved);
  return { id, options, ...saved };
}

/** Save a step: merge it into the draft, and move the furthest step reached forward, never back. */
function save(id: string, subject: string, patch: Partial<Data["draft"]>, reached: Step) {
  const d = load(id, subject);
  const step = __const__Steps.indexOf(reached) > __const__Steps.indexOf(d.draft.step) ? reached : d.draft.step;
  drafts.set(`${subject}:${id}`, { draft: { ...d.draft, ...patch, step }, submitted: d.submitted });
  return load(id, subject);
}

/**
 * Server-side half of "__surface__". Each handler checks its step, saves it, and returns fresh data.
 * Register it: createUiCalling({ surfaces: [__const__Impl, ...] }).
 */
export const __const__Impl = implement(__const__, {
  resolve: async ({ id, choice }, ctx) => load(id, ctx.subject, choice),
  // The agent's view of the screen, in one line: the draft while in progress, the outcome once submitted.
  // Report what was saved, never the tool's input: the user may have changed what the agent preselected.
  summarize: (d) =>
    d.submitted
      ? `Submitted as ${d.submitted.reference}: details "${d.draft.details}", choice ${d.draft.choice}.`
      : `Draft for ${d.id}, reached step ${__const__Steps.indexOf(d.draft.step) + 1} of ${__const__Steps.length} (${d.draft.step}). ` +
        `Details: ${d.draft.details || "none yet"}. Choice: ${d.draft.choice ?? "none yet"}.`,
  on: {
    details_saved: async ({ details }, ctx) => {
      if (!details.trim()) throw new SurfaceError("details_missing", "The details are empty");
      return save(String(ctx.session.input.id), ctx.subject, { details: details.trim() }, "choice");
    },
    choice_saved: async ({ choice }, ctx) => {
      const id = String(ctx.session.input.id);
      if (!load(id, ctx.subject).options.some((o) => o.id === choice)) throw new SurfaceError("unknown_choice", `No option ${choice}`);
      return save(id, ctx.subject, { choice }, "review");
    },
    submitted: async (_p, ctx) => {
      const id = String(ctx.session.input.id);
      const d = load(id, ctx.subject);
      if (d.submitted) return d; // a double tap submits once
      if (!d.draft.details || !d.draft.choice) throw new SurfaceError("incomplete", "Details or choice is missing");
      // TODO: do the real thing here. Throw SurfaceError(code, message, { retryable: true }) if a system behind it fails.
      drafts.set(`${ctx.subject}:${id}`, { draft: d.draft, submitted: { reference: `R-${Math.floor(1000 + Math.random() * 9000)}` } });
      return load(id, ctx.subject);
    },
  },
});
