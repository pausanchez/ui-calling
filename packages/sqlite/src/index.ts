import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UnknownEventError, matchesForget, type CountQuery, type EventKeyClaim, type EventQuery, type ForgetFilter, type SessionStatus, type UiEvent, type UiFile, type UiSession, type UiStore } from "@ui-calling/core";

/**
 * Sessions and events in a SQLite file, on Node's built-in `node:sqlite`: nothing to install, nothing
 * to run. Links and the agent's context survive restarts and deploys on the same machine.
 *
 *   createUiCalling({ store: sqliteStore(), ... })   // see DEFAULT_PATH
 *
 * Needs a writable disk that outlives the process. On serverless platforms (e.g. Vercel functions)
 * use a hosted database instead: implement `UiStore` for it.
 *
 * `store.db` is the open `DatabaseSync`: keep your own tables (drafts, mock data) next to ui-calling's.
 */
export function sqliteStore(path = DEFAULT_PATH()): SqliteStore {
  // Opened on first use, not on import: `next build` imports route modules to collect page data, and would
  // otherwise create the production database in the project (or a Docker build layer) every time.
  let opened: SqliteStore | undefined;
  const get = () => (opened ??= open(path));
  const lazy =
    <K extends keyof UiStore>(key: K) =>
    (...args: unknown[]) =>
      (get()[key] as (...a: unknown[]) => unknown)(...args);
  return {
    get db() {
      return get().db;
    },
    close: () => opened?.close(),
    createSession: lazy("createSession"),
    getSessionByTokenHash: lazy("getSessionByTokenHash"),
    getSession: lazy("getSession"),
    updateSession: lazy("updateSession"),
    updateSessionIf: lazy("updateSessionIf"),
    appendEvent: lazy("appendEvent"),
    listEvents: lazy("listEvents"),
    countEvents: lazy("countEvents"),
    listSessions: lazy("listSessions"),
    putFile: lazy("putFile"),
    getFile: lazy("getFile"),
    listFiles: lazy("listFiles"),
    deleteFile: lazy("deleteFile"),
    forget: lazy("forget"),
    claimEventKey: lazy("claimEventKey"),
    finishEventKey: lazy("finishEventKey"),
    releaseEventKey: lazy("releaseEventKey"),
    acquireTurn: lazy("acquireTurn"),
    releaseTurn: lazy("releaseTurn"),
  } as SqliteStore;
}

export type SqliteStore = UiStore & { db: DatabaseSync; close(): void };

/**
 * `UI_CALLING_DB` when set (a test's own file, or `:memory:`). Otherwise `.ui-calling/ui-calling.db` in production,
 * and in development `node_modules/.cache/ui-calling/`: Next's dev server watches the whole project, and a database
 * inside it reloads the page on every event the screen records, so the screen never finishes loading. Dev servers
 * ignore `node_modules`.
 */
function DEFAULT_PATH() {
  if (process.env.UI_CALLING_DB) return process.env.UI_CALLING_DB;
  return process.env.NODE_ENV === "production" ? ".ui-calling/ui-calling.db" : "node_modules/.cache/ui-calling/ui-calling.db";
}

