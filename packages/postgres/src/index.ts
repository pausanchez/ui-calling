import {
  UnknownEventError,
  type CountQuery,
  type EventQuery,
  type ForgetFilter,
  type ForgetResult,
  type SessionStatus,
  type UiEvent,
  type UiFile,
  type UiSession,
  type UiStore,
} from "@ui-calling/core";

/**
 * Anything that runs a parameterized query: a `pg` Pool or Client, PGlite, or a serverless driver with the same
 * shape (Neon's `Pool`, Vercel Postgres). Only `rows` and the affected-row count are read.
 */
export type PgQueryable = {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null; affectedRows?: number }>;
};

/**
 * Sessions, events, files and turn leases in Postgres, for several instances or hosts without a lasting disk.
 * Every method that must be atomic (the turn lease, a status move, forget) is one statement, so it's safe on a
 * pool shared by many processes.
 *
 *   import { Pool } from "pg";
 *   createUiCalling({ store: postgresStore(new Pool({ connectionString: process.env.DATABASE_URL })), ... })
 *
 * Tables are created on first use (`CREATE TABLE IF NOT EXISTS`). If your migrations own the schema, pass
 * `{ createTables: false }` and run `POSTGRES_SCHEMA` in one of them.
 */
export function postgresStore(db: PgQueryable, opts: { createTables?: boolean } = {}): UiStore & { ready: Promise<void> } {
  // Created on first use, not at import: `next build` imports route modules and shouldn't touch the database.
  let schema: Promise<void> | undefined;
  // One statement per query: drivers on the extended protocol (PGlite, some serverless ones) refuse several at once.
  const ready = () =>
    (schema ??=
      opts.createTables === false
        ? Promise.resolve()
        : POSTGRES_SCHEMA.split(";")
            .map((sql) => sql.trim())
            .filter(Boolean)
            .reduce<Promise<unknown>>((done, sql) => done.then(() => db.query(sql)), Promise.resolve())
            .then(() => undefined));
  const q = async (text: string, params: unknown[] = []) => {
    await ready();
    return db.query(text, params);
  };
  const changed = (r: { rowCount?: number | null; affectedRows?: number }) => Number(r.rowCount ?? r.affectedRows ?? 0);
  const fileOf = (row: { data: UiFile; bytes: Uint8Array }) => ({ file: row.data, bytes: new Uint8Array(row.bytes) });

  return {
    get ready() {
      return ready();
    },

    async createSession(session: UiSession, tokenHash: string) {
      await q(
        "INSERT INTO ui_sessions (id, token_hash, conversation_id, subject, status, expires_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [session.id, tokenHash, session.conversationId, session.subject, session.status, session.expiresAt, JSON.stringify(session)],
      );
    },
    async getSessionByTokenHash(tokenHash: string) {
      return (await q("SELECT data FROM ui_sessions WHERE token_hash = $1", [tokenHash])).rows[0]?.data as UiSession | undefined;
    },
    async getSession(id: string) {
      return (await q("SELECT data FROM ui_sessions WHERE id = $1", [id])).rows[0]?.data as UiSession | undefined;
    },
    // jsonb `||` merges in the database, so two instances patching different fields don't overwrite each other.
    async updateSession(id: string, patch: Partial<UiSession>) {
      await q("UPDATE ui_sessions SET status = coalesce($2, status), data = data || $3::jsonb WHERE id = $1", [id, patch.status ?? null, JSON.stringify(patch)]);
    },
    async updateSessionIf(id: string, status: SessionStatus, patch: Partial<UiSession>) {
      const r = await q("UPDATE ui_sessions SET status = coalesce($3, status), data = data || $4::jsonb WHERE id = $1 AND status = $2", [
        id,
        status,
        patch.status ?? null,
        JSON.stringify(patch),
      ]);
      return changed(r) > 0;
    },
    async listSessions({ status }: { status?: SessionStatus }) {
      const r = status ? await q("SELECT data FROM ui_sessions WHERE status = $1", [status]) : await q("SELECT data FROM ui_sessions");
      return r.rows.map((row) => row.data as UiSession);
    },

    // Events keep their JSON as written (json, not jsonb), so the payload's key order reaches the agent unchanged.
    async appendEvent(event: UiEvent) {
      await q("INSERT INTO ui_events (id, session_id, conversation_id, kind, wake, at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
        event.id,
        event.sessionId,
        event.conversationId,
        event.kind,
        event.wake,
        event.at,
        JSON.stringify(event),
      ]);
    },
    async listEvents({ conversationId, sessionId, after, limit }: EventQuery) {
      let from = 0;
      if (after !== undefined) {
        const row = (await q("SELECT seq FROM ui_events WHERE id = $1", [after])).rows[0];
        if (!row) throw new UnknownEventError(after);
        from = Number(row.seq);
      }
      const r = await q(
        `SELECT data FROM ui_events
          WHERE seq > $1 AND ($2::text IS NULL OR conversation_id = $2) AND ($3::text IS NULL OR session_id = $3)
          ORDER BY seq LIMIT $4`,
        [from, conversationId ?? null, sessionId ?? null, limit ?? null],
      );
      return r.rows.map((row) => parseJson<UiEvent>(row.data));
    },
    async countEvents({ sessionId, kind, wake, since }: CountQuery) {
      const r = await q(
        `SELECT count(*) AS n FROM ui_events
          WHERE session_id = $1 AND ($2::text IS NULL OR kind = $2) AND ($3::boolean IS NULL OR wake = $3) AND ($4::text IS NULL OR at >= $4)`,
        [sessionId, kind ?? null, wake ?? null, since ?? null],
      );
      return Number(r.rows[0].n);
    },

    // Bytes in a bytea column: fine for photos and documents. For large files, implement these four on object storage.
    async putFile(file: UiFile, bytes: Uint8Array) {
      await q("INSERT INTO ui_files (id, session_id, data, bytes) VALUES ($1, $2, $3, $4)", [file.id, file.sessionId, JSON.stringify(file), bytes]);
    },
    async getFile(id: string) {
      const row = (await q("SELECT data, bytes FROM ui_files WHERE id = $1", [id])).rows[0];
      return row ? fileOf(row) : undefined;
    },
    async listFiles(sessionId: string) {
      return (await q("SELECT data FROM ui_files WHERE session_id = $1 ORDER BY seq", [sessionId])).rows.map((row) => row.data as UiFile);
    },
    async deleteFile(id: string) {
      await q("DELETE FROM ui_files WHERE id = $1", [id]);
    },

    // One statement: a pool may run each query on a different connection, so BEGIN … COMMIT across calls wouldn't hold.
    async forget(filter: ForgetFilter): Promise<ForgetResult> {
      const [where, value] =
        "conversationId" in filter
          ? ["conversation_id = $1", filter.conversationId]
          : "subject" in filter
            ? ["subject = $1", filter.subject]
            : ["expires_at < $1", filter.expiredBefore];
      const r = await q(
        `WITH s AS (DELETE FROM ui_sessions WHERE ${where} RETURNING id),
              e AS (DELETE FROM ui_events WHERE session_id IN (SELECT id FROM s) RETURNING 1),
              f AS (DELETE FROM ui_files WHERE session_id IN (SELECT id FROM s) RETURNING 1)
         SELECT (SELECT count(*) FROM s) AS sessions, (SELECT count(*) FROM e) AS events, (SELECT count(*) FROM f) AS files`,
        [value],
      );
      const row = r.rows[0];
      return { sessions: Number(row.sessions), events: Number(row.events), files: Number(row.files) };
    },

    // The database's clock, not each instance's: leases mean the same thing on every machine.
    async acquireTurn(conversationId: string, holder: string, ttlMs: number) {
      const r = await q(
        `INSERT INTO ui_turns (conversation_id, holder, expires_at) VALUES ($1, $2, now() + $3 * interval '1 millisecond')
         ON CONFLICT (conversation_id) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
         WHERE ui_turns.expires_at <= now() OR ui_turns.holder = excluded.holder
         RETURNING 1`,
        [conversationId, holder, ttlMs],
      );
      return r.rows.length > 0;
    },
    async releaseTurn(conversationId: string, holder: string) {
      await q("DELETE FROM ui_turns WHERE conversation_id = $1 AND holder = $2", [conversationId, holder]);
    },
  };
}

