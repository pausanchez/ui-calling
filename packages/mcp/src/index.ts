import { Server } from "@modelcontextprotocol/sdk/server";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { SurfaceLink, UiCalling, Who } from "@ui-calling/core";

type CallExtra = Parameters<Parameters<Server["setRequestHandler"]>[1]>[1];

export type McpAdapterOptions = {
  name?: string;
  version?: string;
  /**
   * Who a tool call is for. MCP has no notion of your end user, so derive it from the request,
   * e.g. from `extra.authInfo` (the authenticated user) and `extra.sessionId`.
   */
  who: (extra: CallExtra) => Who | Promise<Who>;
  /** Called with every link a tool call creates. */
  onLink?: (link: SurfaceLink) => void;
  filter?: (toolName: string) => boolean;
  /**
   * Also list `stay_silent`, for a host that runs the model on screen events without a user message.
   * MCP tool lists don't change per turn, so its description tells the model it's only for those turns.
   */
  staySilent?: boolean;
  /** Called when the model calls `stay_silent`: the host should send nothing this turn. */
  onSilent?: (reason: string) => void;
};

/**
 * An MCP server whose tools are your surfaces. Connect it to any transport:
 *
 *   const server = createUiCallingMcpServer(ui, {
 *     // One conversation per client session, never a shared fallback: events would mix between users.
 *     who: (extra) => {
 *       if (!extra.sessionId) throw new Error("This server needs a session ID per client");
 *       return { conversationId: extra.sessionId, subject: userFrom(extra.authInfo) };
 *     },
 *   });
 *   await server.connect(new StdioServerTransport());
 *
 * MCP clients usually show the model's text, so create the runtime with `deliverLinks: "message"`
 * to have the model include the URL in its reply.
 */
export function createUiCallingMcpServer(ui: UiCalling, opts: McpAdapterOptions) {
  const server = new Server({ name: opts.name ?? "ui-calling", version: opts.version ?? "0.1.0-preview.0" }, { capabilities: { tools: {} } });
  const visible = () => ui.tools({ woken: opts.staySilent, filter: opts.filter });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: visible().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema as { type: "object"; properties?: Record<string, object> },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    if (!visible().some((t) => t.name === name)) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ status: "error", code: "unknown_tool", message: `No tool ${name}` }) }], isError: true };
    }
    const run = await ui.runTool(name, request.params.arguments ?? {}, await opts.who(extra));
    if (run.ok && run.silent) opts.onSilent?.(run.reason);
    else if (run.ok) opts.onLink?.(run.link);
    return { content: [{ type: "text" as const, text: run.content }], isError: !run.ok };
  });

  return server;
}
