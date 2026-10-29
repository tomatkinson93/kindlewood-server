-- 0NN_feedback.sql — player bug reports and suggestions (routes/feedback.js).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_feedback.sql`), so
-- every statement is idempotent. Live databases that already have the table
-- keep it as it is.
BEGIN;
CREATE TABLE IF NOT EXISTS bug_reports (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_name  TEXT,
  kind           TEXT NOT NULL DEFAULT 'bug',
  title          TEXT NOT NULL,
  body           TEXT,
  page_context   TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bug_reports_user ON bug_reports (user_id);
COMMIT;
