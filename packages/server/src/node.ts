import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { UiCalling } from "@ui-calling/core";
import { uiCallingHandler, type RouteOptions } from "./index";

/**
 * The same routes as a Node `(req, res)` handler, for Express, Fastify (`reply.raw`), Koa or `http.createServer`.
 * Its own entry point so the main one stays free of Node built-ins (Workers, Deno).
 *
 *   app.use("/api/ui", uiCallingNodeHandler(ui, { dev: process.env.NODE_ENV !== "production" })); // before express.json()
 *
 * Mount it before any body parser: it reads the raw body (events, file uploads). `basePath` is where you mount
 * it (default /api/ui); Express's `req.originalUrl` is used, so the mount path isn't lost.
 */
export function uiCallingNodeHandler(ui: UiCalling, opts: RouteOptions & { basePath?: string } = {}) {
  const handler = uiCallingHandler(ui, opts);
  return async (req: IncomingMessage & { originalUrl?: string }, res: ServerResponse) => {
    const url = new URL(req.originalUrl ?? req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const response = await handler(
      new Request(url, {
        method: req.method,
        headers,
        body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
        // Node's fetch needs this to send a streamed body; lib.dom's RequestInit doesn't list it.
        ...(hasBody ? { duplex: "half" } : {}),
      } as RequestInit),
    );
    res.statusCode = response.status;
    response.headers.forEach((v, k) => {
      if (k !== "set-cookie") res.setHeader(k, v);
    });
    const cookies = response.headers.getSetCookie();
    if (cookies.length) res.setHeader("set-cookie", cookies);
    if (!response.body) return void res.end();
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
  };
}
