-- R5: expedition recall, first-steps checklist.
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS first_steps_dismissed BOOLEAN NOT NULL DEFAULT FALSE;
