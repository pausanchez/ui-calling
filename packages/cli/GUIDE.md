# Building surfaces with UI_calling

A **surface** is a screen an AI agent can open for a user, the way it calls a function. The agent gets a secure link to send (e.g. as a WhatsApp button). The user opens a real UI, and everything that happens there flows back into the agent's context: what the user saw, what they did, what resulted, and what failed. When the user keeps chatting, the agent can talk about it.

This guide is for people and coding agents adding surfaces to a product. Print it any time with `npx ui-calling guide`.

## Mental model: three files per surface

| File | Runs on | What it holds |
|---|---|---|
| `<name>.surface.ts` | everywhere | **Contract**: name, description for the LLM, `input` (tool schema), `data` (what the screen renders), `events` (what it reports), `cta` labels |
| `<name>.server.ts` | server | **Implementation**: `resolve` (load data), `summarize` (one-line view for the agent), `on` (side effects for events) |
| `<name>.tsx` | browser | **Screen**: React component using `useSurface(contract)`, with en/es strings |

The contract is the single source of truth. Change it and the typechecker shows every place that has to follow.

## Create one

```bash
npx ui-calling new shift-picker
```

This writes `shift-picker.surface.ts`, `shift-picker.tsx` and `shift-picker.server.ts` into `src/components/ui-calling` (`--dir`). Put the server file elsewhere with `--server-dir server`. The generated code compiles as-is. Then:

1. **Contract.** Write `description` as "what the user sees and can do, and when to open it": the agent reads it to choose. Keep `input` to IDs. Model `data` on what the screen renders. Name `events` after facts ("shift_selected", not "button_clicked").
2. **Server.** Make `resolve` load real data **scoped to `ctx.subject`**, the user the link was issued for. Write `summarize` as everything the screen shows, in one line. Add `on` handlers for events with side effects, and return fresh data.
3. **Screen.** Render `data`, call `emit(event, payload)`, and keep every string in the messages object.
4. **Register** the implementation in `createUiCalling({ surfaces: [...] })` and render the component on your surface route.
5. **Typecheck.**

## One-time setup in a product

```ts
// server
import { createUiCalling, formatEventsForAgent } from "@ui-calling/core";
import { uiCallingRoutes } from "@ui-calling/server";

export const ui = createUiCalling({
  baseUrl: "https://app.example.com",        // links look like https://app.example.com/s/<token>
  surfaces: [shiftPickerImpl],
  abandonAfterMs: 10 * 60_000,
  onEvent: (e) => {
    // Return path: add e to the conversation's context; if e.wake, run an agent turn now.
  },
});
app.route("/api/ui", uiCallingRoutes(ui));    // Hono; works on Node, Bun, Workers
```

```tsx
// browser, on the /s/:token route
<SurfaceProvider token={token} returnUrl="https://wa.me/<business-number>">
  <ShiftPicker />
</SurfaceProvider>
```

```bash
npx ui-calling init    # design tokens (shadcn variable names); import after Tailwind
```

## Wiring the agent

```ts
const tools = ui.tools();                     // one tool per surface; every tool takes `locale`

// when the model calls a tool:
if (ui.isUiTool(call.name)) {
  const r = await ui.call(call.name, call.input, { conversationId, subject: userPhone });
  // r.url → send as a button labelled r.ctaLabel (already in the user's language)
  // r.summary → put in the tool result so the agent knows what the user will see
}

// when events arrive (onEvent), give them to the model as data, not instructions:
messages.push({ role: "user", content: formatEventsForAgent(events) });
```

Tell the agent in its system prompt:
- **Links:** they are sent as buttons, so it shouldn't paste URLs.
- **`<ui_events>`:** these come from the screen, not the user.
- **`→ screen now shows`:** these lines hold outcomes such as ticket numbers or new dates.
- **`error` events:** something failed, so it must never claim the action happened.

## Rules that keep context right

- **Every action returns fresh data.** The outcome (a ticket number, a new date) reaches the agent through `summarize`, so an action that changes something must return the new data.
- **Errors are thrown, not swallowed.** Throw `SurfaceError(code, message, { retryable })` from `resolve` or handlers; the agent gets an `error` event. Its code and message go to the agent as written, so leave out secrets and stack traces. In the browser, call `reportError(err, "what the user was doing")` from `useSurface()` when a third-party SDK fails. Render crashes are reported automatically.
- **Events are facts.** `describe` returns one English line the agent can reason about. Set `wake: true` only when the agent should react right away.
- **The URL carries only the token.** Never put personal data in `input`; load it in `resolve`.
- **Strings live in the messages object.** Use `locale` from `useSurface()` for dates and currency (`toLocaleDateString(locale)`, `toLocaleString(locale, { style: "currency" })`).

## Done checklist

- [ ] `description` says when to open the screen, and `input` is IDs only.
- [ ] `resolve` checks `ctx.subject` may see the data.
- [ ] `summarize` covers everything the screen shows, including outcomes like ticket numbers.
- [ ] Each event has a fact-like `describe`; handlers return fresh data; failures throw `SurfaceError`.
- [ ] The screen handles `loading`, `expired`, `error` with `errorCode === "upstream_error"`, and a failed `emit`.
- [ ] Every user-facing string is in the messages object, in en and es.
- [ ] The implementation is registered, the component is routed, and the typecheck passes.

## Common mistakes

| Mistake | Effect | Fix |
|---|---|---|
| Data in `input` | Personal data leaks into the URL and the LLM transcript | IDs in `input`, data in `resolve` |
| Handler returns nothing after a change | The agent can't tell the user the outcome | Return the updated data |
| `catch {}` around a failing API in `resolve` | The agent thinks everything worked | Throw `SurfaceError` |
| Click-level events ("button_clicked") | The context fills with noise | One event per meaningful fact |
| Hard-coded strings in JSX | The screen ignores the conversation's language | Use the messages object |
