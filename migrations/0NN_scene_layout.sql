-- Where each building stands in the Home scene (docs/HOME_SCENE.md §2.3):
-- { plot id: building id }. It was kept in each browser; here it is the same
-- on every device. NULL: never saved (the first device to load sends its own).
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS scene_layout JSONB;
