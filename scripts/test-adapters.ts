// Exercises every SDK adapter against a tiny surface, in-process: no model, no network.
// Run: npx tsx scripts/test-adapters.ts
import assert from "node:assert/strict";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SurfaceError, createUiCalling, defineSurface, event, implement, type SurfaceLink } from "@ui-calling/core";
import { anthropicRunnableTools, anthropicToolResult, anthropicTools } from "@ui-calling/anthropic";
import { aiSdkTools } from "@ui-calling/ai-sdk";
import { openaiChatTools, openaiResponsesTools, runChatToolCall, runResponsesFunctionCall } from "@ui-calling/openai";
import { createUiCallingMcpServer } from "@ui-calling/mcp";
import { uiCallingHandler } from "@ui-calling/server";
import { uiCallingNodeHandler } from "@ui-calling/server/node";
import { Readable, Writable } from "node:stream";

const ticket = defineSurface({
  name: "ticket",
  description: "Shows a support ticket.",
  input: z.object({ ticket_id: z.string() }),
  cta: { en: "View ticket", es: "Ver incidencia" },
  data: z.object({ id: z.string(), status: z.string() }),
  events: { closed: event(z.object({}), { describe: () => "User asked to close the ticket" }) },
});
const ui = createUiCalling({
  baseUrl: "https://ui.example.com",
  surfaces: [
    implement(ticket, {
      resolve: async ({ ticket_id }) => {
        if (ticket_id === "missing") throw new SurfaceError("ticket_not_found", "No such ticket");
        return { id: ticket_id, status: "open" };
      },
      summarize: (d) => `Ticket ${d.id} is ${d.status}.`,
    }),
  ],
});
const who = { conversationId: "c1", subject: "user-1" };
const input = { ticket_id: "T-1", locale: "es" };

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}
const isLink = (l: SurfaceLink | undefined) => {
  assert.ok(l, "a link was produced");
  assert.match(l.url, /^https:\/\/ui\.example\.com\/s\//);
  assert.equal(l.label, "Ver incidencia");
};

await check("core: runTool returns the tool result and the link, and errors as results", async () => {
  const ok = await ui.runTool("show_ticket", input, who);
  assert.ok(ok.ok);
  isLink(ok.link);
  assert.match(ok.content, /Ticket T-1 is open/);
  assert.doesNotMatch(ok.content, /https:/, "button mode keeps the URL away from the model");
  const bad = await ui.runTool("show_ticket", { ticket_id: "missing" }, who);
  assert.ok(!bad.ok);
  assert.equal(bad.error.code, "ticket_not_found");
});

await check("core: deliverLinks 'message' gives the model the URL", async () => {
  const web = createUiCalling({ baseUrl: "https://ui.example.com", deliverLinks: "message", surfaces: [implement(ticket, { resolve: async () => ({ id: "T-1", status: "open" }), summarize: () => "" })] });
  const run = await web.runTool("show_ticket", input, who);
  assert.ok(run.ok);
  assert.equal(JSON.parse(run.content).url, run.link.url);
});

await check("anthropic: tool definitions, manual tool_result, runnable tools", async () => {
  const [def] = anthropicTools(ui);
  assert.equal(def.name, "show_ticket");
  assert.equal(def.input_schema.type, "object");
  const { result, run } = await anthropicToolResult(ui, { id: "tu_1", name: "show_ticket", input }, who);
  assert.equal(result.tool_use_id, "tu_1");
  assert.ok(run.ok && !result.is_error);
  const failed = await anthropicToolResult(ui, { id: "tu_2", name: "show_ticket", input: { ticket_id: "missing" } }, who);
  assert.equal(failed.result.is_error, true);
  let link: SurfaceLink | undefined;
  const [runnable] = anthropicRunnableTools(ui, who, { onLink: (l) => (link = l) });
  const out = await runnable.run(input as never);
  assert.match(String(out), /link_ready/);
  isLink(link);
});

await check("ai-sdk: tools keyed by name; execute returns an object and reports the link", async () => {
  let link: SurfaceLink | undefined;
  const tools = aiSdkTools(ui, () => who, { onLink: (l) => (link = l) });
  assert.deepEqual(Object.keys(tools), ["show_ticket"]);
  const out = await tools.show_ticket.execute!(input, { toolCallId: "1", messages: [] } as never);
  assert.equal((out as { status: string }).status, "link_ready");
  isLink(link);
});

await check("openai: Responses and Chat Completions shapes, bad JSON becomes an error result", async () => {
  assert.equal(openaiResponsesTools(ui)[0].name, "show_ticket");
  assert.equal(openaiChatTools(ui)[0].function.name, "show_ticket");
  const r = await runResponsesFunctionCall(ui, { call_id: "call_1", name: "show_ticket", arguments: JSON.stringify(input) }, who);
  assert.equal(r.item.type, "function_call_output");
  assert.ok(r.run.ok);
  isLink(r.run.link);
  const c = await runChatToolCall(ui, { id: "call_2", function: { name: "show_ticket", arguments: "{oops" } }, who);
  assert.equal(c.message.role, "tool");
  assert.ok(!c.run.ok);
  assert.equal(c.run.error.code, "invalid_arguments");
});

await check("mcp: a client lists the surfaces and calls one through the protocol", async () => {
  let link: SurfaceLink | undefined;
  const server = createUiCallingMcpServer(ui, { who: () => who, onLink: (l) => (link = l) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ["show_ticket"]);
  const res = await client.callTool({ name: "show_ticket", arguments: input });
  assert.ok(!res.isError);
  assert.match(JSON.stringify(res.content), /link_ready/);
  isLink(link);
  const missing = await client.callTool({ name: "show_ticket", arguments: { ticket_id: "missing" } });
  assert.equal(missing.isError, true);
  await client.close();
});

await check("server: uiCallingHandler serves the routes as a plain fetch handler, errors included", async () => {
  const handler = uiCallingHandler(ui);
  const run = await ui.runTool("show_ticket", input, who);
  assert.ok(run.ok);
  const token = run.link.url.split("/s/")[1];
  const open = await handler(new Request(`https://app.example.com/api/ui/sessions/${token}`));
  assert.equal(open.status, 200);
  assert.equal(((await open.json()) as { surface: string }).surface, "ticket");
  const missing = await handler(new Request("https://app.example.com/api/ui/sessions/nope"));
  assert.equal(missing.status, 404, "UiCallingError status survives the basePath mount");
  assert.equal(((await missing.json()) as { error: string }).error, "not_found");
});

await check("server: uiCallingNodeHandler serves Node (req, res), mounted under Express's originalUrl", async () => {
  const node = uiCallingNodeHandler(ui);
  const run = await ui.runTool("show_ticket", input, who);
  assert.ok(run.ok);
  const token = run.link.url.split("/s/")[1];
  // Express inside app.use("/api/ui", …): req.url loses the mount path, originalUrl keeps it.
  const send = async (method: string, path: string, body?: unknown) => {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      method,
      url: path.replace("/api/ui", ""),
      originalUrl: path,
      headers: { host: "localhost:3000", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    });
    const chunks: Buffer[] = [];
    const headers: Record<string, unknown> = {};
    const res = Object.assign(
      new Writable({
        write(chunk, _enc, done) {
          chunks.push(Buffer.from(chunk));
          done();
        },
      }),
      { statusCode: 0, setHeader: (k: string, v: unknown) => void (headers[k] = v) },
    );
    const finished = new Promise((ok) => res.on("finish", ok));
    await node(req as never, res as never);
    await finished;
    return { status: res.statusCode, headers, json: JSON.parse(Buffer.concat(chunks).toString() || "null") };
  };
  const open = await send("GET", `/api/ui/sessions/${token}`);
  assert.equal(open.status, 200);
  assert.equal(open.json.surface, "ticket");
  assert.equal(open.headers["referrer-policy"], "no-referrer");
  const posted = await send("POST", `/api/ui/sessions/${token}/events`, { type: "closed", payload: {} });
  assert.equal(posted.status, 200, "a streamed body reaches the handler");
  assert.ok((await ui.events("c1")).some((e) => e.type === "closed"));
  assert.equal((await send("GET", "/api/ui/sessions/nope")).status, 404);
});

console.log(`\n${passed} checks passed`);
