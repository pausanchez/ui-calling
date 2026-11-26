import { SurfaceScreen } from "__SCREEN_IMPORT__";
import type { Route } from "./+types/s.$token";

// Where surface links land: /s/<token> (routes.ts: `route("s/:token", ...)`). The token is opaque; data is loaded
// server-side by the surface. The token is in this page's address: don't send it to sites the screen links to.
export const headers: Route.HeadersFunction = () => ({ "Referrer-Policy": "no-referrer" });

// Read on the server: where "Back to chat" goes (e.g. https://wa.me/<your number>, or your chat's page; without it,
// screens show a "Finish" button instead), and the tab title (e.g. your shop's name).
export const loader = () => ({ returnUrl: process.env.UI_CALLING_RETURN_URL, title: process.env.UI_CALLING_PAGE_TITLE });

export const meta: Route.MetaFunction = ({ loaderData }) => [
  { name: "referrer", content: "no-referrer" },
  ...(loaderData?.title ? [{ title: loaderData.title }] : []),
];

export default function SurfacePage({ params, loaderData }: Route.ComponentProps) {
  return <SurfaceScreen token={params.token} returnUrl={loaderData.returnUrl} />;
}
