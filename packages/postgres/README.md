# @ui-calling/postgres

Sessions, events, uploaded files and turn leases in Postgres: for several instances, or hosts without a lasting disk (serverless). No dependencies: pass any client with `query(text, params)`, such as a `pg` Pool, PGlite or a serverless driver with the same shape.

```ts
import { Pool } from "pg";
import { postgresStore } from "@ui-calling/postgres";

export const store = postgresStore(new Pool({ connectionString: process.env.DATABASE_URL }));
createUiCalling({ store, abandonTimers: false, ... }); // serverless: call ui.sweep() from a cron
```

- **Tables** (`ui_sessions`, `ui_events`, `ui_files`, `ui_turns`) are created on first use. If your migrations own the schema, pass `{ createTables: false }` and run `POSTGRES_SCHEMA` in one of them.
- **Safe on a shared pool.** The turn lease, status moves (first open, abandon) and `forget` are each one statement, and leases use the database's clock.
- **Files** go in a `bytea` column, fine for photos and documents. For large files, implement the four file methods on object storage.
- **Set up by `init`.** Install this package (and `pg`) before `npx ui-calling init`, and `store.ts` is a Postgres store on `DATABASE_URL`, with a `drafts` helper the `steps` template uses.
- **Supabase:** use the transaction pooler (port 6543), with TLS. A Prisma-style `?pgbouncer=true` must be dropped for node-postgres; `init`'s pool does it.
- **Identity:** `sqliteIdentity` (account links, codes, PINs) needs SQLite. With Postgres, keep those in your own user tables and pass your own `verifier`.
