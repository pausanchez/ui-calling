# UI_calling

**Send a screen from any chat. Your agent hears what happens on it.**

Your agent is talking to a customer on WhatsApp. To process a return it needs the items, a reason for each, photos and a pickup slot, and chat is bad at all four. So it calls `show_order_return({ order_id })` like any other tool. The customer gets a link and opens a real screen. They pick the items, give a reason, and stop before the photos. Ninety seconds later the agent reads:

```
- 26 Nov 08:20:11 UTC [order_return] opened: User opened the screen
- 26 Nov 08:20:40 UTC [order_return] items_chosen: Step 1 of 5: chose items to return: 1× BL-200 {…}
- 26 Nov 08:21:02 UTC [order_return] reasons_given: Step 2 of 5: gave reasons: BL-200 damaged ("jar cracked") {…}
- 26 Nov 08:22:32 UTC [order_return] abandoned: User stopped partway without finishing. Last step: Step 2 of 5: gave reasons: BL-200 damaged ("jar cracked")
```

It writes back in the chat: "No rush. Want to send the photos later? The link keeps your progress." Reopening the link starts at the photos.

That's UI_calling. The screen a tool opens is a *surface*: a link that works in any channel (WhatsApp, SMS, email, a web chat), and its whole life comes back into the agent's context (opened, left, came back, each action and its outcome, errors, completed, abandoned). It works with Anthropic, OpenAI, the AI SDK and MCP. Screens are React, copied into your repo, and it's self-hosted.

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

- **The agent decides to open a screen,** the way it calls a function, in the middle of any conversation. There's no predesigned flow.
- **Events cover the screen's whole life,** written for the model to read, not one result on close.
- **Users who stall get noticed.** An `abandoned` event wakes the agent and names where they stopped (`abandonAfterMs`).
- **Failures are explained, not lost.** When an API is down or the slot is gone, the agent learns what the user tried and why it failed, and can say so in the chat.
- **The agent never answers blind.** `summarize` tells it what the user is looking at.
- **Typed end to end.** One `defineSurface` is the tool schema, the server's validation and the screen's types.
- **No new platform.** It plugs into the agent you have, and the screens are yours, copied into your project shadcn-style.

Automation tools count the conversations they handled. UI_calling is for the ones that would otherwise be lost: the user who stopped halfway, the payment that failed, the slot that disappeared.

## How it compares

| Use | When |
|---|---|
| MCP Apps, or the AI SDK's tool parts | The user is already in a client that renders UI inline: Claude, ChatGPT, your own web chat |
| WhatsApp Flows | A short form whose fields you know in advance; it never leaves WhatsApp |
| LangGraph interrupts, or a durable workflow engine | You need to pause and resume an agent, with no screen of your own |
| **UI_calling** | The user is in a channel that can only carry a link, the screen is your own, and what happens on it (a stall, a failure, partial progress) should change what the agent says next |

They combine: a UI_calling event can resume a paused workflow, and a surface is just a page, so it can also open from a web chat.

## When not to use it

- **A short, fixed form** (a lead, a three-question survey): a native form or reply buttons keep the user in the chat. A link asks them to trust a page.
- **Read-only status:** a text reply is enough. A screen earns its place when the user can act on it.
- **Open-ended support:** the conversation is the interface, and there's no outcome for a screen to report.
- **A quick yes or no:** reply buttons beat opening a page.

## What people build with it

The fit is a task that is hard in chat (uploads, live availability, a long list, a third-party SDK) and where stalling or failing matters to the follow-up.

| Use case | What the screen does | In this repo |
|---|---|---|
| Returns and exchanges | Items, a reason each, photos, refund and pickup | Demo surface (`order_return`) |
| Delivery reschedule | Live slots, "that slot is gone", carrier outages | Block: `order-status` |
| Account linking | Verify an email code, link the chat to a customer | Block: `link-account` |
| Shift picking | Open shifts that others may take first | Demo surface (`shift_picker`) |
| Insurance claim intake | Photos, documents, date and place, partial progress | Not yet: the return's step and photo parts fit |
| Identity verification | ID capture and a vendor SDK, abandon at the selfie | Not yet |
| Appointment booking and intake | A calendar across locations, a long intake form | Not yet |
| B2B reorder | A catalog with the customer's prices and quantities | Not yet: parts exist (`quantity-stepper`, `choice-card`) |

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

