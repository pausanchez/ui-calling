import { SurfaceProvider, useSurfaceName } from "@ui-calling/react";
import { OrderStatus } from "./components/ui-calling/order-status";

/** One route serves every surface; the token decides which one renders. */
export function SurfacePage({ token }: { token: string }) {
  return (
    <SurfaceProvider token={token} returnUrl="/">
      <Router />
    </SurfaceProvider>
  );
}

function Router() {
  const { status, surface, error } = useSurfaceName();
  // Until a surface is known (loading, expired, bad link), let the block render its own localized states.
  if (!surface || surface === "order_status") return <OrderStatus />;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6 text-center">
      <div>
        <p className="font-medium">{status === "expired" ? "This link has expired" : "This link isn't valid"}</p>
        <p className="mt-1 text-sm text-muted-foreground">{error ?? "Ask your assistant for a new one."}</p>
      </div>
    </main>
  );
}
