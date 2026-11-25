# AGENTS.md

Guidance for coding agents working in this repository. To build surfaces *with* UI_calling, read [packages/cli/GUIDE.md](packages/cli/GUIDE.md) (also `npx ui-calling guide`).

## What this is

UI_calling lets an AI agent open a screen for a user the way it calls a function, and keeps the conversation's context in sync with what happens on that screen. Read [README.md](README.md) for the concepts.

**Priority:** adoption by developers and coding agents. Prefer zero-config defaults, one-command setup, typed contracts that fail at typecheck, and docs an agent can follow without guessing.

## Layout

| Path | What |
|---|---|
| `packages/core` | Contracts (`defineSurface`, `event`), runtime (`createUiCalling`, sessions, events, errors), store interface, WhatsApp helper |
| `packages/server` | Hono routes for the screen (`GET /sessions/:token`, `POST /sessions/:token/events`) |
| `packages/react` | `SurfaceProvider`, `useSurface`, error boundary, lifecycle tracking |
| `packages/anthropic`, `ai-sdk`, `openai`, `mcp` | Adapters: surfaces as tools for each SDK, all thin wrappers over `ui.runTool()`; tested in `scripts/test-adapters.ts` |
| `packages/sqlite` | `sqliteStore()`: the persistent `UiStore` on `node:sqlite`; contract and restart tests in `scripts/test-store.ts` |
| `packages/cli` | `ui-calling` CLI, `registry/` (blocks, parts and tokens), `templates/` (`ui-calling new`, `--template steps`), `GUIDE.md`, `recipes/` (`ui-calling guide <recipe>`) |
| `apps/demo` | Simulated WhatsApp chat + order-status and shift-picker surfaces + Claude or scripted agent |

## Commands

```bash
npm install
npm test                   # typecheck + generator test + in-process demo smoke test (no ports, no API key)
npm run typecheck          # the whole monorepo, including registry blocks and templates
npm run dev                # demo at http://localhost:5173 (API on 8787); reads ANTHROPIC_API_KEY from .env
npm run dev:whatsapp       # the same, reachable from a real WhatsApp number: tunnel + Meta webhook (README, "Try it on your own WhatsApp")
```

Without an API key the demo runs a scripted agent, which is enough to test the screen-to-agent loop.

`npm install` may warn that install scripts for esbuild and fsevents weren't approved. That's npm's script policy, and everything still works.

## Packages and builds

- Each package's `exports` lists `ui-calling-source` (→ `src/`) before `types`/`default` (→ `dist/`). The repo turns that condition on in `tsconfig.json` (`customConditions`), in every `tsx` call (`-C ui-calling-source`) and in the demo's Vite config. Never import from `dist/` inside the repo.
- `npm run build` runs tsup in every package. tsup settings live in each `package.json` (`"tsup"`), including `removeNodeProtocol: false`: without it, `node:sqlite` is emitted as `sqlite` and breaks for users.
- After changing the `init` templates, verify them in a real app, not only with the typecheck. TypeScript accepted a page that Next.js 16 refused to prerender. Use `create-next-app`, install the packed tarballs, run `init`, `new` (both templates) and `next build`, then open a screen in `next dev` with `npx ui-calling link`: a build can pass while the dev server never renders the page.

## Conventions

- **Blocks vs. demo surfaces:**
  - A surface goes in `packages/cli/registry` only when it's generic enough that products would use it unchanged apart from their data and tokens.
  - Everything else is demo-only: create it with `ui-calling new` inside `apps/demo`.
  - The registry is the source of truth for its blocks. After editing one, copy it into the demo with `cd apps/demo && npx ui-calling add <block> --force --server-dir server`; never edit the demo copy alone. That keeps the demo's own `server/<block>.server.ts` (mock data, outage switches): `add` never overwrites a server file.
