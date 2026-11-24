import { Hono } from "hono";
import { UiCallingError, type UiCalling } from "@ui-calling/core";

/**
 * Routes the screen talks to. Mount them under any prefix:
 *   app.route("/api/ui", uiCallingRoutes(ui))
 *
 * Link previews: WhatsApp and other crawlers fetch the page HTML but don't run
 * its JavaScript, so they never hit these routes. That keeps previews from
 * leaking data or counting as "opened".
 */
export function uiCallingRoutes(ui: UiCalling) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    // The token lives in the page URL: never cache responses or send it on as a Referer.
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/sessions/:token", async (c) => c.json(await ui.open(c.req.param("token"))));

  app.post("/sessions/:token/events", async (c) => {
    const body = await c.req.json<{ type?: string; payload?: unknown }>().catch(() => ({}) as { type?: string; payload?: unknown });
    if (!body.type) return c.json({ error: "invalid_payload", message: "Missing event type" }, 400);
    const { event, data } = await ui.emit(c.req.param("token"), body.type, body.payload);
    return c.json({ event: { id: event.id, type: event.type }, data });
  });

  app.onError((err, c) => {
    if (err instanceof UiCallingError) {
      return c.json({ error: err.code, message: err.message, retryable: err.retryable, reason: err.reason }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  return app;
}

/**
 * The same routes as a plain `(Request) => Response` handler, for frameworks that take one:
 * Next.js route handlers, Remix/React Router actions, Bun.serve, Deno, Workers…
 *
 *   // app/api/ui/[...path]/route.ts
 *   const handler = uiCallingHandler(ui);
 *   export { handler as GET, handler as POST };
 */
export function uiCallingHandler(ui: UiCalling, opts: { basePath?: string } = {}) {
  const app = new Hono().basePath(opts.basePath ?? "/api/ui");
  app.route("/", uiCallingRoutes(ui));
  return (request: Request) => app.fetch(request);
}
