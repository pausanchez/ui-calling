import { SurfaceError, implement } from "@ui-calling/core";
import { orderStatus } from "./order-status.surface";

/**
 * Server-side half of "order_status": where orders come from and what the user's choices do.
 * `ui-calling add` writes this once and never overwrites it: it's your data code.
 * Register it: createUiCalling({ surfaces: [orderStatusImpl, ...] }).
 */
export const orderStatusImpl = implement(orderStatus, {
  // Runs when the link is opened. Only return orders that `ctx.subject` (the user the link was sent to) owns.
  resolve: async ({ order_id }, ctx) => {
    // TODO: load the order from your database or orders API, and check it belongs to ctx.subject.
    // Throw SurfaceError for expected failures (not found, API down): the agent is told.
    if (!order_id) throw new SurfaceError("order_not_found", "No order id was given");
    return exampleOrder(order_id);
  },
  // Everything the screen shows, in one line: this is the agent's view of the screen.
  summarize: (o) =>
    `Order ${o.id}: ${o.status.replace(/_/g, " ")} with ${o.carrier} (${o.trackingCode}), ` +
    `delivery ${o.eta.date} ${o.eta.window} to ${o.address}. ` +
    `Items: ${o.items.map((i) => `${i.qty}× ${i.name}`).join(", ")}. ` +
    `Other slots offered: ${o.rescheduleOptions.map((s) => `${s.date} ${s.window}`).join("; ") || "none"}.` +
    (o.issue ? ` Open issue: ${o.issue.reason}, ticket ${o.issue.ticket}.` : ""),
  on: {
    reschedule_delivery: async (slot, ctx) => {
      // TODO: book the slot with your carrier. Throw SurfaceError("slot_unavailable", …) if it's gone,
      // or with { retryable: true } for timeouts, so the screen only offers "Try again" when it can work.
      return { ...exampleOrder(ctx.input.order_id), eta: slot };
    },
    report_problem: async (p, ctx) => {
      // TODO: open a ticket in your support tool.
      return { ...exampleOrder(ctx.input.order_id), status: "issue" as const, issue: { reason: p.reason, ticket: "TODO-1" } };
    },
  },
});

/** Placeholder so the screen renders before it's wired to real data. Delete it once `resolve` loads real orders. */
function exampleOrder(id: string) {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA");
  return {
    id,
    status: "in_transit" as const,
    carrier: "Rapido Express",
    trackingCode: "RX-000000",
    eta: { date: day(2), window: "9:00–13:00" },
    address: "1 Example Street",
    currency: "EUR",
    items: [{ name: "Example item", qty: 1, price: 19.9 }],
    steps: [
      { key: "placed", label: "Order placed", at: new Date(Date.now() - 2 * 86_400_000).toISOString() },
      { key: "shipped", label: "Shipped", at: new Date(Date.now() - 86_400_000).toISOString() },
      { key: "in_transit", label: "In transit", at: new Date().toISOString() },
      { key: "out_for_delivery", label: "Out for delivery", at: null },
      { key: "delivered", label: "Delivered", at: null },
    ],
    rescheduleOptions: [
      { date: day(3), window: "9:00–13:00" },
      { date: day(4), window: "15:00–19:00" },
    ],
    issue: null,
  };
}
