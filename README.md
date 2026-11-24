# UI_calling

**Function calling, but the function is a screen.**

An AI agent chatting on WhatsApp (or any channel that can't render rich UI) calls a *surface* like a tool. UI_calling mints a secure link, the user opens a real UI, and everything they do there flows back to the agent as **semantic events**, so the conversation picks up knowing exactly what happened.

```
agent ──tool call──▶ show_order_status({ order_id })
                        │  session: opaque token, bound to conversation + subject, expires
                        ▼
chat  ◀── "Here's your order 👇" + [View order] button
                        │
user opens link ──▶ data resolved server-side, scoped to the subject
                        │
user acts ──▶ "User rescheduled the delivery to 2026-11-27, 16:00–20:00"  (wake)
                        ▼
agent follows up in the chat: "Done ✅ …"
```

## Try the demo

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and ask "¿Dónde está mi pedido?". It's a simulated WhatsApp chat next to a live view of what the agent knows.

- With `ANTHROPIC_API_KEY` set, the agent is Claude (`claude-opus-5-5`) using the generated tool schemas.
- Without it, a scripted agent runs the same loop, so the demo works offline. Force either with `AGENT=claude|scripted`.
- `ABANDON_AFTER_MS` (default 90000) controls when an opened-but-untouched screen wakes the agent.

## Packages

| Package | What it does |
|---|---|
| `@ui-calling/core` | `defineSurface`, `implement`, `createUiCalling` (tools, sessions, events), `formatEventsForAgent`, WhatsApp CTA adapter |
| `@ui-calling/server` | Hono routes the screen talks to (`GET /sessions/:token`, `POST /sessions/:token/events`) |
| `@ui-calling/react` | `<SurfaceProvider>`, `useSurface(contract)`: typed data, typed `emit`, automatic lifecycle tracking |
| `ui-calling` (CLI) | `init` copies design tokens; `add <block>` copies surfaces into your app, shadcn style |

## The primitives

**1. Contract** (isomorphic, shared by agent, server and UI):

```ts
export const orderStatus = defineSurface({
  name: "order_status",
  description: "Live status of a customer's order…",         // the LLM reads this
  input: z.object({ order_id: z.string() }),                  // becomes the tool schema
  data: z.object({ /* what the screen renders */ }),
  events: {
    reschedule_delivery: event(slot, {
      describe: (p) => `User rescheduled the delivery to ${p.date}, ${p.window}`,
      wake: true,                                             // start an agent turn right away
    }),
  },
});
```

**2. Implementation** (server only):

```ts
const ui = createUiCalling({
  baseUrl: "https://ui.acme.com",
  onEvent: (e) => /* append to the conversation; if e.wake, run the agent */,
  surfaces: [
    implement(orderStatus, {
      resolve: ({ order_id }, ctx) => getOrder(order_id, ctx.subject),  // access check lives here
      summarize: (o) => `Order ${o.id}: ${o.status}…`,                 // what the agent is told
      on: { reschedule_delivery: (slot, ctx) => updateEta(…) },        // side effects; return fresh data
    }),
  ],
});

ui.tools();                                     // → tool definitions for any function-calling LLM
await ui.call(toolName, input, { conversationId, subject });  // → { url, summary, expiresAt }
```

**3. Screen:**

```tsx
const { data, emit, complete } = useSurface(orderStatus);
emit("reschedule_delivery", { date, window });   // typed from the contract
```

Lifecycle events (`opened`, `returned`, `left`, `completed`, `abandoned`) are tracked automatically.

## Context, not just a callback

The point isn't only that the agent writes again: the conversation continues with everything that happened on the screen, so the user can say "what I reported earlier" and the agent knows. Each event carries three things into the agent's context:

| | Where it comes from | Example |
|---|---|---|
| What the user saw | `state` on `opened` (via `summarize`) | items, prices, delivery slot at the moment they opened it |
| What the user did | `describe(payload)` | "User reported a problem (damaged): …" |
| What resulted | `state` after the event's handler | "Open issue: damaged, ticket INC-3944" |

```
<ui_events …>
- 08:21:04 [order_status] report_problem: User reported a problem (damaged): "…" {…}
  → screen now shows: Order A-1042: issue … Open issue: damaged, ticket INC-3944.
</ui_events>
```

Write `summarize` as "everything the screen shows, in one line": it's the agent's view of the screen.

## Errors reach the agent too

When something behind the screen fails, the agent hears about it as an `error` event. It never claims an action happened, and it can pick up the conversation from there.

| Source | How it's caught | Example |
|---|---|---|
| `load` | `resolve` throws when the page opens | Orders API returns 503 |
| `action` | An event handler throws; includes what the user tried | Carrier API times out while rescheduling |
| `client` | `reportError(err, context)` from `useSurface()` | A maps or payments SDK fails in the browser |
| `render` | Built-in error boundary in `<SurfaceProvider>` | A component crashes |

```ts
throw new SurfaceError("carrier_timeout", "Carrier API timed out after 10s", { retryable: true });
```

- Throw `SurfaceError` for failures you expect. Its code and message go to the agent as written, so keep them free of secrets. Other errors go through `describeError` (default: message trimmed to 300 characters).
- The first error of each kind in a session wakes the agent. Retries are still recorded, but they don't trigger a new message (`wakeOnError: false` turns waking off).
- The screen shows the user a generic message in their language, never the upstream error.

The demo has switches in the side panel to simulate both outages.

## Language

Every surface tool gets a required `locale` (BCP 47, e.g. `es`, `pt-BR`), so the agent opens the screen in the language of the conversation. The locale is stored on the session, not the URL:

- `ui.call()` returns `ctaLabel`, picked from the contract's `cta: { en: "View order", es: "Ver pedido" }`.
- `useSurface()` returns `locale` for dates and currency (`Intl`), and the provider sets `<html lang>`.
- Blocks keep their strings in an exported dictionary (`ORDER_STATUS_MESSAGES`). Add a language by adding a key, or override single strings with the `messages` prop.
- `describe()` lines for the agent stay in English; the agent translates when it talks to the user.

## Security model

- The URL carries only a random 192-bit token; the server stores its SHA-256 hash, never the token itself.
- Data is resolved when the page opens, scoped to the session's `subject`. Nothing sensitive lives in the URL.
- Links expire (`ttlSeconds`, default 1h). Responses are `no-store` and the page sets `Referrer-Policy: no-referrer`.
- Link-preview crawlers don't run JavaScript, so they never fetch data or trigger `opened`.
- Event payloads are validated with Zod and reach the agent inside a `<ui_events>` block marked as user data, not instructions.

## Not done yet

- Step-up verification (OTP over WhatsApp) for sensitive surfaces
- Persistent store and job queue (the defaults are in-memory, with an in-process abandon timer)
- Real WhatsApp Cloud API sending (`whatsappCtaMessage` builds the payload; the demo logs it)
- An MCP server adapter, so any MCP client can call surfaces
- More blocks: shift picker, payslip viewer, document signing, availability calendar
- More languages in the blocks (en and es today)
