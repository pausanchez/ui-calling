import { uiCallingHandler } from "@ui-calling/server";
import { ui } from "__UI_IMPORT__";

// The routes your surfaces talk to: the session, its events, and uploaded files (GET, POST, DELETE).
// In `next dev` it also serves the dev routes behind `npx ui-calling link` and `npx ui-calling events`.
const handler = uiCallingHandler(ui, { basePath: "/api/ui", dev: process.env.NODE_ENV === "development" });

export { handler as GET, handler as POST, handler as DELETE };
