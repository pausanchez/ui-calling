import { SurfaceScreen } from "__SCREEN_IMPORT__";

// Where surface links land: /s/<token>. The token is opaque; data is loaded server-side by the surface.
export default async function SurfacePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SurfaceScreen token={token} />;
}
