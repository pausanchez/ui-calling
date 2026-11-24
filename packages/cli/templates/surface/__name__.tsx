import { useState, type ReactNode } from "react";
import { pickLocalized } from "@ui-calling/core";
import { useSurface } from "@ui-calling/react";
import { __const__ } from "./__name__.surface";

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop. */
export const __MESSAGES__ = {
  en: {
    confirm: "Confirm",
    notePlaceholder: "Anything to add? (optional)",
    confirmed: "Done",
    assistantKnows: "Your assistant already knows. You can go back to the chat.",
    backToChat: "Back to chat",
    actionFailed: "That didn't go through",
    actionFailedBody: "Your assistant already knows. You can try again or go back to the chat.",
    tryAgain: "Try again",
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    expired: "This link has expired",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    confirm: "Confirmar",
    notePlaceholder: "¿Algo que añadir? (opcional)",
    confirmed: "Hecho",
    assistantKnows: "Tu asistente ya lo sabe. Puedes volver al chat.",
    backToChat: "Volver al chat",
    actionFailed: "No se ha podido completar",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes intentarlo de nuevo o volver al chat.",
    tryAgain: "Reintentar",
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    expired: "Este enlace ha caducado",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type __Component__Messages = (typeof __MESSAGES__)["en"];

export function __Component__({ messages }: { messages?: Partial<__Component__Messages> }) {
  const { status, data, errorCode, locale, emit, returnUrl } = useSurface(__const__);
  const t: __Component__Messages = { ...pickLocalized(__MESSAGES__, locale)!, ...messages };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (status === "loading") return <Shell><div className="h-40 animate-pulse rounded-lg bg-muted" /></Shell>;
  if (status !== "ready" || !data) {
    // upstream_error: your data source failed and the agent was told, so send the user back to the chat.
    const upstream = errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
        </Card>
      </Shell>
    );
  }

  async function confirm() {
    setBusy(true);
    setFailed(false);
    try {
      await emit("confirmed", { note });
    } catch {
      // The server already recorded the failure for the agent; here we only tell the user.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {/* TODO: render your data. */}
      <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>

      {failed && (
        <Card className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.actionFailedBody}</p>
          <button disabled={busy} onClick={confirm} className={btn("primary", "mt-3 w-full")}>{t.tryAgain}</button>
        </Card>
      )}

      {data.confirmed ? (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{t.confirmed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.assistantKnows}</p>
          {returnUrl && <a href={returnUrl} className={btn("primary", "mt-3 w-full")}>{t.backToChat}</a>}
        </Card>
      ) : (
        <Card>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t.notePlaceholder}
            className="min-h-20 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button disabled={busy} onClick={confirm} className={btn("primary", "mt-3 w-full")}>{t.confirm}</button>
        </Card>
      )}
    </Shell>
  );
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

function btn(variant: "primary" | "outline", extra = "") {
  const base =
    "inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const v = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    outline: "border border-border bg-card hover:bg-muted",
  }[variant];
  return `${base} ${v} ${extra}`;
}
