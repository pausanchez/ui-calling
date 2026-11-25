export type SessionStatus = "sent" | "opened" | "completed" | "abandoned";

/** One handoff from a conversation to a screen. The URL carries only an opaque token pointing here. */
export type UiSession = {
  id: string;
  conversationId: string;
  /** Who the link was issued for (e.g. a WhatsApp phone number). Resolvers must scope data to it. */
  subject: string;
  surface: string;
  input: Record<string, unknown>;
  /** BCP 47 language the screen renders in, chosen by the agent from the conversation. */
  locale: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  openedAt?: string;
};

export const LIFECYCLE_EVENTS = ["opened", "returned", "left", "completed", "abandoned"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** An event as recorded and handed to the agent. */
export type UiEvent = {
  id: string;
  sessionId: string;
  conversationId: string;
  surface: string;
  type: string;
  kind: "lifecycle" | "domain" | "error";
  payload: unknown;
  /** Natural-language line, ready to put in the agent's context. */
  description: string;
  /**
   * What the screen showed right after this event (via the surface's `summarize`):
   * what the user saw on `opened`, the outcome of an action (ticket number, new date…).
   * Lets the agent talk about results it didn't produce itself.
   */
  state?: string;
  wake: boolean;
  at: string;
};

export class UiCallingError extends Error {
  constructor(
    public code:
      | "not_found"
      | "expired"
      | "completed"
      | "unknown_surface"
      | "unknown_event"
      | "invalid_payload"
      | "upstream_error"
      | "too_many_events",
    message: string,
    public status: 400 | 404 | 410 | 429 | 502 = code === "not_found"
      ? 404
      : code === "expired" || code === "completed"
        ? 410
        : code === "upstream_error"
          ? 502
          : code === "too_many_events"
            ? 429
            : 400,
    public retryable = false,
    /** For `upstream_error`: the `SurfaceError` code (e.g. "shift_full"), so the screen can explain it in the user's language. */
    public reason?: string,
  ) {
    super(message);
  }
}

/**
 * Throw from `resolve` or an event handler when a dependency fails (a third-party API, a database…).
 * The code and message reach the agent, so keep them free of secrets and stack traces.
 */
export class SurfaceError extends Error {
  constructor(
    public code: string,
    message: string,
    public options: { retryable?: boolean } = {},
  ) {
    super(message);
  }
}

/** Where a failure happened, as reported to the agent. */
export type ErrorSource = "load" | "action" | "client" | "render";
