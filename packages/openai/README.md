# @ui-calling/openai

UI_calling surfaces as function tools for OpenAI's Responses or Chat Completions API. No SDK dependency.

```ts
import { openaiResponsesTools, runResponsesFunctionCall } from "@ui-calling/openai";

const response = await openai.responses.create({ model, input: convo.items, tools: openaiResponsesTools(ui) });
convo.items.push(...response.output); // the model's own output goes back before the results
for (const call of response.output) {
  if (call.type !== "function_call") continue;
  const { item, run } = await runResponsesFunctionCall(ui, call, who); // never throws
  convo.items.push(item); // the function_call_output
  if (run.ok) links.push(run.link); // deliver it as a button
}
// call responses.create again with convo.items until there's no function_call
```

Chat Completions: `openaiChatTools(ui)` and `runChatToolCall(ui, toolCall, who)`, which returns `{ message, run }`. The whole loop: `npx ui-calling guide agent`.
