import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type { AnySurface, SurfaceData, SurfaceEventName, SurfaceEventPayload, SurfaceFileSlot, UiFileRef } from "@ui-calling/core";

/**
 * `completed`: the user already finished on this screen, so its link no longer works.
 * `verify`: the surface sets `verify: true` and the user hasn't typed their PIN or code yet; `SurfaceProvider`
 * shows its own step for it (or your `verifyScreen`) instead of the screen.
 */
type Status = "loading" | "verify" | "ready" | "expired" | "completed" | "error";

/** What a `verify` surface asks before showing anything: a PIN the user knows, or a code sent to them. */
export type VerifyPrompt = { kind: "pin" | "code"; attemptsLeft: number };

/** What `verifyScreen` gets to draw your own verify step. */
export type VerifyStepProps = {
  prompt: VerifyPrompt;
  locale: string;
  /** Check what the user typed. Resolves when it's right (the screen then loads); rejects with a `SurfaceActionError`: `reason: "wrong_code"`, or `code: "verification_locked"`. */
  submit: (typed: string) => Promise<void>;
  /** For `kind: "code"`: send a code (again). Resolves with the verifier's hint, e.g. "SMS to •••• 42". */
  sendCode: () => Promise<{ hint?: string }>;
};

type ContextValue = {
  status: Status;
  surface?: string;
  /** The session's language; the browser's until the session has loaded. */
  locale: string;
  data: unknown;
  error?: string;
  /** e.g. "upstream_error" when the data source failed (the agent already knows), "not_found" for a bad
   * link, or "network" when the server couldn't be reached. */
  errorCode?: string;
  /** For `errorCode === "upstream_error"` or `"refused"`: `resolve`'s `SurfaceError` code (e.g. "account_not_linked"). */
  errorReason?: string;
  emit: (type: string, payload?: unknown) => Promise<unknown>;
  reload: () => Promise<void>;
  reportError: (err: unknown, context?: string) => void;
  upload: (slot: string, file: File) => Promise<UiFileRef>;
  removeFile: (id: string) => Promise<void>;
  fileUrl: (id: string) => string;
  returnUrl?: string;
};

/**
 * Error thrown by `emit` and `reload`. For `code === "upstream_error"`, `reason` is the server's
 * `SurfaceError` code (e.g. "shift_full"): map it to a message in the user's language.
 * `retryable` says whether trying the same thing again can work; `code === "network"` always is.
 */
export class SurfaceActionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public retryable = false,
    public reason?: string,
  ) {
    super(message);
  }
}

const SurfaceContext = createContext<ContextValue | null>(null);

/**
 * Loads the session behind `token` and tracks lifecycle automatically:
 * `opened` on load, `left` when the tab is hidden or closed, `opened` again on return
 * (recorded server-side as `returned`). After `complete()` the link is closed: a tab left open
 * switches to `status: "completed"` as soon as it's used again.
 */
/** A mouse, not a touch screen: the chat is in another tab of this browser, not an app to switch back to. */
function onComputer() {
  return typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
}

function CloseTabHint({ locale }: { locale: string }) {
  const text = locale.toLowerCase().startsWith("es")
    ? "Ya está. Cierra esta pestaña para volver al chat."
    : "All done. Close this tab to go back to the chat.";
  return (
    <p
      role="status"
      style={{
        position: "fixed",
        insetInline: 16,
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        margin: "0 auto",
        maxWidth: 420,
        padding: "12px 16px",
        borderRadius: 8,
        background: "var(--foreground, #111)",
        color: "var(--background, #fff)",
        fontSize: 14,
        textAlign: "center",
        zIndex: 50,
      }}
    >
      {text}
    </p>
  );
}

