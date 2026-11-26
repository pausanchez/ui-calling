import { uiCallingHandler } from "@ui-calling/server";
import { ui } from "__UI_IMPORT__";
import type { Route } from "./+types/api.ui";

// The routes your surfaces talk to (routes.ts: `route("api/ui/*", ...)`): the session, its events and uploaded
// files. GET goes to the loader; POST and DELETE to the action. In development it also serves the dev routes
// behind `npx ui-calling link` and `npx ui-calling events`.
//
// Import from server modules only for the loader and action, never for side effects (`import "../agent"`): React
// Router keeps a bare import in the browser bundle, and `react-router build` then refuses every *.server.ts that
// ui.ts imports. If your agent subscribes with ui.onEvent in its own module, import something from it here and use
// it in both functions, so a screen event finds the agent even when no chat request has loaded it since a restart.
const handler = uiCallingHandler(ui, { basePath: "/api/ui", dev: process.env.NODE_ENV === "development" });

export const loader = ({ request }: Route.LoaderArgs) => handler(request);
export const action = ({ request }: Route.ActionArgs) => handler(request);
