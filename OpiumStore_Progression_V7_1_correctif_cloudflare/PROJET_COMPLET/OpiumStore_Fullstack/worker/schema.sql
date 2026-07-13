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
