# @ui-calling/sqlite

Sessions, events and uploaded files in a SQLite file, on Node's built-in `node:sqlite` (Node 22.13+): nothing to install or run. Links and the agent's context survive restarts.

```ts
import { sqliteStore, sqliteIdentity } from "@ui-calling/sqlite";

export const store = sqliteStore(); // .ui-calling/ui-calling.db in production
createUiCalling({ store, ... });
store.db; // the DatabaseSync: keep your own tables next to ui-calling's
```

`UI_CALLING_DB` overrides the default path (a test's own file, or `:memory:`). `sqliteIdentity(store)` links a chat user to your customer or employee record with one-time codes (used by the `link-account` block). On hosts without a lasting disk, implement `UiStore` for your database.
