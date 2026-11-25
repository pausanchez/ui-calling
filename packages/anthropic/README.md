# @ui-calling/anthropic

UI_calling surfaces as tools for the Anthropic SDK, with the tool runner or a manual loop.

```ts
import { anthropicRunnableTools } from "@ui-calling/anthropic";

const runner = client.beta.messages.toolRunner({
  model: "claude-opus-5-5", max_tokens: 16000, messages,
  tools: anthropicRunnableTools(ui, { conversationId, subject }, { onLink: (link) => links.push(link) }),
});
```

Manual loop: `anthropicTools(ui)` and `anthropicToolResult(ui, toolUseBlock, who)`. A whole agent: `npx ui-calling guide agent`.
