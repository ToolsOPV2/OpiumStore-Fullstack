-- OpiumStore V7.9 - séparation rang manuel / synchronisation Discord
-- Idempotent : la table de préférence évite de modifier la structure historique de user_ranks.

CREATE TABLE IF NOT EXISTS user_rank_preferences (
  user_id INTEGER PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'discord' CHECK(mode IN ('discord','manual')),
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Les comptes Admin/Fondateur déjà attribués restent protégés.
-- Les comptes Free utilisent la synchronisation Discord par défaut.
-- Un Boost/VIP n'est mis en automatique que si une synchronisation réussie avait réellement détecté ce rôle.
INSERT OR IGNORE INTO user_rank_preferences(user_id,mode,updated_at)
SELECT ur.user_id,
  CASE
    WHEN ur.rank='admin' THEN 'manual'
    WHEN ur.rank='free' THEN 'discord'
    WHEN EXISTS (
      SELECT 1 FROM discord_role_sync drs
      WHERE drs.user_id=ur.user_id
        AND drs.success=1
        AND drs.last_rank=ur.rank
        AND ((ur.rank='boost' AND drs.has_boost_role=1) OR (ur.rank='vip' AND drs.has_vip_role=1))
    ) THEN 'discord'
    ELSE 'manual'
  END,
  unixepoch()*1000
FROM user_ranks ur;

CREATE INDEX IF NOT EXISTS idx_user_rank_preferences_mode ON user_rank_preferences(mode);
