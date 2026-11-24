import type { SurfaceData } from "@ui-calling/core";
import type { shiftPicker } from "../src/components/ui-calling/shift-picker.surface";
import { customerFor, requireCustomer } from "./identity";

type Board = SurfaceData<typeof shiftPicker>;
type Shift = NonNullable<Board["current"]>;
type Slot = Shift & { spotsTotal: number; spotsLeft: number };
type Worker = { id: string; owner: string; name: string; currentShiftId: string | null; booking: Board["booking"] };

const STORES = {
  gracia: "Acme Store Gràcia, Carrer Gran de Gràcia 112",
  poblenou: "Acme Store Poblenou, Rambla del Poblenou 54",
  warehouse: "Acme warehouse Zona Franca, Carrer 60 nº 18",
};

// One week of the rota, by days from today. Some shifts are already full, as in real rotas.
const ROTA: [day: number, start: string, end: string, where: keyof typeof STORES, role: Shift["role"], total: number, taken: number][] = [
  [1, "06:00", "14:00", "warehouse", "picking", 6, 6],
  [1, "07:00", "15:00", "warehouse", "picking", 8, 7], // the worker's current shift
  [1, "16:00", "21:30", "gracia", "sales_floor", 3, 1],
  [2, "09:30", "15:30", "poblenou", "checkout", 2, 1],
  [2, "14:00", "22:00", "warehouse", "stockroom", 4, 2],
  [3, "10:00", "14:00", "gracia", "checkout", 2, 2],
  [3, "15:00", "21:30", "poblenou", "sales_floor", 4, 1],
  [4, "06:00", "14:00", "warehouse", "picking", 6, 3],
  [4, "17:00", "21:30", "gracia", "checkout", 2, 1],
  [5, "09:30", "15:30", "poblenou", "stockroom", 3, 2],
  [5, "10:00", "21:30", "gracia", "sales_floor", 5, 4],
];

// Stand-in for the product's real workforce scheduling system.
const slots = new Map<string, Slot>();
const workers = new Map<string, Worker>();

/** For the demo's persistence (app.ts). */
export const shiftsState = {
  save: () => ({ slots: [...slots], workers: [...workers] }),
  load: (s: { slots: [string, Slot][]; workers: [string, Worker][] }) => {
    slots.clear();
    workers.clear();
    s.slots.forEach(([k, v]) => slots.set(k, v));
    s.workers.forEach(([k, v]) => workers.set(k, v));
  },
};

/** YYYY-MM-DD in Madrid time, `days` from today: the rota always covers the coming days. */
function dayFromToday(days: number) {
  return new Date(Date.now() + days * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

export function seedShifts() {
  slots.clear();
  workers.clear();
  ROTA.forEach(([day, start, end, where, role, total, taken], i) => {
    const date = dayFromToday(day);
    const id = `SH-${date.slice(5).replace("-", "")}-${String(i + 1).padStart(2, "0")}`;
    slots.set(id, { id, date, start, end, location: STORES[where], role, spotsTotal: total, spotsLeft: total - taken });
  });
  workers.set("W-207", {
    id: "W-207",
    owner: "C-1001",
    name: "Lucía Romero",
    currentShiftId: [...slots.keys()][1],
    booking: null,
  });
}
seedShifts();

const plain = ({ spotsTotal, spotsLeft, ...s }: Slot): Shift => s;

function workerFor(id: string, subject: string) {
  const customer = requireCustomer(subject);
  const w = workers.get(id);
  // Only the worker themself can see or change their shifts: the session's subject must be linked to them.
  if (!w || w.owner !== customer.id) throw new Error(`Worker ${id} not found for this person`);
  return w;
}

/** The worker's current shift and every open shift from tomorrow on, soonest first. */
export function getShiftBoard(workerId: string, subject: string): Board {
  const w = workerFor(workerId, subject);
  const current = w.currentShiftId ? slots.get(w.currentShiftId) : undefined;
  return {
    workerId: w.id,
    workerName: w.name,
    current: current ? plain(current) : null,
    open: [...slots.values()]
      .filter((s) => s.id !== w.currentShiftId)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
      .map((s) => ({ ...s })),
    booking: w.booking,
  };
}

export function listWorkerIds(subject: string) {
  const customer = customerFor(subject);
  return customer ? [...workers.values()].filter((w) => w.owner === customer.id).map((w) => w.id) : [];
}

export class ShiftUnavailable extends Error {
  constructor(public reason: "not_found" | "full" | "already_booked", message: string) {
    super(message);
  }
}

/** Book a shift for the worker, releasing the one they had. Returns the fresh board. */
export function bookShift(workerId: string, subject: string, shiftId: string) {
  const w = workerFor(workerId, subject);
  const slot = slots.get(shiftId);
  if (!slot) throw new ShiftUnavailable("not_found", `Shift ${shiftId} no longer exists`);
  if (w.currentShiftId === shiftId) throw new ShiftUnavailable("already_booked", `Worker already has shift ${shiftId}`);
  if (slot.spotsLeft <= 0) throw new ShiftUnavailable("full", `Shift ${shiftId} has no spots left`);

  const previous = w.currentShiftId ? slots.get(w.currentShiftId) : undefined;
  if (previous) previous.spotsLeft += 1;
  slot.spotsLeft -= 1;
  w.currentShiftId = shiftId;
  w.booking = {
    shiftId,
    confirmation: `BK-${Math.floor(10000 + Math.random() * 90000)}`,
    replaced: previous ? plain(previous) : null,
  };
  return getShiftBoard(workerId, subject);
}