export function SurfaceProvider(props: {
  token: string;
  endpoint?: string;
  returnUrl?: string;
  /** Your own verify step for `verify` surfaces. Without it, a plain one in the user's language (en/es) styled with your tokens. */
  verifyScreen?: (props: VerifyStepProps) => ReactNode;
  children: ReactNode;
}) {
  const base = `${props.endpoint ?? "/api/ui"}/sessions/${encodeURIComponent(props.token)}`;
  const [state, setState] = useState<{
    status: Status;
    surface?: string;
    locale?: string;
    data?: unknown;
    error?: string;
    errorCode?: string;
    errorReason?: string;
    verify?: VerifyPrompt;
  }>({ status: "loading" });
  const opened = useRef(false);

  /** Every request after the first load: turns failures into `SurfaceActionError`s, and notices a closed link. */
  const send = useCallback(async (url: string, init: RequestInit) => {
    const res = await fetch(url, init).catch(() => {
      throw new SurfaceActionError("Couldn't reach the server", "network", true);
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === "completed") setState((s) => ({ status: "completed", locale: s.locale }));
      throw new SurfaceActionError(json.message ?? json.error ?? res.statusText, json.error, json.retryable, json.reason);
    }
    return json;
  }, []);

  const emit = useCallback(
    async (type: string, payload: unknown = {}) => {
      const json = await send(`${base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
        // `complete()` usually runs as the user follows "Back to chat": let it finish after the page goes.
        keepalive: true,
      });
      // The link is closed now: show the "done" screen if the user is still here.
      if (type === "completed") {
        setState((s) => ({ status: "completed", locale: s.locale }));
        return undefined;
      }
      if (json.data !== undefined && json.data !== null) setState((s) => ({ ...s, data: json.data }));
      // Also returned, so the caller can show the outcome of *this* action (a new ticket number) right away.
      return json.data ?? undefined;
    },
    [base, send],
  );

  /** Upload into one of the contract's file slots. Rejections are `invalid_file`, with `reason` e.g. "file_too_large". */
  const upload = useCallback(
    async (slot: string, file: File) => {
      const body = new FormData();
      body.append("file", file);
      const json = await send(`${base}/files/${encodeURIComponent(slot)}`, { method: "POST", body });
      return json.file as UiFileRef;
    },
    [base, send],
  );
  const removeFile = useCallback(
    async (id: string) => void (await send(`${base}/files/${encodeURIComponent(id)}`, { method: "DELETE" })),
    [base, send],
  );
  /** Where to show an uploaded file, e.g. as an <img> src. Only works through this link. */
  const fileUrl = useCallback((id: string) => `${base}/files/${encodeURIComponent(id)}`, [base]);

  /** Fetch fresh data, e.g. after a failed action when what's on screen may be stale. */
  const reload = useCallback(async () => {
    const json = await send(base, {});
    setState((s) => ({ ...s, data: json.data }));
  }, [base, send]);

  /**
   * Tell the agent something failed on the screen, e.g. a third-party API called from the browser.
   * Server-side failures (in `resolve` or event handlers) are reported automatically.
   */
  const reportError = useCallback(
    (err: unknown, context?: string, source: "client" | "render" = "client") => {
      const e = err as { name?: string; code?: unknown; message?: unknown; retryable?: unknown };
      const payload = {
        source,
        code: String(typeof e?.code === "string" ? e.code : (e?.name ?? "client_error")).slice(0, 60),
        message: String(e?.message ?? err).slice(0, 500),
        retryable: e?.retryable === true,
        context: context?.slice(0, 200),
      };
      void emit("error", payload).catch(() => {});
    },
    [emit],
  );

  /** The data is in: show the screen, and record `opened` once (a verify surface only gets here after the PIN). */
  const ready = useCallback(
    (json: { surface: string; locale: string; data: unknown }) => {
      setState({ status: "ready", surface: json.surface, locale: json.locale, data: json.data });
      if (!opened.current) {
        opened.current = true;
        void emit("opened").catch(() => {});
      }
    },
    [emit],
  );

  const submitVerify = useCallback(
    async (typed: string) => {
      try {
        ready(await send(`${base}/verify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: typed }) }));
      } catch (err) {
        if (err instanceof SurfaceActionError && err.reason === "wrong_code") {
          setState((s) => (s.verify ? { ...s, verify: { ...s.verify, attemptsLeft: Math.max(0, s.verify.attemptsLeft - 1) } } : s));
        }
        throw err;
      }
    },
    [base, send, ready],
  );
  const sendCode = useCallback(async () => (await send(`${base}/verify/send`, { method: "POST" })) as { hint?: string }, [base, send]);

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then(async (res) => {
        // A proxy or host error page isn't JSON: treat it like an unreachable server.
        const json = await res.json().catch(() => ({ error: "network" }));
        if (cancelled) return;
        // Errors for a known link carry its surface and language, so the screen can explain in the user's words.
        const { locale } = json;
        if (json.error === "completed") return setState({ status: "completed", locale });
        if (res.status === 410) return setState({ status: "expired", locale, error: json.message });
        if (!res.ok) {
          const errorCode = res.status >= 500 && !json.surface ? "network" : (json.error ?? "network");
          return setState({ status: "error", surface: json.surface, locale, error: json.message ?? json.error, errorCode, errorReason: json.reason });
        }
        if (json.verify) return setState({ status: "verify", surface: json.surface, locale: json.locale, verify: json.verify });
        ready(json);
      })
      .catch((e) => !cancelled && setState({ status: "error", error: String(e), errorCode: "network" }));
    return () => {
      cancelled = true;
    };
  }, [base, ready]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        // sendBeacon survives the tab closing; fetch might not.
        const blob = new Blob([JSON.stringify({ type: "left", payload: {} })], { type: "application/json" });
        navigator.sendBeacon(`${base}/events`, blob);
      } else {
        // Fails once the session is completed; emit has already switched the screen.
        void emit("opened").catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state.status, base, emit]);

  const locale = state.locale ?? (typeof navigator === "undefined" ? "en" : navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // "Back to chat" on a computer, when the screen opened in a tab of its own: the chat (WhatsApp Web, a web chat)
  // is still open in the tab it came from, and following a wa.me link there lands on WhatsApp's "open the app"
  // page. So close this tab instead, whichever link points at returnUrl. A screen opened in the chat's own tab
  // follows the link back, as phones do. A new tab starts with one history entry; read it before steps add more.
  const [ownTab] = useState(() => typeof window !== "undefined" && (window.history.length <= 1 || Boolean(window.opener)));
  const [closeHint, setCloseHint] = useState(false);
  useEffect(() => {
    const target = props.returnUrl;
    if (!target || !ownTab) return;
    const onClick = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a");
      if (!link || link.getAttribute("href") !== target || !onComputer()) return;
      e.preventDefault(); // the link's own onClick (e.g. complete()) still runs
      window.close();
      // Browsers only let a script close a tab with a single history entry (screens with steps add more).
      setTimeout(() => !window.closed && setCloseHint(true), 300);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [props.returnUrl, ownTab]);

  const value = useMemo<ContextValue>(
    () => ({ ...state, locale, data: state.data, emit, reload, reportError, upload, removeFile, fileUrl, returnUrl: props.returnUrl }),
    [state, locale, emit, reload, reportError, upload, removeFile, fileUrl, props.returnUrl],
  );
  return (
    <SurfaceContext.Provider value={value}>
      <SurfaceErrorBoundary report={(err, info) => reportError(err, info, "render")} locale={locale} returnUrl={props.returnUrl}>
        {state.status === "verify" && state.verify
          ? (props.verifyScreen ?? ((p: VerifyStepProps) => <VerifyStep {...p} />))({ prompt: state.verify, locale, submit: submitVerify, sendCode })
          : props.children}
        {closeHint && <CloseTabHint locale={locale} />}
      </SurfaceErrorBoundary>
    </SurfaceContext.Provider>
  );
}

const VERIFY_TEXT = {
  en: {
    pinTitle: "Enter your PIN",
    pinHelp: "This screen has personal details. Enter your PIN to see them.",
    codeTitle: "Enter the code we sent you",
    codeHelp: "This screen has personal details. We've sent you a code to check it's you.",
    label: "PIN or code",
    submit: "Continue",
    resend: "Send a new code",
    wrong: (n: number) => (n === 1 ? "That's not right. You have 1 try left." : `That's not right. You have ${n} tries left.`),
    locked: "Too many wrong tries. Go back to the chat to ask for help.",
    noCode: "We couldn't send a code. Go back to the chat to ask for help.",
    failed: "Something went wrong. Check your connection and try again.",
  },
  es: {
    pinTitle: "Introduce tu PIN",
    pinHelp: "Esta pantalla tiene datos personales. Introduce tu PIN para verlos.",
    codeTitle: "Introduce el código que te hemos enviado",
    codeHelp: "Esta pantalla tiene datos personales. Te hemos enviado un código para comprobar que eres tú.",
    label: "PIN o código",
    submit: "Continuar",
    resend: "Enviar otro código",
    wrong: (n: number) => (n === 1 ? "No es correcto. Te queda 1 intento." : `No es correcto. Te quedan ${n} intentos.`),
    locked: "Demasiados intentos. Vuelve al chat para pedir ayuda.",
    noCode: "No hemos podido enviarte un código. Vuelve al chat para pedir ayuda.",
    failed: "Algo ha fallado. Comprueba tu conexión e inténtalo de nuevo.",
  },
};

/** The built-in verify step: one field, big enough to tap, in the user's language. Wrap it in your `verifyScreen` to add to it. */
export function VerifyStep({ prompt, locale, submit, sendCode, note }: VerifyStepProps & { note?: ReactNode }) {
  const t = VERIFY_TEXT[locale.toLowerCase().startsWith("es") ? "es" : "en"];
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>(prompt.attemptsLeft <= 0 ? t.locked : undefined);
  const [hint, setHint] = useState<string>();
  const [locked, setLocked] = useState(prompt.attemptsLeft <= 0);
  const sent = useRef(false);
  const requestCode = useCallback(() => {
    sendCode().then(
      (r) => setHint(r.hint),
      (err: SurfaceActionError) => setMessage(err.code === "network" ? t.failed : t.noCode),
    );
  }, [sendCode, t]);
  // A code is sent once, when the step first shows; a reload within the same link sends another (at most 3).
  useEffect(() => {
    if (prompt.kind === "code" && !sent.current && prompt.attemptsLeft > 0) {
      sent.current = true;
      requestCode();
    }
  }, [prompt.kind, requestCode]);

  const onSubmit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!typed.trim() || busy) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await submit(typed);
    } catch (err) {
      const a = err as SurfaceActionError;
      if (a.code === "verification_locked") {
        setLocked(true);
        setMessage(t.locked);
      } else setMessage(a.reason === "wrong_code" ? t.wrong(Math.max(0, prompt.attemptsLeft - 1)) : t.failed);
      setTyped("");
    } finally {
      setBusy(false);
    }
  };

  const field = { width: "100%", boxSizing: "border-box", minHeight: 48, padding: "10px 12px", fontSize: 20, letterSpacing: 4, textAlign: "center", borderRadius: 8, border: "1px solid var(--border, #ccc)", background: "var(--background, #fff)", color: "var(--foreground, #111)" } as const;
  return (
    <main style={{ minHeight: "100dvh", maxWidth: 420, margin: "0 auto", padding: "32px 16px", fontFamily: "inherit", color: "var(--foreground, #111)" }}>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{prompt.kind === "pin" ? t.pinTitle : t.codeTitle}</h1>
        <p style={{ margin: 0, color: "var(--muted-foreground, #555)" }}>
          {prompt.kind === "pin" ? t.pinHelp : t.codeHelp}
          {hint && <> ({hint})</>}
        </p>
        <input
          aria-label={t.label}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          inputMode="numeric"
          autoComplete={prompt.kind === "code" ? "one-time-code" : "off"}
          type={prompt.kind === "pin" ? "password" : "text"}
          maxLength={12}
          autoFocus
          disabled={locked}
          style={field}
        />
        {message && (
          <p role="alert" style={{ margin: 0, color: "var(--destructive, #b42318)" }}>
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || locked || !typed.trim()}
          style={{ minHeight: 48, borderRadius: 8, border: 0, fontSize: 16, fontWeight: 600, background: "var(--primary, #111)", color: "var(--primary-foreground, #fff)", opacity: busy || locked || !typed.trim() ? 0.6 : 1 }}
        >
          {t.submit}
        </button>
        {prompt.kind === "code" && !locked && (
          <button type="button" onClick={requestCode} style={{ minHeight: 44, border: 0, background: "none", color: "var(--primary, #111)", fontSize: 15, textDecoration: "underline" }}>
            {t.resend}
          </button>
        )}
        {note}
      </form>
    </main>
  );
}

