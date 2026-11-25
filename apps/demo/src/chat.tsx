import { useEffect, useRef, useState } from "react";
import type { UiEvent } from "@ui-calling/core";
import type { ToolSpec } from "@ui-calling/core";
import type { ChatMessage, InboundTrace, ToolTrace } from "../server/agent";

type Identity = {
  subject: string;
  bsuid?: string;
  phone?: string;
  username?: string;
  customer: { id: string; name: string } | null;
};
type State = {
  mode: "claude" | "scripted";
  chat: ChatMessage[];
  calls: ToolTrace[];
  timeline: UiEvent[];
  typing: boolean;
  inbound: InboundTrace | null;
  identity: Identity;
};
type ToolsInfo = { agent: string; model: string | null; tools: ToolSpec[]; whatsappEndpoint: string };

const SUGGESTIONS = [
  "¿Dónde está mi pedido?",
  "Can I change the delivery day?",
  "The blender arrived cracked, I want to return it",
  "¿Hay turnos libres esta semana?",
];
const NO_FAILURES = { ordersApi: false, carrierApi: false, schedulingApi: false };

// `?conversation=wa:…` watches a real WhatsApp user's chat (the API logs the link); you reply from your phone.
const WATCHING = new URLSearchParams(location.search).get("conversation");

export function Chat() {
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState("");
  const [failures, setFailures] = useState(NO_FAILURES);
  const [tools, setTools] = useState<ToolsInfo | null>(null);
  const [tab, setTab] = useState<"inbound" | "calls" | "context">("inbound");
  const [phoneShared, setPhoneShared] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/demo/failures")
      .then((r) => r.json())
      .then(setFailures)
      .catch(() => {});
    fetch("/api/demo/identity")
      .then((r) => r.json())
      .then((u) => setPhoneShared(u.phoneShared))
      .catch(() => {});
    fetch("/api/demo/tools")
      .then((r) => r.json())
      .then(setTools)
      .catch(() => {});
  }, []);

  async function toggleFailure(key: keyof typeof failures) {
    const res = await fetch("/api/demo/failures", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: !failures[key] }),
    });
    setFailures(await res.json());
  }

  async function togglePhoneShared() {
    const res = await fetch("/api/demo/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneShared: !phoneShared }),
    });
    setPhoneShared((await res.json()).phoneShared);
  }

  async function changeNumber() {
    await fetch("/api/demo/identity/change-number", { method: "POST" });
    setTab("inbound");
  }

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch(WATCHING ? `/api/chat?conversation=${encodeURIComponent(WATCHING)}` : "/api/chat")
        .then((r) => r.json())
        .then((s) => alive && setState(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const count = (state?.chat.length ?? 0) + (state?.typing ? 1 : 0);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [count]);

  async function send(t: string) {
    if (!t.trim()) return;
    setText("");
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t }),
    });
    setState(await res.json());
  }

  async function reset() {
    setState(await (await fetch("/api/chat/reset", { method: "POST" })).json());
    setFailures(NO_FAILURES);
    setPhoneShared(true);
  }

  return (
    <div className="min-h-dvh bg-muted/60">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[400px_1fr] lg:py-10">
        <section className="flex h-[min(780px,calc(100dvh-3rem))] flex-col overflow-hidden rounded-[28px] border border-border bg-[#efeae2] shadow-xl dark:bg-[#0b141a]">
          <header className="flex items-center gap-3 bg-[#008069] px-4 py-3 text-white dark:bg-[#202c33]">
            <div className="grid size-9 place-items-center rounded-full bg-white/20 text-sm font-semibold">A</div>
            <div className="flex-1">
              <p className="text-sm font-semibold leading-tight">Acme Store</p>
              <p className="text-xs text-white/75">{state?.typing ? "typing…" : "online"}</p>
            </div>
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
              WhatsApp · {WATCHING ? "real" : "simulated"}
            </span>
          </header>

          <div ref={scroller} className="flex-1 space-y-2 overflow-y-auto px-3 py-4">
            {state?.chat.length === 0 && (
              <p className="mx-auto max-w-[85%] rounded-lg bg-[#fff5c4] px-3 py-2 text-center text-xs text-neutral-700 dark:bg-[#182229] dark:text-neutral-300">
                You're a customer who also works shifts at Acme. Ask about your order or about open shifts to see the agent hand you a UI.
              </p>
            )}
            {state?.chat.map((m) => <Bubble key={m.id} m={m} />)}
            {state?.typing && (
              <div className="w-fit rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-neutral-500 shadow-sm dark:bg-[#202c33]">
                <span className="animate-pulse">●●●</span>
              </div>
            )}
          </div>

          {!WATCHING && state && state.chat.length === 0 && (
            <div className="flex flex-wrap gap-2 px-3 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-[#008069]/30 bg-white px-3 py-1.5 text-xs text-[#008069] shadow-sm hover:bg-[#f0faf7] dark:bg-[#202c33] dark:text-[#4fd1b0]"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            hidden={!!WATCHING}
            onSubmit={(e) => {
              e.preventDefault();
              void send(text);
            }}
            className="flex gap-2 bg-[#f0f2f5] p-2 dark:bg-[#202c33]"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type a message"
              className="flex-1 rounded-full bg-white px-4 py-2 text-sm text-neutral-900 outline-none dark:bg-[#2a3942] dark:text-neutral-100"
            />
            <button className="grid size-10 place-items-center rounded-full bg-[#008069] text-white" aria-label="Send">
              ➤
            </button>
          </form>
        </section>

        <section className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Under the hood</h1>
              <p className="text-sm text-muted-foreground">
                How the agent opens a screen, and what comes back from it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-border bg-card px-3 py-1 text-xs">
                agent: <b>{state?.mode ?? "…"}</b>
              </span>
              <button onClick={reset} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted">
                Reset
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">Simulate WhatsApp identity:</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={!phoneShared} onChange={togglePhoneShared} />
              User hides their number (username only)
            </label>
            <button
              onClick={changeNumber}
              disabled={!state?.identity.bsuid}
              className="rounded-md border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-50"
            >
              User changes phone number (new BSUID)
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-sm">
            <span className="text-muted-foreground">Simulate failures:</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.ordersApi} onChange={() => toggleFailure("ordersApi")} />
              Orders API down (page won't load)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.carrierApi} onChange={() => toggleFailure("carrierApi")} />
              Carrier API timeout (reschedule and return pickup fail)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.schedulingApi} onChange={() => toggleFailure("schedulingApi")} />
              Scheduling system down (shifts won't load or book)
            </label>
          </div>

          <div role="tablist" className="flex gap-1 rounded-lg border border-border bg-card p-1 text-sm">
            {(
              [
                ["inbound", "Inbound", "Meta → you: who is writing"],
                ["calls", `Tool calls (${state?.calls.length ?? 0})`, "Agent → screen"],
                ["context", `Agent context (${state?.timeline.length ?? 0})`, "Screen → agent"],
              ] as const
            ).map(([key, label, hint]) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-md px-3 py-2 text-left ${tab === key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60"}`}
              >
                {label}
                <span className="block text-xs font-normal text-muted-foreground">{hint}</span>
              </button>
            ))}
          </div>

          {tab === "inbound" && <Inbound inbound={state?.inbound ?? null} identity={state?.identity} />}

          {tab === "calls" && <ToolCalls tools={tools} calls={state?.calls ?? []} />}

          {tab === "context" && (
          <div className="rounded-lg border border-border bg-card">
            <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground">
              Semantic events reported by the screens. <b>Wake</b> events start an agent turn on their own.
            </p>
            {!state?.timeline.length ? (
              <p className="p-6 text-sm text-muted-foreground">No events yet. Open a link from the chat and interact with it.</p>
            ) : (
              <ol className="divide-y divide-border">
                {state.timeline.map((e) => (
                  <li key={e.id} className="flex gap-3 p-3 text-sm">
                    <time className="w-16 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                      {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </time>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <code
                          className={`rounded px-1.5 py-0.5 text-xs ${
                            e.kind === "error" ? "bg-destructive/15 text-destructive" : "bg-muted"
                          }`}
                        >
                          {e.type}
                        </code>
                        <span className="text-xs text-muted-foreground">{e.surface} · {e.kind}</span>
                        {e.wake && <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-medium text-primary-foreground">wake</span>}
                      </div>
                      <p className="mt-1">{e.description}</p>
                      {e.state && (
                        <p className="mt-1 border-l-2 border-primary/40 pl-2 text-xs text-muted-foreground">
                          Screen now shows: {e.state}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
          )}
        </section>
      </div>
    </div>
  );
}

const MATCH_TEXT: Record<InboundTrace["match"], string> = {
  already_linked: "This BSUID was already linked to a customer.",
  linked_by_phone: "Meta shared the phone number, and it matched a customer in the CRM: BSUID linked.",
  not_linked: "No phone number and no link: the agent doesn't know who this is, so it can only offer to verify.",
  relinked_after_id_change: "Meta reported a new BSUID: the customer link moved over to it.",
};

/** Meta → you: the last webhook, and how its BSUID resolved to a session subject and a customer. */
function Inbound({ inbound, identity }: { inbound: InboundTrace | null; identity?: Identity }) {
  if (!inbound || !identity) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        Nothing yet. Each chat message arrives here first, as the webhook Meta would send.
      </p>
    );
  }
  const p = inbound.parsed;
  const rows: [string, string | undefined, string][] = [
    ["BSUID", p.bsuid, "messages[].from_user_id: always present, unique within your business portfolio"],
    ["Phone", p.phone ?? "not shared", "messages[].from: only after a recent conversation or if they're in your contact book"],
    ["Username", p.username ? `@${p.username}` : undefined, "contacts[].profile.username"],
    ["Session subject", inbound.subject, "whatsappSubject(portfolio, bsuid): what UI_calling ties links to"],
    ["Customer", identity.customer ? `${identity.customer.name} (${identity.customer.id})` : "not linked", "your BSUID → customer links"],
  ];
  return (
    <div className="flex flex-col gap-4">
      <article className="rounded-lg border border-border bg-card">
        <header className="border-b border-border px-4 py-2.5 text-sm font-medium">Who is writing</header>
        <dl className="divide-y divide-border text-sm">
          {rows.map(([k, v, hint]) => (
            <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[140px_1fr]">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0">
                <code className="text-xs [overflow-wrap:anywhere]">{v ?? "—"}</code>
                <p className="text-xs text-muted-foreground">{hint}</p>
              </dd>
            </div>
          ))}
        </dl>
        <p
          className={`border-t border-border px-4 py-2.5 text-sm ${
            identity.customer ? "bg-success/10" : "bg-warning/10"
          }`}
        >
          <span className="text-muted-foreground">When the last message arrived: </span>
          {MATCH_TEXT[inbound.match]}
          {p.identityChange && (
            <span className="block text-xs text-muted-foreground">
              System message <code>{p.identityChange.kind}</code>, previous BSUID{" "}
              <code>{p.identityChange.previousBsuid}</code>
            </span>
          )}
        </p>
      </article>
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-sm font-medium">Webhook from Meta</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">POST /api/whatsapp/webhook (signature checked with your app secret)</p>
        <Json value={inbound.payload} />
      </div>
    </div>
  );
}

/** Agent → screen: the tool definitions the model gets, then every call with what it produced. */
function ToolCalls({ tools, calls }: { tools: ToolsInfo | null; calls: ToolTrace[] }) {
  return (
    <div className="flex flex-col gap-4">
      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm">
          <span className="font-medium">Tool definitions given to the model</span>{" "}
          <span className="text-muted-foreground">
            ({tools?.tools.length ?? 0}, generated from the surface contracts by <code>ui.tools()</code>
            {tools?.model ? ` · model ${tools.model}` : " · scripted agent"})
          </span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          {tools?.tools.map((t) => (
            <div key={t.name}>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{t.name}</code>
              <p className="mt-1.5 text-sm text-muted-foreground">{t.description}</p>
              <Json label="input_schema" value={t.input_schema} />
            </div>
          ))}
        </div>
      </details>

      {calls.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No tool calls yet. Ask the chat about your order or your shifts.
        </p>
      ) : (
        [...calls].reverse().map((t) => <CallCard key={t.id} t={t} endpoint={tools?.whatsappEndpoint} />)
      )}
    </div>
  );
}

function CallCard({ t, endpoint }: { t: ToolTrace; endpoint?: string }) {
  const time = new Date(t.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <article className="rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-sm">
        <time className="font-mono text-xs text-muted-foreground">{time}</time>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">{t.tool}</code>
        <span className="text-xs text-muted-foreground">called by {t.agent === "claude" ? "Claude" : "the scripted agent"}</span>
      </header>
      <ol className="space-y-4 p-4">
        <Step n={1} title="The model calls the tool with these params">
          <Json value={t.input} />
        </Step>
        {t.error ? (
          <Step n={2} title="ui.runTool() failed">
            <p className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{t.error}</p>
          </Step>
        ) : (
          <Step n={2} title="ui.runTool() validates them, creates a session and returns a link">
            <Json value={t.result ?? "running…"} />
          </Step>
        )}
        {t.toolResult ? (
          <Step n={3} title="tool_result sent back to the model">
            <Json value={safeParse(t.toolResult)} />
          </Step>
        ) : (
          !t.error && (
            <Step n={3} title="tool_result sent back to the model">
              <p className="text-xs text-muted-foreground">None: the scripted agent doesn't use a model.</p>
            </Step>
          )
        )}
        {!t.error && (
          <Step n={4} title="WhatsApp Cloud API request: the agent's reply with the link as a button">
            {t.whatsapp ? (
              <>
                <p className="mb-1.5 font-mono text-xs text-muted-foreground">{endpoint}</p>
                <Json value={t.whatsapp} />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Waiting for the agent to write its reply…</p>
            )}
          </Step>
        )}
      </ol>
    </article>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1.5 text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Json({ value, label }: { value: unknown; label?: string }) {
  return (
    <div className="mt-1.5">
      {label && <p className="mb-1 font-mono text-[11px] text-muted-foreground">{label}</p>}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

const TICKS = { sending: "🕓", sent: "✓", delivered: "✓✓", read: "✓✓" };

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.from === "user";
  const time = new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] overflow-hidden rounded-lg text-sm shadow-sm ${
          mine
            ? "rounded-tr-none bg-[#d9fdd3] text-neutral-900 dark:bg-[#005c4b] dark:text-neutral-100"
            : "rounded-tl-none bg-white text-neutral-900 dark:bg-[#202c33] dark:text-neutral-100"
        }`}
      >
        <p className="whitespace-pre-wrap px-3 pt-2">{m.text}</p>
        <p className="px-3 pb-1.5 text-right text-[10px] text-neutral-500 dark:text-neutral-400">
          {time}
          {m.delivery && m.delivery.status !== "failed" && (
            <span className={`ml-1 ${m.delivery.status === "read" ? "text-[#53bdeb]" : ""}`} title={m.delivery.status}>
              {TICKS[m.delivery.status]}
            </span>
          )}
        </p>
        {m.delivery?.status === "failed" && (
          <p className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            Not delivered to WhatsApp: {m.delivery.error}
          </p>
        )}
        {m.cta && (
          <a
            href={m.cta.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1.5 border-t border-neutral-200 py-2.5 font-medium text-[#027eb5] hover:bg-neutral-50 dark:border-neutral-700 dark:text-[#53bdeb] dark:hover:bg-[#2a3942]"
          >
            ↗ {m.cta.label}
          </a>
        )}
      </div>
    </div>
  );
}
