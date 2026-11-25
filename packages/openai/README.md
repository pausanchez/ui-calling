# @ui-calling/openai

UI_calling surfaces as function tools for OpenAI's Responses or Chat Completions API. No SDK dependency.

```ts
import { openaiResponsesTools, runResponsesFunctionCall } from "@ui-calling/openai";

const response = await openai.responses.create({ model, input, tools: openaiResponsesTools(ui) });
for (const item of response.output) if (item.type === "function_call") results.push(await runResponsesFunctionCall(ui, item, who));
```

Chat Completions: `openaiChatTools(ui)` and `runChatToolCall(ui, toolCall, who)`. The guide: `npx ui-calling guide agent`.
