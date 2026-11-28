import { SurfaceError, implement, type SurfaceData } from "@ui-calling/core";
import { drafts } from "../init/store";
import { __const__, __const__Steps } from "./__name__.surface";

type Data = SurfaceData<typeof __const__>;
type Step = Data["draft"]["step"];
// `sentIn`: the link it was sent from. A sent draft is final there; a later link starts a new one.
type Saved = Pick<Data, "draft" | "submitted"> & { sentIn?: string };

// Drafts live in init's store (SQLite or Postgres, whichever you set up), so a restart keeps them. Move them to your
// own database when you have one.
const draftKey = (subject: string, id: string) => `__surface__:${subject}:${id}`;

/**
 * Load the record, start the draft, and apply what the agent already knows until the user saves their own choice.
 * `resolve` passes the link's session: a draft sent through another link is done, so this link starts a new one.
 */
async function load(id: string, subject: string, opts: { prefill?: string; session?: string } = {}): Promise<Data> {
  // TODO: load from your data source, and only what `subject` (the user the link was sent to) may see.
  const options = [
    { id: "a", label: "Option A" },
    { id: "b", label: "Option B" },
  ];
  const key = draftKey(subject, id);
  const fresh: Saved = { draft: { step: "details" as Step, details: "", choice: null }, submitted: null };
  let saved = (await drafts.get<Saved>(key)) ?? fresh;
  if (saved.submitted && opts.session && saved.sentIn !== opts.session) saved = fresh;
  const { prefill } = opts;
  if (prefill && options.some((o) => o.id === prefill) && __const__Steps.indexOf(saved.draft.step) < __const__Steps.indexOf("review")) {
    saved.draft = { ...saved.draft, choice: saved.draft.choice ?? prefill };
  }
  await drafts.set(key, saved);
  return { id, options, draft: saved.draft, submitted: saved.submitted };
}

/** Save a step: merge it into the draft, and move the furthest step reached forward, never back. */
async function save(id: string, subject: string, patch: Partial<Data["draft"]>, reached: Step) {
  const d = await load(id, subject);
  const step = __const__Steps.indexOf(reached) > __const__Steps.indexOf(d.draft.step) ? reached : d.draft.step;
  await drafts.set(draftKey(subject, id), { draft: { ...d.draft, ...patch, step }, submitted: d.submitted });
  return load(id, subject);
}

/**
 * Server-side half of "__surface__". Each handler checks its step, saves it, and returns fresh data.
 * Register it: createUiCalling({ surfaces: [__const__Impl, ...] }).
 */
export const __const__Impl = implement(__const__, {
  resolve: async ({ id, choice }, ctx) => load(id, ctx.subject, { prefill: choice, session: ctx.session.id }),
  // The agent's view of the screen, in one line: the draft while in progress, the outcome once submitted.
  // Report what was saved, never the tool's input: the user may have changed what the agent preselected.
  summarize: (d) =>
    d.submitted
      ? `Submitted as ${d.submitted.reference}: details "${d.draft.details}", choice ${d.draft.choice}.`
      : `Draft for ${d.id}, reached step ${__const__Steps.indexOf(d.draft.step) + 1} of ${__const__Steps.length} (${d.draft.step}). ` +
        `Details: ${d.draft.details || "none yet"}. Choice: ${d.draft.choice ?? "none yet"}.`,
  on: {
    details_saved: async ({ details }, ctx) => {
      if (!details.trim()) throw new SurfaceError("details_missing", "The details are empty", { refused: true });
      return save(ctx.input.id, ctx.subject, { details: details.trim() }, "choice");
    },
    choice_saved: async ({ choice }, ctx) => {
      const id = ctx.input.id;
      if (!(await load(id, ctx.subject)).options.some((o) => o.id === choice)) throw new SurfaceError("unknown_choice", `No option ${choice}`, { refused: true });
      return save(id, ctx.subject, { choice }, "review");
    },
    submitted: async (_p, ctx) => {
      const id = ctx.input.id;
      const d = await load(id, ctx.subject);
      if (d.submitted) return ctx.unchanged(d); // a double tap: no second event, no second wake
      if (!d.draft.details || !d.draft.choice) throw new SurfaceError("incomplete", "Details or choice is missing", { refused: true });
      // TODO: do the real thing here. Throw SurfaceError(code, message, { retryable: true }) if a system behind it fails.
      await drafts.set(draftKey(ctx.subject, id), { draft: d.draft, submitted: { reference: `R-${Math.floor(1000 + Math.random() * 9000)}` }, sentIn: ctx.session.id });
      return load(id, ctx.subject);
    },
  },
});
