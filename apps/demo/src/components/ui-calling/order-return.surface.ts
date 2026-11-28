import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

export const RETURN_REASONS = ["damaged", "wrong_item", "not_as_described", "no_longer_needed", "other"] as const;
/** Reasons that need photos before the return can go ahead. */
export const NEEDS_PHOTOS: readonly string[] = ["damaged", "wrong_item"];
export const RETURN_STEPS = ["items", "reasons", "photos", "pickup", "review"] as const;

const reason = z.enum(RETURN_REASONS);
const slot = z.object({ date: z.string().describe("ISO date, YYYY-MM-DD"), window: z.string() });
const refund = z.enum(["original_payment", "store_credit"]);

/**
 * Contract for the "order_return" screen: a return in five steps (items, reasons, photos, pickup, review).
 * Each step is a quiet event that saves a draft, so the agent knows how far the user got and reopening
 * the link resumes there. Only submitting wakes the agent.
 */
export const orderReturn = defineSurface({
  name: "order_return",
  description:
    "Step-by-step return of a delivered order: the user picks the items and quantities, gives a reason for each, adds photos when an item arrived damaged or is the wrong one, chooses the refund method and a pickup slot, then reviews and submits. Progress is saved, so reopening the link resumes where they stopped. Use it when the user wants to return or send back something they received, or says a delivered item is broken or wrong. Pass sku and reason when the user already said which item and why.",
  input: z.object({
    order_id: z.string().describe("The delivered order, e.g. A-0987"),
    sku: z.string().optional().describe("The item to preselect, if the user named one"),
    reason: reason.optional().describe("The reason to preselect, if the user gave one"),
  }),
  cta: { en: "Start return", es: "Iniciar devolución" },
  data: z.object({
    orderId: z.string(),
    deliveredOn: z.string(),
    currency: z.string(),
    address: z.string(),
    items: z.array(
      z.object({ sku: z.string(), name: z.string(), qty: z.number().int(), price: z.number(), returnable: z.boolean() }),
    ),
    pickupOptions: z.array(slot.extend({ spotsLeft: z.number().int() })),
    /** The carrier didn't answer: no slots to offer for now, the rest of the screen still works. */
    pickupUnavailable: z.boolean(),
    /** Photos uploaded through this link so far, confirmed or not: what the photos step shows after a reload. */
    uploaded: z.array(z.object({ id: z.string(), name: z.string() })),
    draft: z.object({
      /** The furthest step the user reached. */
      step: z.enum(RETURN_STEPS),
      lines: z.array(z.object({ sku: z.string(), qty: z.number().int(), reason: reason.nullable(), details: z.string() })),
      photos: z.array(z.object({ id: z.string(), name: z.string() })),
      refund: refund.nullable(),
      pickup: slot.nullable(),
    }),
    submitted: z
      .object({ returnId: z.string(), refundAmount: z.number(), refund, pickup: slot })
      .nullable(),
  }),
  events: {
    items_chosen: event(
      z.object({ lines: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1) })).min(1).max(20) }),
      {
        describe: (p) => `Step 1 of 5: chose items to return: ${p.lines.map((l) => `${l.qty}× ${l.sku}`).join(", ")}`,
        reasons: ["item_not_returnable"],
      },
    ),
    reasons_given: event(
      z.object({
        lines: z.array(z.object({ sku: z.string(), reason, details: z.string().max(300) })).min(1).max(20),
      }),
      {
        describe: (p) =>
          `Step 2 of 5: gave reasons: ${p.lines.map((l) => `${l.sku} ${l.reason}${l.details ? ` ("${l.details}")` : ""}`).join("; ")}`,
        reasons: ["reason_missing"],
      },
    ),
    photos_added: event(z.object({ photos: z.array(z.string()).max(5) }), {
      describe: (p) => `Step 3 of 5: attached ${p.photos.length} photo${p.photos.length === 1 ? "" : "s"}`,
      reasons: ["unknown_photo", "photos_required"],
    }),
    pickup_chosen: event(z.object({ refund, date: z.string(), window: z.string() }), {
      describe: (p) => `Step 4 of 5: chose ${p.refund.replace("_", " ")} as refund and pickup on ${p.date}, ${p.window}`,
      reasons: ["pickup_unknown", "pickup_slot_full"],
    }),
    return_submitted: event(z.object({}), {
      // On failure this reads as "Attempted: …", so it says what the user asked for.
      describe: () => "Step 5 of 5: submitted the return",
      wake: true,
      reasons: ["return_incomplete", "photos_required", "pickup_slot_full", "carrier_unavailable"],
    }),
  },
  files: { photos: { accept: ["image/*"], maxBytes: 8 * 1024 * 1024, maxFiles: 5 } },
});
