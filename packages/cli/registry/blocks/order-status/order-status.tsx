import { useState, type ReactNode } from "react";
import { pickLocalized } from "@ui-calling/core";
import { useSurface } from "@ui-calling/react";
import { orderStatus } from "./order-status.surface";

/** Every string the screen shows. Add a language by adding a key; override single strings with the `messages` prop. */
export const ORDER_STATUS_MESSAGES = {
  en: {
    order: "Order",
    arriving: "Arriving",
    delivered: "Delivered",
    status: {
      placed: "Placed",
      shipped: "Shipped",
      in_transit: "In transit",
      out_for_delivery: "Out for delivery",
      delivered: "Delivered",
      issue: "Issue",
    } as Record<string, string>,
    steps: {
      placed: "Order placed",
      shipped: "Shipped from warehouse",
      in_transit: "In transit",
      out_for_delivery: "Out for delivery",
      delivered: "Delivered",
    } as Record<string, string>,
    items: (n: number, total: string) => `${n} ${n === 1 ? "item" : "items"} · ${total}`,
    show: "Show",
    hide: "Hide",
    pickSlot: "Pick a new delivery slot",
    whatHappened: "What happened?",
    reasons: {
      damaged: "Arrived damaged",
      missing_items: "Items missing",
      wrong_address: "Wrong address",
      late: "It's late",
      other: "Something else",
    },
    detailsPlaceholder: "Tell us a bit more (optional)",
    sendReport: "Send report",
    changeDelivery: "Change delivery",
    reportProblem: "Report a problem",
    cancel: "Cancel",
    movedTo: (when: string) => `Delivery moved to ${when}`,
    problemReported: "Problem reported",
    assistantKnows: "Your assistant already knows. You can go back to the chat.",
    backToChat: "Back to chat",
    issueTitle: (ticket: string) => `Problem reported · ticket ${ticket}`,
    issueBody: "We're on it and will update you in the chat.",
    expired: "This link has expired",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    actionFailed: "That didn't go through",
    actionFailedBody: "Your assistant already knows. You can try again or go back to the chat.",
    tryAgain: "Try again",
  },
  es: {
    order: "Pedido",
    arriving: "Llega",
    delivered: "Entregado",
    status: {
      placed: "Confirmado",
      shipped: "Enviado",
      in_transit: "En camino",
      out_for_delivery: "En reparto",
      delivered: "Entregado",
      issue: "Incidencia",
    },
    steps: {
      placed: "Pedido realizado",
      shipped: "Salió del almacén",
      in_transit: "En tránsito",
      out_for_delivery: "En reparto",
      delivered: "Entregado",
    },
    items: (n: number, total: string) => `${n} ${n === 1 ? "artículo" : "artículos"} · ${total}`,
    show: "Ver",
    hide: "Ocultar",
    pickSlot: "Elige una nueva franja de entrega",
    whatHappened: "¿Qué ha pasado?",
    reasons: {
      damaged: "Llegó dañado",
      missing_items: "Faltan artículos",
      wrong_address: "Dirección incorrecta",
      late: "Llega tarde",
      other: "Otra cosa",
    },
    detailsPlaceholder: "Cuéntanos un poco más (opcional)",
    sendReport: "Enviar",
    changeDelivery: "Cambiar entrega",
    reportProblem: "Hay un problema",
    cancel: "Cancelar",
    movedTo: (when: string) => `Entrega cambiada al ${when}`,
    problemReported: "Problema enviado",
    assistantKnows: "Tu asistente ya lo sabe. Puedes volver al chat.",
    backToChat: "Volver al chat",
    issueTitle: (ticket: string) => `Incidencia abierta · ${ticket}`,
    issueBody: "Lo estamos revisando y te avisaremos por el chat.",
    expired: "Este enlace ha caducado",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    actionFailed: "No se ha podido completar",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes intentarlo de nuevo o volver al chat.",
    tryAgain: "Reintentar",
  },
};

export type OrderStatusMessages = (typeof ORDER_STATUS_MESSAGES)["en"];

const REASONS = ["damaged", "missing_items", "wrong_address", "late", "other"] as const;
type Reason = (typeof REASONS)[number];

