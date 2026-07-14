-- OpiumStore V7.10 - correction robuste des rôles Discord
-- Aucun BEGIN/COMMIT : compatible Cloudflare D1.

CREATE TABLE IF NOT EXISTS user_rank_preferences (
  user_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'discord' CHECK(mode IN ('discord','manual')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Protège seulement les anciens Admin/Fondateur sans préférence existante.
-- Un Admin détecté automatiquement par Discord conserve donc le mode "discord" lors des prochains déploiements.
INSERT OR IGNORE INTO user_rank_preferences(user_id,mode,updated_at)
SELECT ur.user_id,'manual',unixepoch()*1000
FROM user_ranks ur
WHERE ur.rank='admin';

-- Oublie les diagnostics 404 erronés de V7.8/V7.9 afin de forcer une nouvelle lecture fiable.
DELETE FROM discord_role_sync WHERE status_code=404;
