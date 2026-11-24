import { SurfaceProvider, useSurfaceName } from "@ui-calling/react";
import { OrderStatus } from "./components/ui-calling/order-status";
import { ShiftPicker } from "./components/ui-calling/shift-picker";

/** One route serves every surface; the token decides which one renders. */
export function SurfacePage({ token }: { token: string }) {
  return (
    <SurfaceProvider token={token} returnUrl="/">
      <Router />
    </SurfaceProvider>
  );
}

// Add a line here for each surface the demo serves.
const SURFACES: Record<string, () => React.JSX.Element> = {
  order_status: () => <OrderStatus />,
  shift_picker: () => <ShiftPicker />,
};

const TEXT = {
  en: { expired: "This link has expired", invalid: "This link isn't valid", help: "Ask your assistant for a new one." },
  es: { expired: "Este enlace ha caducado", invalid: "Este enlace no es válido", help: "Pídele uno nuevo a tu asistente." },
};

function Router() {
  const { status, surface, locale } = useSurfaceName();
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
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div>
        <p className="font-medium">{status === "expired" ? t.expired : t.invalid}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t.help}</p>
      </div>
    </main>
  );
}