// Drivers return json columns parsed, except where a type parser is turned off: accept both.
function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

/** The tables `postgresStore` uses, for your migrations when you pass `{ createTables: false }`. Safe to run twice. */
export const POSTGRES_SCHEMA = `
CREATE TABLE IF NOT EXISTS ui_sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  conversation_id text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL,
  expires_at text NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ui_sessions_status ON ui_sessions (status);
CREATE INDEX IF NOT EXISTS ui_sessions_conversation ON ui_sessions (conversation_id);
CREATE INDEX IF NOT EXISTS ui_sessions_subject ON ui_sessions (subject);
CREATE INDEX IF NOT EXISTS ui_sessions_expires ON ui_sessions (expires_at);
CREATE TABLE IF NOT EXISTS ui_events (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  session_id text NOT NULL,
  conversation_id text NOT NULL,
  kind text NOT NULL,
  wake boolean NOT NULL,
  at text NOT NULL,
  data json NOT NULL
);
CREATE INDEX IF NOT EXISTS ui_events_session ON ui_events (session_id, seq);
CREATE INDEX IF NOT EXISTS ui_events_conversation ON ui_events (conversation_id, seq);
CREATE TABLE IF NOT EXISTS ui_files (
  seq bigserial PRIMARY KEY,
  id text NOT NULL UNIQUE,
  session_id text NOT NULL,
  data jsonb NOT NULL,
  bytes bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS ui_files_session ON ui_files (session_id, seq);
CREATE TABLE IF NOT EXISTS ui_turns (
  conversation_id text PRIMARY KEY,
  holder text NOT NULL,
  expires_at timestamptz NOT NULL
);
`;
