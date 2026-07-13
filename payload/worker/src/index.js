const DISCORD_API = "https://discord.com/api/v10";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const OAUTH_STATE_TTL_SECONDS = 600;

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return cors(new Response(null, {status: 204}), env, request);
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/health" && request.method === "GET") return json({ok:true, service:"opiumstore-api", version:"vip-daily-limits-v6"}, 200, env, request);
      if (path === "/auth/discord/start" && request.method === "GET") return await startDiscordAuth(env);
      if (path === "/auth/discord/callback" && request.method === "GET") return await discordCallback(request, env);
      if (path === "/auth/exchange" && request.method === "POST") return await exchangeLoginCode(request, env);

      validateOrigin(request, env);
      const user = await requireUser(request, env);

      if (path === "/api/me" && request.method === "GET") return json({user: publicUser(user, env)}, 200, env, request);
      if (path === "/api/logout" && request.method === "POST") return await logout(request, user, env);
      if (path === "/api/catalog" && request.method === "GET") return await getCatalog(user, env, request);
      if (path === "/api/wallet" && request.method === "GET") return await getWallet(user, env, request);
      if (path === "/api/generate" && request.method === "POST") return await generateLine(request, user, env);
      if (path === "/api/shop/purchase" && request.method === "POST") return await purchaseProduct(request, user, env);
      if (path === "/api/wheel/spin" && request.method === "POST") return await spinWheel(request, user, env);

      if (path.startsWith("/api/admin/")) {
        requireAdmin(user, env);
        return await handleAdmin(request, user, env, path);
      }

      return json({error:"Route introuvable."}, 404, env, request);
    } catch (error) {
      const status = Number(error?.status || 500);
      const message = error instanceof Error ? error.message : String(error || "Erreur inconnue");
      if (status >= 500) console.error("Worker error:", error);
      return json({
        error: status >= 500 ? "Erreur interne du serveur." : message,
        ...(error?.extra && typeof error.extra === "object" ? error.extra : {})
      }, status, env, request);
    }
  }
};

function httpError(status, message, extra) {
  const error = new Error(message);
  error.status = status;
  error.extra = extra;
  return error;
}

function cors(response, env, request) {
  const headers = new Headers(response.headers);
  const origin = request?.headers?.get("Origin");
  if (origin && origin === env.FRONTEND_ORIGIN) headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {status:response.status, statusText:response.statusText, headers});
}

function json(data, status, env, request) {
  return cors(new Response(JSON.stringify(data), {status, headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}}), env, request);
}

function validateOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== env.FRONTEND_ORIGIN) throw httpError(403, "Origine non autorisée.");
}

async function parseJson(request) {
  try { return await request.json(); } catch { throw httpError(400, "Corps JSON invalide."); }
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.split(/;\s*/).find(part => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

function redirect(location, cookie) {
  const headers = new Headers({Location:location, "Cache-Control":"no-store"});
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, {status:302, headers});
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return base64Url(data);
}

function base64Url(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

function fromBase64(value) {
  const normalized = value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}

async function sha256(value) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function encryptionKey(env) {
  if (!env.ENCRYPTION_KEY) throw httpError(500, "ENCRYPTION_KEY manquante.");
  const raw = fromBase64(env.ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw httpError(500, "ENCRYPTION_KEY doit contenir 32 octets en Base64.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptText(value, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await encryptionKey(env), new TextEncoder().encode(value));
  return {cipher_text:base64Url(cipher), iv:base64Url(iv)};
}

async function decryptText(cipherText, iv, env) {
  const plain = await crypto.subtle.decrypt({name:"AES-GCM", iv:fromBase64(iv)}, await encryptionKey(env), fromBase64(cipherText));
  return new TextDecoder().decode(plain);
}

function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48) || `item-${randomToken(5)}`;
}

function avatarUrl(user) {
  if (user.avatar) return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.avatar}.png?size=128`;
  const index = Number((BigInt(user.discord_id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function adminIds(env) {
  return new Set(String(env.ADMIN_DISCORD_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
}

function publicUser(user, env) {
  return {
    discord_id:user.discord_id,
    username:user.username,
    display_name:user.global_name || user.username,
    avatar_url:avatarUrl(user),
    points:Number(user.points),
    total_earned:Number(user.total_earned),
    total_spent:Number(user.total_spent),
    is_admin:adminIds(env).has(user.discord_id)
  };
}

async function startDiscordAuth(env) {
  for (const key of ["DISCORD_CLIENT_ID","DISCORD_CLIENT_SECRET","DISCORD_REDIRECT_URI","FRONTEND_ORIGIN"]) if (!env[key]) throw httpError(500, `${key} manquante.`);
  const state = randomToken(24);
  const params = new URLSearchParams({response_type:"code",client_id:env.DISCORD_CLIENT_ID,scope:"identify",state,redirect_uri:env.DISCORD_REDIRECT_URI,prompt:"consent"});
  const cookie = `opium_oauth_state=${encodeURIComponent(state)}; Max-Age=${OAUTH_STATE_TTL_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return redirect(`https://discord.com/oauth2/authorize?${params}`, cookie);
}

async function discordCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookieValue(request, "opium_oauth_state");
  const clearCookie = "opium_oauth_state=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
  if (!code || !state || !expected || state !== expected) return redirect(`${env.FRONTEND_ORIGIN}/#auth_error=${encodeURIComponent("Connexion Discord refusée ou état OAuth invalide.")}`, clearCookie);

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:env.DISCORD_CLIENT_ID,client_secret:env.DISCORD_CLIENT_SECRET,grant_type:"authorization_code",code,redirect_uri:env.DISCORD_REDIRECT_URI})
  });
  if (!tokenResponse.ok) return redirect(`${env.FRONTEND_ORIGIN}/#auth_error=${encodeURIComponent("Impossible d’échanger le code Discord.")}`, clearCookie);
  const token = await tokenResponse.json();
  const userResponse = await fetch(`${DISCORD_API}/users/@me`, {headers:{Authorization:`Bearer ${token.access_token}`}});
  if (!userResponse.ok) return redirect(`${env.FRONTEND_ORIGIN}/#auth_error=${encodeURIComponent("Impossible de lire le profil Discord.")}`, clearCookie);
  const discord = await userResponse.json();
  const now = Date.now();
  const startingPoints = Number(await setting(env, "starting_points", "500"));

  await env.DB.prepare(`INSERT INTO users(discord_id,username,global_name,avatar,points,total_earned,total_spent,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,?,?)
    ON CONFLICT(discord_id) DO UPDATE SET username=excluded.username,global_name=excluded.global_name,avatar=excluded.avatar,updated_at=excluded.updated_at`)
    .bind(discord.id, discord.username, discord.global_name || null, discord.avatar || null, startingPoints, startingPoints, now, now).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE discord_id=?").bind(discord.id).first();
  const rawCode = randomToken(32);
  await env.DB.prepare("INSERT INTO login_codes(code_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)").bind(await sha256(rawCode), user.id, now + LOGIN_CODE_TTL_MS, now).run();
  return redirect(`${env.FRONTEND_ORIGIN}/#auth_code=${encodeURIComponent(rawCode)}`, clearCookie);
}

