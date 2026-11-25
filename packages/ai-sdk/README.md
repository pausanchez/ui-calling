# @ui-calling/ai-sdk

UI_calling surfaces as tools for the Vercel AI SDK (6 or 7).

```ts
import { aiSdkTools } from "@ui-calling/ai-sdk";

const result = await generateText({
  model, instructions, messages, stopWhen: stepCountIs(5),
  tools: aiSdkTools(ui, { conversationId, subject }, { onLink: (link) => links.push(link) }),
});
messages.push(...result.responseMessages);
```

A whole agent, including turns started by the screens: `npx ui-calling guide running`.
