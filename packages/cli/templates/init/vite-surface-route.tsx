import { SurfaceScreen } from "./surface-screen";

/**
 * The screen for a link (`/s/<token>`), or null on every other page, so your app renders as usual:
 * `{surfaceRoute() ?? <App />}`. With a router, route `/s/:token` to `<SurfaceScreen token={token} />` instead.
 */
export function surfaceRoute(path = window.location.pathname) {
  const token = path.match(/^\/s\/([^/]+)\/?$/)?.[1];
  // returnUrl: where "Back to chat" goes, e.g. your web chat's page or https://wa.me/<your number>.
  return token ? <SurfaceScreen token={token} /> : null;
}
