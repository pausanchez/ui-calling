# A form with several steps

Use it when the user has to give several answers in order (a return, a claim, an application) and may stop halfway and come back. It's one surface with the steps inside the screen, not one surface per step.

Full example: the demo's `order_return` (items, reasons, photos, pickup, review).

## Contract

One quiet event per step saves a draft. Only the last step wakes the agent. `data` holds the draft, including the furthest step reached.

```ts
export const RETURN_STEPS = ["items", "reasons", "photos", "pickup", "review"] as const;

export const orderReturn = defineSurface({
  name: "order_return",
  // ...
  data: z.object({
    // ...the order...
    draft: z.object({ step: z.enum(RETURN_STEPS), lines: z.array(line), refund: refund.nullable(), pickup: slot.nullable() }),
    submitted: z.object({ returnId: z.string(), refundAmount: z.number() }).nullable(),
  }),
  events: {
    items_chosen: event(z.object({ lines: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1) })).min(1) }), {
      describe: (p) => `Step 1 of 5: chose items to return: ${p.lines.map((l) => `${l.qty}× ${l.sku}`).join(", ")}`,
    }),
    // reasons_given, photos_added, pickup_chosen: same shape, no wake
    return_submitted: event(z.object({}), { describe: () => "Step 5 of 5: submitted the return", wake: true }),
  },
});
```

## Server

Each handler validates its step, saves it, and returns the fresh draft. Save "the furthest step reached" forward only, so going back to edit doesn't lose progress. The last handler checks everything again before acting.

```ts
items_chosen: async ({ lines }, ctx) => {
  const r = getReturn(orderId(ctx), ctx.subject);
  for (const l of lines) {
    const item = r.items.find((i) => i.sku === l.sku);
    if (!item?.returnable || l.qty > item.qty) throw new SurfaceError("item_not_returnable", `${l.sku} can't be returned in that quantity`);
  }
  return saveDraft(r.orderId, ctx.subject, { lines: withPreviousReasons(lines, r) }, "reasons");
},
return_submitted: async (_p, ctx) => {
  const r = getReturn(orderId(ctx), ctx.subject);
  if (r.submitted) return r; // a double tap submits once
  if (!r.draft.lines.length || !r.draft.refund || !r.draft.pickup) throw new SurfaceError("return_incomplete", "The return is missing items, refund or pickup");
  return submitReturn(r.orderId, ctx.subject);
},
```

`summarize` describes the draft while it's in progress ("Draft, reached step 3 of 5. Items: …") and the outcome once submitted ("Submitted as R-5327: … Refund of 79.00 EUR …").

## Screen

Keep the answers in component state, start from `data.draft`, and save with `emit` on **Continue**. Push a history entry per step, so the phone's back button goes to the previous step instead of closing the screen.

```tsx
const [lines, setLines] = useState(data.draft.lines);
const [step, setStep] = useState(data.draft.step); // resume where they stopped

useEffect(() => {
  const onPop = (e: PopStateEvent) => e.state?.returnStep && setStep(e.state.returnStep);
  // Opened fresh on a later step: add the earlier steps behind it, or Back would leave the screen.
  if (!history.state?.returnStep) {
    history.replaceState({ ...history.state, returnStep: path[0] }, "");
    for (const s of path.slice(1, at + 1)) history.pushState({ ...history.state, returnStep: s }, "");
  }
  window.addEventListener("popstate", onPop);
  return () => window.removeEventListener("popstate", onPop);
}, []);

async function next() {
  if (current === "items") await emit("items_chosen", { lines: lines.map(({ sku, qty }) => ({ sku, qty })) });
  // ...one emit per step...
  go(path[at + 1]); // setStep + history.pushState
}
```

## Watch out

- **Skip steps that don't apply** (no photos unless an item is damaged), and number them for the path the user will actually see.
- **`abandoned` treats the waking event as the finish line.** A user who saves two steps and goes quiet gets "User stopped partway without finishing. Last step: …". See [follow-up-abandoned](follow-up-abandoned.md).
- **Resuming must not re-apply a prefill** over the user's own choice. See [prefill](prefill.md).
- **Double submit:** make the last handler idempotent (return the submitted result if it already exists).

## In the repo

- Contract: [`order-return.surface.ts`](../../../apps/demo/src/components/ui-calling/order-return.surface.ts)
- Server: [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts), drafts in [`returns.ts`](../../../apps/demo/server/returns.ts)
- Screen: [`order-return.tsx`](../../../apps/demo/src/components/ui-calling/order-return.tsx)
- Proof: the `returns:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
