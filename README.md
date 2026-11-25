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

## Why UI_calling

Other tools let a bot open screens. UI_calling lets your agent know what happens on them.

The usual model is a predesigned flow: a button opens a webview, and when it closes it returns one result that moves the bot to a fixed step. UI_calling works differently:

- **The agent decides to open a screen,** the way it calls a function, in the middle of any conversation. There's no fixed flow.
- **Events cover the screen's whole life,** written for the model to read: opened, left, came back, the actions the user attempted and their outcomes, errors, completed. It's more than one result on close.
- **Users who stall get noticed.** If someone opens the screen and does nothing, or stops halfway through the steps, an `abandoned` event can wake the agent to follow up, naming where they stopped (turn it on with `abandonAfterMs`).
- **Failures are explained, not lost.** When an API is down or the slot is gone, the agent learns what the user tried and why it didn't work, and can say so in the chat.
- **The agent never answers blind.** `summarize` tells it what the user is looking at.
- **It plugs into the agent you have:** Anthropic, OpenAI, the AI SDK or MCP. There's no new platform or visual flow builder.
- **Typed end to end.** One `defineSurface` is the tool schema, the server's validation and the screen's types.
- **You own the code.** Screens are copied into your project, shadcn-style.

Automation tools count the conversations they handled. UI_calling is for the ones that would otherwise be lost: the user who stopped halfway, the payment that failed, the slot that disappeared.

## Try the demo

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and ask "¿Dónde está mi pedido?", "The blender arrived cracked, I want to return it" (a five-step return with photo upload) or "Are there any shifts open this week?". It's a simulated WhatsApp chat next to an "Under the hood" panel with two tabs:
- **Tool calls** (agent → screen): the tool definitions the model gets, then for each call the params the model passed, what `ui.runTool()` returned, the `tool_result` sent back, and the WhatsApp Cloud API request that would deliver the link.
- **Agent context** (screen → agent): the events coming back from the screen, with what it showed after each one.

- With `ANTHROPIC_API_KEY` set, the agent is Claude (`claude-opus-5-5`) using the generated tool schemas.
- Without it, a scripted agent runs the same loop, so the demo works offline. Force either with `AGENT=claude|scripted`.
- `ABANDON_AFTER_MS` (default 90000) controls when an opened-but-untouched screen wakes the agent.
- `npm install` may warn about unapproved install scripts (esbuild, fsevents); it still works.

**Reset data** puts orders, returns and shifts back to the start and keeps chats and account links. **Reset all** clears everything, real WhatsApp chats included.

### Try it on your own WhatsApp

The demo also answers a real WhatsApp number, using a Meta test number on the WhatsApp Cloud API.

1. In a Meta app with the WhatsApp product, open WhatsApp → API Setup. Add your phone as a recipient of the test number. A test number only messages numbers on that list, up to five; for other people, add theirs too (Meta texts them a code).
2. Put four keys in `.env`:

   | Key | Where it comes from |
   |---|---|
   | `WHATSAPP_TOKEN` | A system user's token, which can be set never to expire (steps below). The temporary token on API Setup works too, but it can expire within hours. |
   | `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp → API Setup, under the test number |
   | `WHATSAPP_APP_SECRET` | App settings → Basic → App secret. Signed webhooks are checked against it. |
   | `WHATSAPP_VERIFY_TOKEN` | Any string you choose. Meta sends it back when it verifies the webhook. |

   A token that doesn't expire, made once in Meta Business settings (business.facebook.com/settings):
   1. Users → System users → Add, with the Admin role.
   2. Assign assets: the app (full control), and the WhatsApp account with the test number (full control).
   3. Generate new token: your app, expiration **Never**, permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Meta shows it once.

3. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`), then run:

   ```bash
   npm run dev:whatsapp
   ```

   It opens a tunnel, starts the demo with `PUBLIC_URL` set to it, and points the Meta app's webhook there through the API. A quick tunnel gets a new address on every start, so don't set the callback URL by hand. Then it checks the setup and prints `Ready`.

4. Message the test number. Your number isn't linked to a demo customer, so the agent first sends a linking screen: use `lucia.romero@example.com` and code `246810`.

At every start, the demo checks the WhatsApp setup and prints one line. It catches the problems that are otherwise silent: an expired token (replies stop going out) and Meta delivering to an old address (messages never arrive).

Run the tests: typecheck, the generator in several layouts, and an in-process smoke test of the whole loop. No ports or API key needed:

```bash
npm test
```

## Packages

