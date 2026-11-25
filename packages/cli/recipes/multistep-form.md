# A form with several steps

Use it when the user has to give several answers in order (a return, a claim, an application) and may stop halfway and come back. It's one surface with the steps inside the screen, not one surface per step.

Start from the template. It writes a working three-step screen (details, a choice, review) with everything below, and compiles as-is:

```bash
npx ui-calling new claim --template steps
```

Then change the steps to yours. The demo's `order_return` (items, reasons, photos, pickup, review) is the same pattern with five steps.

## Contract

One quiet event per step saves a draft. Only the last step wakes the agent. `data` holds the draft, including the furthest step reached.

```ts
export const claimSteps = ["details", "choice", "review"] as const;

export const claim = defineSurface({
  name: "claim",
  description: "...",
  input: z.object({
    id: z.string().describe("The record this is about"),
    choice: z.string().optional().describe("The option to preselect, if the user already named one"),
  }),
  data: z.object({
    id: z.string(),
    options: z.array(z.object({ id: z.string(), label: z.string() })),
    draft: z.object({ step: z.enum(claimSteps), details: z.string(), choice: z.string().nullable() }),
    submitted: z.object({ reference: z.string() }).nullable(),
  }),
  events: {
    details_saved: event(z.object({ details: z.string().max(500) }), { describe: (p) => `Step 1 of 3: entered details "${p.details}"` }),
    choice_saved: event(z.object({ choice: z.string() }), { describe: (p) => `Step 2 of 3: chose ${p.choice}` }),
    submitted: event(z.object({}), { describe: () => "Step 3 of 3: submitted", wake: true }),
  },
});
```

## Server

Each handler validates its step, saves it, and returns fresh data. The furthest step only moves forward, so going back to edit doesn't lose progress. The last handler checks everything again, and submits once even on a double tap.

```ts
// Your drafts table, in the store `init` wrote (ui-calling/store.ts): store.db is a node:sqlite DatabaseSync.
import { store } from "./store";
store.db.exec("CREATE TABLE IF NOT EXISTS claim_drafts (key TEXT PRIMARY KEY, json TEXT NOT NULL)");

function save(id: string, subject: string, patch: Partial<Draft>, reached: Step) {
  const d = load(id, subject);
  const step = claimSteps.indexOf(reached) > claimSteps.indexOf(d.draft.step) ? reached : d.draft.step;
  writeDraft(`${subject}:${id}`, { draft: { ...d.draft, ...patch, step }, submitted: d.submitted });
  return load(id, subject);
}

export const claimImpl = implement(claim, {
  resolve: async ({ id, choice }, ctx) => load(id, ctx.subject, choice), // applies the prefill, see the prefill recipe
  summarize: (d) =>
    d.submitted
      ? `Submitted as ${d.submitted.reference}: details "${d.draft.details}", choice ${d.draft.choice}.`
      : `Draft for ${d.id}, reached step ${claimSteps.indexOf(d.draft.step) + 1} of 3. Details: ${d.draft.details || "none yet"}.`,
  on: {
    details_saved: async ({ details }, ctx) => {
      if (!details.trim()) throw new SurfaceError("details_missing", "The details are empty", { refused: true });
      return save(ctx.input.id, ctx.subject, { details: details.trim() }, "choice");
    },
    choice_saved: async ({ choice }, ctx) => save(ctx.input.id, ctx.subject, { choice }, "review"),
    submitted: async (_p, ctx) => {
      const d = load(ctx.input.id, ctx.subject);
      if (d.submitted) return d; // a double tap submits once
      if (!d.draft.details || !d.draft.choice) throw new SurfaceError("incomplete", "Details or choice is missing", { refused: true });
      return submitClaim(d); // your system; throw SurfaceError(..., { retryable: true }) if it fails
    },
  },
});
```

## Screen

Two components. The outer one handles loading and errors; the inner one only renders once `data` is there, so its state can start from the draft. `useSurfaceSteps` keeps the step in the browser's history: the phone's back button goes to the previous step, a reload keeps the step, and a link opened straight onto step 3 gets steps 1 and 2 behind it.

