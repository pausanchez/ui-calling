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
import type { AnySurface, SurfaceData, SurfaceEventName, SurfaceEventPayload } from "@ui-calling/core";

type Status = "loading" | "ready" | "expired" | "error";

type ContextValue = {
  status: Status;
  surface?: string;
  /** The session's language; the browser's until the session has loaded. */
  locale: string;
  data: unknown;
  error?: string;
  /** e.g. "upstream_error" when the data source failed: the agent already knows. */
  errorCode?: string;
  emit: (type: string, payload?: unknown) => Promise<void>;
  reportError: (err: unknown, context?: string) => void;
  returnUrl?: string;
};

/** Error thrown by `emit` when the server rejects or fails an event. */
export class SurfaceActionError extends Error {
  constructor(
    message: string,
    public code?: string,
    public retryable = false,
  ) {
    super(message);
  }
}

const SurfaceContext = createContext<ContextValue | null>(null);

/**
 * Loads the session behind `token` and tracks lifecycle automatically:
 * `opened` on load, `left` when the tab is hidden or closed, `opened` again on return
 * (recorded server-side as `returned`).
 */
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

  const emit = useCallback(
    async (type: string, payload: unknown = {}) => {
      const res = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new SurfaceActionError(json.message ?? json.error ?? res.statusText, json.error, json.retryable);
      if (json.data !== undefined && json.data !== null) setState((s) => ({ ...s, data: json.data }));
    },
    [base],
  );

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
        const json = await res.json();
        if (cancelled) return;
        if (res.status === 410) return setState({ status: "expired", error: json.message });
        if (!res.ok) return setState({ status: "error", error: json.message ?? json.error, errorCode: json.error });
        setState({ status: "ready", surface: json.surface, locale: json.locale, data: json.data });
        if (!opened.current) {
          opened.current = true;
          void emit("opened");
        }
      })
      .catch((e) => !cancelled && setState({ status: "error", error: String(e) }));
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
        void emit("opened");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state.status, base, emit]);

  const locale = state.locale ?? (typeof navigator === "undefined" ? "en" : navigator.language);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<ContextValue>(
    () => ({ ...state, locale, data: state.data, emit, reportError, returnUrl: props.returnUrl }),
    [state, locale, emit, reportError, props.returnUrl],
  );
  return (
    <SurfaceContext.Provider value={value}>
      <SurfaceErrorBoundary report={(err, info) => reportError(err, info, "render")} locale={locale} returnUrl={props.returnUrl}>
        {props.children}
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
    reportError: ctx.reportError,
    locale: ctx.locale,
    data: ctx.data as SurfaceData<S> | undefined,
    returnUrl: ctx.returnUrl,
    emit: ctx.emit as <K extends SurfaceEventName<S>>(type: K, payload: SurfaceEventPayload<S, K>) => Promise<void>,
    complete: () => ctx.emit("completed"),
  };
}

/** Which surface a token points to, for routing between several surfaces on one page. */
export function useSurfaceName() {
  const ctx = useContext(SurfaceContext);
  return { status: ctx?.status ?? "loading", surface: ctx?.surface, locale: ctx?.locale, error: ctx?.error };
}
