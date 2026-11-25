import type { SessionStatus, UiEvent, UiFile, UiSession } from "./types";

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
  /**
   * Optional, all four together: needed only by surfaces that declare `files`. Bytes can live elsewhere
   * (e.g. object storage) as long as `getFile` returns them. `listFiles` returns a session's files in upload order.
   */
  putFile?(file: UiFile, bytes: Uint8Array): Promise<void>;
  getFile?(id: string): Promise<{ file: UiFile; bytes: Uint8Array } | undefined>;
  listFiles?(sessionId: string): Promise<UiFile[]>;
  deleteFile?(id: string): Promise<void>;
  /**
   * Optional: delete matching sessions with their events and files, for a deletion request or a retention
   * policy. `ui.forget(...)` needs it. Returns how many of each it deleted.
   */
  forget?(filter: ForgetFilter): Promise<ForgetResult>;
}

/** Which sessions to forget. Give exactly one. */
export type ForgetFilter =
  | { conversationId: string }
  | { subject: string }
  /** Sessions whose link expired before this ISO time (and the user is done with them). */
  | { expiredBefore: string };

export type ForgetResult = { sessions: number; events: number; files: number };

/** Whether a session matches a forget filter. Stores can use it to stay consistent with each other. */
export function matchesForget(session: UiSession, filter: ForgetFilter): boolean {
  if ("conversationId" in filter) return session.conversationId === filter.conversationId;
  if ("subject" in filter) return session.subject === filter.subject;
  return session.expiresAt < filter.expiredBefore;
}

export class MemoryStore implements UiStore {
  private sessions = new Map<string, UiSession>();
  private byToken = new Map<string, string>();
  private events: UiEvent[] = [];
  private files = new Map<string, { file: UiFile; bytes: Uint8Array }>();

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

  async putFile(file: UiFile, bytes: Uint8Array) {
    this.files.set(file.id, { file, bytes });
  }

  async getFile(id: string) {
    return this.files.get(id);
  }

  async listFiles(sessionId: string) {
    return [...this.files.values()].map((f) => f.file).filter((f) => f.sessionId === sessionId);
  }

  async deleteFile(id: string) {
    this.files.delete(id);
  }

  async forget(filter: ForgetFilter) {
    const ids = new Set([...this.sessions.values()].filter((s) => matchesForget(s, filter)).map((s) => s.id));
    const before = { events: this.events.length, files: this.files.size };
    for (const id of ids) this.sessions.delete(id);
    for (const [hash, id] of this.byToken) if (ids.has(id)) this.byToken.delete(hash);
    this.events = this.events.filter((e) => !ids.has(e.sessionId));
    for (const [id, f] of this.files) if (ids.has(f.file.sessionId)) this.files.delete(id);
    return { sessions: ids.size, events: before.events - this.events.length, files: before.files - this.files.size };
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
