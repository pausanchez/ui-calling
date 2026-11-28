# Getting started

ui-calling is a preview: not on npm yet, and the API may still change. What it is and why: the [overview](../README.md).

## Three words

- A **screen** is what the user opens from the link.
- A **surface** is how you define one in code: a contract, a server part and the screen. The agent gets each surface as a tool (`show_<name>`).
- A **block** is a ready-made surface you copy into your project with `npx ui-calling add` (`order-status`, `link-account`).

## Install and set up

> **Not on npm yet.** Install the preview tarballs from the [v0.0.1-preview release](https://github.com/pausanchez/ui-calling/releases/tag/v0.0.1-preview); `npx ui-calling` then runs the installed CLI. Add the adapter for your agent SDK the same way (`ui-calling-anthropic-0.0.1.tgz`, `-ai-sdk-`, `-openai-` or `-mcp-`), and `ui-calling-postgres-0.0.1.tgz` if you run several instances or on serverless.

```bash
R=https://github.com/pausanchez/ui-calling/releases/download/v0.0.1-preview
npm install $R/ui-calling-core-0.0.1.tgz $R/ui-calling-server-0.0.1.tgz $R/ui-calling-react-0.0.1.tgz $R/ui-calling-sqlite-0.0.1.tgz $R/ui-calling-0.0.1.tgz zod
```

```bash
npx ui-calling init
```

```bash
npx ui-calling new shift-picker
```

`init` detects your framework and writes the runtime (`ui.ts`), the store (`store.ts`), the screen router (`surface-screen.tsx`) and the design tokens. Then, per framework:

| Framework | API (what the screen talks to) | Screen route |
|---|---|---|
| Next.js | `app/api/ui/[...path]/route.ts` | `app/s/[token]/page.tsx` |
| Vite | A small Hono server in `server/index.ts` (port 8787, `npm run dev:api`), with `/api` proxied to it | `/s/:token`, rendered from `src/main.tsx` |
| React Router 7 | `app/routes/api.ui.ts`, a resource route | `app/routes/s.$token.tsx` |
| Express, Fastify, Koa | You mount `uiCallingNodeHandler` before your body parser; `init` prints the lines | You route `/s/:token` to `<SurfaceScreen>` |

- Screens use Tailwind v4.
- `ui-calling.json` records where things live, so `new` and `add` register each surface by themselves.
- `new` generates three files (contract, server, screen) that compile as-is, with TODOs where your product comes in.
- **When a stalled screen wakes the agent:** `abandonAfterMs`, on `createUiCalling` or on one contract. It's off until you set it; the demo uses 90 seconds.

Verified end to end on Next.js 16, Vite, React Router 7 and Express 5, and in four pilot apps that coding agents built from the packages alone. [GUIDE.md](../packages/cli/GUIDE.md) covers the patterns, rules and a done checklist, and is written so coding agents can follow it too (`npx ui-calling guide` prints it in any project). Agents working on this repo should read [AGENTS.md](../AGENTS.md).

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
| `@ui-calling/postgres` | The same persistence in Postgres, for several instances and serverless hosts: pass a `pg` Pool (or any client with `query`). Tables are created on first use |
| `@ui-calling/mcp` | An MCP server whose tools are your surfaces (`createUiCallingMcpServer`) |
| `ui-calling` (CLI) | `init` sets ui-calling up in your project (detects Next.js, Vite, React Router, and Express, Fastify or Koa); `new <name>` scaffolds a surface and registers it (`--template steps` for several steps); `add` copies ready-made blocks and parts (`list` shows them); `link` and `events` open a screen for a test user on your dev server and show what the agent reads; `whatsapp dev` and `whatsapp check` connect a real WhatsApp number; `tokens` copies only the design tokens; `guide` prints the building guide and its recipes (`guide toc` lists its sections). Any command takes `--help` |

## Running the demo

From a clone of the repo, `npm install` and `npm run dev`, then open http://localhost:5173.

- With `ANTHROPIC_API_KEY` set, the agent is Claude (`claude-opus-5-5`) using the generated tool schemas.
- Without it, a scripted agent runs the same loop, so the demo works offline. Force either with `AGENT=claude|scripted`.
- `ABANDON_AFTER_MS` (default 90000) controls when an opened-but-untouched screen wakes the agent.
- `npm install` may warn about unapproved install scripts (esbuild, fsevents); it still works.

**Reset data** puts orders, returns and shifts back to the start and keeps chats and account links. **Reset all** clears everything, real WhatsApp chats included.

### On your own WhatsApp

The demo also answers a real WhatsApp number, using a Meta test number on the WhatsApp Cloud API. Put the four keys from [the GUIDE](../packages/cli/GUIDE.md#developing-against-a-real-whatsapp-number) in `.env`, install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) (`brew install cloudflared`), then run:

```bash
npm run dev:whatsapp
```

It opens a tunnel, starts the demo with `PUBLIC_URL` set to it, points the Meta app's webhook there and prints `Ready`. Message the test number. Your number isn't linked to a demo customer, so the agent first sends a linking screen: use `lucia.romero@example.com` and code `246810`. The shift picker then asks for a PIN: `1357`. At every start the demo prints one `WhatsApp` line that names an expired token or a webhook pointing at an old address.

## Roadmap

- A hosted demo with the scripted agent, so you can try it without cloning
- A send helper for the WhatsApp Cloud API (`whatsappCtaMessage` builds the payload; the demo sends it, see GUIDE.md)
- Live, model-backed tests for the adapters (they're tested in-process; the Anthropic one also runs in the demo, and the AI SDK and OpenAI ones ran in pilots)
- More blocks: payslip viewer, document signing, availability calendar (today: `order-status` and `link-account`; a shift picker and a multistep return with photo upload exist in the demo)
- More languages in the blocks (en and es today)
