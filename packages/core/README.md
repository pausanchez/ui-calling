# @ui-calling/core

Let an AI agent open a screen for a user the way it calls a function, and hear back what happens there.

```ts
import { createUiCalling, defineSurface, event, implement } from "@ui-calling/core";

const ui = createUiCalling({ baseUrl: "https://app.example.com", surfaces: [shiftPickerImpl], timeZone: "Europe/Madrid" });
const run = await ui.runTool("show_shift_picker", { worker_id: "W-207" }, { conversationId, subject });
// run.content goes back to the model; run.link.url goes to the user
```

The contract (`defineSurface`), the server half (`implement`: `resolve`, `summarize`, event handlers), the runtime (`createUiCalling`: tools, links, events, errors) and the WhatsApp helpers (`@ui-calling/core/whatsapp`).

Start with the CLI, which sets this up and prints the guide: `npx ui-calling init`, then `npx ui-calling guide`.