The demo also answers a real WhatsApp number, using a Meta test number on the WhatsApp Cloud API. Put the four keys from [the GUIDE](packages/cli/GUIDE.md#developing-against-a-real-whatsapp-number) in `.env`, install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`), then run:

```bash
npm run dev:whatsapp
```

It opens a tunnel, starts the demo with `PUBLIC_URL` set to it, points the Meta app's webhook there and prints `Ready`. Message the test number. Your number isn't linked to a demo customer, so the agent first sends a linking screen: use `lucia.romero@example.com` and code `246810`. At every start the demo prints one `WhatsApp` line that names an expired token or a webhook pointing at an old address.

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
| `@ui-calling/sqlite` | Zero-config persistence on Node's built-in SQLite: links and the agent's context survive restarts. Also `sqliteIdentity`: account links and one-time codes with attempt limits |
| `@ui-calling/mcp` | An MCP server whose tools are your surfaces (`createUiCallingMcpServer`) |
| `ui-calling` (CLI) | `init` sets UI_calling up in your project (detects Next.js, Vite or React Router); `new <name>` scaffolds a surface and registers it (`--template steps` for several steps); `add` copies ready-made blocks and parts (`list` shows them); `link` and `events` open a screen for a test user on your dev server and show what the agent reads; `whatsapp dev` and `whatsapp check` connect a real WhatsApp number; `tokens` copies only the design tokens; `guide` prints the building guide and its recipes (`guide toc` lists its sections). Any command takes `--help` |

## Add it to your project

> **Not on npm yet.** Until the first release, build the tarballs in this repo (see [Building and publishing](#building-and-publishing)) and install them in your app, `ui-calling` included. `npx ui-calling` then runs the installed CLI.

```bash
npx ui-calling init
```

```bash
npx ui-calling new shift-picker
```

`init` detects Next.js, Vite or React Router and writes the runtime, the screen router and the tokens. On Next.js it also writes the API route and the `/s/[token]` page. On Vite it writes a small Hono API server in `server/`, proxies `/api` to it and renders screens on `/s/:token`. On React Router it writes the API as a resource route and the `/s/:token` route; elsewhere it tells you how to mount them. Screens use Tailwind v4. It also leaves a `ui-calling.json` so that `new` and `add` register each surface by themselves. `new` generates three files that compile as-is, with TODOs where your product comes in. [GUIDE.md](packages/cli/GUIDE.md) covers the patterns, rules and a done checklist, and is written so coding agents can follow it too (`npx ui-calling guide` prints it in any project). Agents working on this repo should read [AGENTS.md](AGENTS.md).

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
await ui.runTool(toolName, input, { conversationId, subject });  // → { content for the model, link for the user }
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

- The link's `label` (from `runTool` or `onLink`) is picked from the contract's `cta: { en: "View order", es: "Ver pedido" }`.
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
- **Where the file goes:** `.ui-calling/ui-calling.db` in production. In development it's `node_modules/.cache/ui-calling/`: Next's dev server watches the whole project, and a database inside it reloads the page on every event, so the screen never finishes loading. Pass a path to choose your own; on Vite, `init` passes `.ui-calling/dev.db`, which survives a clean install.
- **Tests** set `UI_CALLING_DB` (a temp file, or `:memory:`) before importing your runtime, so they never touch the dev database.
- **Your own tables** (drafts, mock data) can live in the same file: `store.db` is the open `DatabaseSync`. `init` puts the store in its own `store.ts`, so your server code can import it without importing `ui.ts`.
- **Abandon timers** for screens that were open when the process stopped are re-armed on start, with the time they had left.
- **The default `MemoryStore`** forgets everything on restart. It's what the tests use.
- **On serverless hosts without a lasting disk,** implement `UiStore` for your database. Its `listEvents` must honor `after` (an event ID: return only events appended after it) and `limit`, and throw `UnknownEventError` for an ID it doesn't have. The `contract()` checks in [scripts/test-store.ts](scripts/test-store.ts) run against any store; copy them into your tests.

The demo keeps its own state in the same file, so you can restart it mid-conversation. Old links still open, and the agent still remembers what happened.

## Security model

- The URL carries only a random 192-bit token; the server stores its SHA-256 hash, never the token itself.
- **A link is a bearer token.** Anyone holding it can open it until it expires or is completed, as with a password-reset link. `subject` decides *whose* data the screen shows, not *who* may open it. So send links only to the user, and keep sensitive screens short-lived.
- **Keep tokens out of logs.** The token is in the page's path (`/s/<token>`) and the API's, so access logs, APM and analytics that record full URLs store live tokens. Strip or hash the path there, or keep links short-lived.
- **One subject per person.** Files and drafts follow the subject: a newer link can show the same user's earlier uploads (never delete them). Never use a shared subject (a household account, "anonymous") for screens with personal data.
- **Only offered tools run.** Pass the `filter` you gave the tool list to the manual-loop helpers (`anthropicToolResult`, `runResponsesFunctionCall`, `runChatToolCall`) or to `ui.runTool(name, input, who, filter)`; a tool the model wasn't offered is refused even if it calls it by name.
- **A link can wake the agent a few times a minute at most** (`maxWakesPerMinute`, default 6); after that its events are recorded quietly.
- **Dev routes answer on localhost only,** and never when `NODE_ENV` is `"production"`.
- Data is resolved when the page opens, scoped to the session's `subject`. Nothing sensitive lives in the URL.
- Links expire (`ttlSeconds`, default 1h; a surface can set its own, e.g. 10 minutes for identity checks).
- API responses are `no-store` and send `Referrer-Policy: no-referrer`. `SurfaceScreen` from `init` adds `<meta name="referrer" content="no-referrer">` to the page, and the Next.js page also sets it in its HTML, so the token doesn't leak to sites the screen links to. With a screen of your own, set it on `/s/*` yourself.
- Once the user finishes (`complete()`), the link is closed: reads and actions are refused, so a tab left open or a forwarded link can't act again.
- Link-preview crawlers don't run JavaScript, so they never fetch data or trigger `opened`.
- Event payloads are validated with Zod and reach the agent inside a `<ui_events>` block marked as user data, not instructions. Fields listed in an event's `redact` (codes, passwords) are never stored or shown to the agent.
- On WhatsApp, sessions are tied to the BSUID from a signed webhook, and surfaces check that it's linked to the customer whose data they show.
- **Make the link look like you.** People decide whether to tap a link in a chat by who it seems to come from. Serve screens from your own domain, set your brand in the tokens, and have the agent say what the screen is for before sending it.

## Building and publishing

```bash
npm run build
```

This builds every package with tsup into `dist/` (ESM, `.d.ts` and source maps). Published packages ship only `dist/` and a short README. Inside this repo, a custom export condition, `ui-calling-source`, makes TypeScript, tsx and Vite read `src/` directly, so development and tests never need a build.

To try a release before publishing, create the app first, then pack the packages and install the tarballs into it (installing them before `create-next-app` makes it refuse a non-empty folder):

```bash
npm pack -w packages/core -w packages/server -w packages/react -w packages/sqlite -w packages/cli -w packages/anthropic -w packages/ai-sdk -w packages/openai -w packages/mcp --pack-destination /tmp/ui-calling
```

```bash
cd my-app && npm install /tmp/ui-calling/*.tgz
```

This was verified end to end, installed from tarballs:
- **Next.js 16** (`create-next-app` defaults): `init`, `new` with both templates, `next build` and `next start`, and a link minted through `ui.runTool`, opened in the browser, with its event recorded in SQLite.
- **Vite** (`npm create vite@latest -- --template react-ts`, plus Tailwind): `init`, `new` with both templates, `add link-account`, `tsc -b` and `vite build`, then screens opened at 375px with `npm run dev` and `npm run dev:api` running.
- **Three pilot apps** built from the packages alone, against the real model: Next.js with the Anthropic tool runner, Vite and Hono with the AI SDK, and React Router 7 with the Anthropic manual loop.

Before the first publish, decide:
- **The npm `@ui-calling` scope.** Create the npm organization, and check that the unscoped `ui-calling` name for the CLI is free.
- **The first version number.** Every package is `0.0.1`, and internal dependencies use `^0.0.1`.

## Not done yet

- A short recording of the abandon wake for this README, the demo's chat next to its "Agent context" tab
- Step-up verification for sensitive surfaces (WhatsApp authentication templates cannot be sent to a BSUID, so it needs another channel)
- A Postgres store for hosts without a lasting disk (serverless); `UiStore` is the interface to implement
- A send helper for the WhatsApp Cloud API (`whatsappCtaMessage` builds the payload; the demo sends it, see GUIDE.md)
- Live, model-backed tests for the adapters (they're tested in-process; the Anthropic one also runs in the demo, and the AI SDK one ran in a pilot)
- More blocks: payslip viewer, document signing, availability calendar (today: `order-status` and `link-account`; a shift picker and a multistep return with photo upload exist in the demo)
- A PIN step before a sensitive screen shows its data (`bindToDevice` already stops a forwarded link from working on another device)
- More languages in the blocks (en and es today)
