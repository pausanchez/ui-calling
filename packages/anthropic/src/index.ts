import type Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import type { SurfaceLink, ToolRun, UiCalling, Who } from "@ui-calling/core";

export type AnthropicAdapterOptions = {
  /** Called with every link a tool call creates: deliver it on your channel (e.g. as a WhatsApp button). */
  onLink?: (link: SurfaceLink) => void;
  /** Offer only some surfaces, e.g. hide everything but an account-linking screen until the user is known. */
  filter?: (toolName: string) => boolean;
  /** A screen event started this turn, not a user message: also offer `stay_silent`. */
  woken?: boolean;
  /** Called when the model calls `stay_silent`: send nothing this turn, whatever text it writes after. */
  onSilent?: (reason: string) => void;
};

/**
 * Tool definitions for a manual loop with `client.messages.create({ tools })`. On a woken turn pass
 * `{ woken: true }` to add `stay_silent`; `anthropicToolResult` then returns `run.silent` when it's called.
 */
export function anthropicTools(ui: UiCalling, filter?: (toolName: string) => boolean, turn: { woken?: boolean } = {}): Anthropic.Tool[] {
  return ui
    .tools({ ...turn, filter })
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as Anthropic.Tool.InputSchema }));
}

/**
 * Run one `tool_use` block from a manual loop. Returns the `tool_result` block to send back and the
 * run: deliver `run.link` when `run.ok`, and send nothing this turn when `run.silent`. Failures come back
 * as `is_error` results, never throws.
 * Pass the `filter` you gave `anthropicTools`, so a tool the model wasn't offered is refused.
 */
export async function anthropicToolResult(
  ui: UiCalling,
  block: { id: string; name: string; input: unknown },
  who: Who,
  filter?: (toolName: string) => boolean,
): Promise<{ result: Anthropic.ToolResultBlockParam; run: ToolRun }> {
  const run = await ui.runTool(block.name, block.input, who, filter);
  return {
    result: { type: "tool_result", tool_use_id: block.id, content: run.content, ...(run.ok ? {} : { is_error: true }) },
    run,
  };
}

/**
 * Runnable tools for the SDK's tool runner, which loops for you:
 *
 *   const links: SurfaceLink[] = [];
 *   const final = await client.beta.messages.toolRunner({
 *     model, max_tokens, messages,
 *     tools: anthropicRunnableTools(ui, { conversationId, subject }, { onLink: (l) => links.push(l) }),
 *   });
 *   // send the final text, with links[] as buttons
 */
export function anthropicRunnableTools(ui: UiCalling, who: Who | (() => Who), opts: AnthropicAdapterOptions = {}) {
  return ui
    .tools({ woken: opts.woken, filter: opts.filter })
    .map((t) =>
      betaTool({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema as { type: "object" },
        run: async (input) => {
          const run = await ui.runTool(t.name, input, typeof who === "function" ? who() : who);
          if (run.ok && run.silent) opts.onSilent?.(run.reason);
          else if (run.ok) opts.onLink?.(run.link);
          return run.content;
        },
      }),
    );
}
