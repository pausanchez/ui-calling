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
| `packages/cli` | `ui-calling` CLI, `registry/` (ready-made blocks + tokens), `templates/` (`ui-calling new`), `GUIDE.md` |
| `apps/demo` | Simulated WhatsApp chat + order-status and shift-picker surfaces + Claude or scripted agent |

## Commands

```bash
npm install
npm test                   # typecheck + generator test + in-process demo smoke test (no ports, no API key)
npm run typecheck          # the whole monorepo, including registry blocks and templates
npm run dev                # demo at http://localhost:5173 (API on 8787); reads ANTHROPIC_API_KEY from .env
```

Without an API key the demo runs a scripted agent, which is enough to test the screen-to-agent loop.

`npm install` may warn that install scripts for esbuild and fsevents weren't approved. That's npm's script policy, and everything still works.

## Conventions

- **Blocks vs. demo surfaces:**
  - A surface goes in `packages/cli/registry` only when it's generic enough that products would use it unchanged apart from their data and tokens.
  - Everything else is demo-only: create it with `ui-calling new` inside `apps/demo`.
  - The registry is the source of truth for its blocks. After editing one, copy it into the demo with `cd apps/demo && npx ui-calling add <block> --force`; never edit the demo copy alone.
- **Templates:** `packages/cli/templates/surface` must stay valid TypeScript. Placeholders (`__name__`, `__surface__`, `__const__`, `__Component__`, `__MESSAGES__`) are real identifiers, so the typecheck covers generated code.
- **Strings:**
  - Text the user sees goes in en/es message objects.
  - Text the agent reads (`describe`, error descriptions, `summarize`) is English.
- **No real company names** anywhere in the repo. Use generic examples, like "Acme Store" or "Rapido Express".
- **Code style:** match the code around you: short comments that explain why, no new dependencies without a reason.

## Adding a surface to the demo

1. `cd apps/demo && npx ui-calling new <name> --server-dir server`, then follow [GUIDE.md](packages/cli/GUIDE.md).
2. Put mock data in `server/<topic>.ts` with a `seed…()` function, and add an outage switch to `server/failures.ts` if the surface calls a "third party".
3. In `server/ui.ts`, register the implementation in `createUiCalling({ surfaces })`.
4. In `server/app.ts`, call your `seed…()` on reset and reset your outage switch there; accept the switch in `POST /api/demo/failures`.
5. In `server/agent.ts`:
   - Put the IDs the agent needs in the system prompt.
   - Teach the scripted agent: the topic regex, an `SCRIPT` entry in en/es, and the follow-up in `scriptedFollowUp`.
6. In `src/surface-page.tsx`, add the surface to `SURFACES`.
7. In `src/chat.tsx`, add a suggestion chip and, if you added one, the outage switch.
8. In `server/smoke.ts`, add checks: the outcome reaches the agent, failures carry a `reason`, and the locale is right.

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

`POST /api/demo/failures` with `{"ordersApi":true}`, `{"carrierApi":true}` or `{"schedulingApi":true}` simulates outages.
