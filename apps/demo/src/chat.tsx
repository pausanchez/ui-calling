import { useEffect, useRef, useState } from "react";
import type { UiEvent } from "@ui-calling/core";
import type { ChatMessage } from "../server/agent";

type State = { mode: "claude" | "scripted"; chat: ChatMessage[]; timeline: UiEvent[]; typing: boolean };

const SUGGESTIONS = ["¿Dónde está mi pedido?", "Can I change the delivery day?", "¿Hay turnos libres esta semana?"];
const NO_FAILURES = { ordersApi: false, carrierApi: false, schedulingApi: false };

export function Chat() {
  const [state, setState] = useState<State | null>(null);
  const [text, setText] = useState("");
  const [failures, setFailures] = useState(NO_FAILURES);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/demo/failures")
      .then((r) => r.json())
      .then(setFailures)
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

  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/chat")
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
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]">WhatsApp · simulated</span>
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

          {state && state.chat.length === 0 && (
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
              <h1 className="text-xl font-semibold tracking-tight">What the agent knows</h1>
              <p className="text-sm text-muted-foreground">
                Semantic events reported by the screens. <b>Wake</b> events start an agent turn on their own.
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
            <span className="text-muted-foreground">Simulate failures:</span>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.ordersApi} onChange={() => toggleFailure("ordersApi")} />
              Orders API down (page won't load)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.carrierApi} onChange={() => toggleFailure("carrierApi")} />
              Carrier API timeout (reschedule fails)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={failures.schedulingApi} onChange={() => toggleFailure("schedulingApi")} />
              Scheduling system down (shifts won't load or book)
            </label>
          </div>

          <div className="rounded-lg border border-border bg-card">
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
        </section>
      </div>
    </div>
  );
}

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
        <p className="px-3 pb-1.5 text-right text-[10px] text-neutral-500 dark:text-neutral-400">{time}</p>
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
