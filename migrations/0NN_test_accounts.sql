-- Test accounts (lib/test_accounts.js): made by the "fresh test account"
-- button on the login screen, and deleted when they sign out.
BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_users_test ON users (created_at) WHERE is_test;

COMMIT;
