import { uiCallingHandler } from "@ui-calling/server";
import { ui } from "__UI_IMPORT__";

// The routes your surfaces talk to: GET /api/ui/sessions/:token, POST /api/ui/sessions/:token/events.
const handler = uiCallingHandler(ui, { basePath: "/api/ui" });

export { handler as GET, handler as POST };
