import { SurfaceError, implement, type SurfaceData } from "@ui-calling/core";
import { shiftPicker } from "../src/components/ui-calling/shift-picker.surface";
import { failures } from "./failures";
import { ShiftUnavailable, bookShift, getShiftBoard } from "./shifts";

type Board = SurfaceData<typeof shiftPicker>;
type Shift = NonNullable<Board["current"]>;

const ROLE: Record<Shift["role"], string> = {
  sales_floor: "sales floor",
  checkout: "checkout",
  stockroom: "stockroom",
  picking: "picking & packing",
};
const line = (s: Shift) => `${s.date} ${s.start}–${s.end}, ${ROLE[s.role]} at ${s.location} (${s.id})`;

function checkScheduling() {
  if (failures.schedulingApi) {
    throw new SurfaceError("scheduling_api_unavailable", "Scheduling system responded 503 Service Unavailable", {
      retryable: true,
    });
  }
}

/** Server-side half of "shift_picker": the worker's rota and booking a shift. */
export const shiftPickerImpl = implement(shiftPicker, {
  // The worker is looked up by id, and only shown if the link was sent to their own phone.
  resolve: async ({ worker_id }, ctx) => {
    checkScheduling();
    return getShiftBoard(worker_id, ctx.subject);
  },
  // Everything the screen shows, in one line: this is the agent's view of the screen.
  summarize: (b) => {
    const booked = b.booking && b.current?.id === b.booking.shiftId ? b.booking : null;
    return (
      `Shifts for ${b.workerName} (${b.workerId}). ` +
      (booked
        ? `Just booked ${line(b.current!)}, confirmation ${booked.confirmation}` +
          (booked.replaced ? `, replacing ${line(booked.replaced)}. ` : ". ")
        : `Current shift: ${b.current ? line(b.current) : "none"}. `) +
      `Open shifts: ${b.open
        .map((s) => `${line(s)}: ${s.spotsLeft > 0 ? `${s.spotsLeft} of ${s.spotsTotal} spots left` : "full"}`)
        .join("; ")}.`
    );
  },
  on: {
    // Booking replaces the current shift; the fresh board carries the confirmation code to the agent.
    shift_selected: async (p, ctx) => {
      checkScheduling();
      const workerId = ctx.input.worker_id;
      const shown = getShiftBoard(workerId, ctx.subject).open.find((s) => s.id === p.shift_id);
      // The screen sends what the worker saw; if the rota changed since, don't book something else.
      if (shown && (shown.date !== p.date || shown.start !== p.start || shown.end !== p.end || shown.location !== p.location)) {
        throw new SurfaceError("shift_changed", `Shift ${p.shift_id} changed after the screen loaded`, { refused: true });
      }
      try {
        return bookShift(workerId, ctx.subject, p.shift_id);
      } catch (err) {
        if (err instanceof ShiftUnavailable) throw new SurfaceError(`shift_${err.reason}`, err.message, { refused: true });
        throw err;
      }
    },
  },
});
