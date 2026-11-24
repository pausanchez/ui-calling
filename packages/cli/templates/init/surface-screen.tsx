"use client";
import { SurfaceProvider, useSurfaceName } from "@ui-calling/react";
// ui-calling:imports

/** One entry per surface. `npx ui-calling new <name>` adds them. */
const SURFACES: Record<string, () => React.JSX.Element> = {
  /* ui-calling:surfaces */
};

/** Renders whichever surface the link's token points to. Mount it on your `/s/:token` route. */
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
    invalid: "This link isn't valid",
    help: "Ask your assistant for a new one.",
    completed: "All done here",
    completedHelp: "You can go back to the chat. If you need this screen again, ask your assistant.",
    backToChat: "Back to chat",
  },
  es: {
    expired: "Este enlace ha caducado",
    invalid: "Este enlace no es válido",
    help: "Pídele uno nuevo a tu asistente.",
    completed: "Ya está hecho",
    completedHelp: "Puedes volver al chat. Si necesitas esta pantalla otra vez, pídesela a tu asistente.",
    backToChat: "Volver al chat",
  },
};

function Router() {
  const { status, surface, locale, returnUrl } = useSurfaceName();
  const render = surface ? SURFACES[surface] : undefined;
  if (render) return render();
  if (status === "loading") return <main style={{ minHeight: "100dvh" }} aria-busy="true" />;
  const t = TEXT[(locale ?? "en").startsWith("es") ? "es" : "en"];
  // "completed": the user already finished here and the link is closed.
  const done = status === "completed";
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
      <div>
        <p style={{ fontWeight: 600, margin: 0 }}>{done ? t.completed : status === "expired" ? t.expired : t.invalid}</p>
        <p style={{ margin: "4px 0 0", opacity: 0.7 }}>{done ? t.completedHelp : t.help}</p>
        {done && returnUrl && (
          <a href={returnUrl} style={{ display: "inline-block", marginTop: 12 }}>
            {t.backToChat}
          </a>
        )}
      </div>
    </main>
  );
}
