import { useState, type ReactNode } from "react";
import { pickLocalized, type SurfaceData } from "@ui-calling/core";
import { SurfaceActionError, useSurface } from "@ui-calling/react";
import { shiftPicker } from "./shift-picker.surface";

type Board = SurfaceData<typeof shiftPicker>;
type Shift = NonNullable<Board["current"]>;
type OpenShift = Board["open"][number];

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop. */
export const SHIFT_PICKER_MESSAGES = {
  en: {
    hello: (name: string) => `Hi ${name}`,
    title: "Pick a shift",
    yourShift: "Your shift",
    noShift: "You don't have a shift booked yet.",
    openShifts: "Open shifts",
    noOpenShifts: "There are no open shifts in the coming days.",
    roles: {
      sales_floor: "Sales floor",
      checkout: "Checkout",
      stockroom: "Stockroom",
      picking: "Picking & packing",
    } as Record<Shift["role"], string>,
    spotsLeft: (n: number) => (n === 1 ? "1 spot left" : `${n} spots left`),
    full: "Full",
    confirmTitle: "Book this shift?",
    replaces: "It replaces your current shift:",
    confirm: "Book shift",
    cancel: "Cancel",
    booked: "Shift booked",
    confirmation: (code: string) => `Confirmation ${code}`,
    assistantKnows: "Your assistant already knows. You can go back to the chat.",
    backToChat: "Back to chat",
    pickAnother: "Pick a different shift",
    actionFailed: "That shift couldn't be booked",
    actionFailedBody: "Your assistant already knows. You can try again, pick another one or go back to the chat.",
    shiftGone: "That shift is no longer available",
    shiftGoneBody: "It just filled up or changed. The list is updated: pick another one.",
    tryAgain: "Try again",
    unavailable: "Shifts aren't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    expired: "This link has expired",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    hello: (name: string) => `Hola, ${name}`,
    title: "Elige un turno",
    yourShift: "Tu turno",
    noShift: "Todavía no tienes ningún turno reservado.",
    openShifts: "Turnos disponibles",
    noOpenShifts: "No hay turnos disponibles en los próximos días.",
    roles: {
      sales_floor: "Sala de ventas",
      checkout: "Cajas",
      stockroom: "Almacén de tienda",
      picking: "Preparación de pedidos",
    },
    spotsLeft: (n: number) => (n === 1 ? "Queda 1 plaza" : `Quedan ${n} plazas`),
    full: "Completo",
    confirmTitle: "¿Reservar este turno?",
    replaces: "Sustituye a tu turno actual:",
    confirm: "Reservar turno",
    cancel: "Cancelar",
    booked: "Turno reservado",
    confirmation: (code: string) => `Confirmación ${code}`,
    assistantKnows: "Tu asistente ya lo sabe. Puedes volver al chat.",
    backToChat: "Volver al chat",
    pickAnother: "Elegir otro turno",
    actionFailed: "No se ha podido reservar el turno",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes reintentarlo, elegir otro o volver al chat.",
    shiftGone: "Ese turno ya no está disponible",
    shiftGoneBody: "Se acaba de completar o ha cambiado. La lista está actualizada: elige otro.",
    tryAgain: "Reintentar",
    unavailable: "Los turnos no están disponibles ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    expired: "Este enlace ha caducado",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type ShiftPickerMessages = (typeof SHIFT_PICKER_MESSAGES)["en"];

export function ShiftPicker({ messages }: { messages?: Partial<ShiftPickerMessages> }) {
  const { status, data, errorCode, locale, emit, reload, complete, returnUrl } = useSurface(shiftPicker);
  const t: ShiftPickerMessages = { ...pickLocalized(SHIFT_PICKER_MESSAGES, locale)!, ...messages };
  const [selected, setSelected] = useState<OpenShift | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [gone, setGone] = useState(false);
  // Show the booking banner only for a booking made on this screen, not one from an earlier link.
  const [justBooked, setJustBooked] = useState(false);

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
    // upstream_error: the scheduling system failed and the agent was told, so send the user back to the chat.
    const upstream = errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
          {upstream && returnUrl && <a href={returnUrl} className={btn("outline", "mt-3 w-full")}>{t.backToChat}</a>}
        </Card>
      </Shell>
    );
  }

  const day = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const byDay = new Map<string, OpenShift[]>();
  for (const s of data.open) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s]);
  const booking = justBooked && data.booking?.shiftId === data.current?.id ? data.booking : null;

  async function book(s: OpenShift) {
    setBusy(true);
    setFailed(false);
    setGone(false);
    try {
      await emit("shift_selected", { shift_id: s.id, date: s.date, start: s.start, end: s.end, location: s.location });
      setSelected(null);
      setJustBooked(true);
    } catch (err) {
      // The server already recorded the failure for the agent; here we only tell the user.
      const reason = err instanceof SurfaceActionError ? err.reason : undefined;
      if (reason === "shift_full" || reason === "shift_not_found" || reason === "shift_changed") {
        // Retrying can't help: show what changed and refresh the list.
        setSelected(null);
        setGone(true);
        await reload().catch(() => {});
      } else {
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <header>
        <p className="text-sm text-muted-foreground">{t.hello(data.workerName.split(" ")[0])}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
      </header>

      {booking && data.current && (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{t.booked}</p>
          <p className="mt-1 text-sm first-letter:uppercase">
            {day(data.current.date)}, {data.current.start}–{data.current.end}
          </p>
          <p className="text-sm text-muted-foreground">{t.confirmation(booking.confirmation)}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t.assistantKnows}</p>
          {returnUrl && (
            <a href={returnUrl} onClick={() => void complete()} className={btn("primary", "mt-3 w-full")}>
              {t.backToChat}
            </a>
          )}
        </Card>
      )}

      <Card>
        <p className="text-sm text-muted-foreground">{t.yourShift}</p>
        {data.current ? <ShiftDetails s={data.current} day={day} t={t} large /> : <p className="mt-1 text-sm">{t.noShift}</p>}
      </Card>

      {gone && (
        <Card className="border-warning/50 bg-warning/10">
          <p className="font-medium">{t.shiftGone}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.shiftGoneBody}</p>
        </Card>
      )}

      {failed && selected && (
        <Card className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.actionFailedBody}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => book(selected)} className={btn("primary")}>{t.tryAgain}</button>
            {returnUrl && <a href={returnUrl} className={btn("outline")}>{t.backToChat}</a>}
          </div>
        </Card>
      )}

      {selected && !failed && (
        <Card className="border-primary/40">
          <p className="font-medium">{t.confirmTitle}</p>
          <ShiftDetails s={selected} day={day} t={t} />
          {data.current && (
            <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">
              {t.replaces}{" "}
              <span className="first-letter:uppercase">
                {day(data.current.date)}, {data.current.start}–{data.current.end}
              </span>
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => setSelected(null)} className={btn("outline")}>{t.cancel}</button>
            <button disabled={busy} onClick={() => book(selected)} className={btn("primary")}>{t.confirm}</button>
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">{booking ? t.pickAnother : t.openShifts}</h2>
        {byDay.size === 0 && <p className="text-sm text-muted-foreground">{t.noOpenShifts}</p>}
        {[...byDay].map(([date, shifts]) => (
          <div key={date}>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground first-letter:uppercase">{day(date)}</p>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {shifts.map((s) => {
                const full = s.spotsLeft <= 0;
                return (
                  <li key={s.id}>
                    <button
                      disabled={full || busy}
                      onClick={() => {
                        setFailed(false);
                        setSelected(s);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      aria-pressed={selected?.id === s.id}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${
                        selected?.id === s.id ? "bg-accent" : ""
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block font-medium tabular-nums">{s.start}–{s.end}</span>
                        <span className="block text-sm">{t.roles[s.role]}</span>
                        <span className="block truncate text-xs text-muted-foreground">{s.location}</span>
                      </span>
                      <Spots full={full} label={full ? t.full : t.spotsLeft(s.spotsLeft)} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </Shell>
  );
}

function ShiftDetails({ s, day, t, large }: { s: Shift; day: (iso: string) => string; t: ShiftPickerMessages; large?: boolean }) {
  return (
    <div className="mt-1">
      <p className={`${large ? "text-lg" : ""} font-semibold first-letter:uppercase`}>{day(s.date)}</p>
      <p className="text-sm tabular-nums">{s.start}–{s.end} · {t.roles[s.role]}</p>
      <p className="text-sm text-muted-foreground">{s.location}</p>
    </div>
  );
}

function Spots({ full, label }: { full: boolean; label: string }) {
  const tone = full ? "bg-muted text-muted-foreground" : "bg-accent text-accent-foreground";
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{label}</span>;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">{children}</div>
    </main>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-border bg-card p-4 text-card-foreground ${className}`}>{children}</section>;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-10 w-1/2 rounded-md bg-muted" />
      <div className="h-24 rounded-lg bg-muted" />
      <div className="h-48 rounded-lg bg-muted" />
    </div>
  );
}

function btn(variant: "primary" | "outline", extra = "") {
  const base =
    "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}
