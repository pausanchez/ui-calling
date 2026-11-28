import { z } from "zod";
import { defineSurface, event } from "@ui-calling/core";

const shift = z.object({
  id: z.string(),
  date: z.string().describe("ISO date, YYYY-MM-DD"),
  start: z.string().describe("Local time, HH:MM"),
  end: z.string().describe("Local time, HH:MM"),
  location: z.string(),
  role: z.enum(["sales_floor", "checkout", "stockroom", "picking"]),
});

/**
 * Contract for the "shift_picker" screen: a worker sees the open shifts for the coming days
 * and books one, which replaces the shift they had.
 */
export const shiftPicker = defineSurface({
  name: "shift_picker",
  description:
    "Open shifts for a worker over the coming days: date, start and end time, location, role and how many spots are left, next to the shift they have now. Lets the worker book one, which replaces their current shift. Use it when a worker asks which shifts are available, wants to pick up a shift, or wants to change or swap their shift.",
  input: z.object({ worker_id: z.string().describe("The worker whose shifts to show, e.g. W-207") }),
  cta: { en: "Pick a shift", es: "Elegir turno" },
  // A rota says where someone will be and when: the worker types their PIN first, so a shared phone shows nothing.
  verify: true,
  data: z.object({
    workerId: z.string(),
    workerName: z.string(),
    current: shift.nullable(),
    open: z.array(shift.extend({ spotsLeft: z.number().int(), spotsTotal: z.number().int() })),
    /** Set after a booking: what the worker just picked and its confirmation code. */
    booking: z.object({ shiftId: z.string(), confirmation: z.string(), replaced: shift.nullable() }).nullable(),
  }),
  events: {
    shift_selected: event(
      z.object({
        shift_id: z.string(),
        date: z.string(),
        start: z.string(),
        end: z.string(),
        location: z.string(),
      }),
      {
        // Also used as "what the user tried" when booking fails, so it states the pick, not the outcome.
        describe: (p) =>
          `Worker picked the shift on ${p.date}, ${p.start}–${p.end} at ${p.location} (${p.shift_id}) to replace their current one`,
        wake: true,
      },
    ),
  },
});