- **Recipes** (`packages/cli/recipes/`): one task per file, each pointing to demo code that runs and a check that proves it. When you change a pattern the demo shows (a contract, a handler, a screen flow), update its recipe in the same change. A new recipe needs a row in `recipes/README.md`. `scripts/test-cli.mjs` checks that every recipe is listed and that its links point at real files.
- **Parts** (`registry/parts/`): pieces screens are built from, copied by `ui-calling add <part>` into `<surfaces dir>/parts/`. They take a `locale` and carry their own en/es strings. The `steps` template imports them from `../../registry/parts/` so the repo typechecks it; `new` copies them and rewrites the imports.
- **Templates:** `packages/cli/templates/surface` and `templates/steps` must stay valid TypeScript. Placeholders (`__name__`, `__surface__`, `__const__`, `__Component__`, `__MESSAGES__`) are real identifiers, so the typecheck covers generated code.
- **Strings:**
  - Text the user sees goes in en/es message objects.
  - Text the agent reads (`describe`, error descriptions, `summarize`) is English.
- **No real company names** anywhere in the repo. Use generic examples, like "Acme Store" or "Rapido Express".
- **Code style:** match the code around you: short comments that explain why, no new dependencies without a reason.

## How the demo identifies people

Each chat message becomes the webhook Meta would send (`server/whatsapp-sim.ts`), handled by `receiveWebhook` in `server/agent.ts` exactly like `POST /api/whatsapp/webhook`. The flow from there:
- The session subject is `wa:<portfolio>:<bsuid>`.
- `server/identity.ts` links it to a customer: by phone when Meta shares it, otherwise through the `link_account` surface.
- Until it's linked, the agent only gets the `show_link_account` tool.

## Demo state

The demo keeps UI_calling's sessions and events, and its own state, in `apps/demo/.ui-calling/demo.db`. Its own state is:
- chat;
- links;
- mock orders, returns and shifts;
- the simulated user.

Restarting the dev server keeps all of it. **Reset all** in the UI (or `POST /api/chat/reset`) clears it, real WhatsApp chats included, so ask before using it on a demo someone is testing from their phone. **Reset data** (`POST /api/demo/reset-data`) only puts the mock data back to the start. Module state that should survive exposes a `{ save, load }` object, registered in `STATE` in `server/app.ts`. The smoke test runs on `:memory:`.

## Adding a surface to the demo

1. `cd apps/demo && npx ui-calling new <name> --server-dir server`, then follow [GUIDE.md](packages/cli/GUIDE.md).
2. Put mock data in `server/<topic>.ts` with a `seed…()` function, and add an outage switch to `server/failures.ts` if the surface calls a "third party". Owners are customer IDs: check access with `requireCustomer(subject)` from `server/identity.ts`, never by comparing phone numbers.
3. In `server/ui.ts`, register the implementation in `createUiCalling({ surfaces })`.
4. In `server/app.ts`, call your `seed…()` and reset your outage switch in `seedData()`; accept the switch in `POST /api/demo/failures`.
5. In `server/agent.ts`:
   - Put the IDs the agent needs in the system prompt.
   - Teach the scripted agent: the topic regex, an `SCRIPT` entry in en/es, and the follow-up in `scriptedFollowUp`.
6. In `src/surface-page.tsx`, add the surface to `SURFACES`.
7. In `src/chat.tsx`, add a suggestion chip and, if you added one, the outage switch.
8. In `server/smoke.ts`, add checks: the outcome reaches the agent, failures carry a `reason`, and the locale is right.
9. If the surface shows a pattern no recipe covers yet, write one in `packages/cli/recipes/`.

## Verifying changes

1. `npm test`. It runs in-process, so it works while someone else has the dev server running.
2. If you need to poke a running demo, drive the loop with the API:

   ```bash
   B=localhost:5173/api
   curl -s -XPOST $B/chat/reset
   curl -s -XPOST $B/chat -H 'content-type: application/json' -d '{"text":"Where is my order?"}'
   curl -s $B/chat                                        # the agent's reply carries cta.url
   curl -s -XPOST $B/ui/sessions/<token>/events -H 'content-type: application/json' -d '{"type":"opened"}'
   curl -s $B/chat                                        # timeline shows the events and their state
   ```

3. For UI changes, open the link at a 375px width and check both locales.
4. If a real WhatsApp number gets no reply, read the `WhatsApp` line the API prints at startup first: it names an expired token or a webhook pointing at an old tunnel. A webhook with a bad signature logs `webhook rejected`.

`POST /api/demo/failures` with `{"ordersApi":true}`, `{"carrierApi":true}` or `{"schedulingApi":true}` simulates outages.