const CRASH_TEXT: Record<string, [string, string]> = {
  en: ["Something went wrong on this page", "Your assistant has been notified. You can go back to the chat."],
  es: ["Algo ha fallado en esta página", "Tu asistente ya lo sabe. Puedes volver al chat."],
};

/** Reports render crashes to the agent and shows a minimal fallback instead of a blank page. */
class SurfaceErrorBoundary extends Component<
  { children: ReactNode; report: (err: unknown, where?: string) => void; locale: string; returnUrl?: string },
  { crashed: boolean }
> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const where = info.componentStack?.trim().split("\n")[0]?.trim();
    this.props.report(error, where ? `rendering ${where}` : "rendering the screen");
  }

  render() {
    if (!this.state.crashed) return this.props.children;
    const [title, body] = CRASH_TEXT[this.props.locale.split("-")[0]] ?? CRASH_TEXT.en;
    return (
      <div role="alert" style={{ padding: 24, maxWidth: 420, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ fontWeight: 600, margin: 0 }}>{title}</p>
        <p style={{ margin: "6px 0 0", opacity: 0.7 }}>{body}</p>
        {this.props.returnUrl && (
          <a href={this.props.returnUrl} style={{ display: "inline-block", marginTop: 12 }}>
            ←
          </a>
        )}
      </div>
    );
  }
}