```tsx
import { SurfaceActionError, useSurface, useSurfaceSteps } from "@ui-calling/react";
import { ActionBar } from "./parts/action-bar";
import { StepBar } from "./parts/step-bar";

export function Claim() {
  const { status, data } = useSurface(claim);
  if (status === "loading") return <Skeleton />;
  if (status !== "ready" || !data) return <Unavailable />; // expired, upstream_error...: see the template
  return data.submitted ? <Done reference={data.submitted.reference} /> : <Steps data={data} />;
}

function Steps({ data }: { data: Data }) {
  const { emit, locale } = useSurface(claim);
  const [details, setDetails] = useState(data.draft.details); // answers live here until each step is saved
  const [choice, setChoice] = useState(data.draft.choice);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<null | { message: string }>(null);

  const path = [...claimSteps]; // leave out steps that don't apply to this user
  const valid = { details: details.trim().length > 0, choice: Boolean(choice), review: true };
  // How far the user may go: the furthest step saved, but never past a step whose answer is missing now.
  const saved = path.reduce((at, s, i) => (claimSteps.indexOf(s) <= claimSteps.indexOf(data.draft.step) ? i : at), 0);
  const firstMissing = path.findIndex((s) => !valid[s]);
  const reached = firstMissing === -1 ? saved : Math.min(saved, firstMissing);
  const nav = useSurfaceSteps(path, { initial: path[reached] });

  async function next() {
    setBusy(true);
    setProblem(null);
    try {
      if (nav.step === "details") await emit("details_saved", { details });
      if (nav.step === "choice") await emit("choice_saved", { choice: choice! });
      if (nav.step === "review") await emit("submitted", {});
      if (!nav.isLast) {
        nav.next();
        window.scrollTo({ top: 0 });
      }
    } catch (err) {
      const e = err instanceof SurfaceActionError ? err : null;
      setProblem({ message: (e?.reason && t.errors[e.reason]) || (e?.code === "network" ? t.offline : t.failed) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <StepBar steps={path.map((s) => ({ key: s, label: t.steps[s] }))} index={nav.index} reached={reached} onSelect={nav.go} locale={locale} />
      {nav.step === "details" && <textarea value={details} onChange={(e) => setDetails(e.target.value)} />}
      {/* ...one block per step... */}
      <ActionBar
        back={nav.isFirst ? undefined : { label: t.back, onClick: nav.back }}
        primary={{ label: nav.isLast ? t.submit : t.next, onClick: () => void next(), busy }}
        problem={problem}
      />
    </>
  );
}
```

`t` is the screen's messages object in the user's language (`pickLocalized(MESSAGES, locale)`); the template has it in full, in English and Spanish.

## Watch out

- **Skip steps that don't apply** (no photos unless an item is damaged): pass only the steps the user will see, so "Step 2 of 4" is right. If a step drops out while the user is on it, `useSurfaceSteps` shows the one that took its place.
- **`abandoned` treats the waking event as the finish line.** A user who saves two steps and goes quiet gets "User stopped partway without finishing. Last step: …". See [follow-up-abandoned](follow-up-abandoned.md).
- **The furthest step isn't a free pass.** A user can go back and change an answer so a later step is needed again (a reason changed to "damaged" now needs photos). Cap how far they can jump at the first step with a missing answer, as above, and check everything again in the last handler.
- **A skipped step can be the saved one.** If the draft's step dropped out of the path, `path.indexOf` gives -1; count it by its place in the full order, as `saved` does above.
- **Resuming must not re-apply a prefill** over the user's own choice. See [prefill](prefill.md).
- **Photos in a draft:** a draft outlives its link. `ctx.files(ids)` accepts this user's uploads from earlier links to the same surface, so the draft's photo IDs still work when the agent opens the screen again. See [file-upload](file-upload.md).
- **Where drafts live:** in your database. In memory, a restart loses them; in a JSON file inside the project, `next dev` reloads the page on every save.

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- Contract: [`order-return.surface.ts`](../../../apps/demo/src/components/ui-calling/order-return.surface.ts)
- Server: [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts), drafts in [`returns.ts`](../../../apps/demo/server/returns.ts)
- Screen: [`order-return.tsx`](../../../apps/demo/src/components/ui-calling/order-return.tsx)
- Proof: the `returns:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
