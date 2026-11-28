# Follow one interaction end to end

Use it when a user says "I tapped it and nothing happened", or when you want to know where a screen loses people. The idea is to follow one link from the moment the agent opened it, through each tap, to what reached the agent. You don't need a monitoring platform for this: `onTrace` hands each step to your logger, and the IDs tie the steps together.

Full example: the demo prints every step with `UI_CALLING_TRACE=1 npm run dev`.

## Server

```ts
createUiCalling({
  // ...
  onTrace: (t) => logger.info({ msg: `ui-calling ${t.step}`, ...t }),
});
```

Each step carries:
- `sessionId`, the link, which ties every step of one user on one screen together;
- `conversationId` and `surface`;
- `key` on steps that belong to one action, the same for every retry of it.

| Step | When | Adds |
|---|---|---|
| `link.created` | The agent opened the screen | |
| `event.received` | The screen sent an event (lifecycle or yours) | `type`, `key` |
| `handler.finished` | Your handler returned or threw | `ms`, `outcome`: `ok`, `unchanged` or `failed` |
| `event.recorded` | The event is stored, and the agent will read it | `eventId`, `wake` |
| `event.repeat` | A retry of an action that already ran: answered from the first try, nothing ran | `eventId` |
| `event.failed` | The request failed | `kind`, `code`, `reason` |

`kind` says which failure it was:

| `kind` | Meaning |
|---|---|
| `validation` | The body didn't match the contract |
| `refused` | A business refusal, with your `reason` |
| `upstream` | A system your handler calls |
| `infrastructure` | Your store or server |
| `in_progress` | A retry while the first try still runs |
| `link` | Expired, completed, another device, not verified |

Alert on `upstream` and `infrastructure`. A `refused` is the screen working, and `validation` usually means the screen and the contract are out of step.

Traces carry IDs and types, never payloads, so they hold nothing the user typed. A hook that throws or is slow never fails the user's action.

## Reading one

A booking where the first response was lost on the way back to the phone:

```text
[trace] wL3k9a link.created
[trace] wL3k9a event.received opened
[trace] wL3k9a event.recorded opened
[trace] wL3k9a event.received shift_selected key 6d0def5f
[trace] wL3k9a handler.finished shift_selected key 6d0def5f 41ms ok
[trace] wL3k9a event.recorded shift_selected wake
[trace] wL3k9a event.received shift_selected key 6d0def5f
[trace] wL3k9a event.repeat shift_selected key 6d0def5f
```

The same key arriving twice is a retry, and `event.repeat` shows it ran once. Two different keys with the same type are two taps. If you see `handler.finished … ok` with no `event.recorded` after it, the store failed after your handler ran. The screen was told it failed, and a retry after `eventKeyStaleMs` runs the handler again with the same key.

## Watch out

- **Don't log payloads next to traces.** If you need what the user chose, read the event the agent read: `ui.events(conversationId)`, by `eventId`.
- **Sample in production if you need to.** There's one step per event and a few per action, so most apps can keep them all.

## In the ui-calling repo

Not in the package; for reading if you have the repo.

- Server: `onTrace` in [`ui.ts`](../../../apps/demo/server/ui.ts)
- Proof: "trace: every step of one action shares the session and key" in [`test-runtime.ts`](../../../scripts/test-runtime.ts)
