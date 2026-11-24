import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

const slot = z.object({ date: z.string().describe("ISO date, YYYY-MM-DD"), window: z.string() });

export const orderStatus = defineSurface({
  name: "order_status",
  description:
    "Live status of a customer's order: tracking steps, delivery date, items and total. Lets the user reschedule the delivery or report a problem. Use it when the user asks where their order is, when it arrives, or wants to change the delivery.",
  input: z.object({ order_id: z.string().describe("The order to show, e.g. A-1042") }),
  cta: { en: "View order", es: "Ver pedido" },
  data: z.object({
    id: z.string(),
    status: z.enum(["placed", "shipped", "in_transit", "out_for_delivery", "delivered", "issue"]),
    carrier: z.string(),
    trackingCode: z.string(),
    eta: slot,
    address: z.string(),
    currency: z.string(),
    items: z.array(z.object({ name: z.string(), qty: z.number(), price: z.number() })),
    steps: z.array(z.object({ key: z.string(), label: z.string(), at: z.string().nullable() })),
    rescheduleOptions: z.array(slot),
    issue: z.object({ reason: z.string(), ticket: z.string() }).nullable(),
  }),
  events: {
    reschedule_delivery: event(slot, {
      describe: (p) => `User rescheduled the delivery to ${p.date}, ${p.window}`,
      wake: true,
    }),
    report_problem: event(
      z.object({
        reason: z.enum(["damaged", "missing_items", "wrong_address", "late", "other"]),
        details: z.string().max(500),
      }),
      { describe: (p) => `User reported a problem (${p.reason}): "${p.details}"`, wake: true },
    ),
    viewed_items: event(z.object({}), { describe: () => "User expanded the item list" }),
  },
});
