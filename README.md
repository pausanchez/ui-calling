# UI_calling

**Send a screen from any chat. Your agent hears what happens on it.**

Your agent is talking to a customer on WhatsApp. To process a return it needs the items, a reason for each, photos and a pickup slot, and chat is bad at all four. So it calls `show_order_return({ order_id })` like any other tool. The customer gets a link and opens a real screen. They pick the items, give a reason, and stop before the photos. Fifteen minutes later (you choose how long: `abandonAfterMs`) the agent reads:

```
08:20:11 [order_return] opened: User opened the screen
08:20:40 [order_return] items_chosen: Step 1 of 5:
         chose items to return: 1× BL-200
08:21:02 [order_return] reasons_given: Step 2 of 5:
         gave reasons: BL-200 damaged ("jar cracked")
08:36:02 [order_return] abandoned: User stopped partway
         without finishing. Last step: Step 2 of 5
```

It writes back in the chat: "Want to send the photos later? The link keeps your progress." Reopening the link starts at the photos.

![The demo: a WhatsApp-style chat on the left; on the right, the "Agent context" tab with the events from the return screen, ending in the abandon that woke the agent](docs/abandon.png)

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

The fit is a task that is hard in chat (uploads, live availability, a long list, a third-party SDK) and where stalling or failing matters to the follow-up. These four run today, in the demo or as blocks you copy:

| Use case | What the screen does | In this repo |
|---|---|---|
| Returns and exchanges | Items, a reason each, photos, refund and pickup | Demo surface (`order_return`) |
| Delivery reschedule | Live slots, "that slot is gone", carrier outages | Block: `order-status` |
| Account linking | Verify an email code, link the chat to a customer | Block: `link-account` |
| Shift picking | Open shifts that others may take first | Demo surface (`shift_picker`) |

The same pieces fit insurance claim intake (the return's steps and photo upload), identity verification (abandon at the selfie), appointment booking across locations, and B2B reorders (`quantity-stepper`, `choice-card`).

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
| `@ui-calling/server` | The routes the screen talks to (`GET /sessions/:token`, `POST /sessions/:token/events`): a Hono app, a `(Request) => Response` handler, and a Node `(req, res)` handler for Express and Fastify (`@ui-calling/server/node`) |
| `@ui-calling/react` | `<SurfaceProvider>`, `useSurface(contract)`: typed data, typed `emit`, automatic lifecycle tracking |
| `@ui-calling/anthropic` | Surfaces as Anthropic SDK tools: tool runner (`anthropicRunnableTools`) or manual loop (`anthropicTools`, `anthropicToolResult`) |
| `@ui-calling/ai-sdk` | Surfaces as Vercel AI SDK tools (`aiSdkTools`) |
| `@ui-calling/openai` | Function tools for the Responses API and Chat Completions, no SDK dependency |
| `@ui-calling/sqlite` | Zero-config persistence on Node's built-in SQLite: links and the agent's context survive restarts. Also `sqliteIdentity`: account links and one-time codes with attempt limits |
| `@ui-calling/mcp` | An MCP server whose tools are your surfaces (`createUiCallingMcpServer`) |
| `ui-calling` (CLI) | `init` sets UI_calling up in your project (detects Next.js, Vite, React Router, and Express, Fastify or Koa); `new <name>` scaffolds a surface and registers it (`--template steps` for several steps); `add` copies ready-made blocks and parts (`list` shows them); `link` and `events` open a screen for a test user on your dev server and show what the agent reads; `whatsapp dev` and `whatsapp check` connect a real WhatsApp number; `tokens` copies only the design tokens; `guide` prints the building guide and its recipes (`guide toc` lists its sections). Any command takes `--help` |

## Add it to your project

> **Not on npm yet.** Install the preview tarballs from the [v0.0.1-preview release](https://github.com/pausanchez/ui_calling/releases/tag/v0.0.1-preview); `npx ui-calling` then runs the installed CLI. Add the adapter for your agent SDK the same way (`ui-calling-anthropic-0.0.1.tgz`, `-ai-sdk-`, `-openai-` or `-mcp-`).

```bash
R=https://github.com/pausanchez/ui_calling/releases/download/v0.0.1-preview
npm install $R/ui-calling-core-0.0.1.tgz $R/ui-calling-server-0.0.1.tgz $R/ui-calling-react-0.0.1.tgz $R/ui-calling-sqlite-0.0.1.tgz $R/ui-calling-0.0.1.tgz zod
```

```bash
npx ui-calling init
```

```bash
npx ui-calling new shift-picker
```

`init` detects Next.js, Vite or React Router and writes the runtime, the screen router and the tokens. On Next.js it also writes the API route and the `/s/[token]` page. On Vite it writes a small Hono API server in `server/`, proxies `/api` to it and renders screens on `/s/:token`. On React Router it writes the API as a resource route and the `/s/:token` route. On Express, Fastify and other servers it tells you how to mount them (`uiCallingNodeHandler` for Node servers). Screens use Tailwind v4. It also leaves a `ui-calling.json` so that `new` and `add` register each surface by themselves. `new` generates three files that compile as-is, with TODOs where your product comes in. Verified end to end on Next.js 16, Vite, React Router 7 and Express 5, and in four pilot apps that coding agents built from the packages alone. [GUIDE.md](packages/cli/GUIDE.md) covers the patterns, rules and a done checklist, and is written so coding agents can follow it too (`npx ui-calling guide` prints it in any project). Agents working on this repo should read [AGENTS.md](AGENTS.md).

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

## Security, in short

- The link carries only a random token; the server keeps its hash. Data is resolved when the page opens, scoped to the user the link was sent to.
- Events reach the agent marked as user data, not instructions, and fields like codes and passwords are never shown to it.
- Links expire, close once the user finishes, and can be bound to one device.
- A link can wake the agent only a few times a minute.

The whole model, plus persistence, languages and WhatsApp identity: [GUIDE.md](packages/cli/GUIDE.md#security-model).

## Roadmap

- A hosted demo with the scripted agent, so you can try it without cloning
- Step-up verification for sensitive surfaces (WhatsApp authentication templates cannot be sent to a BSUID, so it needs another channel)
- A Postgres store for hosts without a lasting disk (serverless); `UiStore` is the interface to implement
- A send helper for the WhatsApp Cloud API (`whatsappCtaMessage` builds the payload; the demo sends it, see GUIDE.md)
- Live, model-backed tests for the adapters (they're tested in-process; the Anthropic one also runs in the demo, and the AI SDK and OpenAI ones ran in pilots)
- More blocks: payslip viewer, document signing, availability calendar (today: `order-status` and `link-account`; a shift picker and a multistep return with photo upload exist in the demo)
- A PIN step before a sensitive screen shows its data (`bindToDevice` already stops a forwarded link from working on another device)
- More languages in the blocks (en and es today)
