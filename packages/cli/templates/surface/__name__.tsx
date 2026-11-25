import { useState } from "react";
import { pickLocalized } from "@ui-calling/core";
import { SurfaceActionError, useSurface } from "@ui-calling/react";
import { Card, Shell, Skeleton, btn } from "../../registry/parts/screen-kit";
import { __const__ } from "./__name__.surface";

/** Every string on the screen. Add a language by adding a key; override strings with the `messages` prop.
 * Not exported: a file that only exports components keeps Fast Refresh working. */
const __MESSAGES__ = {
  en: {
    confirm: "Confirm",
    notePlaceholder: "Anything to add? (optional)",
    confirmed: "Done",
    assistantKnows: "Your assistant already knows. You can go back to the chat.",
    backToChat: "Back to chat",
    finish: "Finish",
    actionFailed: "That didn't go through",
    actionFailedBody: "Your assistant already knows. You can try again or go back to the chat.",
    tryAgain: "Try again",
    offline: "We couldn't reach the server. Check your connection and try again.",
    unavailable: "This page isn't available right now",
    unavailableBody: "Your assistant already knows and will follow up in the chat.",
    expired: "This link has expired",
    otherDevice: "This link was already opened on another device",
    loadError: "We couldn't load this page",
    askNewLink: "Ask your assistant for a new link.",
  },
  es: {
    confirm: "Confirmar",
    notePlaceholder: "¿Algo que añadir? (opcional)",
    confirmed: "Hecho",
    assistantKnows: "Tu asistente ya lo sabe. Puedes volver al chat.",
    backToChat: "Volver al chat",
    finish: "Terminar",
    actionFailed: "No se ha podido completar",
    actionFailedBody: "Tu asistente ya lo sabe. Puedes intentarlo de nuevo o volver al chat.",
    tryAgain: "Reintentar",
    offline: "No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.",
    unavailable: "Esta página no está disponible ahora mismo",
    unavailableBody: "Tu asistente ya lo sabe y te escribirá por el chat.",
    expired: "Este enlace ha caducado",
    otherDevice: "Este enlace ya se abrió en otro dispositivo",
    loadError: "No hemos podido cargar esta página",
    askNewLink: "Pídele un enlace nuevo a tu asistente.",
  },
};

export type __Component__Messages = (typeof __MESSAGES__)["en"];

export function __Component__({ messages }: { messages?: Partial<__Component__Messages> }) {
  const { status, data, errorCode, locale, emit, reload, complete, returnUrl } = useSurface(__const__);
  const t: __Component__Messages = { ...pickLocalized(__MESSAGES__, locale)!, ...messages };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // After a failed action: whether trying again can work (a timeout can, a full slot can't).
  // `offline`: the request never arrived, so the agent doesn't know either.
  const [failed, setFailed] = useState<null | { retryable: boolean; offline: boolean }>(null);

  if (status === "loading") return <Shell><Skeleton /></Shell>;
  if (status !== "ready" || !data) {
    // upstream_error: your data source failed and the agent was told, so send the user back to the chat.
    const upstream = errorCode === "upstream_error";
    return (
      <Shell>
        <Card>
          <p className="font-medium">{status === "expired" ? t.expired : errorCode === "other_device" ? t.otherDevice : upstream ? t.unavailable : t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{upstream ? t.unavailableBody : t.askNewLink}</p>
          {upstream && returnUrl && <a href={returnUrl} className={btn("outline", "mt-3 w-full")}>{t.backToChat}</a>}
        </Card>
      </Shell>
    );
  }

  async function confirm() {
    setBusy(true);
    setFailed(null);
    try {
      await emit("confirmed", { note });
    } catch (err) {
      // The server already recorded the failure for the agent; here we only tell the user.
      const retryable = !(err instanceof SurfaceActionError) || err.retryable;
      setFailed({ retryable, offline: !(err instanceof SurfaceActionError) || err.code === "network" });
      // What's on screen may be out of date (e.g. someone else took the slot): refresh it.
      if (!retryable) void reload().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      {/* TODO: render your data. */}
      <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>

      {failed && (
        <Card role="alert" className="border-destructive/40 bg-destructive/10">
          <p className="font-medium">{t.actionFailed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{failed.offline ? t.offline : failed.retryable ? t.actionFailedBody : t.unavailableBody}</p>
          {failed.retryable && (
            <button disabled={busy} onClick={confirm} className={btn("primary", "mt-3 w-full")}>{t.tryAgain}</button>
          )}
        </Card>
      )}

      {data.confirmed ? (
        <Card className="border-success/40 bg-success/10">
          <p className="font-medium">{t.confirmed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.assistantKnows}</p>
          {/* complete() tells the agent the user finished here and closes the link; call it when they're done, not on every action. */}
          {returnUrl ? (
            <a href={returnUrl} onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>
              {t.backToChat}
            </a>
          ) : (
            <button onClick={() => void complete().catch(() => {})} className={btn("primary", "mt-3 w-full")}>
              {t.finish}
            </button>
          )}
        </Card>
      ) : (
        <Card>
          <textarea
            aria-label={t.notePlaceholder}
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
