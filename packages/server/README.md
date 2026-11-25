# @ui-calling/server

The HTTP routes screens talk to: load a link's data, post events, upload files. A Hono app that runs on Node, Bun, Deno and Workers.

```ts
import { uiCallingHandler, uiCallingRoutes } from "@ui-calling/server";

app.route("/api/ui", uiCallingRoutes(ui, { dev: process.env.NODE_ENV !== "production" })); // Hono
const handler = uiCallingHandler(ui); // (Request) => Response, e.g. a Next.js route: GET, POST and DELETE
```

`dev: true` adds the routes behind `npx ui-calling link` and `events` (localhost only). Routes and errors: `npx ui-calling guide api`.