| Package | What it does |
|---|---|
| `@ui-calling/core` | `defineSurface`, `implement`, `createUiCalling` (tools, sessions, events), `formatEventsForAgent`, WhatsApp CTA adapter |
| `@ui-calling/server` | Hono routes the screen talks to (`GET /sessions/:token`, `POST /sessions/:token/events`) |
| `@ui-calling/react` | `<SurfaceProvider>`, `useSurface(contract)`: typed data, typed `emit`, automatic lifecycle tracking |
| `@ui-calling/anthropic` | Surfaces as Anthropic SDK tools: tool runner (`anthropicRunnableTools`) or manual loop (`anthropicTools`, `anthropicToolResult`) |
| `@ui-calling/ai-sdk` | Surfaces as Vercel AI SDK tools (`aiSdkTools`) |
| `@ui-calling/openai` | Function tools for the Responses API and Chat Completions, no SDK dependency |
| `@ui-calling/sqlite` | Zero-config persistence on Node's built-in SQLite: links and the agent's context survive restarts |
| `@ui-calling/mcp` | An MCP server whose tools are your surfaces (`createUiCallingMcpServer`) |
| `ui-calling` (CLI) | `init` sets UI_calling up in your project (detects Next.js or Vite); `new <name>` scaffolds a surface and registers it (`--template steps` for several steps); `add` copies ready-made blocks and parts (`list` shows them); `link` and `events` open a screen for a test user on your dev server and show what the agent reads; `tokens` copies only the design tokens; `guide` prints the building guide and its recipes |

## Add it to your project

