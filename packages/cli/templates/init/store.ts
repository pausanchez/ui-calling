import { sqliteStore } from "@ui-calling/sqlite";

/**
 * UI_calling's sessions, events and files, in Node's built-in SQLite: links and the agent's context survive
 * restarts. The file is .ui-calling/ui-calling.db, or node_modules/.cache/ui-calling/ in development, where the
 * dev server doesn't watch it. On serverless hosts without a lasting disk, implement UiStore for your database.
 *
 * Your server code can keep its own tables here too (drafts, test data): import { store } from this file and
 * use store.db, a node:sqlite DatabaseSync. It's its own file so surfaces can import it without importing ui.ts.
 */
export const store = sqliteStore();
