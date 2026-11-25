# Link a WhatsApp user to a customer account

Use it when the chat must know **who** the user is before showing personal data, and the channel doesn't tell you. WhatsApp identifies users by a business-scoped user ID (BSUID), and only shares the phone number under Meta's conditions; users with a username may never share it.

Start from the block. It ships the screen and the security-critical half: links, one-time codes stored hashed, attempt limits per customer, and a code that survives a reload while the user reads their email.

```bash
npx ui-calling add link-account
```

Then fill the three TODOs in `link-account.server.ts`: `findCustomer` (look the user up by what they typed), `sendCode` (email or SMS, never the chat) and `nameOf`.

## How it fits

1. The webhook gives you a BSUID. The session subject is `whatsappSubject(portfolioId, bsuid)`.
2. If Meta shared a phone number that matches a customer, link by phone and skip the screen: `identity.link(subject, customer.id)`.
3. Otherwise the agent only gets one tool, `show_link_account`, until the chat is linked. The adapters take a filter: `anthropicTools(ui, (name) => (name === "show_link_account") !== linked)`. Pass the same filter when you run a tool call (`anthropicToolResult(ui, block, who, filter)`), so a tool the model wasn't offered is refused.
4. Every other surface checks the link before loading anything.

## The identity helper

`sqliteIdentity(store)` from `@ui-calling/sqlite` keeps its tables next to UI_calling's. The block's server file creates one and exports it as `identity`, so your other surfaces can use it:

```ts
import { identity } from "./link-account.server";

resolve: async ({ shift_id }, ctx) => {
  const employeeId = identity.customerFor(ctx.subject);
  if (!employeeId) throw new SurfaceError("account_not_linked", "This chat isn't linked to an employee yet");
  return loadShift(shift_id, employeeId); // only this employee's shifts
},
```

| Method | What it does |
|---|---|
| `customerFor(subject)` | The linked customer ID, or `undefined` |
| `link(subject, customerId)` / `unlink(subject)` | Link directly, e.g. by a phone number Meta shared |
| `startVerification(subject, customerId)` | A new code to send (replaces the previous one); `undefined` while the customer is locked out |
| `pending(subject)` | A code is waiting: the screen resumes on "enter your code" after a reload |
| `verify(subject, code)` | `{ ok: true, customerId }` and the subject is linked, or `{ ok: false, reason }`: `wrong_code` (with `attemptsLeft`), `expired`, `no_code`, `locked` |
| `cancelVerification(subject)` | Drop the waiting code (the user starts over) |
| `moveLink(previousSubject, subject)` | The user changed number and got a new BSUID: carry the link over |

Options: `codeTtlMs` (10 minutes), `maxAttempts` (5), `lockMs` (15 minutes), `digits` (6).

## Contract

Short-lived, and the code never reaches the agent:

```ts
export const linkAccount = defineSurface({
  name: "link_account",
  input: z.object({ continue_with: z.string().max(200).describe("What the user asked for, so you can pick it up after linking") }),
  ttlSeconds: 15 * 60, // whoever holds this link can link the chat to an account
  data: z.object({ stage: z.enum(["start", "code_sent", "linked"]), sentTo: z.string().nullable(), name: z.string().nullable(), continueWith: z.string() }),
  events: {
    code_requested: event(z.object({ identifier: z.string().trim().min(1).max(200) }), { describe: () => "User asked for a verification code" }),
    code_entered: event(z.object({ code: z.string().trim().max(12) }), { redact: ["code"], describe: () => "User entered their verification code", wake: true }),
    start_over: event(z.object({}), { describe: () => "User started over" }),
  },
});
```

`summarize` ends with "They wanted: …", so the agent picks the original request back up as soon as the link is made.

## Watch out

- **Same answer for unknown accounts.** `code_requested` shows "if that email matches an account, we sent a code" either way, also after a reload, so the screen can't be used to find out who's a customer.
- **Link the session's subject, never an ID from the screen.** The handler links `ctx.subject`; the payload only carries what the user typed.
- **Attempts count per customer, not per link.** The agent can open new links on request; the helper's lock follows the customer across chats and links.
- **Restrict tools until linked.** Giving the agent every tool and hoping it asks first leaks data the first time it doesn't.
- **BSUIDs change when the user changes number.** Meta sends the old one (`identityChange` from `parseWhatsAppWebhook`); call `identity.moveLink`.

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- The block: [`link-account.surface.ts`](../registry/blocks/link-account/link-account.surface.ts), [`link-account.server.ts`](../registry/blocks/link-account/link-account.server.ts), [`link-account.tsx`](../registry/blocks/link-account/link-account.tsx)
- The helper and its tests: [`identity.ts`](../../sqlite/src/identity.ts), the `identity:` check in [`test-store.ts`](../../../scripts/test-store.ts)
- The demo's own version (phone linking, BSUID changes): [`identity.ts`](../../../apps/demo/server/identity.ts), the `identity:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