async function exchangeLoginCode(request, env) {
  validateOrigin(request, env);
  const {code} = await parseJson(request);
  if (!code) throw httpError(400, "Code de connexion manquant.");
  const now = Date.now();
  const hash = await sha256(code);
  const record = await env.DB.prepare("DELETE FROM login_codes WHERE code_hash=? AND expires_at>? RETURNING user_id").bind(hash, now).first();
  if (!record) throw httpError(401, "Code de connexion expiré ou déjà utilisé.");
  const rawToken = randomToken(36);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO sessions(id,token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?,?)").bind(id, await sha256(rawToken), record.user_id, now + SESSION_TTL_MS, now).run();
  return json({token:rawToken, expires_at:now + SESSION_TTL_MS}, 200, env, request);
}

async function requireUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw httpError(401, "Connexion requise.");
  const token = auth.slice(7).trim();
  const row = await env.DB.prepare(`SELECT u.*,s.id AS session_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(await sha256(token), Date.now()).first();
  if (!row) throw httpError(401, "Session invalide ou expirée.");
  return row;
}

function requireAdmin(user, env) {
  if (!adminIds(env).has(user.discord_id)) throw httpError(403, "Accès administrateur requis.");
}

async function logout(request, user, env) {
  await env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(user.session_id).run();
  return json({ok:true}, 200, env, request);
}

async function setting(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key=?").bind(key).first();
  return row?.value ?? fallback;
}

async function getCatalog(user, env, request) {
  const now = Date.now();
  const services = await env.DB.prepare(`SELECT s.id,s.name,s.emoji,s.description,s.cooldown_seconds,s.enabled,COUNT(i.id) AS stock,MAX(0,COALESCE(c.next_allowed_at,0)-?) AS cooldown_ms
    FROM services s LEFT JOIN inventory_lines i ON i.service_id=s.id LEFT JOIN generator_cooldowns c ON c.user_id=? AND c.service_id=s.id
    WHERE s.enabled=1 GROUP BY s.id ORDER BY s.created_at`).bind(now,user.id).all();
  const products = await env.DB.prepare(`SELECT p.id,p.name,p.emoji,p.description,p.price,p.enabled,COUNT(l.id) AS stock FROM products p LEFT JOIN product_lines l ON l.product_id=p.id WHERE p.enabled=1 GROUP BY p.id ORDER BY p.created_at`).all();
  const wheel = await env.DB.prepare("SELECT id,emoji,label,points,weight FROM wheel_rewards ORDER BY created_at").all();
  const wheelCooldown = await env.DB.prepare("SELECT next_allowed_at FROM wheel_cooldowns WHERE user_id=?").bind(user.id).first();
  const summary = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM deliveries WHERE user_id=?) AS generations,
    (SELECT COUNT(*) FROM purchases WHERE user_id=?) AS purchases`).bind(user.id,user.id).first();
  const dayKey = brusselsDayKey(now);
  const dailyGenerationLimit = await getUserDailyGenerationLimit(user, env);
  const generationsToday = await getDailyGenerationUsage(user, env, dayKey);
  const dailyGenerationRemaining = dailyGenerationLimit === 0 ? -1 : Math.max(0,dailyGenerationLimit-generationsToday);
  return json({
    services:services.results.map(s => ({...s,stock:Number(s.stock),cooldown_remaining:Math.ceil(Number(s.cooldown_ms)/1000)})),
    products:products.results.map(p => ({...p,stock:Number(p.stock),price:Number(p.price)})),
    wheel_rewards:wheel.results.map(r => ({...r,points:Number(r.points),weight:Number(r.weight)})),
    wheel_cooldown_remaining:Math.ceil(Math.max(0,Number(wheelCooldown?.next_allowed_at || 0)-now)/1000),
    daily_generation_limit:dailyGenerationLimit,
    generations_today:generationsToday,
    daily_generation_remaining:dailyGenerationRemaining,
    daily_reset_timezone:"Europe/Brussels",
    summary:{generations:Number(summary?.generations || 0),purchases:Number(summary?.purchases || 0)}
  }, 200, env, request);
}

