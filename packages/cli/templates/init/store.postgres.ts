import { Pool } from "pg";
import { postgresStore } from "@ui-calling/postgres";

/**
 * ui-calling's sessions, events, files and turn leases in Postgres, shared by every instance: a link opened on one
 * and a webhook handled by another agree, and two never run the same conversation's agent at once. Tables are
 * created on first use. Set DATABASE_URL; on Supabase, use the transaction pooler's (port 6543), which suits
 * serverless functions that open and close often.
 *
 * Your server code can use the same pool for its own tables: import { pool } from this file.
 */
const url = (process.env.DATABASE_URL ?? "")
  // Pasted with quotes into a host's settings, the quotes become part of the value.
  .replace(/^["']|["']$/g, "")
  // A Prisma flag: node-postgres would send it to the server as a setting and fail.
  .replace(/[?&]pgbouncer=true$/, "");

// One pool per instance; in development it survives hot reloads on globalThis.
const g = globalThis as unknown as { uiCallingPool?: Pool };
export const pool =
  g.uiCallingPool ??
  new Pool({
    connectionString: url,
    // Hosted Postgres (Supabase, Neon) needs TLS; a local server usually has none.
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? undefined : { rejectUnauthorized: false },
    max: 3,
  });
if (process.env.NODE_ENV !== "production") g.uiCallingPool = pool;

export const store = postgresStore(pool);

/** Small JSON records your screens keep between steps (drafts), by key. The table is made on first use. */
let draftsReady: Promise<unknown> | undefined;
const ready = () => (draftsReady ??= pool.query("CREATE TABLE IF NOT EXISTS ui_drafts (key text PRIMARY KEY, value jsonb NOT NULL)"));
export const drafts = {
  async get<T>(key: string): Promise<T | undefined> {
    await ready();
    return (await pool.query("SELECT value FROM ui_drafts WHERE key = $1", [key])).rows[0]?.value as T | undefined;
  },
  async set(key: string, value: unknown) {
    await ready();
    await pool.query("INSERT INTO ui_drafts (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [key, JSON.stringify(value)]);
  },
};
