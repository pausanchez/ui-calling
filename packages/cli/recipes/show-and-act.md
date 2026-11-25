# Show something and let the user act on it

Use it when the answer is easier to see than to read (an order's tracking steps, a booking, an invoice) and the user may want to change something from there.

Full example: the demo's `order_status` (`npx ui-calling add order-status` gives you a copy).

## Contract

`describe` says what the user asked for; `wake: true` makes the agent react now. Small events that only add context stay quiet.

```ts
export const orderStatus = defineSurface({
  name: "order_status",
  description: "Live status of a customer's order... Use it when the user asks where their order is, when it arrives, or wants to change the delivery.",
  input: z.object({ order_id: z.string().describe("The order to show, e.g. A-1042") }),
  cta: { en: "View order", es: "Ver pedido" },
  data: z.object({ id: z.string(), status: z.enum([/* ... */]), eta: slot, rescheduleOptions: z.array(slot), /* ... */ }),
  events: {
    reschedule_delivery: event(slot, {
      describe: (p) => `User asked to move the delivery to ${p.date}, ${p.window}`,
      wake: true,
    }),
    viewed_items: event(z.object({}), { describe: () => "User expanded the item list" }),
  },
});
```

## Server

Every action returns fresh data, and `summarize` turns it into the one line the agent reads. That line is how the outcome (the new date, a ticket number) reaches the agent.

```ts
export const orderStatusImpl = implement(orderStatus, {
  resolve: async ({ order_id }, ctx) => getOrder(order_id, ctx.subject),
  summarize: (o) => `Order ${o.id}: ${o.status}, delivery ${o.eta.date} ${o.eta.window} to ${o.address}. ...`,
  on: {
    reschedule_delivery: async (slot, ctx) => updateOrder(String(ctx.session.input.order_id), ctx.subject, { eta: slot }),
  },
});
```

## Screen

```tsx
const { status, data, emit, complete, returnUrl } = useSurface(orderStatus);
// ...
await emit("reschedule_delivery", slot); // data updates with what the handler returned
// "Back to chat" closes the link and tells the agent the user is done:
<a href={returnUrl} onClick={() => void complete()}>Back to chat</a>
```

## Watch out

- **Write `describe` as the request, not the result.** "User asked to move the delivery to…", never "Delivery was moved". If the handler fails, the agent reads your line as "did NOT go through. Attempted: …".
- **Look data up by `ctx.subject`.** The order ID comes from the agent, so `getOrder` must check the order belongs to this user.
- **Keep `summarize` to one line** with everything the screen shows. The agent answers later questions ("what was the tracking code?") from it.

## In the repo

- Contract: [`order-status.surface.ts`](../../../apps/demo/src/components/ui-calling/order-status.surface.ts)
- Server: [`order-status.server.ts`](../../../apps/demo/server/order-status.server.ts)
- Screen: [`order-status.tsx`](../../../apps/demo/src/components/ui-calling/order-status.tsx)
- Proof: the `order:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
