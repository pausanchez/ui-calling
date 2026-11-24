export type SessionStatus = "sent" | "opened" | "completed" | "abandoned";

/** One handoff from a conversation to a screen. The URL carries only an opaque token pointing here. */
export type UiSession = {
  id: string;
  conversationId: string;
  /** Who the link was issued for (e.g. a WhatsApp phone number). Resolvers must scope data to it. */
  subject: string;
  surface: string;
  input: Record<string, unknown>;
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
  kind: "lifecycle" | "domain";
  payload: unknown;
  /** Natural-language line, ready to put in the agent's context. */
  description: string;
  wake: boolean;
  at: string;
};

export class UiCallingError extends Error {
  constructor(
    public code: "not_found" | "expired" | "unknown_surface" | "unknown_event" | "invalid_payload",
    message: string,
    public status: 400 | 404 | 410 = code === "not_found" ? 404 : code === "expired" ? 410 : 400,
  ) {
    super(message);
  }
}