export function OrderStatus({ messages }: { messages?: Partial<OrderStatusMessages> }) {
  const { status, data, errorCode, locale, emit, complete, returnUrl } = useSurface(orderStatus);
  const t: OrderStatusMessages = { ...pickLocalized(ORDER_STATUS_MESSAGES, locale)!, ...messages };
  const [panel, setPanel] = useState<null | "reschedule" | "problem">(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<Reason>("damaged");
  const [details, setDetails] = useState("");
  const [failed, setFailed] = useState<null | { retry: () => void }>(null);

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
    // upstream_error: the data source failed and the agent was told, so don't send the user hunting for a new link.
    const upstream = errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
          {upstream && returnUrl && (
            <a href={returnUrl} className={btn("outline", "mt-3 w-full")}>{t.backToChat}</a>
          )}
        </Card>
      </Shell>
    );
  }

  const day = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const money = (n: number) => n.toLocaleString(locale, { style: "currency", currency: data.currency });
  const total = data.items.reduce((s, i) => s + i.qty * i.price, 0);
  const currentStep = data.steps.findLastIndex((s) => s.at);

  async function run(fn: () => Promise<void>, message: string) {
    setBusy(true);
    setFailed(null);
    try {
      await fn();
      setPanel(null);
      setConfirmation(message);
    } catch {
      // The server already recorded the failure for the agent; here we only tell the user.
      setFailed({ retry: () => void run(fn, message) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{t.order}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.id}</h1>
        </div>
        <StatusBadge status={data.status} label={t.status[data.status] ?? data.status} />
      </header>

      {failed && (
        <Card className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.actionFailedBody}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={failed.retry} className={btn("primary")}>{t.tryAgain}</button>
            {returnUrl && <a href={returnUrl} className={btn("outline")}>{t.backToChat}</a>}
          </div>
        </Card>
      )}

      {confirmation && (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{confirmation}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.assistantKnows}</p>
          {returnUrl && (
            <a href={returnUrl} onClick={() => void complete()} className={btn("primary", "mt-3 w-full")}>
              {t.backToChat}
            </a>
          )}
        </Card>
      )}

      <Card>
        <p className="text-sm text-muted-foreground">{data.status === "delivered" ? t.delivered : t.arriving}</p>
        <p className="mt-0.5 text-lg font-semibold first-letter:uppercase">{day(data.eta.date)}</p>
        <p className="text-sm text-muted-foreground">{data.eta.window} · {data.carrier} {data.trackingCode}</p>
        <ol className="mt-5 space-y-0">
          {data.steps.map((s, i) => (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < data.steps.length - 1 && (
                <span className={`absolute left-[7px] top-4 h-full w-0.5 ${i < currentStep ? "bg-primary" : "bg-border"}`} />
              )}
              <span
                className={`relative mt-0.5 size-4 shrink-0 rounded-full border-2 ${
                  i <= currentStep ? "border-primary bg-primary" : "border-border bg-card"
                } ${i === currentStep ? "ring-4 ring-primary/20" : ""}`}
              />
              <div className="flex-1 text-sm">
                <p className={i <= currentStep ? "font-medium" : "text-muted-foreground"}>{t.steps[s.key] ?? s.label}</p>
                {s.at && <p className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {data.issue && (
        <Card className="border-warning/50 bg-warning/10">
          <p className="font-medium">{t.issueTitle(data.issue.ticket)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.issueBody}</p>
        </Card>
      )}

      <Card>
        <button
          className="flex w-full items-center justify-between text-left"
          onClick={() => {
            if (!itemsOpen) void emit("viewed_items", {});
            setItemsOpen(!itemsOpen);
          }}
        >
          <span className="font-medium">{t.items(data.items.length, money(total))}</span>
          <span className="text-sm text-muted-foreground">{itemsOpen ? t.hide : t.show}</span>
        </button>
        {itemsOpen && (
          <ul className="mt-3 divide-y divide-border text-sm">
            {data.items.map((it) => (
              <li key={it.name} className="flex justify-between py-2">
                <span>{it.qty} × {it.name}</span>
                <span className="tabular-nums">{money(it.qty * it.price)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 border-t border-border pt-3 text-sm text-muted-foreground">{data.address}</p>
      </Card>

      {panel === "reschedule" && (
        <Card>
          <p className="mb-3 font-medium">{t.pickSlot}</p>
          <div className="grid gap-2">
            {data.rescheduleOptions.map((o) => (
              <button
                key={o.date + o.window}
                disabled={busy}
                className={btn("outline", "justify-between")}
                onClick={() => run(() => emit("reschedule_delivery", o), t.movedTo(`${day(o.date)}, ${o.window}`))}
              >
                <span className="first-letter:uppercase">{day(o.date)}</span>
                <span className="text-muted-foreground">{o.window}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {panel === "problem" && (
        <Card>
          <p className="mb-3 font-medium">{t.whatHappened}</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map((value) => (
              <button key={value} onClick={() => setReason(value)} className={btn(reason === value ? "primary" : "outline", "h-9 px-3")}>
                {t.reasons[value]}
              </button>
            ))}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={500}
            placeholder={t.detailsPlaceholder}
            className="mt-3 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={busy}
            className={btn("primary", "mt-3 w-full")}
            onClick={() => run(() => emit("report_problem", { reason, details }), t.problemReported)}
          >
            {t.sendReport}
          </button>
        </Card>
      )}

      {!panel && data.status !== "delivered" && (
        <div className="grid grid-cols-2 gap-2">
          <button className={btn("outline")} onClick={() => setPanel("reschedule")}>{t.changeDelivery}</button>
          <button className={btn("outline")} onClick={() => setPanel("problem")}>{t.reportProblem}</button>
        </div>
      )}
      {panel && (
        <button className={btn("ghost")} onClick={() => setPanel(null)}>{t.cancel}</button>
      )}
    </Shell>
  );
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone = status === "issue" ? "bg-warning/15 text-foreground" : "bg-accent text-accent-foreground";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>;
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
      <div className="h-48 rounded-lg bg-muted" />
      <div className="h-20 rounded-lg bg-muted" />
    </div>
  );
}

function btn(variant: "primary" | "outline" | "ghost", extra = "") {
  const base =
    "inline-flex h-11 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "justify-center bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "justify-center border border-border bg-card hover:bg-muted",
    ghost: "justify-center text-muted-foreground hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}
