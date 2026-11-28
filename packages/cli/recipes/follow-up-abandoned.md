# Follow up when the user stops

Use it when it matters that the user finishes: a return, a booking, a verification. If they open the screen and go quiet, the agent writes once, knowing where they stopped.

Full example: `abandonAfterMs` in the demo's `server/ui.ts`, and `abandoned` in `scriptedFollowUp` in `server/agent.ts`.

## Setup

Off by default. Turn it on with how long the user may be idle:

```ts
export const ui = createUiCalling({
  // ...
  abandonAfterMs: 10 * 60_000,
});
```

## What the agent gets

The finish line is any event whose contract says `wake: true` (even one recorded quietly past `maxWakesPerMinute`), or a failed action that woke the agent (an outage: the agent already heard about it). A refusal, like a wrong code, doesn't count: the user may have given up after it. If neither happened and the user has been idle for `abandonAfterMs`, the runtime records one `abandoned` event, which wakes the agent:

| What the user did | What the agent reads |
|---|---|
| Opened the screen, nothing else | "User opened the screen but took no action" |
| Saved some steps, then went quiet | "User stopped partway without finishing. Last step: Step 2 of 5: gave reasons: …", with `payload.lastStep` and the screen's state |
| Still moving through the steps | Nothing yet: the timer restarts from their last step |

## Prompt

A woken turn has no new message from the user. Offer `stay_silent` on it (`woken: true` on the adapter, see GUIDE.md, "A woken turn may say nothing") so the agent can stay quiet when a follow-up wouldn't help:

```text
If the screen shows the user stopped partway, offer once to help with the step they stopped at, in one sentence. Don't repeat the whole screen. If a follow-up would add nothing, call stay_silent.
```

Count the silences with `ui.onSilentWake`: if most abandons end in `stay_silent`, the wait is too short or the surface is one people only read (set `abandonAfterMs: false` on it).

In the demo the reply is specific because the event names the step: "I saw you stopped at the pickup step of your return. Need a hand? Your progress is saved, so the same link picks up where you left off."

## Watch out

- **One nudge, not a reminder series.** `abandoned` fires once per link. If you want more, schedule them yourself and respect the user's silence.
- **`wake: true` only on the real finish.** A wake event in the middle of a flow (say, on step 1) counts as finishing, and no `abandoned` will ever come.
- **Timers live in the process.** They're re-armed after a restart, but on serverless nothing runs between requests. There, set `abandonTimers: false` and call `ui.sweep()` from a cron every minute or so; it's safe on several instances at once.
- **The link stays valid** until it expires, so "the link still works" is true. Check `ttlSeconds` before promising it.

## In the ui-calling repo

Not in the package; for reading if you have the repo.

- Setting: `abandonAfterMs` in [`ui.ts`](../../../apps/demo/server/ui.ts) (`ABANDON_AFTER_MS`, default 90 s in the demo)
- Follow-ups: `scriptedFollowUp` in [`agent.ts`](../../../apps/demo/server/agent.ts); a woken turn with nothing to add ends in `scriptedSilence`, and `runClaude(c, true)` offers Claude `stay_silent`
- Proof of a silent wake: "a wake with nothing new to say ends in stay_silent" in [`smoke.ts`](../../../apps/demo/server/smoke.ts)
- Proof: the abandon checks in [`test-runtime.ts`](../../../scripts/test-runtime.ts) (untouched screen, a failed action, stopping partway, still moving)
