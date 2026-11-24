import type { ToolRun, UiCalling, Who } from "@ui-calling/core";

type Filter = (toolName: string) => boolean;

/** Function tools for the Responses API: `client.responses.create({ tools })`. */
export function openaiResponsesTools(ui: UiCalling, filter?: Filter) {
  return ui
    .tools()
    .filter((t) => !filter || filter(t.name))
    .map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.input_schema, strict: false }));
}

/** Function tools for Chat Completions: `client.chat.completions.create({ tools })`. */
export function openaiChatTools(ui: UiCalling, filter?: Filter) {
  return ui
    .tools()
    .filter((t) => !filter || filter(t.name))
    .map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    }));
}

/**
 * Run a Responses API `function_call` output item. Returns the `function_call_output` item to add to
 * the next request's input, and the run (with `run.link` to deliver when `run.ok`).
 */
export async function runResponsesFunctionCall(
  ui: UiCalling,
  call: { call_id: string; name: string; arguments: string },
  who: Who,
): Promise<{ item: { type: "function_call_output"; call_id: string; output: string }; run: ToolRun }> {
  const run = await runWithArguments(ui, call.name, call.arguments, who);
  return { item: { type: "function_call_output", call_id: call.call_id, output: run.content }, run };
}

/** Run a Chat Completions tool call. Returns the `tool` message to append, and the run. */
export async function runChatToolCall(
  ui: UiCalling,
  call: { id: string; function: { name: string; arguments: string } },
  who: Who,
): Promise<{ message: { role: "tool"; tool_call_id: string; content: string }; run: ToolRun }> {
  const run = await runWithArguments(ui, call.function.name, call.function.arguments, who);
  return { message: { role: "tool", tool_call_id: call.id, content: run.content }, run };
}

// OpenAI sends arguments as a JSON string; malformed JSON becomes an error result the model can fix.
async function runWithArguments(ui: UiCalling, name: string, args: string, who: Who): Promise<ToolRun> {
  let input: unknown;
  try {
    input = JSON.parse(args || "{}");
  } catch {
    const error = { code: "invalid_arguments", message: "Tool arguments were not valid JSON" };
    return { ok: false, content: JSON.stringify({ status: "error", ...error }), error };
  }
  return ui.runTool(name, input, who);
}