/** Typed access to a surface's data and events. */
export function useSurface<S extends AnySurface>(surface: S) {
  const ctx = useContext(SurfaceContext);
  if (!ctx) throw new Error("useSurface must be used inside <SurfaceProvider>");
  if (ctx.surface && ctx.surface !== surface.name) {
    throw new Error(`This link is for "${ctx.surface}", not "${surface.name}"`);
  }
  return {
    status: ctx.status,
    error: ctx.error,
    errorCode: ctx.errorCode,
    errorReason: ctx.errorReason,
    reload: ctx.reload,
    reportError: ctx.reportError,
    locale: ctx.locale,
    data: ctx.data as SurfaceData<S> | undefined,
    returnUrl: ctx.returnUrl,
    /** Report an event. Resolves with the screen's fresh data when the handler returned some (else undefined). */
    emit: ctx.emit as <K extends SurfaceEventName<S>>(type: K, payload: SurfaceEventPayload<S, K>) => Promise<SurfaceData<S> | undefined>,
    complete: () => ctx.emit("completed").then(() => undefined),
    upload: ctx.upload as (slot: SurfaceFileSlot<S>, file: File) => Promise<UiFileRef>,
    removeFile: ctx.removeFile,
    fileUrl: ctx.fileUrl,
  };
}

