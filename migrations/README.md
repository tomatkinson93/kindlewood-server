# migrations/

How the database schema is kept up to date.

## How they run
- `db.js` `initDB()` applies the files named in `applyMigrationFiles([...])` **on every boot, in that order**. Each one is found by its name suffix (`_market.sql`, `_crafting.sql`, …).
- Because every file re-runs each time, everything in it must be idempotent:
  - `CREATE … IF NOT EXISTS`
  - `ADD COLUMN IF NOT EXISTS`
  - constraints added inside `DO $$ … EXCEPTION WHEN duplicate_object …`
  - seed rows with `ON CONFLICT DO NOTHING`, so Dev Tools edits survive a boot
- Some older columns are still only added by the admin endpoint `POST /api/game/migrate` (routes/game.js). Run it once on a new database. For a throwaway test database, use `scripts/prepare_test_db.js`.

## Heavy one-off work
A backfill that scans history (e.g. the Market ledger copying past trips and runs) must run once, not on every boot. Guard it with `migration_marks`:

```sql
DO $x$ BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'my_backfill') THEN
  -- … the backfill …
  INSERT INTO migration_marks (key) VALUES ('my_backfill');
END IF;
END $x$;
```

`migration_marks` is created by `0NN_market_ledger.sql`. Create it with `IF NOT EXISTS` in any file that uses it earlier.

## Naming: `0NN_` before deploy
New files are written as `0NN_<name>.sql`. **At deploy time, rename each to the next free number** (e.g. `014_crafting.sql`). Only the `_<name>.sql` suffix is matched, so `db.js` needs no change. Keep the order in `applyMigrationFiles`: a file can rely on the ones before it, e.g.
- `market_ledger` → `market_npc` → `market_v2` → `market_items` → `market`
- `crafting` → `careers`
- `resources` (settlement columns for every key in lib/resource_defs.js — add a line here when you add a resource)

## Tests
- `scripts/test_all.sh` runs every server suite and the frontend proofs against a throwaway database and a running server.
- See the header of each `scripts/*_test.js` for its settings. The server needs the test admin ids (and user id 1 for the chat and clan tests) in `ADMIN_USER_IDS`.