function open(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    -- Several processes can share the file (turn leases are for that): wait for a writer instead of failing.
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS ui_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ui_sessions_status ON ui_sessions (status);
    CREATE TABLE IF NOT EXISTS ui_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ui_events_session ON ui_events (session_id, seq);
    CREATE INDEX IF NOT EXISTS ui_events_conversation ON ui_events (conversation_id, seq);
    CREATE TABLE IF NOT EXISTS ui_files (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      session_id TEXT NOT NULL,
      json TEXT NOT NULL,
      bytes BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ui_files_session ON ui_files (session_id, seq);
    CREATE TABLE IF NOT EXISTS ui_event_keys (
      session_id TEXT NOT NULL,
      key TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      event_id TEXT,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, key)
    );
    CREATE TABLE IF NOT EXISTS ui_turns (
      conversation_id TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  const q = {
    insertSession: db.prepare("INSERT INTO ui_sessions (id, token_hash, conversation_id, status, json) VALUES (?, ?, ?, ?, ?)"),
    byToken: db.prepare("SELECT json FROM ui_sessions WHERE token_hash = ?"),
    byId: db.prepare("SELECT json FROM ui_sessions WHERE id = ?"),
    updateSession: db.prepare("UPDATE ui_sessions SET status = ?, json = ? WHERE id = ?"),
    // One statement, so two processes can't both make the same move: the status check and the write happen together.
    // json_patch merges into the stored JSON, so a field another process wrote meanwhile isn't lost.
    updateSessionIf: db.prepare("UPDATE ui_sessions SET status = ?, json = json_patch(json, ?) WHERE id = ? AND status = ?"),
    sessionsByStatus: db.prepare("SELECT json FROM ui_sessions WHERE status = ?"),
    allSessions: db.prepare("SELECT json FROM ui_sessions"),
    insertEvent: db.prepare("INSERT INTO ui_events (id, session_id, conversation_id, json) VALUES (?, ?, ?, ?)"),
    seqOf: db.prepare("SELECT seq FROM ui_events WHERE id = ?"),
    countEvents: db.prepare(`
      SELECT count(*) AS n FROM ui_events WHERE session_id = ?
        AND (?2 IS NULL OR json_extract(json, '$.kind') = ?2)
        AND (?3 IS NULL OR json_extract(json, '$.wake') = ?3)
        AND (?4 IS NULL OR json_extract(json, '$.at') >= ?4)`),
    insertFile: db.prepare("INSERT INTO ui_files (id, session_id, json, bytes) VALUES (?, ?, ?, ?)"),
    fileById: db.prepare("SELECT json, bytes FROM ui_files WHERE id = ?"),
    filesBySession: db.prepare("SELECT json FROM ui_files WHERE session_id = ? ORDER BY seq"),
    deleteFile: db.prepare("DELETE FROM ui_files WHERE id = ?"),
    deleteEventsOf: db.prepare("DELETE FROM ui_events WHERE session_id = ?"),
    deleteFilesOf: db.prepare("DELETE FROM ui_files WHERE session_id = ?"),
    deleteSession: db.prepare("DELETE FROM ui_sessions WHERE id = ?"),
    // One statement, so two processes can't both take the lease: the update only happens if it expired or is ours.
    acquireTurn: db.prepare(`
      INSERT INTO ui_turns (conversation_id, holder, expires_at) VALUES (?, ?, ?)
      ON CONFLICT (conversation_id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
      WHERE ui_turns.expires_at <= ? OR ui_turns.holder = excluded.holder`),
    releaseTurn: db.prepare("DELETE FROM ui_turns WHERE conversation_id = ? AND holder = ?"),
    // One statement, like the lease: a key is claimed when it's new, or when a claim that never finished went stale.
    claimKey: db.prepare(`
      INSERT INTO ui_event_keys (session_id, key, claimed_at) VALUES (?, ?, ?)
      ON CONFLICT (session_id, key) DO UPDATE SET claimed_at = excluded.claimed_at
      WHERE ui_event_keys.done = 0 AND ui_event_keys.claimed_at <= ?`),
    keyOf: db.prepare("SELECT done, event_id FROM ui_event_keys WHERE session_id = ? AND key = ?"),
    finishKey: db.prepare("UPDATE ui_event_keys SET done = 1, event_id = ? WHERE session_id = ? AND key = ?"),
    releaseKey: db.prepare("DELETE FROM ui_event_keys WHERE session_id = ? AND key = ? AND done = 0"),
    deleteKeysOf: db.prepare("DELETE FROM ui_event_keys WHERE session_id = ?"),
  };
  // One statement per combination of filters, so each query can use the (…, seq) indexes.
  const eventQueries = new Map<string, ReturnType<DatabaseSync["prepare"]>>();
  const eventQuery = (filters: string[]) => {
    const key = filters.join(",");
    if (!eventQueries.has(key)) {
      const where = filters.length ? `WHERE ${filters.map((f) => `${f} = ?`).join(" AND ")} AND seq > ?` : "WHERE seq > ?";
      eventQueries.set(key, db.prepare(`SELECT json FROM ui_events ${where} ORDER BY seq LIMIT ?`));
    }
    return eventQueries.get(key)!;
  };
  const one = <T>(row: unknown) => (row ? (JSON.parse((row as { json: string }).json) as T) : undefined);
  const many = <T>(rows: unknown[]) => rows.map((r) => JSON.parse((r as { json: string }).json) as T);

  const store: SqliteStore = {
    /** The underlying database, if your app wants its own tables in the same file. */
    db,
    close: () => db.close(),

    async createSession(session: UiSession, tokenHash: string) {
      q.insertSession.run(session.id, tokenHash, session.conversationId, session.status, JSON.stringify(session));
    },
    async getSessionByTokenHash(tokenHash: string) {
      return one<UiSession>(q.byToken.get(tokenHash));
    },
    async getSession(id: string) {
      return one<UiSession>(q.byId.get(id));
    },
    async updateSession(id: string, patch: Partial<UiSession>) {
      const current = one<UiSession>(q.byId.get(id));
      if (!current) return;
      const next = { ...current, ...patch };
      q.updateSession.run(next.status, JSON.stringify(next), id);
    },
    async updateSessionIf(id: string, status: SessionStatus, patch: Partial<UiSession>) {
      return Number(q.updateSessionIf.run(patch.status ?? status, JSON.stringify(patch), id, status).changes) > 0;
    },
    async appendEvent(event: UiEvent) {
      q.insertEvent.run(event.id, event.sessionId, event.conversationId, JSON.stringify(event));
    },
    async countEvents({ sessionId, kind, wake, since }: CountQuery) {
      // JSON booleans come out of json_extract as 1 and 0.
      const row = q.countEvents.get(sessionId, kind ?? null, wake === undefined ? null : Number(wake), since ?? null) as { n: number };
      return Number(row.n);
    },
    async listEvents({ conversationId, sessionId, after, limit }: EventQuery) {
      let from = 0;
      if (after !== undefined) {
        const row = q.seqOf.get(after) as { seq: number } | undefined;
        if (!row) throw new UnknownEventError(after);
        from = row.seq;
      }
      const filters: string[] = [];
      const params: (string | number)[] = [];
      if (conversationId) {
        filters.push("conversation_id");
        params.push(conversationId);
      }
      if (sessionId) {
        filters.push("session_id");
        params.push(sessionId);
      }
      // LIMIT -1 is SQLite for "no limit".
      return many<UiEvent>(eventQuery(filters).all(...params, from, limit ?? -1));
    },
    async listSessions({ status }: { status?: SessionStatus }) {
      return many<UiSession>(status ? q.sessionsByStatus.all(status) : q.allSessions.all());
    },
    // Files sit in the same database as blobs: fine for screenshots and photos on one machine.
    // For larger files or several servers, implement these four on object storage.
    async putFile(file: UiFile, bytes: Uint8Array) {
      q.insertFile.run(file.id, file.sessionId, JSON.stringify(file), bytes);
    },
    async getFile(id: string) {
      const row = q.fileById.get(id) as { json: string; bytes: Uint8Array } | undefined;
      return row ? { file: JSON.parse(row.json) as UiFile, bytes: new Uint8Array(row.bytes) } : undefined;
    },
    async listFiles(sessionId: string) {
      return many<UiFile>(q.filesBySession.all(sessionId));
    },
    async deleteFile(id: string) {
      q.deleteFile.run(id);
    },
    async claimEventKey(sessionId: string, key: string, staleMs: number): Promise<EventKeyClaim> {
      const now = Date.now();
      if (Number(q.claimKey.run(sessionId, key, now, now - staleMs).changes) > 0) return { status: "claimed" };
      const row = q.keyOf.get(sessionId, key) as { done: number; event_id: string | null };
      return row.done ? { status: "done", ...(row.event_id ? { eventId: row.event_id } : {}) } : { status: "running" };
    },
    async finishEventKey(sessionId: string, key: string, eventId: string | undefined) {
      q.finishKey.run(eventId ?? null, sessionId, key);
    },
    async releaseEventKey(sessionId: string, key: string) {
      q.releaseKey.run(sessionId, key);
    },
    async acquireTurn(conversationId: string, holder: string, ttlMs: number) {
      const now = Date.now();
      return Number(q.acquireTurn.run(conversationId, holder, now + ttlMs, now).changes) > 0;
    },
    async releaseTurn(conversationId: string, holder: string) {
      q.releaseTurn.run(conversationId, holder);
    },
    async forget(filter: ForgetFilter) {
      // The session's subject and expiry live in its JSON: pick the sessions in code, then delete by ID.
      const ids = many<UiSession>(q.allSessions.all()).filter((s) => matchesForget(s, filter)).map((s) => s.id);
      const result = { sessions: 0, events: 0, files: 0 };
      db.exec("BEGIN");
      try {
        for (const id of ids) {
          result.events += Number(q.deleteEventsOf.run(id).changes);
          result.files += Number(q.deleteFilesOf.run(id).changes);
          q.deleteKeysOf.run(id);
          result.sessions += Number(q.deleteSession.run(id).changes);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return result;
    },
  };
  return store;
}
export { sqliteIdentity, type SqliteIdentity, type VerifyResult } from "./identity";
