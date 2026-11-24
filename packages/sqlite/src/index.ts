import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SessionStatus, UiEvent, UiSession, UiStore } from "@ui-calling/core";

/**
 * Sessions and events in a SQLite file, on Node's built-in `node:sqlite`: nothing to install, nothing
 * to run. Links and the agent's context survive restarts and deploys on the same machine.
 *
 *   createUiCalling({ store: sqliteStore(), ... })   // .ui-calling/ui-calling.db
 *
 * Needs a writable disk that outlives the process. On serverless platforms (e.g. Vercel functions)
 * use a hosted database instead: implement `UiStore` for it.
 */
export function sqliteStore(path = ".ui-calling/ui-calling.db") {
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
  `);

  const q = {
    insertSession: db.prepare("INSERT INTO ui_sessions (id, token_hash, conversation_id, status, json) VALUES (?, ?, ?, ?, ?)"),
    byToken: db.prepare("SELECT json FROM ui_sessions WHERE token_hash = ?"),
    byId: db.prepare("SELECT json FROM ui_sessions WHERE id = ?"),
    updateSession: db.prepare("UPDATE ui_sessions SET status = ?, json = ? WHERE id = ?"),
    sessionsByStatus: db.prepare("SELECT json FROM ui_sessions WHERE status = ?"),
    allSessions: db.prepare("SELECT json FROM ui_sessions"),
    insertEvent: db.prepare("INSERT INTO ui_events (id, session_id, conversation_id, json) VALUES (?, ?, ?, ?)"),
    eventsBySession: db.prepare("SELECT json FROM ui_events WHERE session_id = ? ORDER BY seq"),
    eventsByConversation: db.prepare("SELECT json FROM ui_events WHERE conversation_id = ? ORDER BY seq"),
    eventsByBoth: db.prepare("SELECT json FROM ui_events WHERE conversation_id = ? AND session_id = ? ORDER BY seq"),
    allEvents: db.prepare("SELECT json FROM ui_events ORDER BY seq"),
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
    async listEvents({ conversationId, sessionId }: { conversationId?: string; sessionId?: string }) {
      if (conversationId && sessionId) return many<UiEvent>(q.eventsByBoth.all(conversationId, sessionId));
      if (sessionId) return many<UiEvent>(q.eventsBySession.all(sessionId));
      if (conversationId) return many<UiEvent>(q.eventsByConversation.all(conversationId));
      return many<UiEvent>(q.allEvents.all());
    },
    async listSessions({ status }: { status?: SessionStatus }) {
      return many<UiSession>(status ? q.sessionsByStatus.all(status) : q.allSessions.all());
    },
  };
  return store;
}
