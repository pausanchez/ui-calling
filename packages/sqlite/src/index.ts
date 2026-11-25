import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { UnknownEventError, type EventQuery, type SessionStatus, type UiEvent, type UiFile, type UiSession, type UiStore } from "@ui-calling/core";

/**
 * Sessions and events in a SQLite file, on Node's built-in `node:sqlite`: nothing to install, nothing
 * to run. Links and the agent's context survive restarts and deploys on the same machine.
 *
 *   createUiCalling({ store: sqliteStore(), ... })   // see DEFAULT_PATH
 *
 * Needs a writable disk that outlives the process. On serverless platforms (e.g. Vercel functions)
 * use a hosted database instead: implement `UiStore` for it.
 *
 * `store.db` is the open `DatabaseSync`: keep your own tables (drafts, mock data) next to UI_calling's.
 */
export function sqliteStore(path = DEFAULT_PATH()) {
  return open(path);
}

/**
 * `.ui-calling/ui-calling.db` in production. In development, `node_modules/.cache/ui-calling/`: Next's dev
 * server watches the whole project, and a database inside it reloads the page on every event the
 * screen records, so the screen never finishes loading. Dev servers ignore `node_modules`.
 */
function DEFAULT_PATH() {
  return process.env.NODE_ENV === "production" ? ".ui-calling/ui-calling.db" : "node_modules/.cache/ui-calling/ui-calling.db";
}

function open(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
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
  `);

  const q = {
    insertSession: db.prepare("INSERT INTO ui_sessions (id, token_hash, conversation_id, status, json) VALUES (?, ?, ?, ?, ?)"),
    byToken: db.prepare("SELECT json FROM ui_sessions WHERE token_hash = ?"),
    byId: db.prepare("SELECT json FROM ui_sessions WHERE id = ?"),
    updateSession: db.prepare("UPDATE ui_sessions SET status = ?, json = ? WHERE id = ?"),
    sessionsByStatus: db.prepare("SELECT json FROM ui_sessions WHERE status = ?"),
    allSessions: db.prepare("SELECT json FROM ui_sessions"),
    insertEvent: db.prepare("INSERT INTO ui_events (id, session_id, conversation_id, json) VALUES (?, ?, ?, ?)"),
    seqOf: db.prepare("SELECT seq FROM ui_events WHERE id = ?"),
    insertFile: db.prepare("INSERT INTO ui_files (id, session_id, json, bytes) VALUES (?, ?, ?, ?)"),
    fileById: db.prepare("SELECT json, bytes FROM ui_files WHERE id = ?"),
    filesBySession: db.prepare("SELECT json FROM ui_files WHERE session_id = ? ORDER BY seq"),
    deleteFile: db.prepare("DELETE FROM ui_files WHERE id = ?"),
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

  const store: UiStore & { db: DatabaseSync; close(): void } = {
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
    async appendEvent(event: UiEvent) {
      q.insertEvent.run(event.id, event.sessionId, event.conversationId, JSON.stringify(event));
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
  };
  return store;
}
export { sqliteIdentity, type SqliteIdentity, type VerifyResult } from "./identity";
