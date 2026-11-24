import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AnySurface, SurfaceData, SurfaceEventName, SurfaceEventPayload } from "@ui-calling/core";

type Status = "loading" | "ready" | "expired" | "error";

type ContextValue = {
  status: Status;
  surface?: string;
  /** The session's language; the browser's until the session has loaded. */
  locale: string;
  data: unknown;
  error?: string;
  emit: (type: string, payload?: unknown) => Promise<void>;
  returnUrl?: string;
};

const SurfaceContext = createContext<ContextValue | null>(null);

/**
 * Loads the session behind `token` and tracks lifecycle automatically:
 * `opened` on load, `left` when the tab is hidden or closed, `opened` again on return
 * (recorded server-side as `returned`).
 */
export function SurfaceProvider(props: { token: string; endpoint?: string; returnUrl?: string; children: ReactNode }) {
  const base = `${props.endpoint ?? "/api/ui"}/sessions/${encodeURIComponent(props.token)}`;
  const [state, setState] = useState<{ status: Status; surface?: string; locale?: string; data?: unknown; error?: string }>(
    { status: "loading" },
  );
  const opened = useRef(false);

  const emit = useCallback(
    async (type: string, payload: unknown = {}) => {
      const res = await fetch(`${base}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error);
      if (json.data !== undefined && json.data !== null) setState((s) => ({ ...s, data: json.data }));
    },
    [base],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (res.status === 410) return setState({ status: "expired", error: json.message });
        if (!res.ok) return setState({ status: "error", error: json.message ?? json.error });
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
    () => ({ ...state, locale, data: state.data, emit, returnUrl: props.returnUrl }),
    [state, locale, emit, props.returnUrl],
  );
  return <SurfaceContext.Provider value={value}>{props.children}</SurfaceContext.Provider>;
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
