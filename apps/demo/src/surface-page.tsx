import { SurfaceProvider, useSurfaceName } from "@ui-calling/react";
import { OrderStatus } from "./components/ui-calling/order-status";
import { LinkAccount } from "./components/ui-calling/link-account";
import { OrderReturn } from "./components/ui-calling/order-return";
import { ShiftPicker } from "./components/ui-calling/shift-picker";

/** One route serves every surface; the token decides which one renders. */
export function SurfacePage({ token }: { token: string }) {
  // Links sent to a real WhatsApp chat carry the business number (?wa=<digits>), so "Back to chat"
  // reopens that chat in the app. Digits only, so the link can't be turned into a redirect elsewhere.
  const wa = new URLSearchParams(location.search).get("wa");
  const returnUrl = wa && /^\d{6,15}$/.test(wa) ? `https://wa.me/${wa}` : "/";
  return (
    <SurfaceProvider token={token} returnUrl={returnUrl}>
      <Router />
    </SurfaceProvider>
  );
}

// Add a line here for each surface the demo serves.
const SURFACES: Record<string, () => React.JSX.Element> = {
  order_status: () => <OrderStatus />,
  order_return: () => <OrderReturn />,
  shift_picker: () => <ShiftPicker />,
  link_account: () => <LinkAccount />,
};

const TEXT = {
  en: {
    expired: "This link has expired",
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
  const { status, surface, locale, errorCode, returnUrl } = useSurfaceName();
  const render = surface ? SURFACES[surface] : undefined;
  if (render) return render();
  // No surface known yet: a neutral skeleton while loading, a neutral message if the link is bad.
  if (status === "loading") {
    return (
      <main className="min-h-dvh bg-background">
        <div className="mx-auto max-w-md animate-pulse space-y-4 px-4 py-6">
          <div className="h-10 w-1/2 rounded-md bg-muted" />
          <div className="h-48 rounded-lg bg-muted" />
        </div>
      </main>
    );
  }
  const t = TEXT[(locale ?? "en").startsWith("es") ? "es" : "en"];
  // The user already finished here: the link is closed, so point them back to the chat.
  if (status === "completed") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div>
          <p className="font-medium">{t.completed}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.completedHelp}</p>
          {returnUrl && (
            <a
              href={returnUrl}
              className="mt-4 inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t.backToChat}
            </a>
          )}
        </div>
      </main>
    );
  }
  // Only an unknown token is a bad link. Anything else (offline, server down) may work on a retry.
  if (status === "error" && errorCode !== "not_found") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
        <div role="alert">
          <p className="font-medium">{t.loadError}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t.loadErrorHelp}</p>
          <button
            onClick={() => location.reload()}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
          >
            {t.tryAgain}
          </button>
        </div>
      </main>
    );
  }
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div>
        <p className="font-medium">{status === "expired" ? t.expired : t.invalid}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.help}</p>
      </div>
    </main>
  );
}
