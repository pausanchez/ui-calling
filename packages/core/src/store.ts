import type { SessionStatus, UiEvent, UiFile, UiSession } from "./types";

/**
 * Which events `listEvents` returns. `after` is the ID of an event already read: only events appended
 * after it come back, so an agent can catch up without re-reading the whole conversation. A store must
 * honor it, and must throw if no event has that ID: returning everything again would duplicate context
 * without anyone noticing.
 */
export type EventQuery = { conversationId?: string; sessionId?: string; after?: string; limit?: number };

/** Which of a session's events `countEvents` counts: all of them, or only those of a kind, a wake flag, at or after `since` (ISO). */
export type CountQuery = { sessionId: string; kind?: UiEvent["kind"]; wake?: boolean; since?: string };

/** Whether an event matches a count query. Stores can use it to stay consistent with each other. */
export function matchesCount(event: UiEvent, q: CountQuery): boolean {
  return (
    event.sessionId === q.sessionId &&
    (q.kind === undefined || event.kind === q.kind) &&
    (q.wake === undefined || event.wake === q.wake) &&
    (q.since === undefined || event.at >= q.since)
  );
}

/**
 * What `claimEventKey` found for a screen's idempotency key: no one had it (`claimed`, run the action), another
 * request is still running it (`running`), or it already ran (`done`, with the event it recorded, if any).
 */
export type EventKeyClaim = { status: "claimed" } | { status: "running" } | { status: "done"; eventId?: string };

/** Thrown by `listEvents` when `after` isn't the ID of a stored event. */
export class UnknownEventError extends Error {
  constructor(public eventId: string) {
    super(`No event with id "${eventId}" to list events after`);
  }
}

/** Thrown by `ui.turn()` when another turn held the conversation for longer than `waitMs`. */
export class TurnBusyError extends Error {
  constructor(public conversationId: string) {
    super(`Another agent turn is still running for conversation "${conversationId}"`);
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
  /**
   * Optional, and needed for several instances: apply `patch` only if the session's status is still `status`,
   * atomically, and return whether it did. The runtime uses it so two tabs or two instances can't both record
   * the first `opened`, or both mark a screen `abandoned`. Without it, the runtime reads, then writes.
   */
  updateSessionIf?(id: string, status: SessionStatus, patch: Partial<UiSession>): Promise<boolean>;
  /** Events come back from `listEvents` in the order they were appended. */
  appendEvent(event: UiEvent): Promise<void>;
  /** Matching events in append order: only those after `query.after`, and at most `query.limit`. */
  listEvents(query: EventQuery): Promise<UiEvent[]>;
  /** Optional: how many of a session's events match, without reading them. Without it, the runtime counts `listEvents`. */
  countEvents?(query: CountQuery): Promise<number>;
  /**
   * Optional, all three together, and what makes a screen's retries safe. The screen sends a key with each action and
   * sends the same one when it retries. `claimEventKey` must be atomic: it claims the key for this session when no one
   * holds it, or when a claim that never finished is older than `staleMs` (the instance running it died); otherwise it
   * says what it found. `finishEventKey` marks it done with the event it recorded (none for `ctx.unchanged()`), and
   * `releaseEventKey` frees it after a failed action, so a retry runs it again. Without them, a retry runs twice.
   */
  claimEventKey?(sessionId: string, key: string, staleMs: number): Promise<EventKeyClaim>;
  finishEventKey?(sessionId: string, key: string, eventId: string | undefined): Promise<void>;
  releaseEventKey?(sessionId: string, key: string): Promise<void>;
  /** Optional. Lets the runtime re-arm abandon timers for screens left open across a restart, and `ui.sweep()` find them. */
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
  /**
   * Optional, both together: a lease so only one agent turn runs per conversation, across instances. `ui.turn()`
   * uses it. `acquireTurn` must be atomic: it takes the lease (and returns true) when no one holds it, when it
   * expired, or when `holder` already holds it (which renews it for another `ttlMs`); otherwise it returns false.
   * `releaseTurn` frees it only if `holder` still holds it.
   */
  acquireTurn?(conversationId: string, holder: string, ttlMs: number): Promise<boolean>;
  releaseTurn?(conversationId: string, holder: string): Promise<void>;
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
  private turns = new Map<string, { holder: string; until: number }>();
  private keys = new Map<string, { done: boolean; eventId?: string; at: number }>();

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

  async updateSessionIf(id: string, status: SessionStatus, patch: Partial<UiSession>) {
    const s = this.sessions.get(id);
    if (s?.status !== status) return false;
    this.sessions.set(id, { ...s, ...patch });
    return true;
  }

  async appendEvent(event: UiEvent) {
    this.events.push(event);
  }

  async claimEventKey(sessionId: string, key: string, staleMs: number): Promise<EventKeyClaim> {
    const k = `${sessionId}:${key}`;
    const found = this.keys.get(k);
    if (found?.done) return { status: "done", ...(found.eventId ? { eventId: found.eventId } : {}) };
    if (found && found.at > Date.now() - staleMs) return { status: "running" };
    this.keys.set(k, { done: false, at: Date.now() });
    return { status: "claimed" };
  }

  async finishEventKey(sessionId: string, key: string, eventId: string | undefined) {
    this.keys.set(`${sessionId}:${key}`, { done: true, eventId, at: Date.now() });
  }

  async releaseEventKey(sessionId: string, key: string) {
    const k = `${sessionId}:${key}`;
    if (!this.keys.get(k)?.done) this.keys.delete(k);
  }

  async countEvents(q: CountQuery) {
    return this.events.filter((e) => matchesCount(e, q)).length;
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
    for (const k of this.keys.keys()) if (ids.has(k.slice(0, k.indexOf(":")))) this.keys.delete(k);
    return { sessions: ids.size, events: before.events - this.events.length, files: before.files - this.files.size };
  }

  async acquireTurn(conversationId: string, holder: string, ttlMs: number) {
    const lease = this.turns.get(conversationId);
    if (lease && lease.holder !== holder && lease.until > Date.now()) return false;
    this.turns.set(conversationId, { holder, until: Date.now() + ttlMs });
    return true;
  }

  async releaseTurn(conversationId: string, holder: string) {
    if (this.turns.get(conversationId)?.holder === holder) this.turns.delete(conversationId);
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
