import { jsonSchema, tool, type ToolSet } from "ai";
import type { SurfaceLink, UiCalling, Who } from "@ui-calling/core";

export type AiSdkAdapterOptions = {
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
 * Surfaces as Vercel AI SDK tools. Build them per request, for the user you're talking to:
 *
 *   const result = await generateText({
 *     model, messages,
 *     tools: aiSdkTools(ui, { conversationId, subject }, { onLink: (l) => links.push(l) }),
 *     stopWhen: stepCountIs(5),
 *   });
 */
export function aiSdkTools(ui: UiCalling, who: Who | (() => Who), opts: AiSdkAdapterOptions = {}): ToolSet {
  return Object.fromEntries(
    ui
      .tools({ woken: opts.woken, filter: opts.filter })
      .map((t) => [
        t.name,
        tool({
          description: t.description,
          inputSchema: jsonSchema(t.input_schema as Parameters<typeof jsonSchema>[0]),
          execute: async (input: unknown) => {
            const run = await ui.runTool(t.name, input, typeof who === "function" ? who() : who);
            if (run.ok && run.silent) opts.onSilent?.(run.reason);
            else if (run.ok) opts.onLink?.(run.link);
            // The model reads this object as the tool output; failures say why instead of throwing.
            return JSON.parse(run.content) as Record<string, unknown>;
          },
        }),
      ]),
  );
}
