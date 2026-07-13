PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_settings(key, value) VALUES ('wheel_cooldown_seconds', '3600');
INSERT OR IGNORE INTO app_settings(key, value) VALUES ('starting_points', '500');

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  global_name TEXT,
  avatar TEXT,
  points INTEGER NOT NULL DEFAULT 500 CHECK(points >= 0),
  total_earned INTEGER NOT NULL DEFAULT 500,
  total_spent INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '⚡',
  description TEXT NOT NULL DEFAULT '',
  cooldown_seconds INTEGER NOT NULL DEFAULT 10 CHECK(cooldown_seconds >= 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  cipher_text TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_fifo ON inventory_lines(service_id, id);

CREATE TABLE IF NOT EXISTS generator_cooldowns (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  next_allowed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, service_id)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id),
  service_name TEXT NOT NULL,
  cipher_text TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliveries_user ON deliveries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁',
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 100 CHECK(price >= 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS product_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cipher_text TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_product_lines_fifo ON product_lines(product_id, id);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  cipher_text TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_user ON purchases(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wheel_rewards (
  id TEXT PRIMARY KEY,
  emoji TEXT NOT NULL DEFAULT '🎁',
  label TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0),
  weight INTEGER NOT NULL DEFAULT 1 CHECK(weight > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wheel_cooldowns (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  next_allowed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wheel_spins (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL,
  reward_label TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO services(id,name,emoji,description,cooldown_seconds,enabled,created_at,updated_at)
VALUES ('demo-service','Service Démo','⚡','Ajoute tes propres lignes depuis le panel admin.',10,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO products(id,name,emoji,description,price,enabled,created_at,updated_at)
VALUES ('phrase-surprise','Phrase surprise','💬','Une phrase est distribuée dans l’ordre du stock.',100,1,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO wheel_rewards(id,emoji,label,points,weight,created_at,updated_at) VALUES
('wheel-50','✨','Petit gain',50,5,unixepoch()*1000,unixepoch()*1000),
('wheel-100','🎁','Gain classique',100,4,unixepoch()*1000,unixepoch()*1000),
('wheel-250','💎','Gros gain',250,2,unixepoch()*1000,unixepoch()*1000),
('wheel-0','🍀','Retente plus tard',0,3,unixepoch()*1000,unixepoch()*1000);
-- V5 : garantit un cooldown isolé par utilisateur ET par service.
-- Cette migration conserve les timers existants.
BEGIN TRANSACTION;

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

COMMIT;
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
-- V7 : progression complète (XP, niveaux, séries, missions, inventaire,
-- coffres, classements, codes promos et événements communautaires).
PRAGMA foreign_keys = ON;
BEGIN TRANSACTION;

INSERT INTO app_settings(key,value) VALUES ('xp_generation','20') ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value) VALUES ('xp_purchase','35') ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value) VALUES ('xp_wheel','15') ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value) VALUES ('xp_chest','25') ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value) VALUES ('daily_base_points','50') ON CONFLICT(key) DO NOTHING;
INSERT INTO app_settings(key,value) VALUES ('daily_base_xp','30') ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS progress_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp_total INTEGER NOT NULL DEFAULT 0 CHECK(xp_total >= 0),
  level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
  streak_current INTEGER NOT NULL DEFAULT 0 CHECK(streak_current >= 0),
  streak_best INTEGER NOT NULL DEFAULT 0 CHECK(streak_best >= 0),
  last_daily_key TEXT,
  active_title_key TEXT,
  active_cosmetic_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 1,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  day_key TEXT NOT NULL,
  week_key TEXT NOT NULL,
  month_key TEXT NOT NULL,
  metadata_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_user_time ON activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_period ON activity_log(activity_type, week_key, month_key, created_at);

CREATE TABLE IF NOT EXISTS item_catalog (
  item_key TEXT PRIMARY KEY,
  item_type TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'common',
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '🎁',
  description TEXT NOT NULL DEFAULT '',
  stackable INTEGER NOT NULL DEFAULT 1,
  duplicate_points INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_inventory (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL REFERENCES item_catalog(item_key),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  equipped INTEGER NOT NULL DEFAULT 0,
  acquired_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,item_key)
);
CREATE INDEX IF NOT EXISTS idx_user_inventory_type ON user_inventory(user_id, quantity, item_key);

CREATE TABLE IF NOT EXISTS user_effects (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  effect_key TEXT NOT NULL,
  multiplier REAL NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,effect_key)
);
CREATE INDEX IF NOT EXISTS idx_user_effects_expiry ON user_effects(expires_at);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK(scope IN ('classic','weekly')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL,
  target INTEGER NOT NULL CHECK(target > 0),
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT REFERENCES item_catalog(item_key),
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_mission_progress (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mission_id TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0),
  claimed INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,mission_id,period_key)
);
CREATE INDEX IF NOT EXISTS idx_mission_progress_user ON user_mission_progress(user_id, claimed, updated_at DESC);

CREATE TABLE IF NOT EXISTS community_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '🌍',
  activity_type TEXT NOT NULL,
  target INTEGER NOT NULL CHECK(target > 0),
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT REFERENCES item_catalog(item_key),
  starts_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS community_event_progress (
  event_id TEXT PRIMARY KEY REFERENCES community_events(id) ON DELETE CASCADE,
  progress INTEGER NOT NULL DEFAULT 0 CHECK(progress >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS community_event_participants (
  event_id TEXT NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contribution INTEGER NOT NULL DEFAULT 0 CHECK(contribution >= 0),
  claimed INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_participants_user ON community_event_participants(user_id, claimed);

CREATE TABLE IF NOT EXISTS promo_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT REFERENCES item_catalog(item_key),
  max_uses INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at INTEGER NOT NULL DEFAULT 0,
  ends_at INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS promo_redemptions (
  code TEXT NOT NULL REFERENCES promo_codes(code) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY(code,user_id)
);

CREATE TABLE IF NOT EXISTS level_rewards (
  level INTEGER PRIMARY KEY,
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_item_key TEXT REFERENCES item_catalog(item_key),
  label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS level_reward_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL REFERENCES level_rewards(level) ON DELETE CASCADE,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,level)
);

-- Objets disponibles dans l'inventaire.
INSERT OR IGNORE INTO item_catalog(item_key,item_type,rarity,name,emoji,description,stackable,duplicate_points,metadata_json,active,created_at,updated_at) VALUES
('chest_common','chest','common','Coffre commun','📦','Récompenses courantes et petits bonus.',1,0,'{"loot":"common"}',1,unixepoch()*1000,unixepoch()*1000),
('chest_rare','chest','rare','Coffre rare','🔷','Récompenses améliorées avec plus de chances de bonus.',1,0,'{"loot":"rare"}',1,unixepoch()*1000,unixepoch()*1000),
('chest_epic','chest','epic','Coffre épique','🟣','Gains importants, boosts et objets cosmétiques.',1,0,'{"loot":"epic"}',1,unixepoch()*1000,unixepoch()*1000),
('chest_legendary','chest','legendary','Coffre légendaire','🟡','Très gros gains et récompenses exclusives.',1,0,'{"loot":"legendary"}',1,unixepoch()*1000,unixepoch()*1000),
('chest_event','chest','event','Coffre événementiel','🌍','Récompenses spéciales liées aux événements.',1,0,'{"loot":"event"}',1,unixepoch()*1000,unixepoch()*1000),
('wheel_ticket','ticket','rare','Ticket de roue','🎟️','Permet de tourner la roue même pendant le cooldown.',1,0,'{}',1,unixepoch()*1000,unixepoch()*1000),
('xp_boost_2x','boost','epic','Boost XP ×2','🔥','Double l’XP gagnée pendant 60 minutes.',1,0,'{"duration_seconds":3600,"multiplier":2}',1,unixepoch()*1000,unixepoch()*1000),
('streak_protector','protector','rare','Protecteur de série','🛡️','Protège automatiquement une série après un seul jour manqué.',1,0,'{}',1,unixepoch()*1000,unixepoch()*1000),
('title_pioneer','title','rare','Pionnier','🚀','Titre réservé aux premiers membres du système de progression.',0,250,'{}',1,unixepoch()*1000,unixepoch()*1000),
('title_veteran','title','epic','Vétéran','🏆','Titre obtenu en progressant régulièrement.',0,500,'{}',1,unixepoch()*1000,unixepoch()*1000),
('title_legend','title','legendary','Légende Opium','👑','Titre prestigieux réservé aux meilleurs niveaux.',0,1200,'{}',1,unixepoch()*1000,unixepoch()*1000),
('cosmetic_red_aura','cosmetic','rare','Aura rouge','🔴','Ajoute une aura rouge au profil.',0,300,'{"class":"aura-red"}',1,unixepoch()*1000,unixepoch()*1000),
('cosmetic_neon_frame','cosmetic','epic','Cadre néon','💠','Cadre de profil lumineux.',0,650,'{"class":"frame-neon"}',1,unixepoch()*1000,unixepoch()*1000),
('cosmetic_crown','cosmetic','legendary','Couronne animée','👑','Cosmétique légendaire pour le profil.',0,1500,'{"class":"crown-legendary"}',1,unixepoch()*1000,unixepoch()*1000),
('event_token','event','event','Jeton événementiel','🌐','Objet de collection obtenu pendant un événement communautaire.',1,0,'{}',1,unixepoch()*1000,unixepoch()*1000);

-- Missions classiques permanentes.
INSERT OR IGNORE INTO missions(id,scope,title,description,activity_type,target,reward_points,reward_xp,reward_item_key,active,sort_order,created_at,updated_at) VALUES
('classic-first-gen','classic','Première génération','Utilise le générateur une fois.','generation',1,100,75,'chest_common',1,10,unixepoch()*1000,unixepoch()*1000),
('classic-gen-10','classic','Habitué du générateur','Effectue 10 générations.','generation',10,250,200,'chest_rare',1,20,unixepoch()*1000,unixepoch()*1000),
('classic-gen-50','classic','Machine à générer','Effectue 50 générations.','generation',50,750,600,'chest_epic',1,30,unixepoch()*1000,unixepoch()*1000),
('classic-first-wheel','classic','Tour de chance','Utilise la roue une fois.','wheel',1,100,75,'wheel_ticket',1,40,unixepoch()*1000,unixepoch()*1000),
('classic-open-3','classic','Chasseur de coffres','Ouvre 3 coffres.','chest_open',3,200,150,'xp_boost_2x',1,50,unixepoch()*1000,unixepoch()*1000),
('classic-shop','classic','Premier achat','Achète un article dans la Boutique points.','purchase',1,150,100,'chest_common',1,60,unixepoch()*1000,unixepoch()*1000),
('classic-daily-7','classic','Une semaine fidèle','Récupère 7 récompenses quotidiennes.','daily_claim',7,400,300,'streak_protector',1,70,unixepoch()*1000,unixepoch()*1000);

-- Missions hebdomadaires : la progression repart chaque lundi.
INSERT OR IGNORE INTO missions(id,scope,title,description,activity_type,target,reward_points,reward_xp,reward_item_key,active,sort_order,created_at,updated_at) VALUES
('weekly-gen-5','weekly','Générateur actif','Effectue 5 générations cette semaine.','generation',5,180,140,'chest_common',1,110,unixepoch()*1000,unixepoch()*1000),
('weekly-wheel-3','weekly','Chance régulière','Utilise la roue 3 fois cette semaine.','wheel',3,180,140,'wheel_ticket',1,120,unixepoch()*1000,unixepoch()*1000),
('weekly-chest-2','weekly','Ouverture hebdomadaire','Ouvre 2 coffres cette semaine.','chest_open',2,220,180,'chest_rare',1,130,unixepoch()*1000,unixepoch()*1000),
('weekly-daily-5','weekly','Connexion régulière','Récupère 5 récompenses quotidiennes cette semaine.','daily_claim',5,300,250,'xp_boost_2x',1,140,unixepoch()*1000,unixepoch()*1000);

INSERT OR IGNORE INTO level_rewards(level,reward_points,reward_item_key,label) VALUES
(2,100,'chest_common','Bienvenue dans la progression'),
(3,150,'title_pioneer','Titre Pionnier'),
(5,300,'chest_rare','Palier niveau 5'),
(10,750,'chest_epic','Palier niveau 10'),
(15,1200,'title_veteran','Titre Vétéran'),
(20,2000,'chest_legendary','Palier niveau 20'),
(30,3500,'title_legend','Titre Légende Opium');

-- Événement de lancement actif jusqu'en 2030, modifiable depuis l'API admin.
INSERT OR IGNORE INTO community_events(id,title,description,emoji,activity_type,target,reward_points,reward_xp,reward_item_key,starts_at,ends_at,active,created_at,updated_at)
VALUES('community-launch','Objectif communautaire de lancement','La communauté doit effectuer 1 000 générations.','🌍','generation',1000,500,350,'chest_event',unixepoch()*1000,1893456000000,1,unixepoch()*1000,unixepoch()*1000);
INSERT OR IGNORE INTO community_event_progress(event_id,progress,updated_at)
VALUES('community-launch',0,unixepoch()*1000);

-- Code de bienvenue modifiable ou désactivable par un administrateur.
INSERT OR IGNORE INTO promo_codes(code,description,reward_points,reward_xp,reward_item_key,max_uses,used_count,starts_at,ends_at,active,created_at,updated_at)
VALUES('OPIUM2026','Code de lancement du système de progression.',250,150,'chest_common',500,0,0,1893456000000,1,unixepoch()*1000,unixepoch()*1000);

COMMIT;
