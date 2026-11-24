import type { SurfaceData } from "@ui-calling/core";
import type { orderStatus } from "../src/components/ui-calling/order-status.surface";
import { customerFor, requireCustomer } from "./identity";

type Order = SurfaceData<typeof orderStatus> & { owner: string };

// Stand-in for the product's real order system.
const orders = new Map<string, Order>();

export function seedOrders() {
  orders.clear();
  orders.set("A-1042", {
    id: "A-1042",
    owner: "C-1001",
    status: "in_transit",
    carrier: "Rapido Express",
    trackingCode: "RX8842107",
    eta: { date: "2026-11-26", window: "10:00–14:00" },
    address: "Carrer de Pallars 193, 08005 Barcelona",
    currency: "EUR",
    items: [
      { name: "Wireless headphones", qty: 1, price: 89.9 },
      { name: "Silicone case", qty: 2, price: 12.5 },
    ],
    steps: [
      { key: "placed", label: "Order placed", at: "2026-11-21T18:12:00+01:00" },
      { key: "shipped", label: "Shipped from warehouse", at: "2026-11-22T09:40:00+01:00" },
      { key: "in_transit", label: "In transit", at: "2026-11-23T07:05:00+01:00" },
      { key: "out_for_delivery", label: "Out for delivery", at: null },
      { key: "delivered", label: "Delivered", at: null },
    ],
    rescheduleOptions: [
      { date: "2026-11-27", window: "10:00–14:00" },
      { date: "2026-11-27", window: "16:00–20:00" },
      { date: "2026-11-28", window: "10:00–14:00" },
    ],
    issue: null,
  });
}
seedOrders();

/** Only the owner can see an order: the session's subject must be linked to the owning customer. */
export function getOrder(id: string, subject: string) {
  const customer = requireCustomer(subject);
  const o = orders.get(id);
  if (!o || o.owner !== customer.id) throw new Error(`Order ${id} not found for this customer`);
  const { owner, ...data } = o;
  return data;
}

export function listOrderIds(subject: string) {
  const customer = customerFor(subject);
  return customer ? [...orders.values()].filter((o) => o.owner === customer.id).map((o) => o.id) : [];
}

export function updateOrder(id: string, subject: string, patch: Partial<Order>) {
  getOrder(id, subject);
  orders.set(id, { ...orders.get(id)!, ...patch });
  return getOrder(id, subject);
}
