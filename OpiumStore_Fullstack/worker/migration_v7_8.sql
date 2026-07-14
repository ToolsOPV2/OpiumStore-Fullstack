-- OpiumStore V7.8 - Synchronisation fiable des rôles Discord

CREATE TABLE IF NOT EXISTS discord_role_sync (
  user_id INTEGER PRIMARY KEY,
  last_rank TEXT NOT NULL DEFAULT 'free' CHECK(last_rank IN ('free','boost','vip','admin')),
  source TEXT NOT NULL DEFAULT 'none',
  success INTEGER NOT NULL DEFAULT 0,
  status_code INTEGER NOT NULL DEFAULT 0,
  has_boost_role INTEGER NOT NULL DEFAULT 0,
  has_vip_role INTEGER NOT NULL DEFAULT 0,
  role_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  synced_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_discord_role_sync_synced_at ON discord_role_sync(synced_at);
