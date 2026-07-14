-- OpiumStore V7.7 — Discord, défis quotidiens, succès, cadeaux et notifications push

CREATE TABLE IF NOT EXISTS daily_challenge_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🎯',
  activity_type TEXT NOT NULL,
  min_target INTEGER NOT NULL DEFAULT 1,
  max_target INTEGER NOT NULL DEFAULT 1,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (reward_item_key) REFERENCES item_catalog(item_key) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_daily_challenges (
  user_id INTEGER NOT NULL,
  day_key TEXT NOT NULL,
  slot INTEGER NOT NULL,
  template_id TEXT NOT NULL,
  target INTEGER NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  claimed_at INTEGER,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_key, slot),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES daily_challenge_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (reward_item_key) REFERENCES item_catalog(item_key) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_challenges_user_day ON user_daily_challenges(user_id, day_key);

CREATE TABLE IF NOT EXISTS secret_achievements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🕵️',
  activity_type TEXT NOT NULL,
  threshold INTEGER NOT NULL DEFAULT 1,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (reward_item_key) REFERENCES item_catalog(item_key) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id INTEGER NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (achievement_id) REFERENCES secret_achievements(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id, unlocked_at DESC);

CREATE TABLE IF NOT EXISTS gift_transactions (
  id TEXT PRIMARY KEY,
  sender_user_id INTEGER NOT NULL,
  receiver_user_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (receiver_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (item_key) REFERENCES item_catalog(item_key) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_gifts_sender ON gift_transactions(sender_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gifts_receiver ON gift_transactions(receiver_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  notify_daily INTEGER NOT NULL DEFAULT 1,
  notify_wheel INTEGER NOT NULL DEFAULT 1,
  last_daily_notice_key TEXT,
  last_wheel_notice_cycle TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_enabled ON push_subscriptions(enabled, user_id);

INSERT OR IGNORE INTO daily_challenge_templates(id,title,description,emoji,activity_type,min_target,max_target,reward_points,reward_xp,reward_item_key,active,created_at,updated_at) VALUES
('daily-gen','Générateur actif','Effectue plusieurs générations aujourd’hui.','⚡','generation',2,5,45,35,NULL,1,1773655200000,1773655200000),
('daily-wheel','Tour de chance','Fais tourner la roue aujourd’hui.','🎡','wheel',1,2,35,30,NULL,1,1773655200000,1773655200000),
('daily-shop','Petit acheteur','Achète un article dans la Boutique points.','🛍️','purchase',1,2,55,40,NULL,1,1773655200000,1773655200000),
('daily-chest','Chasseur de coffres','Ouvre un ou plusieurs coffres.','📦','chest_open',1,3,50,45,NULL,1,1773655200000,1773655200000),
('daily-login','Fidèle du jour','Récupère ta récompense quotidienne.','🔥','daily_claim',1,1,30,25,NULL,1,1773655200000,1773655200000),
('daily-promo','Code secret','Utilise un code promotionnel.','🎟️','promo',1,1,60,50,'chest_common',1,1773655200000,1773655200000),
('daily-mission','Objectif accompli','Récupère la récompense d’une mission.','🎯','mission_claim',1,2,50,45,NULL,1,1773655200000,1773655200000),
('daily-community','Esprit communautaire','Contribue à une activité communautaire.','🌍','generation',3,6,65,50,'wheel_ticket',1,1773655200000,1773655200000);

INSERT OR IGNORE INTO secret_achievements(id,title,description,emoji,activity_type,threshold,reward_points,reward_xp,reward_item_key,active,created_at,updated_at) VALUES
('secret-first-gen','Première étincelle','Effectuer sa toute première génération.','⚡','generation',1,50,25,NULL,1,1773655200000,1773655200000),
('secret-wheel-10','La roue tourne','Faire tourner la roue 10 fois.','🎡','wheel',10,120,90,'wheel_ticket',1,1773655200000,1773655200000),
('secret-chest-10','Collectionneur de coffres','Ouvrir 10 coffres.','📦','chest_open',10,180,120,'chest_rare',1,1773655200000,1773655200000),
('secret-shop-5','Client fidèle','Effectuer 5 achats dans la Boutique points.','🛍️','purchase',5,140,100,NULL,1,1773655200000,1773655200000),
('secret-daily-7','Une semaine fidèle','Récupérer 7 récompenses quotidiennes.','🔥','daily_claim',7,200,150,'chest_rare',1,1773655200000,1773655200000),
('secret-promo-3','Décrypteur','Utiliser 3 codes promotionnels.','🕵️','promo',3,160,120,'chest_common',1,1773655200000,1773655200000),
('secret-gen-50','Machine lancée','Effectuer 50 générations.','🚀','generation',50,350,250,'chest_epic',1,1773655200000,1773655200000);

INSERT INTO app_settings(key,value) VALUES('daily_deals_count','3') ON CONFLICT(key) DO NOTHING;
