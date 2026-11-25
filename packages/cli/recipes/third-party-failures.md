# A system behind the screen fails

Use it whenever a screen loads from or writes to something you don't control: an orders API, a carrier, a scheduling system, a payment provider. Both the user and the agent should learn what failed, and "try again" should only appear when it can work.

Full example: the demo's outage switches (`server/failures.ts`), used by `order_status`, `shift_picker` and `order_return`.

## Server

Throw `SurfaceError` with a code, a message for the agent, and `retryable` when trying again can help. The same call works in `resolve` (the screen can't load) and in handlers (an action failed).

```ts
resolve: async ({ order_id }, ctx) => {
  const res = await ordersApi.get(order_id).catch(() => null);
  if (!res) throw new SurfaceError("orders_api_unavailable", "Orders API responded 503 Service Unavailable", { retryable: true });
  return toData(res);
},
on: {
  reschedule_delivery: async (slot, ctx) => {
    try {
      return await carrier.book(slot);
    } catch {
      throw new SurfaceError("carrier_timeout", "Carrier API timed out after 10s while booking the new slot", { retryable: true });
    }
  },
},
```

What happens next, without more code:
- The agent gets an `error` event with the code and message, worded as "did NOT go through. Attempted: …" from your `describe`. The first error of each kind wakes it.
- The screen gets `errorCode` (load) or a `SurfaceActionError` with `reason` and `retryable` (action).
- A failed load returns 502 with `error: "upstream_error"`.

## Screen

```tsx
const { status, errorCode, returnUrl } = useSurface(orderStatus);
if (status === "error" && errorCode === "upstream_error") {
  // The agent was told: send the user back to the chat instead of a dead end.
  return <Card>{t.unavailable} <a href={returnUrl}>{t.backToChat}</a></Card>;
}

try {
  await emit("reschedule_delivery", slot);
} catch (err) {
  const e = err instanceof SurfaceActionError ? err : null;
  const known = e?.reason ? t.errors[e.reason] : undefined;     // your message, in the user's language
  const offline = !e || e.code === "network";
  setProblem({
    message: known ?? (offline ? t.offline : t.actionFailed),
    retry: !known && (!e || e.retryable) ? () => void reschedule(slot) : undefined,
  });
}
```

## Prompt

```text
Events of type "error" mean something failed on the screen, usually a system behind it. Never say an action happened if it failed. Tell the customer plainly what didn't work, without technical jargon or internal codes, and offer a way forward.
```

## Outages and refusals

An outage (the API is down, a timeout) is `upstream_error` (502), and can be `retryable`. A refusal (the slot filled up, the code was wrong) isn't an outage: throw it with `{ refused: true }` and the screen gets 422 `refused`, so your monitoring only alerts on real failures. The screen handles both the same way: by `reason`, with "try again" only when `retryable`.

## Watch out

- **The message goes to the agent as written.** No secrets, tokens or stack traces in it.
- **`retryable` only when it can work:** a timeout or a 503 yes; "slot full" or "not returnable" no.
- **Keep the user's work.** A failed submit in a [multistep form](multistep-form.md) keeps the saved draft; say "your return is saved, try again in a minute".
- **Test it.** Give each third party an outage switch in development, as the demo does, and check that the agent's reply never claims success.

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- Switches: [`failures.ts`](../../../apps/demo/server/failures.ts), toggled by `POST /api/demo/failures`
- Server: [`order-status.server.ts`](../../../apps/demo/server/order-status.server.ts), [`order-return.server.ts`](../../../apps/demo/server/order-return.server.ts)
- Screen: `next()` in [`order-return.tsx`](../../../apps/demo/src/components/ui-calling/order-return.tsx)
- Proof: "a failing action is an error event with a reason", "a failing data source makes the page say so" and "a failed pickup keeps the draft" in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