async function getWallet(user, env, request) {
  const deliveries = await env.DB.prepare("SELECT id,service_name AS title,cipher_text,iv,created_at FROM deliveries WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
  const purchases = await env.DB.prepare("SELECT id,product_name AS title,cipher_text,iv,created_at FROM purchases WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();
  const items = [];
  for (const row of deliveries.results) items.push({id:row.id,kind:"generation",title:row.title,value:await decryptText(row.cipher_text,row.iv,env),created_at:Number(row.created_at)});
  for (const row of purchases.results) items.push({id:row.id,kind:"purchase",title:row.title,value:await decryptText(row.cipher_text,row.iv,env),created_at:Number(row.created_at)});
  items.sort((a,b) => b.created_at-a.created_at);
  return json({items:items.slice(0,150)}, 200, env, request);
}

async function getUserGenerationCooldownSeconds(user, env) {
  const key = `user_generation_cooldown:${user.discord_id}`;
  const defaultRaw = Number(await setting(env, "default_generation_cooldown_seconds", "900"));
  const safeDefault = Number.isFinite(defaultRaw) ? Math.max(0, Math.min(31536000, Math.trunc(defaultRaw))) : 900;
  const raw = Number(await setting(env, key, String(safeDefault)));
  if (!Number.isFinite(raw)) return safeDefault;
  return Math.max(0, Math.min(31536000, Math.trunc(raw)));
}


function brusselsDayKey(timestamp = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone:"Europe/Brussels",
    year:"numeric",
    month:"2-digit",
    day:"2-digit"
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type,p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function getUserDailyGenerationLimit(user, env) {
  const key = `user_daily_generation_limit:${user.discord_id}`;
  const defaultRaw = Number(await setting(env, "default_daily_generation_limit", "6"));
  const safeDefault = Number.isInteger(defaultRaw) ? Math.max(0, Math.min(100000, defaultRaw)) : 6;
  const raw = Number(await setting(env, key, String(safeDefault)));
  if (!Number.isInteger(raw)) return safeDefault;
  return Math.max(0, Math.min(100000, raw));
}

async function getDailyGenerationUsage(user, env, dayKey = brusselsDayKey()) {
  const row = await env.DB.prepare("SELECT used FROM daily_generation_usage WHERE user_id=? AND day_key=?").bind(user.id,dayKey).first();
  return Math.max(0, Number(row?.used || 0));
}

async function reserveDailyGeneration(user, env) {
  const now = Date.now();
  const dayKey = brusselsDayKey(now);
  const limit = await getUserDailyGenerationLimit(user, env);
  let row;
  if (limit === 0) {
    row = await env.DB.prepare(`INSERT INTO daily_generation_usage(user_id,day_key,used,updated_at)
      VALUES(?,?,1,?)
      ON CONFLICT(user_id,day_key) DO UPDATE SET used=daily_generation_usage.used+1,updated_at=excluded.updated_at
      RETURNING used`).bind(user.id,dayKey,now).first();
  } else {
    row = await env.DB.prepare(`INSERT INTO daily_generation_usage(user_id,day_key,used,updated_at)
      VALUES(?,?,1,?)
      ON CONFLICT(user_id,day_key) DO UPDATE SET used=daily_generation_usage.used+1,updated_at=excluded.updated_at
      WHERE daily_generation_usage.used<?
      RETURNING used`).bind(user.id,dayKey,now,limit).first();
  }
  if (!row) {
    const used = await getDailyGenerationUsage(user, env, dayKey);
    throw httpError(429, `Limite journalière atteinte : ${used}/${limit} génération(s).`, {
      daily_limit:limit,
      generations_today:used,
      day_key:dayKey
    });
  }
  return {dayKey,limit,used:Number(row.used),reserved:true};
}

async function releaseDailyGeneration(user, env, quota) {
  if (!quota?.reserved) return;
  await env.DB.prepare(`UPDATE daily_generation_usage
    SET used=MAX(0,used-1),updated_at=?
    WHERE user_id=? AND day_key=?`).bind(Date.now(),user.id,quota.dayKey).run();
}

async function acquireGeneratorCooldown(user, service, env) {
  const now = Date.now();
  const cooldownSeconds = await getUserGenerationCooldownSeconds(user, env);
  const next = now + cooldownSeconds * 1000;
  const lock = await env.DB.prepare(`INSERT INTO generator_cooldowns(user_id,service_id,next_allowed_at) VALUES(?,?,?)
    ON CONFLICT(user_id,service_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at
    WHERE generator_cooldowns.next_allowed_at<=? RETURNING next_allowed_at`).bind(user.id,service.id,next,now).first();
  if (!lock) {
    const row = await env.DB.prepare("SELECT next_allowed_at FROM generator_cooldowns WHERE user_id=? AND service_id=?").bind(user.id,service.id).first();
    const retryAfter = Math.max(0, Math.ceil((Number(row?.next_allowed_at || now)-now)/1000));
    throw httpError(429, `Cooldown actif : ${retryAfter} seconde(s).`, {retry_after:retryAfter});
  }
  return next;
}

async function generateLine(request, user, env) {
  const {service_id} = await parseJson(request);
  const service = await env.DB.prepare("SELECT * FROM services WHERE id=? AND enabled=1").bind(service_id).first();
  if (!service) throw httpError(404, "Service indisponible.");

  const quota = await reserveDailyGeneration(user, env);
  let nextAllowed;
  try {
    nextAllowed = await acquireGeneratorCooldown(user, service, env);
  } catch (error) {
    await releaseDailyGeneration(user, env, quota);
    throw error;
  }

  const line = await env.DB.prepare(`DELETE FROM inventory_lines WHERE id=(SELECT id FROM inventory_lines WHERE service_id=? ORDER BY id LIMIT 1) RETURNING id,cipher_text,iv`).bind(service.id).first();
  if (!line) {
    await env.DB.prepare("UPDATE generator_cooldowns SET next_allowed_at=0 WHERE user_id=? AND service_id=?").bind(user.id,service.id).run();
    await releaseDailyGeneration(user, env, quota);
    throw httpError(409, "Stock épuisé.");
  }

  const id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare("INSERT INTO deliveries(id,user_id,service_id,service_name,cipher_text,iv,created_at) VALUES(?,?,?,?,?,?,?)").bind(id,user.id,service.id,service.name,line.cipher_text,line.iv,now).run();
  return json({
    delivery:{id,title:service.name,value:await decryptText(line.cipher_text,line.iv,env),created_at:now},
    next_allowed_at:nextAllowed,
    daily_generation_limit:quota.limit,
    generations_today:quota.used,
    daily_generation_remaining:quota.limit === 0 ? -1 : Math.max(0,quota.limit-quota.used)
  }, 200, env, request);
}

async function purchaseProduct(request, user, env) {
  const {product_id} = await parseJson(request);
  const product = await env.DB.prepare("SELECT * FROM products WHERE id=? AND enabled=1").bind(product_id).first();
  if (!product) throw httpError(404, "Récompense indisponible.");
  const price = Number(product.price), now = Date.now();
  const deducted = await env.DB.prepare("UPDATE users SET points=points-?,total_spent=total_spent+?,updated_at=? WHERE id=? AND points>=? RETURNING points").bind(price,price,now,user.id,price).first();
  if (!deducted) throw httpError(409, "Points insuffisants.");
  const line = await env.DB.prepare(`DELETE FROM product_lines WHERE id=(SELECT id FROM product_lines WHERE product_id=? ORDER BY id LIMIT 1) RETURNING id,cipher_text,iv`).bind(product.id).first();
  if (!line) {
    await env.DB.prepare("UPDATE users SET points=points+?,total_spent=MAX(0,total_spent-?),updated_at=? WHERE id=?").bind(price,price,now,user.id).run();
    throw httpError(409, "Cette récompense vient d’être épuisée. Tes points ont été remboursés.");
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO purchases(id,user_id,product_id,product_name,price,cipher_text,iv,created_at) VALUES(?,?,?,?,?,?,?,?)").bind(id,user.id,product.id,product.name,price,line.cipher_text,line.iv,now).run();
  return json({purchase:{id,title:product.name,value:await decryptText(line.cipher_text,line.iv,env),price,created_at:now},points:Number(deducted.points)}, 200, env, request);
}

async function spinWheel(request, user, env) {
  const now = Date.now(), cooldownSeconds = Number(await setting(env,"wheel_cooldown_seconds","3600")), next = now + cooldownSeconds*1000;
  const lock = await env.DB.prepare(`INSERT INTO wheel_cooldowns(user_id,next_allowed_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at WHERE wheel_cooldowns.next_allowed_at<=? RETURNING next_allowed_at`).bind(user.id,next,now).first();
  if (!lock) {
    const row = await env.DB.prepare("SELECT next_allowed_at FROM wheel_cooldowns WHERE user_id=?").bind(user.id).first();
    throw httpError(429, `Roue disponible dans ${Math.ceil((Number(row.next_allowed_at)-now)/1000)} seconde(s).`);
  }
  const rewards = (await env.DB.prepare("SELECT * FROM wheel_rewards ORDER BY created_at").all()).results;
  if (!rewards.length) {
    await env.DB.prepare("UPDATE wheel_cooldowns SET next_allowed_at=0 WHERE user_id=?").bind(user.id).run();
    throw httpError(409, "Aucun gain configuré.");
  }
  const total = rewards.reduce((sum,r)=>sum+Number(r.weight),0);
  let pick = Math.random()*total, chosen = rewards[0];
  for (const reward of rewards) { pick -= Number(reward.weight); if (pick <= 0) { chosen = reward; break; } }
  const points = Number(chosen.points);
  if (points > 0) await env.DB.prepare("UPDATE users SET points=points+?,total_earned=total_earned+?,updated_at=? WHERE id=?").bind(points,points,now,user.id).run();
  await env.DB.prepare("INSERT INTO wheel_spins(id,user_id,reward_id,reward_label,points,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,chosen.id,chosen.label,points,now).run();
  return json({reward:{id:chosen.id,emoji:chosen.emoji,label:chosen.label,points},next_allowed_at:next}, 200, env, request);
}

async function handleAdmin(request, user, env, path) {
  if (path === "/api/admin/overview" && request.method === "GET") return adminOverview(request, env);
  if (path === "/api/admin/history" && request.method === "GET") return adminHistory(request, env);
  if (path === "/api/admin/services" && request.method === "POST") return createService(request, env);
  if (path === "/api/admin/products" && request.method === "POST") return createProduct(request, env);
  if (path === "/api/admin/wheel" && request.method === "POST") return createWheelReward(request, env);
  if (path === "/api/admin/settings" && request.method === "PUT") return updateSettings(request, env);

  let match = path.match(/^\/api\/admin\/services\/([^/]+)$/);
  if (match && request.method === "PUT") return updateService(request, env, match[1]);
  if (match && request.method === "DELETE") return deleteService(request, env, match[1]);
  match = path.match(/^\/api\/admin\/services\/([^/]+)\/restock$/);
  if (match && request.method === "POST") return restock(request, env, "service", match[1]);
  match = path.match(/^\/api\/admin\/services\/([^/]+)\/stock$/);
  if (match && request.method === "DELETE") return clearStock(request, env, "service", match[1]);

  match = path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if (match && request.method === "PUT") return updateProduct(request, env, match[1]);
  if (match && request.method === "DELETE") return deleteProduct(request, env, match[1]);
  match = path.match(/^\/api\/admin\/products\/([^/]+)\/restock$/);
  if (match && request.method === "POST") return restock(request, env, "product", match[1]);
  match = path.match(/^\/api\/admin\/products\/([^/]+)\/stock$/);
  if (match && request.method === "DELETE") return clearStock(request, env, "product", match[1]);

  match = path.match(/^\/api\/admin\/wheel\/([^/]+)$/);
  if (match && request.method === "PUT") return updateWheelReward(request, env, match[1]);
  if (match && request.method === "DELETE") return deleteWheelReward(request, env, match[1]);
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/points$/);
  if (match && request.method === "POST") return adjustPoints(request, env, match[1]);
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/generation-cooldown$/);
  if (match && (request.method === "PUT" || request.method === "POST")) return setUserGenerationCooldown(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/generation-limit$/);
  if (match && (request.method === "PUT" || request.method === "POST")) return setUserDailyGenerationLimit(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/timer$/);
  if (match && (request.method === "PUT" || request.method === "POST")) return setUserTimer(request, env, decodeURIComponent(match[1]));
  throw httpError(404, "Route admin introuvable.");
}

async function getAdminHistoryData(env) {
  const generations = await env.DB.prepare(`SELECT d.id,d.service_id,d.service_name,d.created_at,
    u.discord_id,u.username,u.global_name AS display_name
    FROM deliveries d JOIN users u ON u.id=d.user_id
    ORDER BY d.created_at DESC LIMIT 250`).all();
  const purchases = await env.DB.prepare(`SELECT p.id,p.product_id,p.product_name,p.price,p.created_at,
    u.discord_id,u.username,u.global_name AS display_name
    FROM purchases p JOIN users u ON u.id=p.user_id
    ORDER BY p.created_at DESC LIMIT 250`).all();
  const totals = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM deliveries) AS generations,
    (SELECT COUNT(*) FROM purchases) AS purchases,
    (SELECT COALESCE(SUM(price),0) FROM purchases) AS points_spent`).first();
  return {
    generations: generations.results.map(row => ({...row, created_at:Number(row.created_at)})),
    purchases: purchases.results.map(row => ({...row, price:Number(row.price), created_at:Number(row.created_at)})),
    totals: {
      generations:Number(totals?.generations || 0),
      purchases:Number(totals?.purchases || 0),
      points_spent:Number(totals?.points_spent || 0)
    }
  };
}

async function getAdminTimersData(env) {
  const now = Date.now();
  const generator = await env.DB.prepare(`SELECT u.discord_id,u.username,u.global_name AS display_name,
    gc.service_id,s.name AS service_name,gc.next_allowed_at
    FROM generator_cooldowns gc
    JOIN users u ON u.id=gc.user_id
    JOIN services s ON s.id=gc.service_id
    WHERE gc.next_allowed_at>?
    ORDER BY gc.next_allowed_at DESC LIMIT 500`).bind(now).all();
  const wheel = await env.DB.prepare(`SELECT u.discord_id,u.username,u.global_name AS display_name,wc.next_allowed_at
    FROM wheel_cooldowns wc
    JOIN users u ON u.id=wc.user_id
    WHERE wc.next_allowed_at>?
    ORDER BY wc.next_allowed_at DESC LIMIT 500`).bind(now).all();
  return {
    generator: generator.results.map(row => ({...row,next_allowed_at:Number(row.next_allowed_at)})),
    wheel: wheel.results.map(row => ({...row,next_allowed_at:Number(row.next_allowed_at)}))
  };
}

async function adminOverview(request, env) {
  // Requêtes séquentielles : plus stables avec D1 que plusieurs lectures concurrentes.
  const services = await env.DB.prepare(`SELECT s.*,COUNT(i.id) AS stock FROM services s LEFT JOIN inventory_lines i ON i.service_id=s.id GROUP BY s.id ORDER BY s.created_at`).all();
  const products = await env.DB.prepare(`SELECT p.*,COUNT(l.id) AS stock FROM products p LEFT JOIN product_lines l ON l.product_id=p.id GROUP BY p.id ORDER BY p.created_at`).all();
  const wheel = await env.DB.prepare("SELECT * FROM wheel_rewards ORDER BY created_at").all();
  const dayKey = brusselsDayKey();
  const users = await env.DB.prepare(`SELECT u.discord_id,u.username,u.global_name AS display_name,u.points,u.total_earned,u.total_spent,
    COALESCE(
      CAST(gen_setting.value AS INTEGER),
      CAST((SELECT value FROM app_settings WHERE key='default_generation_cooldown_seconds') AS INTEGER),
      900
    ) AS generation_cooldown_seconds,
    COALESCE(
      CAST(limit_setting.value AS INTEGER),
      CAST((SELECT value FROM app_settings WHERE key='default_daily_generation_limit') AS INTEGER),
      6
    ) AS daily_generation_limit,
    COALESCE((SELECT dgu.used FROM daily_generation_usage dgu WHERE dgu.user_id=u.id AND dgu.day_key=?),0) AS generations_today,
    (SELECT COUNT(*) FROM deliveries d WHERE d.user_id=u.id) AS generations,
    (SELECT COUNT(*) FROM purchases p WHERE p.user_id=u.id) AS purchases
    FROM users u
    LEFT JOIN app_settings gen_setting ON gen_setting.key=('user_generation_cooldown:' || u.discord_id)
    LEFT JOIN app_settings limit_setting ON limit_setting.key=('user_daily_generation_limit:' || u.discord_id)
    ORDER BY u.created_at DESC LIMIT 200`).bind(dayKey).all();
  const settingsRows = await env.DB.prepare("SELECT key,value FROM app_settings").all();
  const history = await getAdminHistoryData(env);
  const timers = await getAdminTimersData(env);
  const settings = Object.fromEntries(settingsRows.results.map(x => [x.key,x.value]));
  return json({
    api_version:"vip-daily-limits-v6",
    services:services.results.map(x=>({...x,stock:Number(x.stock),cooldown_seconds:Number(x.cooldown_seconds),enabled:!!x.enabled})),
    products:products.results.map(x=>({...x,stock:Number(x.stock),price:Number(x.price),enabled:!!x.enabled})),
    wheel_rewards:wheel.results.map(x=>({...x,points:Number(x.points),weight:Number(x.weight)})),
    users:users.results.map(x=>({...x,
      points:Number(x.points),
      total_earned:Number(x.total_earned),
      total_spent:Number(x.total_spent),
      generations:Number(x.generations),
      purchases:Number(x.purchases),
      generation_cooldown_seconds:Number(x.generation_cooldown_seconds ?? 900),
      daily_generation_limit:Number(x.daily_generation_limit ?? 6),
      generations_today:Number(x.generations_today || 0)
    })),
    settings,
    history,
    timers,
    daily_usage_day:dayKey,
    daily_usage_timezone:"Europe/Brussels"
  },200,env,request);
}

async function adminHistory(request, env) {
  return json(await getAdminHistoryData(env), 200, env, request);
}

async function createService(request, env) {
  const body = await parseJson(request), name = String(body.name || "").trim();
  if (!name) throw httpError(400,"Nom requis.");
  let id = slug(name), suffix = 2;
  while (await env.DB.prepare("SELECT 1 FROM services WHERE id=?").bind(id).first()) id = `${slug(name)}-${suffix++}`;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO services(id,name,emoji,description,cooldown_seconds,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)").bind(id,name,String(body.emoji||"⚡").slice(0,16),String(body.description||"").slice(0,300),Math.max(0,Number(body.cooldown_seconds||0)),now,now).run();
  return json({ok:true,id},201,env,request);
}

async function updateService(request, env, id) {
  const body = await parseJson(request), current = await env.DB.prepare("SELECT * FROM services WHERE id=?").bind(id).first();
  if (!current) throw httpError(404,"Service introuvable.");
  await env.DB.prepare("UPDATE services SET name=?,emoji=?,description=?,cooldown_seconds=?,enabled=?,updated_at=? WHERE id=?").bind(
    String(body.name ?? current.name).trim().slice(0,80),String(body.emoji ?? current.emoji).slice(0,16),String(body.description ?? current.description).slice(0,300),Math.max(0,Number(body.cooldown_seconds ?? current.cooldown_seconds)),body.enabled===undefined?current.enabled:(body.enabled?1:0),Date.now(),id).run();
  return json({ok:true},200,env,request);
}

async function deleteService(request, env, id) {
  const history = await env.DB.prepare("SELECT COUNT(*) AS n FROM deliveries WHERE service_id=?").bind(id).first();
  if (Number(history?.n || 0) > 0) throw httpError(409,"Ce service possède un historique. Désactive-le au lieu de le supprimer.");
  await env.DB.prepare("DELETE FROM services WHERE id=?").bind(id).run();
  return json({ok:true},200,env,request);
}

async function createProduct(request, env) {
  const body = await parseJson(request), name = String(body.name || "").trim(); if (!name) throw httpError(400,"Nom requis.");
  let id=slug(name),suffix=2; while(await env.DB.prepare("SELECT 1 FROM products WHERE id=?").bind(id).first()) id=`${slug(name)}-${suffix++}`;
  const now=Date.now(); await env.DB.prepare("INSERT INTO products(id,name,emoji,description,price,enabled,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)").bind(id,name,String(body.emoji||"🎁").slice(0,16),String(body.description||"").slice(0,300),Math.max(0,Number(body.price||0)),now,now).run();
  return json({ok:true,id},201,env,request);
}

async function updateProduct(request, env, id) {
  const body=await parseJson(request),current=await env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first(); if(!current)throw httpError(404,"Récompense introuvable.");
  await env.DB.prepare("UPDATE products SET name=?,emoji=?,description=?,price=?,enabled=?,updated_at=? WHERE id=?").bind(String(body.name??current.name).trim().slice(0,80),String(body.emoji??current.emoji).slice(0,16),String(body.description??current.description).slice(0,300),Math.max(0,Number(body.price??current.price)),body.enabled===undefined?current.enabled:(body.enabled?1:0),Date.now(),id).run();
  return json({ok:true},200,env,request);
}
async function deleteProduct(request,env,id){
  const history=await env.DB.prepare("SELECT COUNT(*) AS n FROM purchases WHERE product_id=?").bind(id).first();
  if(Number(history?.n||0)>0)throw httpError(409,"Cette récompense possède un historique. Désactive-la au lieu de la supprimer.");
  await env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run();
  return json({ok:true},200,env,request)
}

async function restock(request, env, kind, id) {
  const body=await parseJson(request), lines=Array.isArray(body.lines)?body.lines.map(x=>String(x).trim()).filter(Boolean):[];
  if(!lines.length)throw httpError(400,"Ajoute au moins une ligne."); if(lines.length>1000)throw httpError(400,"Maximum 1000 lignes par envoi.");
  const table=kind==="service"?"services":"products", linesTable=kind==="service"?"inventory_lines":"product_lines", foreign=kind==="service"?"service_id":"product_id";
  if(!await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind(id).first())throw httpError(404,"Élément introuvable.");
  const now=Date.now(), statements=[];
  for(const line of lines){if(line.length>4000)throw httpError(400,"Une ligne dépasse 4000 caractères.");const enc=await encryptText(line,env);statements.push(env.DB.prepare(`INSERT INTO ${linesTable}(${foreign},cipher_text,iv,created_at) VALUES(?,?,?,?)`).bind(id,enc.cipher_text,enc.iv,now));}
  for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
  return json({ok:true,added:lines.length},200,env,request);
}

async function clearStock(request,env,kind,id){const table=kind==="service"?"inventory_lines":"product_lines",foreign=kind==="service"?"service_id":"product_id";const result=await env.DB.prepare(`DELETE FROM ${table} WHERE ${foreign}=?`).bind(id).run();return json({ok:true,removed:result.meta?.changes||0},200,env,request)}

async function createWheelReward(request,env){const b=await parseJson(request),now=Date.now(),id=crypto.randomUUID();await env.DB.prepare("INSERT INTO wheel_rewards(id,emoji,label,points,weight,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id,String(b.emoji||"🎁").slice(0,16),String(b.label||"Gain").slice(0,80),Math.max(0,Number(b.points||0)),Math.max(1,Number(b.weight||1)),now,now).run();return json({ok:true,id},201,env,request)}
async function updateWheelReward(request,env,id){const b=await parseJson(request),r=await env.DB.prepare("SELECT * FROM wheel_rewards WHERE id=?").bind(id).first();if(!r)throw httpError(404,"Gain introuvable.");await env.DB.prepare("UPDATE wheel_rewards SET emoji=?,label=?,points=?,weight=?,updated_at=? WHERE id=?").bind(String(b.emoji??r.emoji).slice(0,16),String(b.label??r.label).slice(0,80),Math.max(0,Number(b.points??r.points)),Math.max(1,Number(b.weight??r.weight)),Date.now(),id).run();return json({ok:true},200,env,request)}
async function deleteWheelReward(request,env,id){const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM wheel_rewards").first();if(Number(count.n)<=2)throw httpError(409,"Conserve au moins deux gains.");await env.DB.prepare("DELETE FROM wheel_rewards WHERE id=?").bind(id).run();return json({ok:true},200,env,request)}

async function updateSettings(request,env){
  const b=await parseJson(request);
  const defaultMinutes=Number(b.default_generation_cooldown_minutes ?? 15);
  const defaultDailyLimit=Number(b.default_daily_generation_limit ?? 6);
  if(!Number.isFinite(defaultMinutes)||defaultMinutes<0||defaultMinutes>525600)throw httpError(400,"Temps gen par défaut invalide.");
  if(!Number.isInteger(defaultDailyLimit)||defaultDailyLimit<0||defaultDailyLimit>100000)throw httpError(400,"Limite journalière par défaut invalide.");
  const values={
    default_generation_cooldown_seconds:Math.round(defaultMinutes*60),
    default_daily_generation_limit:defaultDailyLimit,
    wheel_cooldown_seconds:Math.max(0,Number(b.wheel_cooldown_seconds||0)),
    starting_points:Math.max(0,Number(b.starting_points||0))
  };
  await env.DB.batch(Object.entries(values).map(([k,v])=>env.DB.prepare("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k,String(v))));
  return json({ok:true},200,env,request)
}

async function adjustPoints(request,env,discordId){const {delta}=await parseJson(request),amount=Math.trunc(Number(delta));if(!Number.isFinite(amount)||Math.abs(amount)>1000000)throw httpError(400,"Ajustement invalide.");const row=await env.DB.prepare("UPDATE users SET points=MAX(0,points+?),total_earned=total_earned+CASE WHEN ?>0 THEN ? ELSE 0 END,total_spent=total_spent+CASE WHEN ?<0 THEN ABS(?) ELSE 0 END,updated_at=? WHERE discord_id=? RETURNING points").bind(amount,amount,amount,amount,amount,Date.now(),discordId).first();if(!row)throw httpError(404,"Utilisateur introuvable.");return json({ok:true,points:Number(row.points)},200,env,request)}

async function setUserGenerationCooldown(request, env, discordId) {
  const cleanId = String(discordId || "").trim();
  if (!/^\d{5,30}$/.test(cleanId)) throw httpError(400, "ID Discord invalide.");
  const user = await env.DB.prepare("SELECT id FROM users WHERE discord_id=?").bind(cleanId).first();
  if (!user) throw httpError(404, "Utilisateur introuvable. Il doit s’être connecté au site au moins une fois.");
  const body = await parseJson(request);
  const minutes = Number(body.minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 525600) throw httpError(400, "Durée invalide (0 à 525 600 minutes).");
  const seconds = Math.round(minutes * 60);
  const key = `user_generation_cooldown:${cleanId}`;
  await env.DB.prepare(`INSERT INTO app_settings(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,String(seconds)).run();
  return json({ok:true,discord_id:cleanId,minutes:seconds/60,seconds},200,env,request);
}


async function setUserDailyGenerationLimit(request, env, discordId) {
  const cleanId = String(discordId || "").trim();
  if (!/^\d{5,30}$/.test(cleanId)) throw httpError(400, "ID Discord invalide.");
  const user = await env.DB.prepare("SELECT id FROM users WHERE discord_id=?").bind(cleanId).first();
  if (!user) throw httpError(404, "Utilisateur introuvable. Il doit s’être connecté au site au moins une fois.");
  const body = await parseJson(request);
  const limit = Number(body.limit);
  if (!Number.isInteger(limit) || limit < 0 || limit > 100000) throw httpError(400, "Limite invalide (0 à 100 000). 0 signifie illimité.");
  const key = `user_daily_generation_limit:${cleanId}`;
  await env.DB.prepare(`INSERT INTO app_settings(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(key,String(limit)).run();
  return json({ok:true,discord_id:cleanId,limit,unlimited:limit===0},200,env,request);
}

async function setUserTimer(request, env, discordId) {
  const cleanId = String(discordId || "").trim();
  if (!/^\d{5,30}$/.test(cleanId)) throw httpError(400, "ID Discord invalide.");
  const body = await parseJson(request);
  const type = String(body.type || "generator");
  const seconds = Math.trunc(Number(body.seconds));
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 31536000) throw httpError(400, "Durée invalide (0 à 31 536 000 secondes).");
  const user = await env.DB.prepare("SELECT id,discord_id,username,global_name FROM users WHERE discord_id=?").bind(cleanId).first();
  if (!user) throw httpError(404, "Utilisateur introuvable. Il doit s’être connecté au site au moins une fois.");
  const now = Date.now();
  const nextAllowedAt = seconds === 0 ? 0 : now + seconds * 1000;

  if (type === "wheel") {
    if (seconds === 0) {
      await env.DB.prepare("DELETE FROM wheel_cooldowns WHERE user_id=?").bind(user.id).run();
    } else {
      await env.DB.prepare(`INSERT INTO wheel_cooldowns(user_id,next_allowed_at) VALUES(?,?)
        ON CONFLICT(user_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at`).bind(user.id,nextAllowedAt).run();
    }
    return json({ok:true,type:"wheel",discord_id:cleanId,seconds,next_allowed_at:nextAllowedAt},200,env,request);
  }

  if (type !== "generator") throw httpError(400, "Type de timer invalide.");
  const serviceId = String(body.service_id || "").trim();
  if (!serviceId) throw httpError(400, "Choisis un service.");
  const service = await env.DB.prepare("SELECT id,name FROM services WHERE id=?").bind(serviceId).first();
  if (!service) throw httpError(404, "Service introuvable.");
  if (seconds === 0) {
    await env.DB.prepare("DELETE FROM generator_cooldowns WHERE user_id=? AND service_id=?").bind(user.id,serviceId).run();
  } else {
    await env.DB.prepare(`INSERT INTO generator_cooldowns(user_id,service_id,next_allowed_at) VALUES(?,?,?)
      ON CONFLICT(user_id,service_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at`).bind(user.id,serviceId,nextAllowedAt).run();
  }
  return json({ok:true,type:"generator",discord_id:cleanId,service_id:serviceId,service_name:service.name,seconds,next_allowed_at:nextAllowedAt},200,env,request);
}

