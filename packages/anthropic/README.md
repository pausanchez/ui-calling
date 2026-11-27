# @ui-calling/anthropic

ui-calling surfaces as tools for the Anthropic SDK, with the tool runner or a manual loop.

```ts
import { anthropicRunnableTools } from "@ui-calling/anthropic";

const runner = client.beta.messages.toolRunner({
  model: "claude-opus-5-5", max_tokens: 16000, messages,
  tools: anthropicRunnableTools(ui, { conversationId, subject }, { onLink: (link) => links.push(link) }),
});
```

Manual loop: `anthropicTools(ui, filter?)` for `tools`, and `anthropicToolResult(ui, block, who, filter?)` for each `tool_use`, which returns `{ result, run }` and never throws. Both, with a whole loop: `npx ui-calling guide agent`. Turns started by the screens: `npx ui-calling guide running`.
