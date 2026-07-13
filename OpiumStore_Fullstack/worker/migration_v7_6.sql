-- OpiumStore V7.6 : rangs, accès aux générateurs/quêtes et cycles de roue.
-- Idempotent et compatible Cloudflare D1/Wrangler : aucun BEGIN/COMMIT.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_ranks (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rank TEXT NOT NULL DEFAULT 'free' CHECK(rank IN ('free','boost','vip','admin')),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO user_ranks(user_id,rank,updated_at)
SELECT id,'free',unixepoch()*1000 FROM users;

CREATE TABLE IF NOT EXISTS service_access (
  service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,
  required_rank TEXT NOT NULL DEFAULT 'free' CHECK(required_rank IN ('free','boost','vip')),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO service_access(service_id,required_rank,updated_at)
SELECT id,'free',unixepoch()*1000 FROM services;

CREATE TABLE IF NOT EXISTS mission_access (
  mission_id TEXT PRIMARY KEY REFERENCES missions(id) ON DELETE CASCADE,
  required_rank TEXT NOT NULL DEFAULT 'free' CHECK(required_rank IN ('free','boost','vip')),
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO mission_access(mission_id,required_rank,updated_at)
SELECT id,'free',unixepoch()*1000 FROM missions;

CREATE TABLE IF NOT EXISTS wheel_cycle_usage (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  cycle_ends_at INTEGER NOT NULL,
  free_spins_used INTEGER NOT NULL DEFAULT 0 CHECK(free_spins_used >= 0),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_ranks_rank ON user_ranks(rank);
CREATE INDEX IF NOT EXISTS idx_service_access_rank ON service_access(required_rank);
CREATE INDEX IF NOT EXISTS idx_mission_access_rank ON mission_access(required_rank);
CREATE INDEX IF NOT EXISTS idx_wheel_cycle_ends ON wheel_cycle_usage(cycle_ends_at);

INSERT INTO app_settings(key,value) VALUES ('wheel_cooldown_seconds','43200')
ON CONFLICT(key) DO UPDATE SET value='43200';
