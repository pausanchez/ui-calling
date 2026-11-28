import type { SurfaceData } from "@ui-calling/core";
import { RETURN_STEPS, type orderReturn } from "../src/components/ui-calling/order-return.surface";
import { customerFor, requireCustomer } from "./identity";

type Return = SurfaceData<typeof orderReturn>;
type Draft = Return["draft"];
type Step = Draft["step"];
type Slot = Return["pickupOptions"][number];
type Order = Omit<Return, "draft" | "submitted" | "pickupOptions" | "pickupUnavailable" | "uploaded"> & { owner: string };
/** A return as the returns system knows it; the screen adds this link's uploads (see order-return.server.ts). */
export type StoredReturn = Omit<Return, "uploaded">;

// Stand-in for the product's order history, returns system and carrier pickups.
const orders = new Map<string, Order>();
const drafts = new Map<string, { draft: Draft; submitted: Return["submitted"] }>();
const pickups = new Map<string, Slot>();

/** For the demo's persistence (app.ts). */
export const returnsState = {
  save: () => ({ orders: [...orders], drafts: [...drafts], pickups: [...pickups] }),
  load: (s: { orders: [string, Order][]; drafts: [string, { draft: Draft; submitted: Return["submitted"] }][]; pickups: [string, Slot][] }) => {
    orders.clear();
    drafts.clear();
    pickups.clear();
    s.orders.forEach(([k, v]) => orders.set(k, v));
    s.drafts.forEach(([k, v]) => drafts.set(k, v));
    s.pickups.forEach(([k, v]) => pickups.set(k, v));
  },
};

/** YYYY-MM-DD in Madrid time, `days` from today. */
function dayFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

export function seedReturns() {
  orders.clear();
  drafts.clear();
  pickups.clear();
  orders.set("A-0987", {
    orderId: "A-0987",
    owner: "C-1001",
    deliveredOn: dayFromToday(-6),
    currency: "EUR",
    address: "Carrer de Pallars 193, 08005 Barcelona",
    items: [
      { sku: "BL-200", name: "Countertop blender", qty: 1, price: 79, returnable: true },
      { sku: "GB-3", name: "Glass mixing bowls (set of 3)", qty: 2, price: 24.5, returnable: true },
      { sku: "KS-1", name: "Kitchen scale", qty: 1, price: 19.9, returnable: false },
    ],
  });
  // The first slot has one spot left, so a second return can find it full.
  for (const [day, window, spots] of [
    [1, "10:00–14:00", 1],
    [1, "16:00–20:00", 3],
    [2, "10:00–14:00", 4],
    [3, "16:00–20:00", 2],
  ] as const) {
    const date = dayFromToday(day);
    pickups.set(`${date} ${window}`, { date, window, spotsLeft: spots });
  }
}
seedReturns();

export class PickupFull extends Error {}

/** Delivered orders of this customer that have something returnable. */
export function listReturnableOrderIds(subject: string) {
  const customer = customerFor(subject);
  if (!customer) return [];
  return [...orders.values()].filter((o) => o.owner === customer.id && o.items.some((i) => i.returnable)).map((o) => o.orderId);
}

/** For the agent's prompt: each returnable order with its items' SKUs, so it can preselect what the user names. */
export function describeReturnable(subject: string) {
  return listReturnableOrderIds(subject)
    .map((id) => {
      const o = orders.get(id)!;
      const items = o.items.map((i) => `${i.sku} ${i.name}${i.returnable ? "" : " (not returnable)"}`).join(", ");
      return `${id}, delivered ${o.deliveredOn}: ${items}`;
    })
    .join("; ");
}

/** The order with this customer's return draft. Only the owner can see it. */
export function getReturn(orderId: string, subject: string, prefill?: { sku?: string; reason?: Draft["lines"][number]["reason"] }): StoredReturn {
  const customer = requireCustomer(subject);
  const order = orders.get(orderId);
  if (!order || order.owner !== customer.id) throw new Error(`Order ${orderId} not found for this customer`);
  if (!drafts.has(orderId)) {
    drafts.set(orderId, { draft: { step: "items", lines: [], photos: [], refund: null, pickup: null }, submitted: null });
  }
  // What the agent already knows from the chat ("the blender arrived cracked") goes into the draft,
  // as long as the user hasn't saved their own choice of items yet.
  const item = order.items.find((i) => i.sku === prefill?.sku && i.returnable);
  const current = drafts.get(orderId)!;
  const itemsSaved = current.submitted || current.draft.step !== "items";
  if (item && !itemsSaved && !current.draft.lines.some((l) => l.sku === item.sku)) {
    const line = { sku: item.sku, qty: 1, reason: prefill?.reason ?? null, details: "" };
    drafts.set(orderId, { ...current, draft: { ...current.draft, lines: [...current.draft.lines, line] } });
  }
  const { owner, ...rest } = order;
  return { ...rest, ...drafts.get(orderId)!, pickupOptions: [...pickups.values()], pickupUnavailable: false };
}

/** Save a step: merge it into the draft and move the furthest step reached forward, never back. */
export function saveDraft(orderId: string, subject: string, patch: Partial<Draft>, reached: Step) {
  const current = getReturn(orderId, subject);
  const step = RETURN_STEPS.indexOf(reached) > RETURN_STEPS.indexOf(current.draft.step) ? reached : current.draft.step;
  drafts.set(orderId, { draft: { ...current.draft, ...patch, step }, submitted: current.submitted });
  return getReturn(orderId, subject);
}

/** Book the pickup and file the return. */
export function submitReturn(orderId: string, subject: string) {
  const r = getReturn(orderId, subject);
  const { pickup, refund } = r.draft;
  const slot = pickup && pickups.get(`${pickup.date} ${pickup.window}`);
  if (!slot || slot.spotsLeft <= 0) throw new PickupFull(`Pickup ${pickup?.date} ${pickup?.window} is full`);
  slot.spotsLeft--;
  const refundAmount = r.draft.lines.reduce((sum, l) => sum + l.qty * (r.items.find((i) => i.sku === l.sku)?.price ?? 0), 0);
  drafts.set(orderId, {
    draft: r.draft,
    submitted: { returnId: `R-${Math.floor(1000 + Math.random() * 9000)}`, refundAmount, refund: refund!, pickup: pickup! },
  });
  return getReturn(orderId, subject);
}