/** The link's state (status, surface, locale, errorCode, errorReason, returnUrl), before you know which screen it is: for routing between surfaces on one page. */
export function useSurfaceSession() {
  const ctx = useContext(SurfaceContext);
  return {
    status: ctx?.status ?? "loading",
    surface: ctx?.surface,
    locale: ctx?.locale,
    error: ctx?.error,
    errorCode: ctx?.errorCode,
    errorReason: ctx?.errorReason,
    returnUrl: ctx?.returnUrl,
  };
}

/** @deprecated Renamed to `useSurfaceSession`: it returns the link's whole state, not just a name. */
export const useSurfaceName = useSurfaceSession;

/**
 * The steps of a screen with several steps, kept in the browser's history so the phone's back button
 * goes to the previous step instead of closing the screen.
 *
 * - `steps` is the path the user will see now (leave out steps that don't apply). If the current step
 *   drops out of it, the step that took its place is shown.
 * - `initial` is where to start, usually the furthest step saved in your draft (`data.draft.step`).
 * - After a reload the step comes back from history. Opened fresh on a later step, the earlier steps are
 *   added behind it, so Back goes to them.
 *
 *   const { step, index, count, go, next, back } = useSurfaceSteps(path, { initial: data.draft.step });
 */
export function useSurfaceSteps<S extends string>(steps: readonly S[], options: { initial: S; key?: string }) {
  const key = options.key ?? "uiCallingStep";
  // The step, and where it sat in the path: if the step drops out of the path, its place is shown instead.
  const [pos, setPos] = useState(() => {
    const restored = typeof window === "undefined" ? undefined : historyStep<S>(key);
    const step = restored ?? options.initial;
    return { step, index: Math.max(0, steps.indexOf(step)) };
  });
  const found = steps.indexOf(pos.step);
  const index = found === -1 ? Math.min(pos.index, steps.length - 1) : found;
  const step = steps[index];

  const path = useRef(steps);
  useEffect(() => {
    path.current = steps;
  });
  // Where the screen opened, for the mount effect below (only read there).
  const opened = useRef(index);
  useEffect(() => {
    if (!historyStep(key)) {
      const at = opened.current;
      window.history.replaceState({ ...window.history.state, [key]: path.current[0] }, "");
      for (const s of path.current.slice(1, at + 1)) window.history.pushState({ ...window.history.state, [key]: s }, "");
    }
    const onPop = () => {
      const s = historyStep<S>(key);
      if (!s) return;
      // A step that no longer applies (say, photos after the reason changed) gives way to the one before it.
      const found = path.current.indexOf(s);
      setPos((prev) => ({ step: s, index: found === -1 ? Math.max(0, prev.index - 1) : found }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [key]);

  const go = useCallback(
    (to: S) => {
      setPos({ step: to, index: Math.max(0, path.current.indexOf(to)) });
      window.history.pushState({ ...window.history.state, [key]: to }, "");
    },
    [key],
  );

  return {
    step,
    index,
    count: steps.length,
    isFirst: index === 0,
    isLast: index === steps.length - 1,
    /** Show a step and add it to history. */
    go,
    next: () => {
      if (index < steps.length - 1) go(steps[index + 1]);
    },
    /** Like the phone's back button: the previous step in history. */
    back: () => {
      if (index > 0) window.history.back();
    },
  };
}

function historyStep<S extends string>(key: string) {
  return (window.history.state as Record<string, unknown> | null)?.[key] as S | undefined;
}
