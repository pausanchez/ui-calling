import { sqliteStore } from "@ui-calling/sqlite";

/**
 * ui-calling's sessions, events and files, in Node's built-in SQLite: links and the agent's context survive
 * restarts. The file is .ui-calling/ui-calling.db, or node_modules/.cache/ui-calling/ in development, where the
 * dev server doesn't watch it. Set UI_CALLING_DB to use another file: a test sets it (or ":memory:") before importing
 * this, so it never touches your dev data. On serverless hosts without a lasting disk, implement UiStore for your database.
 *
 * Your server code can keep its own tables here too (drafts, test data): import { store } from this file and
 * use store.db, a node:sqlite DatabaseSync. It's its own file so surfaces can import it without importing ui.ts.
 */
export const store = sqliteStore();
