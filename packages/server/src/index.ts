import { Hono, type Context, type Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import { UiCallingError, formatEventsForAgent, type UiCalling } from "@ui-calling/core";

/**
 * Routes the screen talks to (session, events, and files for surfaces that declare them). Mount them under any prefix:
 *   app.route("/api/ui", uiCallingRoutes(ui))
 *
 * Link previews: WhatsApp and other crawlers fetch the page HTML but don't run
 * its JavaScript, so they never hit these routes. That keeps previews from
 * leaking data or counting as "opened".
 */
const DEVICE_COOKIE = "uic_device";

export function uiCallingRoutes(ui: UiCalling, opts: RouteOptions = {}) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    // The token lives in the page URL: never cache responses or send it on as a Referer.
    c.header("Cache-Control", "no-store");
    c.header("Referrer-Policy", "no-referrer");
  });

  // Surfaces with `bindToDevice`: the first browser to open the link gets a cookie scoped to this link's routes,
  // and every later request must carry it. Other surfaces pass straight through.
  const bindDevice = async (c: Context, next: Next) => {
    const token = c.req.param("token")!;
    const { issue } = await ui.device(token, getCookie(c, DEVICE_COOKIE));
    if (issue) {
      const path = c.req.path.slice(0, c.req.path.indexOf(`/sessions/${token}`) + `/sessions/${token}`.length);
      setCookie(c, DEVICE_COOKIE, issue, { path, httpOnly: true, sameSite: "Strict", secure: new URL(c.req.url).protocol === "https:" });
    }
    await next();
  };
  // One registration: in Hono "/sessions/:token/*" also matches "/sessions/:token", and a second pass would refuse
  // the cookie the first one just issued (the browser hasn't sent it yet).
  app.use("/sessions/:token/*", bindDevice);

  app.get("/sessions/:token", async (c) => c.json(await ui.open(c.req.param("token"))));

  // Development only: open a screen for a test user without an agent, and see what the agent would read.
  // `npx ui-calling link` and `npx ui-calling events` call these. Never mounted in production.
  if (opts.dev && process.env.NODE_ENV !== "production") {
    // They open any user's screens with no login: localhost only, so a dev server reachable through a tunnel or
    // a misconfigured deploy (`next dev` in production, NODE_ENV=development) doesn't expose them.
    console.warn("[ui_calling] dev routes are on (/dev/links, /dev/events): localhost only, never in production");
    app.use("/dev/*", async (c, next) => {
      const host = new URL(c.req.url).hostname;
      if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return c.json({ error: "not_found" }, 404);
      await next();
    });
    app.post("/dev/links", async (c) => {
      const body = await c.req.json<{ surface?: string; input?: Record<string, unknown>; subject?: string; conversationId?: string; locale?: string }>();
      const tool = ui.tools().find((t) => t.name === body.surface || t.name.endsWith(`_${body.surface}`))?.name;
      if (!tool) return c.json({ error: "unknown_surface", message: `No surface "${body.surface}". Surfaces: ${ui.tools().map((t) => t.name).join(", ")}` }, 404);
      const subject = body.subject ?? "dev-user";
      const conversationId = body.conversationId ?? `dev:${subject}`;
      const run = await ui.runTool(tool, { ...body.input, ...(body.locale ? { locale: body.locale } : {}) }, { conversationId, subject });
      // A refusal from resolve (e.g. the test user isn't linked) is 422 with its code; bad input stays 400.
      if (!run.ok) {
        const bad = run.error.code === "invalid_payload" || run.error.code === "unknown_surface";
        return c.json({ error: run.error.code, message: run.error.message }, bad ? 400 : 422);
      }
      return c.json({ url: run.link?.url, conversationId, toolResult: run.content });
    });
    app.get("/dev/events/:conversationId", async (c) => {
      const timeZone = c.req.query("timeZone");
      return c.text(formatEventsForAgent(await ui.events(c.req.param("conversationId")), timeZone ? { timeZone } : {}) || "(no events yet)");
    });
  }

  app.post(
    "/sessions/:token/events",
    // Events are small: an ID and the user's choices. Anything bigger is a mistake or abuse.
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "payload_too_large", message: "Event too large" }, 413) }),
    async (c) => {
    const body = await c.req.json<{ type?: string; payload?: unknown }>().catch(() => ({}) as { type?: string; payload?: unknown });
    if (!body.type) return c.json({ error: "invalid_payload", message: "Missing event type" }, 400);
    const { event, data } = await ui.emit(c.req.param("token"), body.type, body.payload);
    return c.json({ event: { id: event.id, type: event.type }, data });
    },
  );

  // Uploads are multipart, with the file in a field named "file". The exact limit is per slot (checked by
  // the runtime); this cap only stops bodies bigger than any slot accepts before they're read.
  app.post(
    "/sessions/:token/files/:slot",
    bodyLimit({
      maxSize: ui.maxUploadBytes + 64 * 1024,
      onError: (c) => c.json({ error: "invalid_file", reason: "file_too_large", message: "File too large" }, 413),
    }),
    async (c) => {
      const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
      const file = body.file;
      if (!(file instanceof File)) return c.json({ error: "invalid_file", reason: "no_file", message: "Send the file in a multipart field named \"file\"" }, 400);
      const ref = await ui.upload(c.req.param("token"), c.req.param("slot"), {
        name: file.name,
        type: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return c.json({ file: ref });
    },
  );

  app.get("/sessions/:token/files/:id", async (c) => {
    const { file, bytes } = await ui.file(c.req.param("token"), c.req.param("id"));
    return c.body(bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": file.type,
      // Images and PDFs show in the page; anything else downloads instead of rendering on this origin.
      "Content-Disposition": `${/^image\/|^application\/pdf$/.test(file.type) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      // Uploaded bytes are untrusted: never let the browser guess a type or run anything in them.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
  });

  app.delete("/sessions/:token/files/:id", async (c) => {
    await ui.deleteFile(c.req.param("token"), c.req.param("id"));
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    if (err instanceof UiCallingError) {
      const { code, message, retryable, reason, surface, locale } = err;
      return c.json({ error: code, message, retryable, reason, surface, locale }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal" }, 500);
  });

  return app;
}

export type RouteOptions = {
  /**
   * Add development routes: `POST /dev/links` opens a screen for a test user, `GET /dev/events/:conversationId`
   * shows what the agent would read. Ignored when NODE_ENV is "production". `init` sets it for `next dev`.
   */
  dev?: boolean;
};

/**
 * The same routes as a plain `(Request) => Response` handler, for frameworks that take one:
 * Next.js route handlers, Remix/React Router actions, Bun.serve, Deno, Workers…
 *
 *   // app/api/ui/[...path]/route.ts
 *   const handler = uiCallingHandler(ui);
 *   export { handler as GET, handler as POST, handler as DELETE }; // DELETE: removing an uploaded file
 */
export function uiCallingHandler(ui: UiCalling, opts: RouteOptions & { basePath?: string } = {}) {
  const app = new Hono().basePath(opts.basePath ?? "/api/ui");
  app.route("/", uiCallingRoutes(ui, opts));
  return (request: Request) => app.fetch(request);
}
