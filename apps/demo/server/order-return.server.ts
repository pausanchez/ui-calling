import { SurfaceError, implement, type SurfaceContext, type SurfaceData } from "@ui-calling/core";
import { NEEDS_PHOTOS, RETURN_STEPS, orderReturn } from "../src/components/ui-calling/order-return.surface";
import { failures } from "./failures";
import { PickupFull, getReturn, saveDraft, submitReturn, type StoredReturn } from "./returns";

type Return = SurfaceData<typeof orderReturn>;

/**
 * What the screen gets: the stored return plus the photos it can show. That's the draft's photos, which may
 * come from an earlier link the agent sent, and anything uploaded through this link since.
 */
async function withUploads(r: StoredReturn, ctx: SurfaceContext): Promise<Return> {
  const saved = await ctx.files(r.draft.photos.map((p) => p.id));
  const fresh = (await ctx.files()).filter((f) => !saved.some((s) => s.id === f.id));
  return { ...r, uploaded: [...saved, ...fresh].map((f) => ({ id: f.id, name: f.name })) };
}

const needsPhotos = (r: StoredReturn) => r.draft.lines.some((l) => l.reason && NEEDS_PHOTOS.includes(l.reason));
const money = (r: StoredReturn, n: number) => `${n.toFixed(2)} ${r.currency}`;

/** Server-side half of "order_return": a return draft saved step by step, then filed with a carrier pickup. */
export const orderReturnImpl = implement(orderReturn, {
  resolve: async ({ order_id, sku, reason }, ctx) => withUploads(getReturn(order_id, ctx.subject, { sku, reason }), ctx),
  // Everything the screen shows, in one line: where the user is, what they picked, and the outcome.
  summarize: (r) => {
    const name = (sku: string) => r.items.find((i) => i.sku === sku)?.name ?? sku;
    const lines = r.draft.lines
      .map((l) => `${l.qty}× ${name(l.sku)} (${l.sku})${l.reason ? `, ${l.reason.replace(/_/g, " ")}` : ""}${l.details ? ` "${l.details}"` : ""}`)
      .join("; ");
    const head = `Return for order ${r.orderId}, delivered ${r.deliveredOn}.`;
    if (r.submitted) {
      const s = r.submitted;
      return (
        `${head} Submitted as ${s.returnId}: ${lines}. Refund of ${money(r, s.refundAmount)} to ` +
        `${s.refund === "store_credit" ? "store credit" : "the original payment"}, after pickup on ${s.pickup.date}, ${s.pickup.window} at ${r.address}.`
      );
    }
    const step = RETURN_STEPS.indexOf(r.draft.step) + 1;
    return (
      `${head} Draft, reached step ${step} of 5 (${r.draft.step}). Items: ${lines || "none chosen yet"}. ` +
      `Photos: ${r.draft.photos.length}${needsPhotos(r) ? " (required for damaged or wrong items)" : ""}. ` +
      `Refund: ${r.draft.refund?.replace("_", " ") ?? "not chosen"}. ` +
      `Pickup: ${r.draft.pickup ? `${r.draft.pickup.date}, ${r.draft.pickup.window}` : "not chosen"}. ` +
      `Not returnable: ${r.items.filter((i) => !i.returnable).map((i) => i.name).join(", ") || "none"}.`
    );
  },
  on: {
    items_chosen: async ({ lines }, ctx) => {
      const r = getReturn(ctx.input.order_id, ctx.subject);
      for (const l of lines) {
        const item = r.items.find((i) => i.sku === l.sku);
        if (!item || !item.returnable || l.qty > item.qty) throw new SurfaceError("item_not_returnable", `${l.sku} can't be returned in that quantity`);
      }
      // Keep the reasons already given for items that are still in the return.
      const previous = new Map(r.draft.lines.map((l) => [l.sku, l]));
      const next = lines.map((l) => ({ ...l, reason: previous.get(l.sku)?.reason ?? null, details: previous.get(l.sku)?.details ?? "" }));
      return withUploads(saveDraft(r.orderId, ctx.subject, { lines: next }, "reasons"), ctx);
    },
    reasons_given: async ({ lines }, ctx) => {
      const r = getReturn(ctx.input.order_id, ctx.subject);
      const given = new Map(lines.map((l) => [l.sku, l]));
      if (r.draft.lines.some((l) => !given.has(l.sku))) throw new SurfaceError("reason_missing", "Every item needs a reason");
      const next = r.draft.lines.map((l) => ({ ...l, reason: given.get(l.sku)!.reason, details: given.get(l.sku)!.details }));
      const photos = next.some((l) => NEEDS_PHOTOS.includes(l.reason));
      return withUploads(saveDraft(r.orderId, ctx.subject, { lines: next }, photos ? "photos" : "pickup"), ctx);
    },
    photos_added: async ({ photos }, ctx) => {
      const r = getReturn(ctx.input.order_id, ctx.subject);
      // Only files uploaded through this link count; anything else in the payload is rejected.
      const files = await ctx.files(photos);
      if (files.length !== photos.length) throw new SurfaceError("unknown_photo", "A photo isn't from this screen");
      if (needsPhotos(r) && files.length === 0) throw new SurfaceError("photos_required", "Damaged or wrong items need at least one photo");
      return withUploads(saveDraft(r.orderId, ctx.subject, { photos: files.map((f) => ({ id: f.id, name: f.name })) }, "pickup"), ctx);
    },
    pickup_chosen: async ({ refund, date, window }, ctx) => {
      const r = getReturn(ctx.input.order_id, ctx.subject);
      const slot = r.pickupOptions.find((o) => o.date === date && o.window === window);
      if (!slot) throw new SurfaceError("pickup_unknown", `No pickup on ${date}, ${window}`);
      if (slot.spotsLeft <= 0) throw new SurfaceError("pickup_slot_full", `Pickup on ${date}, ${window} is full`);
      return withUploads(saveDraft(r.orderId, ctx.subject, { refund, pickup: { date, window } }, "review"), ctx);
    },
    return_submitted: async (_p, ctx) => {
      const orderId = ctx.input.order_id;
      const r = getReturn(orderId, ctx.subject);
      if (r.submitted) return withUploads(r, ctx);
      if (!r.draft.lines.length || r.draft.lines.some((l) => !l.reason) || !r.draft.refund || !r.draft.pickup) {
        throw new SurfaceError("return_incomplete", "The return is missing items, reasons, refund or pickup");
      }
      if (needsPhotos(r) && !r.draft.photos.length) throw new SurfaceError("photos_required", "Damaged or wrong items need at least one photo");
      if (failures.carrierApi) {
        throw new SurfaceError("carrier_unavailable", "Carrier API timed out while booking the pickup", { retryable: true });
      }
      try {
        return withUploads(submitReturn(orderId, ctx.subject), ctx);
      } catch (err) {
        if (err instanceof PickupFull) throw new SurfaceError("pickup_slot_full", err.message);
        throw err;
      }
    },
  },
});
