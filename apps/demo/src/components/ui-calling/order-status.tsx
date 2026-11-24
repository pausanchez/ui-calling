import { useState, type ReactNode } from "react";
import { useSurface } from "@ui-calling/react";
import { orderStatus } from "./order-status.surface";

const REASONS = [
  ["damaged", "Arrived damaged"],
  ["missing_items", "Items missing"],
  ["wrong_address", "Wrong address"],
  ["late", "It's late"],
  ["other", "Something else"],
] as const;

type Reason = (typeof REASONS)[number][0];

export function OrderStatus({ locale = "en-GB" }: { locale?: string }) {
  const { status, data, error, emit, complete, returnUrl } = useSurface(orderStatus);
  const [panel, setPanel] = useState<null | "reschedule" | "problem">(null);
  const [itemsOpen, setItemsOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<Reason>("damaged");
  const [details, setDetails] = useState("");

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? "This link has expired" : "We couldn't load this page"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{error ?? "Ask your assistant for a new link."}</p>
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
    try {
      await fn();
      setPanel(null);
      setConfirmation(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Order</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.id}</h1>
        </div>
        <StatusBadge status={data.status} />
      </header>

      {confirmation && (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{confirmation}</p>
          <p className="mt-1 text-sm text-muted-foreground">Your assistant already knows. You can go back to the chat.</p>
          {returnUrl && (
            <a href={returnUrl} onClick={() => void complete()} className={btn("primary", "mt-3 w-full")}>
              Back to chat
            </a>
          )}
        </Card>
      )}

      <Card>
        <p className="text-sm text-muted-foreground">{data.status === "delivered" ? "Delivered" : "Arriving"}</p>
        <p className="mt-0.5 text-lg font-semibold capitalize">{day(data.eta.date)}</p>
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
                <p className={i <= currentStep ? "font-medium" : "text-muted-foreground"}>{s.label}</p>
                {s.at && <p className="text-xs text-muted-foreground">{new Date(s.at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}</p>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {data.issue && (
        <Card className="border-warning/50 bg-warning/10">
          <p className="font-medium">Problem reported · ticket {data.issue.ticket}</p>
          <p className="mt-1 text-sm text-muted-foreground">We're on it and will update you in the chat.</p>
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
          <span className="font-medium">{data.items.length} items · {money(total)}</span>
          <span className="text-sm text-muted-foreground">{itemsOpen ? "Hide" : "Show"}</span>
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
          <p className="mb-3 font-medium">Pick a new delivery slot</p>
          <div className="grid gap-2">
            {data.rescheduleOptions.map((o) => (
              <button
                key={o.date + o.window}
                disabled={busy}
                className={btn("outline", "justify-between")}
                onClick={() => run(() => emit("reschedule_delivery", o), `Delivery moved to ${day(o.date)}, ${o.window}`)}
              >
                <span className="capitalize">{day(o.date)}</span>
                <span className="text-muted-foreground">{o.window}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {panel === "problem" && (
        <Card>
          <p className="mb-3 font-medium">What happened?</p>
          <div className="flex flex-wrap gap-2">
            {REASONS.map(([value, label]) => (
              <button key={value} onClick={() => setReason(value)} className={btn(reason === value ? "primary" : "outline", "h-9 px-3")}>
                {label}
              </button>
            ))}
          </div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={500}
            placeholder="Tell us a bit more (optional)"
            className="mt-3 min-h-24 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={busy}
            className={btn("primary", "mt-3 w-full")}
            onClick={() => run(() => emit("report_problem", { reason, details }), "Problem reported")}
          >
            Send report
          </button>
        </Card>
      )}

      {!panel && data.status !== "delivered" && (
        <div className="grid grid-cols-2 gap-2">
          <button className={btn("outline")} onClick={() => setPanel("reschedule")}>Change delivery</button>
          <button className={btn("outline")} onClick={() => setPanel("problem")}>Report a problem</button>
        </div>
      )}
      {panel && (
        <button className={btn("ghost")} onClick={() => setPanel(null)}>Cancel</button>
      )}
    </Shell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
  const tone = status === "issue" ? "bg-warning/15 text-foreground" : "bg-accent text-accent-foreground";
  return <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${tone}`}>{label}</span>;
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
