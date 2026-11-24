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

```bash
npx ui-calling init
```

Run it in your project's root. It detects Next.js or Vite and writes:
- `ui-calling/ui.ts`: your runtime, with `createUiCalling`, the surfaces list and `onEvent`.
- `ui-calling/surface-screen.tsx`: renders whichever surface a link's token points to.
- `ui-calling/tokens.css`: design tokens, with shadcn variable names.
- **Next.js only:** the API route (`app/api/ui/[...path]/route.ts`) and the landing page (`app/s/[token]/page.tsx`).
- `ui-calling.json`: where things live. With it, `ui-calling new` registers each new surface in `ui.ts` and `surface-screen.tsx` by itself.
- **A note in `AGENTS.md` / `CLAUDE.md`,** if you have them, so coding agents find this guide.

Without Next.js, mount the API yourself, then route `/s/:token` to `<SurfaceScreen token={token} />`:
- **`uiCallingHandler(ui)`** is a plain `(Request) => Response`, for Bun, Deno, Workers, Remix and the like.
- **`uiCallingRoutes(ui)`** is a Hono app.

Options: `--deliver message` (the model writes the link; for web chat and MCP), `--dir`, `--framework`, `--base-url`.

What the generated files amount to, if you'd rather write it by hand:

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

## Wiring the agent

Use the adapter for the SDK you already have. Each one turns your surfaces into that SDK's tools, and when a tool runs you get `link` (`url` and `label`, already in the user's language) to deliver.

**Anthropic SDK** (`@ui-calling/anthropic`), with the tool runner:

```ts
const links: SurfaceLink[] = [];
const final = await client.beta.messages.toolRunner({
  model: "claude-opus-5-5", max_tokens: 16000, messages,
  tools: anthropicRunnableTools(ui, { conversationId, subject }, { onLink: (l) => links.push(l) }),
});
// send final's text, with each link as a button
```

For a manual loop, use `anthropicTools(ui)` for `tools` and `anthropicToolResult(ui, toolUseBlock, who)` for each `tool_use`.

**Vercel AI SDK** (`@ui-calling/ai-sdk`):

```ts
const result = await generateText({
  model, messages, stopWhen: stepCountIs(5),
  tools: aiSdkTools(ui, { conversationId, subject }, { onLink: (l) => links.push(l) }),
});
```

**OpenAI** (`@ui-calling/openai`, no SDK dependency):
- Responses API: `openaiResponsesTools(ui)` and `runResponsesFunctionCall(ui, item, who)`.
- Chat Completions: `openaiChatTools(ui)` and `runChatToolCall(ui, toolCall, who)`.

**Any MCP client** (`@ui-calling/mcp`): `createUiCallingMcpServer(ui, { who: (extra) => … })`, connected to any transport. MCP knows nothing of your end user, so `who` derives the user from the request (e.g. `extra.authInfo`).

**Anything else:** `ui.tools()` gives JSON Schema tools, and `ui.runTool(name, input, who)` returns `{ ok, content, link }`. `content` is what goes back to the model, and errors come back as results, not exceptions.

**How links reach the user.** `createUiCalling({ deliverLinks })` decides what the model is told:
- **`"button"` (default):** your channel sends the link as a button (a WhatsApp CTA), and the model never sees the URL.
- **`"message"`:** the model gets the URL and puts it in its reply. Use it for web chat and MCP clients.

**The return path is the same everywhere.** When events arrive (`onEvent`), give them to the model as data, not instructions:

```ts
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
- **Secrets never reach the agent.** Add `redact: ["code"]` to an event that carries a one-time code, password or similar. The handler still gets the value, but the event log, `describe` and the agent see `"[redacted]"`.
- **Keep payloads small and don't trust them.** The payload comes from the browser. Send IDs and the user's choices; let `summarize` give the agent the readable detail (dates, places, prices) from your own data. If the payload repeats what the user saw (e.g. a time), check it against your data in the handler and throw `SurfaceError` if it changed.
- **Errors are thrown, not swallowed.** Throw `SurfaceError(code, message, { retryable })` from `resolve` or handlers; the agent gets an `error` event. Its code and message go to the agent as written, so leave out secrets and stack traces. In the browser, call `reportError(err, "what the user was doing")` from `useSurface()` when a third-party SDK fails. Render crashes are reported automatically.
- **The screen can explain failures.** A failed `emit` throws `SurfaceActionError`, and its `reason` is your `SurfaceError` code. Map known reasons to messages in the user's language ("that shift just filled up"), call `reload()` when the screen may be stale, and only offer "try again" for retryable failures.
- **`complete()` means "the user is done here".** Call it on the "back to chat" link or a final button, not after every action. It records a `completed` event, and stops the screen counting as abandoned.
- **The URL carries only the token.** Never put personal data in `input`; load it in `resolve`.
- **Strings live in the messages object.** Use `locale` from `useSurface()` for dates and currency (`toLocaleDateString(locale)`, `toLocaleString(locale, { style: "currency" })`).

## WhatsApp: who is the `subject`?

On WhatsApp, Meta identifies each user with a **BSUID** (business-scoped user ID), unique within your business portfolio. The phone number is only included when you exchanged messages or calls with it in the last 30 days, or it's in your contact book. Users with a WhatsApp username may never share it. So:

1. **Trust only signed webhooks.** `verifyWhatsAppSignature(rawBody, header, appSecret)` checks `X-Hub-Signature-256`.
2. **Use the BSUID, with your portfolio, as the subject.** `parseWhatsAppWebhook(body)` flattens Meta's payload (`bsuid`, `phone?`, `username?`, `identityChange?`), and `whatsappSubject(portfolioId, bsuid)` builds `wa:<portfolio>:<bsuid>`. The portfolio is part of the key because a BSUID is only unique within one.
3. **Keep a BSUID → customer link in your database.**
   - **If the webhook has the phone:** match it against your CRM and save the link. Meta sends digits only, so normalize both sides.
   - **If not:** don't show anything personal. Offer only a linking surface (the demo's `link_account`): the user verifies by logging in or with an emailed code, and the handler saves the link. WhatsApp authentication templates (one-tap, zero-tap, copy code) can't be sent to a BSUID, so verify outside WhatsApp.
4. **In every `resolve`, map the subject to a customer** and throw `SurfaceError("account_not_linked", …)` when there's no link.
5. **Handle ID changes.** A BSUID is regenerated when the user changes phone number, and it arrives as a system message (`identityChange`: `user_changed_number` or `user_changed_user_id`, with `previousBsuid`). Copy the link to the new subject. Keep the old one too, so links already sent keep working until they expire.
6. **Send to the BSUID.** `whatsappCtaMessage({ recipient: bsuid, … })`. Use `to: phone` instead when you have it; if both are set, Meta uses `to`.

The demo implements all of this (`apps/demo/server/identity.ts`, `agent.ts` → `receiveWebhook`), and its panel lets you hide the number or change it.

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
