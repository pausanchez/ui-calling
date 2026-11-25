# The agent fills in what it knows

Use it when the user already said something in the chat that the screen asks for ("the blender arrived cracked"): the agent passes it, and the screen starts with it selected. The user can still change it.

Full example: `sku` and `reason` in the demo's `order_return`.

## Contract

Optional inputs, with a `describe` that tells the model when to pass them. Say it in the surface's `description` too.

```ts
input: z.object({
  order_id: z.string().describe("The delivered order, e.g. A-0987"),
  sku: z.string().optional().describe("The item to preselect, if the user named one"),
  reason: z.enum(RETURN_REASONS).optional().describe("The reason to preselect, if the user gave one"),
}),
```

## Server

Apply the prefill in `resolve`, into the draft, and **only while the user hasn't saved their own choice**. A second link (the user asks again) must not overwrite what they picked.

```ts
resolve: async ({ order_id, sku, reason }, ctx) => {
  const r = getReturn(order_id, ctx.subject);
  const item = r.items.find((i) => i.sku === sku && i.returnable);
  const itemsSaved = r.submitted || r.draft.step !== "items";
  if (item && !itemsSaved && !r.draft.lines.some((l) => l.sku === item.sku)) {
    addLine(r, { sku: item.sku, qty: 1, reason: reason ?? null, details: "" });
  }
  return getReturn(order_id, ctx.subject);
},
```

## Prompt

The model can only pass IDs it has. Put them in the system prompt for this user:

```text
Returnable orders: A-0987, delivered 2026-11-19: BL-200 Countertop blender, GB-3 Glass mixing bowls (set of 3), KS-1 Kitchen scale (not returnable).
```

## Watch out

- **The user's choice beats the prefill.** `summarize` reports what was saved, never the tool's `input`. In a real test, the agent opened a return for the cracked blender and the user returned the bowls instead. The agent's reply named the bowls, because it read the outcome from `summarize`.
- **Without the IDs in the prompt, the model can't prefill.** Ours called the tool without `sku` until the prompt listed the SKUs.
- **A prefill that only works the first time looks like a bug.** If an empty draft already exists from an earlier link, the prefill must still apply; the check above uses "has the user saved items yet", not "does a draft exist".

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- `getReturn` in [`returns.ts`](../../../apps/demo/server/returns.ts), `resolve` in [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts)
- The prompt: `describeReturnable` in [`returns.ts`](../../../apps/demo/server/returns.ts), used in `systemPrompt()` in [`agent.ts`](../../../apps/demo/server/agent.ts)
- Proof: "a later call can still preselect the item, until the user saves their own choice" in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
