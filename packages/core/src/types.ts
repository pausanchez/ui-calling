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
  /** For `bindToDevice` surfaces: the hash of the secret the first browser to open the link got as a cookie. */
  deviceHash?: string;
  /** For `verify` surfaces: when the user proved who they are on this link. */
  verifiedAt?: string;
  /** For `verify` surfaces: wrong PINs or codes typed on this link. */
  verifyFailures?: number;
  /** For `verify` surfaces: codes sent for this link. */
  verifySends?: number;
};

/** A file uploaded from a screen. Its bytes live in the store; events and the agent only see this. */
export type UiFile = {
  id: string;
  sessionId: string;
  /** The contract's file slot it was uploaded into, e.g. "photos". */
  slot: string;
  name: string;
  /** MIME type, checked against the slot's `accept`. */
  type: string;
  size: number;
  at: string;
};

/** What the screen gets back for an upload, and what a handler's `ctx.files()` lists. */
export type UiFileRef = Pick<UiFile, "id" | "slot" | "name" | "type" | "size">;

export const LIFECYCLE_EVENTS = ["opened", "returned", "left", "completed", "abandoned"] as const;
export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

/** An event as recorded and handed to the agent. */
export type UiEvent = {
  id: string;
  sessionId: string;
  conversationId: string;
  /** Who the link was issued for: pass it back as `who` when a woken turn runs the tools. */
  subject: string;
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
  /** False when the event's definition leaves its payload out of what the agent reads (`includePayload: false`). */
  payloadForAgent?: boolean;
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
      | "too_many_events"
      | "invalid_file"
      | "refused"
      | "other_device"
      | "verification_required"
      | "verification_locked"
      | "in_progress",
    message: string,
    public status: 400 | 403 | 404 | 409 | 410 | 422 | 429 | 502 = code === "not_found"
      ? 404
      : code === "other_device" || code === "verification_required" || code === "verification_locked"
        ? 403
      : code === "expired" || code === "completed"
        ? 410
        : code === "upstream_error"
          ? 502
          : code === "refused"
            ? 422
            : code === "too_many_events"
              ? 429
              : code === "in_progress"
                ? 409
                : 400,
    public retryable = false,
    /** For `upstream_error` and `refused`: the `SurfaceError` code (e.g. "shift_full"), so the screen can explain it in the user's language. */
    public reason?: string,
  ) {
    super(message);
  }
  /** Set once the link is known, so the screen can pick the right surface and language for the error. */
  surface?: string;
  locale?: string;
}

/**
 * Throw from `resolve` or an event handler when a dependency fails (a third-party API, a database…).
 * The code and message reach the agent, so keep them free of secrets and stack traces.
 */
export class SurfaceError extends Error {
  constructor(
    public code: string,
    message: string,
    public options: {
      retryable?: boolean;
      /**
       * A business refusal (the shift filled up, the code was wrong), not an outage: the screen gets 422 `refused`
       * instead of 502 `upstream_error`, so monitoring doesn't read it as your back office being down.
       */
      refused?: boolean;
    } = {},
  ) {
    super(message);
  }
}

/** Where a failure happened, as reported to the agent. "partial": `ctx.reportError` (the screen loaded without a part). */
export type ErrorSource = "load" | "partial" | "action" | "client" | "render";
