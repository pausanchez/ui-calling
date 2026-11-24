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
2. **Server.** Make `resolve` load real data **scoped to `ctx.subject`**, the user the link was issued for. Write `summarize` (required) as everything the screen shows, in one line. Add `on` handlers for events with side effects, and return fresh data.
3. **Screen.** Render `data`, call `emit(event, payload)`, call `complete()` when the user is done, and keep every string in the messages object.
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

**Where the agent gets IDs.** `input` takes IDs, so the agent must know them before calling the tool. Pick one of these sources:
- **The system prompt.** Write in the user's IDs when the conversation starts ("Their orders: A-1042"). This is simplest; the demo does it.
- **A lookup tool.** Give the agent a tool like `list_orders(customer)` when users have many records.
- **Your channel's context.** Many channels already know the user, e.g. through a CRM record linked to the phone number.

Never let the agent invent an ID. `resolve` checks it against `ctx.subject` anyway, so a wrong ID fails safely.

Tell the agent in its system prompt:
- **Links:** they are sent as buttons, so it shouldn't paste URLs.
- **`<ui_events>`:** these come from the screen, not the user.
- **`→ screen now shows`:** these lines hold outcomes such as ticket numbers or new dates.
- **`error` events:** something failed, so it must never claim the action happened.

## Rules that keep context right

- **Every action returns fresh data.** The outcome (a ticket number, a new date) reaches the agent through `summarize`, so an action that changes something must return the new data.
- **`describe` says what the user asked for, not the outcome.** Write "User asked to move the delivery to…" or "Worker picked shift S-12", never "Delivery was moved". The outcome comes from `summarize`. If the handler fails, the agent reads your line as "did NOT go through. Attempted: …", so it must read right in both cases. Set `wake: true` only when the agent should react right away.
- **Keep payloads small and don't trust them.** The payload comes from the browser. Send IDs and the user's choices; let `summarize` give the agent the readable detail (dates, places, prices) from your own data. If the payload repeats what the user saw (e.g. a time), check it against your data in the handler and throw `SurfaceError` if it changed.
- **Errors are thrown, not swallowed.** Throw `SurfaceError(code, message, { retryable })` from `resolve` or handlers; the agent gets an `error` event. Its code and message go to the agent as written, so leave out secrets and stack traces. In the browser, call `reportError(err, "what the user was doing")` from `useSurface()` when a third-party SDK fails. Render crashes are reported automatically.
- **The screen can explain failures.** A failed `emit` throws `SurfaceActionError`, and its `reason` is your `SurfaceError` code. Map known reasons to messages in the user's language ("that shift just filled up"), call `reload()` when the screen may be stale, and only offer "try again" for retryable failures.
- **`complete()` means "the user is done here".** Call it on the "back to chat" link or a final button, not after every action. It records a `completed` event, and stops the screen counting as abandoned.
- **The URL carries only the token.** Never put personal data in `input`; load it in `resolve`.
- **Strings live in the messages object.** Use `locale` from `useSurface()` for dates and currency (`toLocaleDateString(locale)`, `toLocaleString(locale, { style: "currency" })`).

## Testing without servers

Every route is a plain Hono app, so you can drive the whole loop in-process with `request()`: no ports, no browser.

```ts
const routes = uiCallingRoutes(ui);
const link = await ui.call("show_shift_picker", { worker_id: "W-207", locale: "es" }, { conversationId: "t", subject: "+34600000000" });
const token = link.url.split("/s/")[1];

const open = await routes.request(`/sessions/${token}`);                  // what the screen loads
await routes.request(`/sessions/${token}/events`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "shift_selected", payload: { shift_id: "S-12" } }),
});
console.log(formatEventsForAgent(await ui.events("t")));                  // exactly what the agent will read
```

Check three things: the outcome shows up in a `→ screen now shows` line, failures come back with the right `reason`, and another `subject` can't open the link. The demo's `apps/demo/server/smoke.ts` is a full example.

## Done checklist

- [ ] `description` says when to open the screen, and `input` is IDs only.
- [ ] `resolve` checks `ctx.subject` may see the data.
- [ ] `summarize` covers everything the screen shows, including outcomes like ticket numbers.
- [ ] Each event's `describe` states what the user asked for; handlers return fresh data; failures throw `SurfaceError`.
- [ ] The screen handles `loading`, `expired`, `error` with `errorCode === "upstream_error"`, and a failed `emit` (by `reason`).
- [ ] `complete()` is called when the user is done.
- [ ] An in-process test covers the outcome, a failure and a foreign `subject`.
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
| `describe` written as an outcome ("Booked shift…") | A failure reads "did NOT go through. Attempted: Booked shift…" | Describe the request ("Picked shift…") |
| Readable details sent from the browser and trusted | A tampered payload changes what the agent tells the user | IDs in the payload; details from `summarize` |
| Always offering "try again" | The user retries something that can't work, like a full shift | Branch on `reason`, `reload()` |
