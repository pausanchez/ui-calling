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

/** `completed`: the user already finished on this screen, so its link no longer works. */
type Status = "loading" | "ready" | "expired" | "completed" | "error";

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

export function SurfaceProvider(props: { token: string; endpoint?: string; returnUrl?: string; children: ReactNode }) {
  const base = `${props.endpoint ?? "/api/ui"}/sessions/${encodeURIComponent(props.token)}`;
  const [state, setState] = useState<{
    status: Status;
    surface?: string;
    locale?: string;
    data?: unknown;
    error?: string;
    errorCode?: string;
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
          return setState({ status: "error", surface: json.surface, locale, error: json.message ?? json.error, errorCode });
        }
        setState({ status: "ready", surface: json.surface, locale: json.locale, data: json.data });
        if (!opened.current) {
          opened.current = true;
          void emit("opened").catch(() => {});
        }
      })
      .catch((e) => !cancelled && setState({ status: "error", error: String(e), errorCode: "network" }));
    return () => {
      cancelled = true;
    };
  }, [base, emit]);

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

  // "Back to chat" on a computer: the chat (WhatsApp Web, a web chat) is still open in the tab the screen came
  // from, and following a wa.me link there lands on WhatsApp's "open the app" page. So close this tab instead,
  // whichever link points at returnUrl. Phones follow the link back into the app as before.
  const [closeHint, setCloseHint] = useState(false);
  useEffect(() => {
    const target = props.returnUrl;
    if (!target) return;
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
  }, [props.returnUrl]);

  const value = useMemo<ContextValue>(
    () => ({ ...state, locale, data: state.data, emit, reload, reportError, upload, removeFile, fileUrl, returnUrl: props.returnUrl }),
    [state, locale, emit, reload, reportError, upload, removeFile, fileUrl, props.returnUrl],
  );
  return (
    <SurfaceContext.Provider value={value}>
      <SurfaceErrorBoundary report={(err, info) => reportError(err, info, "render")} locale={locale} returnUrl={props.returnUrl}>
        {props.children}
        {closeHint && <CloseTabHint locale={locale} />}
      </SurfaceErrorBoundary>
    </SurfaceContext.Provider>
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

/** Which surface a token points to, for routing between several surfaces on one page. */
export function useSurfaceName() {
  const ctx = useContext(SurfaceContext);
  return {
    status: ctx?.status ?? "loading",
    surface: ctx?.surface,
    locale: ctx?.locale,
    error: ctx?.error,
    errorCode: ctx?.errorCode,
    returnUrl: ctx?.returnUrl,
  };
}

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
