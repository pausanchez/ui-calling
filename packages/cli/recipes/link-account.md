# Link a WhatsApp user to a customer account

Use it when the chat must know **who** the user is before showing personal data, and the channel doesn't tell you. WhatsApp identifies users by a business-scoped user ID (BSUID), and only shares the phone number under Meta's conditions; users with a username may never share it.

Full example: the demo's `link_account`, with `server/identity.ts`.

## How it fits

1. The webhook gives you a BSUID. The session subject is `whatsappSubject(portfolioId, bsuid)`.
2. If Meta shared a phone number that matches a customer, link by phone and skip the screen.
3. Otherwise the agent only gets one tool, `show_link_account`, until the chat is linked. The adapters take a filter: `anthropicTools(ui, (name) => (name === "show_link_account") !== linked)`.
4. Every other surface calls `requireCustomer(ctx.subject)` before loading anything.

## Contract

Short-lived, and the code never reaches the agent.

```ts
export const linkAccount = defineSurface({
  name: "link_account",
  description: "Lets the user verify who they are (email and a one-time code) so this WhatsApp chat gets linked to their customer account...",
  input: z.object({ continue_with: z.string().max(200).describe("What the user asked for, so you can pick it up after linking") }),
  cta: { en: "Verify it's you", es: "Verificar identidad" },
  ttlSeconds: 10 * 60, // whoever holds this link can link the chat to an account
  data: z.object({ linked: z.boolean(), customerName: z.string().nullable(), continueWith: z.string() }),
  events: {
    verify_identity: event(z.object({ email: z.string().email().max(200), code: z.string().max(12) }), {
      redact: ["code"],
      describe: (p) => `User asked to link this chat to the account with email ${mask(p.email)}`,
      wake: true,
    }),
  },
});
```

## Server

Link the session's **subject**, never an ID from the payload. Give the same error for an unknown email and a wrong code, so nobody can test which emails have accounts.

```ts
verify_identity: async ({ email, code }, ctx) => {
  const customer = findByEmail(email);
  if (!customer || !(await codeMatches(customer, code))) {
    throw new SurfaceError("invalid_code", "The email and code don't match an account", { retryable: true });
  }
  links.set(ctx.subject, customer.id);
  return { linked: true, customerName: customer.name, continueWith: String(ctx.session.input.continue_with) };
},
```

`summarize` ends with "They wanted: …", so the agent picks the original request back up as soon as the link is made.

## Watch out

- **Check access by customer, not by phone number.** Phone numbers change and may be hidden; the link from subject to customer is what counts.
- **BSUIDs change when the user changes number.** Meta sends the old one; move the link (`identityChange` from `parseWhatsAppWebhook`).
- **Restrict tools until linked.** Giving the agent every tool and hoping it asks first leaks data the first time it doesn't.

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- Contract: [`link-account.surface.ts`](../../../apps/demo/src/components/ui-calling/link-account.surface.ts)
- Server: [`link-account.server.ts`](../../../apps/demo/server/link-account.server.ts), [`identity.ts`](../../../apps/demo/server/identity.ts)
- Tools until linked: `receiveWebhook` and the tool filter in [`agent.ts`](../../../apps/demo/server/agent.ts)
- Proof: the `identity:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
