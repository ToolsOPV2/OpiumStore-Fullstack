-- V5 : garantit un cooldown isolÃ© par utilisateur ET par service.
-- Cette migration conserve les timers existants.

INSERT INTO app_settings(key, value)
VALUES ('default_generation_cooldown_seconds', '900')
ON CONFLICT(key) DO NOTHING;

DROP TABLE IF EXISTS generator_cooldowns_v5;
CREATE TABLE generator_cooldowns_v5 (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  next_allowed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, service_id)
);

INSERT OR REPLACE INTO generator_cooldowns_v5(user_id, service_id, next_allowed_at)
SELECT user_id, service_id, MAX(next_allowed_at)
FROM generator_cooldowns
GROUP BY user_id, service_id;

DROP TABLE generator_cooldowns;
ALTER TABLE generator_cooldowns_v5 RENAME TO generator_cooldowns;
CREATE INDEX IF NOT EXISTS idx_generator_cooldowns_user ON generator_cooldowns(user_id, next_allowed_at);

