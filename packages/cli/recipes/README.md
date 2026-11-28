# Recipes

Each recipe starts from a task and gives the whole answer: the contract, the server, the screen, what went wrong when we built it, and the demo code that does it in full. The rules and the API reference stay in the guide (`npx ui-calling guide`).

Print one with `npx ui-calling guide <recipe>`. They build on:
- `npx ui-calling new <name> --template steps` for screens with several steps;
- parts you copy and own: `screen-kit`, `step-bar`, `action-bar`, `choice-card`, `quantity-stepper`, `photo-picker` (`npx ui-calling add <part>`, `npx ui-calling list`);
- `npx ui-calling link <surface> key=value...` to open a screen for a test user while you build, and `npx ui-calling events` to see what the agent reads.

| Recipe | Use it when |
|---|---|
| [`show-and-act`](show-and-act.md) | Seeing beats reading (an order, a booking), and the user may change something from there |
| [`pick-from-options`](pick-from-options.md) | The user picks one of a few things that can run out: shifts, slots, seats |
| [`multistep-form`](multistep-form.md) | The user gives several answers in order and may stop and come back |
| [`file-upload`](file-upload.md) | The user has to send a photo or a document |
| [`prefill`](prefill.md) | The user already said in the chat what the screen asks for |
| [`link-account`](link-account.md) | You must know which customer this WhatsApp user is before showing anything personal |
| [`verify-before-showing`](verify-before-showing.md) | The screen shows what only that person should see (a payslip, a contract), and phones get shared |
| [`third-party-failures`](third-party-failures.md) | A system behind the screen can fail, and both the user and the agent should know |
| [`trace-an-interaction`](trace-an-interaction.md) | You need to follow one user's taps to what the agent read, or find where a screen fails |
| [`follow-up-abandoned`](follow-up-abandoned.md) | It matters that the user finishes, and the agent should nudge once if they stop |

Each recipe's code is complete enough to follow on its own. The "In the ui-calling repo" links at the end point to the demo, where each one runs and is tested; they're not in the package.
