import { sqliteStore } from "@ui-calling/sqlite";

/**
 * ui-calling's sessions, events and files, in Node's built-in SQLite: links and the agent's context survive
 * restarts. The file is .ui-calling/ui-calling.db, or node_modules/.cache/ui-calling/ in development, where the
 * dev server doesn't watch it. Set UI_CALLING_DB to use another file: a test sets it (or ":memory:") before importing
 * this, so it never touches your dev data. Several instances, or a host without a lasting disk (serverless)?
 * Install @ui-calling/postgres and run `npx ui-calling init` again: it writes this file for Postgres.
 *
 * Your server code can keep its own tables here too: import { store } from this file and use store.db, a node:sqlite
 * DatabaseSync. It's its own file so surfaces can import it without importing ui.ts.
 */
export const store = sqliteStore();

/**
 * Small JSON records your screens keep between steps (drafts), by key, in the same database. Async, so code that uses
 * it works unchanged on the Postgres store. The table is made on first use: opening the database on import would
 * create it during a production build.
 */
let draftsReady = false;
const draftsDb = () => {
  if (!draftsReady) store.db.exec("CREATE TABLE IF NOT EXISTS ui_drafts (key TEXT PRIMARY KEY, json TEXT NOT NULL)");
  draftsReady = true;
  return store.db;
};
export const drafts = {
  async get<T>(key: string): Promise<T | undefined> {
    const row = draftsDb().prepare("SELECT json FROM ui_drafts WHERE key = ?").get(key) as { json: string } | undefined;
    return row && (JSON.parse(row.json) as T);
  },
  async set(key: string, value: unknown) {
    draftsDb().prepare("INSERT INTO ui_drafts (key, json) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET json = excluded.json").run(key, JSON.stringify(value));
  },
};
