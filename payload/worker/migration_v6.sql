-- V6 : quota journalier individuel, réinitialisé selon le jour Europe/Brussels.
-- 0 génération/jour signifie illimité.
BEGIN TRANSACTION;

INSERT INTO app_settings(key, value)
VALUES ('default_daily_generation_limit', '6')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS daily_generation_usage (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, day_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_generation_usage_day
ON daily_generation_usage(day_key, user_id);

COMMIT;