> **Not on npm yet.** Until the first release, build the tarballs in this repo (see [Building and publishing](#building-and-publishing)) and install them in your app, `ui-calling` included. `npx ui-calling` then runs the installed CLI.

```bash
npx ui-calling init
```

```bash
npx ui-calling new shift-picker
```

`init` detects Next.js or Vite and writes the runtime, the screen router and the tokens. On Next.js it also writes the API route and the `/s/[token]` page; elsewhere it tells you how to mount them. Screens use Tailwind v4. It also leaves a `ui-calling.json` so that `new` and `add` register each surface by themselves. `new` generates three files that compile as-is, with TODOs where your product comes in. [GUIDE.md](packages/cli/GUIDE.md) covers the patterns, rules and a done checklist, and is written so coding agents can follow it too (`npx ui-calling guide` prints it in any project). Agents working on this repo should read [AGENTS.md](AGENTS.md).

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
  onEvent: (e) => handleUiEvent(e),            // append to the conversation; if e.wake, run the agent
  surfaces: [
    implement(orderStatus, {
      resolve: ({ order_id }, ctx) => getOrder(order_id, ctx.subject),  // access check lives here
      summarize: (o) => `Order ${o.id}: ${o.status}…`,                 // what the agent is told
      on: { reschedule_delivery: async (slot, ctx) => updateEta(slot, ctx.subject) }, // side effects; return fresh data
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

- Throw `SurfaceError` for failures you expect. Its code and message go to the agent as written, so keep them free of secrets. Other errors go through `describeError`. By default the agent gets a generic `unexpected` error and the real one is only logged on your server, since raw messages can carry secrets.
- The first error of each kind in a session wakes the agent. Retries are still recorded, but they don't trigger a new message (`wakeOnError: false` turns waking off).
- The screen shows the user a generic message in their language, never the upstream error.

The demo has switches in the side panel to simulate both outages.

## Language

Every surface tool gets a required `locale` (BCP 47, e.g. `es`, `pt-BR`), so the agent opens the screen in the language of the conversation. The locale is stored on the session, not the URL:

- `ui.call()` returns `ctaLabel`, picked from the contract's `cta: { en: "View order", es: "Ver pedido" }`.
- `useSurface()` returns `locale` for dates and currency (`Intl`), and the provider sets `<html lang>`.
- Blocks keep their strings in a dictionary at the top of the component file (`ORDER_STATUS_MESSAGES`). Add a language by adding a key, or override single strings with the `messages` prop.
- `describe()` lines for the agent stay in English; the agent translates when it talks to the user.

## WhatsApp identity (BSUIDs)

WhatsApp identifies users by a **business-scoped user ID** (BSUID), unique within your business portfolio. The phone number only comes along under Meta's conditions, and users with a WhatsApp username may never share it. `@ui-calling/core/whatsapp` covers the plumbing:

| Helper | What it does |
|---|---|
| `verifyWhatsAppSignature(raw, header, secret)` | Checks `X-Hub-Signature-256`, so you only trust signed webhooks |
| `parseWhatsAppWebhook(body)` | Flattens Meta's payload: `bsuid`, `parentBsuid?`, `phone?`, `username?`, and `identityChange?` for BSUID changes |
| `whatsappSubject(portfolioId, bsuid)` | The session `subject`: `wa:<portfolio>:<bsuid>` |
| `whatsappCtaMessage({ recipient \| to, … })` | The link button, addressed to a BSUID or a phone number |

Your product keeps the BSUID → customer link. The demo shows the whole flow:
- **Number shared:** match it in the CRM.
- **No number:** the agent only gets a `link_account` screen, where the user verifies with an email code (redacted from the agent's context). Then it carries on with the question.
- **The user changes number:** the link moves to the new BSUID.

See [GUIDE.md](packages/cli/GUIDE.md#whatsapp-who-is-the-subject).

## Persistence

Sessions and events are what keep links working and the agent's context intact, so keep them across restarts:

```ts
createUiCalling({ store: sqliteStore(), ... })   // from @ui-calling/sqlite: .ui-calling/ui-calling.db, node_modules/.cache/ui-calling/ in development
```

- **`sqliteStore()`** uses Node's built-in `node:sqlite` (Node 22.13+), so there's nothing to install or run. `init` sets it up.
- **Where the file goes:** `.ui-calling/ui-calling.db` in production. In development it's `node_modules/.cache/ui-calling/`: Next's dev server watches the whole project, and a database inside it reloads the page on every event, so the screen never finishes loading. Pass a path to choose your own.
- **Your own tables** (drafts, mock data) can live in the same file: `store.db` is the open `DatabaseSync`.
- **Abandon timers** for screens that were open when the process stopped are re-armed on start, with the time they had left.
- **The default `MemoryStore`** forgets everything on restart. It's what the tests use.
- **On serverless hosts without a lasting disk,** implement `UiStore` for your database. Its `listEvents` must honor `after` (an event ID: return only events appended after it) and `limit`, and throw `UnknownEventError` for an ID it doesn't have. The `contract()` checks in [scripts/test-store.ts](scripts/test-store.ts) run against any store; copy them into your tests.

The demo keeps its own state in the same file, so you can restart it mid-conversation. Old links still open, and the agent still remembers what happened.

## Security model

- The URL carries only a random 192-bit token; the server stores its SHA-256 hash, never the token itself.
- **A link is a bearer token.** Anyone holding it can open it until it expires or is completed, as with a password-reset link. `subject` decides *whose* data the screen shows, not *who* may open it. So send links only to the user, and keep sensitive screens short-lived.
- Data is resolved when the page opens, scoped to the session's `subject`. Nothing sensitive lives in the URL.
- Links expire (`ttlSeconds`, default 1h; a surface can set its own, e.g. 10 minutes for identity checks).
- API responses are `no-store` and send `Referrer-Policy: no-referrer`. The `/s/[token]` page from `init` on Next.js sets it too; on other frameworks, set it on `/s/*` yourself so the token doesn't leak to sites the screen links to.
- Once the user finishes (`complete()`), the link is closed: reads and actions are refused, so a tab left open or a forwarded link can't act again.
- Link-preview crawlers don't run JavaScript, so they never fetch data or trigger `opened`.
- Event payloads are validated with Zod and reach the agent inside a `<ui_events>` block marked as user data, not instructions. Fields listed in an event's `redact` (codes, passwords) are never stored or shown to the agent.
- On WhatsApp, sessions are tied to the BSUID from a signed webhook, and surfaces check that it's linked to the customer whose data they show.

## Building and publishing

```bash
npm run build
```

This builds every package with tsup into `dist/` (ESM, `.d.ts` and source maps). Published packages ship only `dist/`. Inside this repo, a custom export condition, `ui-calling-source`, makes TypeScript, tsx and Vite read `src/` directly, so development and tests never need a build.

To try a release before publishing, pack the packages and install the tarballs in a fresh app:

```bash
npm pack -w packages/core -w packages/server -w packages/react -w packages/sqlite -w packages/cli --pack-destination /tmp/ui-calling
```

This was verified end to end on a new Next.js 16 app (`create-next-app` defaults), installed from tarballs:
- `npx ui-calling init` and `npx ui-calling new ticket`;
- `next build` and `next start`;
- a link minted through `ui.runTool`, opened in the browser, with its event recorded in SQLite.

Before the first publish, decide:
- **License.** There's none yet.
- **The npm `@ui-calling` scope.** Create the npm organization, and check that the unscoped `ui-calling` name for the CLI is free.
- **The first version number.** Every package is `0.0.1`, and internal dependencies use `^0.0.1`.

## Not done yet

- Step-up verification for sensitive surfaces (WhatsApp authentication templates cannot be sent to a BSUID, so it needs another channel)
- A Postgres store for hosts without a lasting disk (serverless); `UiStore` is the interface to implement
- A send helper for the WhatsApp Cloud API (`whatsappCtaMessage` builds the payload; the demo sends it, see GUIDE.md)
- Live, model-backed tests for the AI SDK, OpenAI and MCP adapters (they're tested in-process; the Anthropic one also runs in the demo)
- More blocks: payslip viewer, document signing, availability calendar (a shift picker and a multistep return with photo upload exist in the demo)
- More languages in the blocks (en and es today)
