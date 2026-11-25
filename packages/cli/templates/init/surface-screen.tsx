"use client";
import { SurfaceProvider, useSurfaceSession } from "@ui-calling/react";
// ui-calling:imports

/** One entry per surface. `npx ui-calling new <name>` adds them. */
const SURFACES: Record<string, () => React.JSX.Element> = {
  /* ui-calling:surfaces */
};

/**
 * A quiet placeholder in the screen's shape, for while the link loads. The `/s/[token]` page also shows it before
 * any JavaScript runs, so a slow phone sees a screen taking shape instead of a white page.
 */
export function SurfaceLoading() {
  return (
    <main aria-busy="true" style={{ minHeight: "100dvh", maxWidth: 448, margin: "0 auto", padding: "24px 16px", display: "grid", gap: 12, alignContent: "start" }}>
      {[40, 112, 64].map((h, i) => (
        <div key={i} style={{ height: h, borderRadius: 8, background: "var(--muted, #eee)", opacity: 0.8 }} />
      ))}
    </main>
  );
}

/**
 * Renders whichever surface the link's token points to. Mount it on your `/s/:token` route.
 * `returnUrl` is where "Back to chat" goes, e.g. `https://wa.me/<your number>` or your web chat.
 */
export function SurfaceScreen({ token, returnUrl }: { token: string; returnUrl?: string }) {
  return (
    <SurfaceProvider token={token} endpoint="/api/ui" returnUrl={returnUrl}>
      <Router />
    </SurfaceProvider>
  );
}

const TEXT = {
  en: {
    expired: "This link has expired",
    otherDevice: "This link was already opened on another device",
    invalid: "This link isn't valid",
    help: "Ask your assistant for a new one.",
    loadError: "We couldn't load this page",
    loadErrorHelp: "Check your connection and try again.",
    tryAgain: "Try again",
    completed: "All done here",
    completedHelp: "You can go back to the chat. If you need this screen again, ask your assistant.",
    backToChat: "Back to chat",
  },
  es: {
    expired: "Este enlace ha caducado",
    otherDevice: "Este enlace ya se abrió en otro dispositivo",
    invalid: "Este enlace no es válido",
    help: "Pídele uno nuevo a tu asistente.",
    loadError: "No hemos podido cargar esta página",
    loadErrorHelp: "Comprueba tu conexión e inténtalo de nuevo.",
    tryAgain: "Reintentar",
    completed: "Ya está hecho",
    completedHelp: "Puedes volver al chat. Si necesitas esta pantalla otra vez, pídesela a tu asistente.",
    backToChat: "Volver al chat",
  },
};

function Router() {
  const { status, surface, locale, errorCode, returnUrl } = useSurfaceSession();
  // Once the surface is known, it renders its own states, including "your data source is down".
  const render = surface ? SURFACES[surface] : undefined;
  if (render) return render();
  // Until the surface is known: a quiet placeholder, so the first load doesn't look like a blank page.
  if (status === "loading") return <SurfaceLoading />;
  const t = TEXT[(locale ?? "en").startsWith("es") ? "es" : "en"];
  // "completed": the user already finished here and the link is closed.
  const done = status === "completed";
  // Only an unknown token is a bad link. Anything else (offline, server down) may work on a retry.
  const otherDevice = errorCode === "other_device";
  const unreachable = status === "error" && errorCode !== "not_found" && !otherDevice;
  const [title, help] = done
    ? [t.completed, t.completedHelp]
    : status === "expired" || otherDevice
      ? [otherDevice ? t.otherDevice : t.expired, t.help]
      : unreachable
        ? [t.loadError, t.loadErrorHelp]
        : [t.invalid, t.help];
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div role={unreachable ? "alert" : undefined}>
        <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
        <p style={{ margin: "4px 0 0", opacity: 0.7 }}>{help}</p>
        {unreachable && (
          <button onClick={() => location.reload()} style={{ marginTop: 12 }}>
            {t.tryAgain}
          </button>
        )}
        {done && returnUrl && (
          <a href={returnUrl} style={{ display: "inline-block", marginTop: 12 }}>
            {t.backToChat}
          </a>
        )}
      </div>
    </main>
  );
}
