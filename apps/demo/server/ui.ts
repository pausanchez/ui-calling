import { createUiCalling, implement, type UiEvent } from "@ui-calling/core";
import { orderStatus } from "../src/components/ui-calling/order-status.surface";
import { getOrder, updateOrder } from "./orders";

export const PUBLIC_URL = process.env.PUBLIC_URL ?? "http://localhost:5173";

const listeners = new Set<(e: UiEvent) => void>();
export const onUiEvent = (fn: (e: UiEvent) => void) => listeners.add(fn);

export const ui = createUiCalling({
  baseUrl: PUBLIC_URL,
  abandonAfterMs: Number(process.env.ABANDON_AFTER_MS ?? 90_000),
  onEvent: (e) => listeners.forEach((fn) => fn(e)),
  surfaces: [
    implement(orderStatus, {
      resolve: async ({ order_id }, ctx) => getOrder(order_id, ctx.subject),
      // Everything the screen shows, in one line: this is the agent's view of the screen.
      summarize: (o) =>
        `Order ${o.id}: ${o.status.replace(/_/g, " ")} with ${o.carrier} (${o.trackingCode}), ` +
        `delivery ${o.eta.date} ${o.eta.window} to ${o.address}. ` +
        `Items: ${o.items.map((i) => `${i.qty}× ${i.name} at ${i.price} ${o.currency} each`).join(", ")}, ` +
        `total ${o.items.reduce((s, i) => s + i.qty * i.price, 0).toFixed(2)} ${o.currency}. ` +
        `Other slots offered: ${o.rescheduleOptions.map((s) => `${s.date} ${s.window}`).join("; ")}.` +
        (o.issue ? ` Open issue: ${o.issue.reason}, ticket ${o.issue.ticket}.` : ""),
      on: {
        reschedule_delivery: async (slot, ctx) => updateOrder(String(ctx.session.input.order_id), ctx.subject, { eta: slot }),
        report_problem: async (p, ctx) =>
          updateOrder(String(ctx.session.input.order_id), ctx.subject, {
            status: "issue",
            issue: { reason: p.reason, ticket: `INC-${Math.floor(1000 + Math.random() * 9000)}` },
          }),
      },
    }),
  ],
});
