import { SurfaceScreen } from "./surface-screen";

/**
 * The screen for a link (`/s/<token>`), or null on every other page, so your app renders as usual:
 * `{surfaceRoute() ?? <App />}`. With a router, route `/s/:token` to `<SurfaceScreen token={token} />` instead.
 */
export function surfaceRoute(path = window.location.pathname) {
  const token = path.match(/^\/s\/([^/]+)\/?$/)?.[1];
  if (!token) return null;
  // The tab title: set VITE_UI_CALLING_PAGE_TITLE (e.g. your shop's name) in .env, or index.html's title shows.
  const title = import.meta.env.VITE_UI_CALLING_PAGE_TITLE;
  if (title) document.title = title;
  // returnUrl: where "Back to chat" goes, e.g. your web chat's page or https://wa.me/<your number>.
  return <SurfaceScreen token={token} returnUrl={import.meta.env.VITE_UI_CALLING_RETURN_URL} />;
}
