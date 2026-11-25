import { Suspense } from "react";
import { SurfaceScreen } from "__SCREEN_IMPORT__";

// Where surface links land: /s/<token>. The token is opaque; data is loaded server-side by the surface.
// `params` is read inside <Suspense> so Next.js can still prerender the page shell (required from Next 16).
export default function SurfacePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={null}>
      <Screen params={params} />
    </Suspense>
  );
}

async function Screen({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Where "Back to chat" goes, e.g. https://wa.me/<your number>. Without it, screens show a "Done" button instead.
  return <SurfaceScreen token={token} returnUrl={process.env.UI_CALLING_RETURN_URL} />;
}
