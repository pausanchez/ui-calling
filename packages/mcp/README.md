# @ui-calling/mcp

UI_calling surfaces as tools on an MCP server, so any MCP client can open screens.

```ts
import { createUiCallingMcpServer } from "@ui-calling/mcp";

const server = createUiCallingMcpServer(ui, { who: (extra) => ({ conversationId: extra.sessionId!, subject: userFrom(extra.authInfo) }) });
await server.connect(transport);
```

MCP knows nothing of your end user, so `who` derives them from the request. Use `deliverLinks: "message"` so the model puts the link in its reply. The guide: `npx ui-calling guide agent`.
