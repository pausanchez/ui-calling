# Ask for a PIN or code before showing personal data

Use it when a screen shows what only that person should see: a payslip, a contract, an ID document, a rota. A link is a bearer token, and phones get shared, lent and changed. With `verify: true`, nothing loads until the user types a PIN they know or a code you send them.

Full example: the demo's shift picker asks for a PIN (`verify: true` in `shift-picker.surface.ts`, `demoVerifier` in `server/identity.ts`).

## Contract

```ts
export const payslip = defineSurface({
  name: "payslip",
  description: "The worker's payslip for a month…",
  input: z.object({ month: z.string() }),
  data: z.object({ /* … */ }),
  events: {},
  verify: true,          // resolve doesn't run until the user proves who they are
  ttlSeconds: 15 * 60,   // and keep the link short-lived
});
```

## Server

Give `createUiCalling` a `verifier`. `sqliteIdentity` (see [`link-account`](link-account.md)) has two:

```ts
import { identity } from "./identity";

export const ui = createUiCalling({
  // ...
  verifier: identity.pinVerifier(),
  // or a fresh code each time, through a channel the user already controls:
  // verifier: identity.codeVerifier({ deliver: async (customerId, code, locale) => {
  //   const { phone } = await employees.get(customerId);
  //   await sms.send(phone, locale.startsWith("es") ? `Tu código: ${code}` : `Your code: ${code}`);
  //   return { hint: `SMS to •••• ${phone.slice(-2)}` };
  // } }),
});

// Set the PIN once the chat is linked, e.g. in the link-account screen or your onboarding:
identity.setPin(employeeId, pin);
```

Or write your own: `{ kind: "pin" | "code", send?(who, locale), check(who, typed) }`. With Twilio Verify, when the subject is the user's phone number:

```ts
const verify = () => twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID!);

export const twilioVerifier: Verifier = {
  kind: "code",
  async send({ subject }) {
    await verify().verifications.create({ to: subject, channel: "sms" });
    return { hint: `SMS to •••• ${subject.slice(-2)}` };
  },
  async check({ subject }, typed) {
    return (await verify().verificationChecks.create({ to: subject, code: typed }).catch(() => null))?.status === "approved";
  },
};
```

On a trial account, Twilio Verify only texts numbers verified in its console. `check` gets `who.subject`: look up the person the chat is linked to and compare against theirs, never a shared value. Keep a lockout per person in your verifier; the runtime only counts per link.

WhatsApp can't send an authentication template to a BSUID, so on WhatsApp a code goes by SMS or email, or you use a PIN.

## Screen

Nothing to write. `SurfaceProvider` shows its own step, in the user's language (en/es) and with your tokens, then your screen once the PIN is right. `opened` is recorded only after that. To change it, pass `verifyScreen`, or wrap the built-in one:

```tsx
<SurfaceProvider token={token} verifyScreen={(p) => <VerifyStep {...p} note={<a href="/help">Forgot your PIN?</a>} />}>
```

## What the agent gets

- **A wrong PIN is quiet:** an `error` event with `wrong_code`, refused, so the agent reads it on its next turn without being woken.
- **After `maxVerifyAttempts` (5) the link locks** and the agent is woken once: "The user's action did NOT go through. Attempted: verify their identity. verification_locked". Offer another way, or a new link later.
- **What the user typed never reaches the agent** or the store.

## Watch out

- **Once per link.** A new link asks again. That's the point on a shared phone.
- **Codes are limited to 3 per link,** so a script holding the link can't spend your SMS budget.
- **`bindToDevice` is not enough** when people change or share phones: it stops a forwarded link, not someone holding the phone. Use both for the most sensitive screens.
- **Errors before the PIN** say nothing about the user: `open` doesn't call `resolve`, so even "account not found" can't leak.

## In the ui-calling repo

Not in the package; for reading if you have the repo.

- Contract: `verify: true` in [`shift-picker.surface.ts`](../../../apps/demo/src/components/ui-calling/shift-picker.surface.ts)
- Verifier: `demoVerifier` in [`identity.ts`](../../../apps/demo/server/identity.ts), passed in [`ui.ts`](../../../apps/demo/server/ui.ts)
- Screen: `verifyScreen` with the demo's PIN in [`surface-page.tsx`](../../../apps/demo/src/surface-page.tsx)
- On Twilio Verify, deployed: the ticket screen in [the event concierge example](https://github.com/pausanchez/ui-calling-event-concierge) (`src/lib/verify.ts`)
- Proof: "the rota needs the worker's PIN" in [`smoke.ts`](../../../apps/demo/server/smoke.ts), the verify check in [`test-runtime.ts`](../../../scripts/test-runtime.ts), and the PIN and code verifiers in [`test-store.ts`](../../../scripts/test-store.ts)
