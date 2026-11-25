# Pick from limited options

Use it when the user chooses one of a few things that can run out: shifts, appointment slots, seats, delivery windows. What they saw may be gone by the time they tap.

Full example: the demo's `shift_picker`.

## Contract

The event carries the ID **and** what the user saw, so the server can tell if it changed.

```ts
events: {
  shift_selected: event(
    z.object({ shift_id: z.string(), date: z.string(), start: z.string(), end: z.string(), location: z.string() }),
    {
      describe: (p) => `Worker picked the shift on ${p.date}, ${p.start}–${p.end} at ${p.location} (${p.shift_id})`,
      wake: true,
    },
  ),
},
```

## Server

Check the pick against your data, and fail with a specific code when it's gone. The code reaches both the screen (as `reason`) and the agent.

```ts
shift_selected: async (p, ctx) => {
  const workerId = String(ctx.session.input.worker_id);
  const shown = getShiftBoard(workerId, ctx.subject).open.find((s) => s.id === p.shift_id);
  if (shown && (shown.date !== p.date || shown.start !== p.start)) {
    throw new SurfaceError("shift_changed", `Shift ${p.shift_id} changed after the screen loaded`);
  }
  try {
    return bookShift(workerId, ctx.subject, p.shift_id);
  } catch (err) {
    if (err instanceof ShiftUnavailable) throw new SurfaceError(`shift_${err.reason}`, err.message); // shift_full, shift_not_found
    throw err;
  }
},
```

## Screen

Each option is a `choice-card` part (`npx ui-calling add choice-card`), with what's left on the right:

```tsx
<ChoiceCard type="radio" name="shift" checked={selected?.id === s.id} onChange={() => setSelected(s)}
  title={`${s.start}–${s.end} · ${s.location}`} aside={t.spotsLeft(s.spotsLeft)} disabled={s.spotsLeft === 0} note={s.spotsLeft === 0 ? t.full : undefined} />
```

When the option is gone, retrying can't help: say so, and reload the list.

```tsx
try {
  await emit("shift_selected", { shift_id: s.id, date: s.date, start: s.start, end: s.end, location: s.location });
} catch (err) {
  const reason = err instanceof SurfaceActionError ? err.reason : undefined;
  if (reason === "shift_full" || reason === "shift_not_found" || reason === "shift_changed") {
    setGone(true);                    // "That shift just filled up"
    await reload().catch(() => {});
  } else {
    setFailed(true);                  // generic message, with "try again" only if err.retryable
  }
}
```

## Watch out

- **Don't trust the payload.** It comes from the browser. Use the ID to look up the real option, and compare what the user saw.
- **Show what's left** ("2 of 5 spots left") and put it in `summarize` too, so the agent can suggest another option when one fills up.
- **No `retryable` on "full".** Only mark errors retryable when trying again can work (a timeout, a 503).

## In the UI_calling repo

Not in the package; for reading if you have the repo.

- Contract: [`shift-picker.surface.ts`](../../../apps/demo/src/components/ui-calling/shift-picker.surface.ts)
- Server: [`shift-picker.server.ts`](../../../apps/demo/server/shift-picker.server.ts)
- Screen: [`shift-picker.tsx`](../../../apps/demo/src/components/ui-calling/shift-picker.tsx)
- Proof: the `shifts:` checks in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
