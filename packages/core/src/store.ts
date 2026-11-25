import type { SessionStatus, UiEvent, UiSession } from "./types";

/**
 * Which events `listEvents` returns. `after` is the ID of an event already read: only events appended
 * after it come back, so an agent can catch up without re-reading the whole conversation. A store must
 * honor it, and must throw if no event has that ID: returning everything again would duplicate context
 * without anyone noticing.
 */
export type EventQuery = { conversationId?: string; sessionId?: string; after?: string; limit?: number };

/** Thrown by `listEvents` when `after` isn't the ID of a stored event. */
export class UnknownEventError extends Error {
  constructor(public eventId: string) {
    super(`No event with id "${eventId}" to list events after`);
  }
}

/**
 * Persistence for sessions and events. The in-memory default loses everything on restart;
 * use `sqliteStore()` from @ui-calling/sqlite, or implement this for your database.
 */
export interface UiStore {
  createSession(session: UiSession, tokenHash: string): Promise<void>;
  getSessionByTokenHash(tokenHash: string): Promise<UiSession | undefined>;
  getSession(id: string): Promise<UiSession | undefined>;
  updateSession(id: string, patch: Partial<UiSession>): Promise<void>;
  /** Events come back from `listEvents` in the order they were appended. */
  appendEvent(event: UiEvent): Promise<void>;
  /** Matching events in append order: only those after `query.after`, and at most `query.limit`. */
  listEvents(query: EventQuery): Promise<UiEvent[]>;
  /** Optional. Lets the runtime re-arm abandon timers for screens left open across a restart. */
  listSessions?(query: { status?: SessionStatus }): Promise<UiSession[]>;
}

export class MemoryStore implements UiStore {
  private sessions = new Map<string, UiSession>();
  private byToken = new Map<string, string>();
  private events: UiEvent[] = [];

  async createSession(session: UiSession, tokenHash: string) {
    this.sessions.set(session.id, session);
    this.byToken.set(tokenHash, session.id);
  }

  async getSessionByTokenHash(tokenHash: string) {
    const id = this.byToken.get(tokenHash);
    return id ? this.sessions.get(id) : undefined;
  }

  async getSession(id: string) {
    return this.sessions.get(id);
  }

  async updateSession(id: string, patch: Partial<UiSession>) {
    const s = this.sessions.get(id);
    if (s) this.sessions.set(id, { ...s, ...patch });
  }

  async appendEvent(event: UiEvent) {
    this.events.push(event);
  }

  async listSessions({ status }: { status?: SessionStatus }) {
    return [...this.sessions.values()].filter((s) => !status || s.status === status);
  }

  async listEvents({ conversationId, sessionId, after, limit }: EventQuery) {
    let from = 0;
    if (after !== undefined) {
      from = this.events.findIndex((e) => e.id === after) + 1;
      if (from === 0) throw new UnknownEventError(after);
    }
    const matching = this.events
      .slice(from)
      .filter((e) => (!conversationId || e.conversationId === conversationId) && (!sessionId || e.sessionId === sessionId));
    return limit === undefined ? matching : matching.slice(0, limit);
  }
}
