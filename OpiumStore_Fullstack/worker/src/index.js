const DISCORD_API = "https://discord.com/api/v10";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const OAUTH_STATE_TTL_SECONDS = 600;
const RANK_ORDER = Object.freeze({free:0, boost:1, vip:2, admin:3});
const RANK_RULES = Object.freeze({
  free:{key:"free",label:"Free",emoji:"🆓",daily_generation_limit:6,generation_cooldown_seconds:900,wheel_free_spins:1,daily_reward_multiplier:1},
  boost:{key:"boost",label:"Boost",emoji:"🚀",daily_generation_limit:15,generation_cooldown_seconds:120,wheel_free_spins:2,daily_reward_multiplier:1.2},
  vip:{key:"vip",label:"VIP",emoji:"👑",daily_generation_limit:0,generation_cooldown_seconds:60,wheel_free_spins:3,daily_reward_multiplier:1.5},
  admin:{key:"admin",label:"Admin",emoji:"🛡️",daily_generation_limit:0,generation_cooldown_seconds:60,wheel_free_spins:3,daily_reward_multiplier:1.5}
});

// Produits virtuels de la Boutique points : stock illimité, aucune ligne produit requise.
const POINT_SHOP_CHESTS = [
  {id:"points-wheel-ticket",item_key:"wheel_ticket",item_type:"ticket",rarity:"rare",name:"Ticket de roue",emoji:"🎟️",price:250,description:"Stock illimité · permet de tourner la roue avant la fin du délai."},
  {id:"points-chest-common",item_key:"chest_common",item_type:"chest",rarity:"common",name:"Coffre commun",emoji:"📦",price:250,description:"Stock illimité · jusqu’à 119 points et 69 XP."},
  {id:"points-chest-rare",item_key:"chest_rare",item_type:"chest",rarity:"rare",name:"Coffre rare",emoji:"🔷",price:750,description:"Stock illimité · jusqu’à 399 points et 199 XP."},
  {id:"points-chest-epic",item_key:"chest_epic",item_type:"chest",rarity:"epic",name:"Coffre épique",emoji:"🟣",price:1500,description:"Stock illimité · jusqu’à 699 points et 400 XP."},
  {id:"points-chest-legendary",item_key:"chest_legendary",item_type:"chest",rarity:"legendary",name:"Coffre légendaire",emoji:"🟡",price:3000,description:"Stock illimité · jusqu’à 1 499 points et 700 XP."}
];

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") return cors(new Response(null, {status: 204}), env, request);
      const url = new URL(request.url);
      const path = url.pathname;

      if (path === "/health" && request.method === "GET") return json({ok:true, service:"opiumstore-api", version:"progression-v7.6"}, 200, env, request);
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
      if (path === "/api/progression" && request.method === "GET") return await getProgression(request, user, env);
      if (path === "/api/daily/claim" && request.method === "POST") return await claimDailyReward(request, user, env);
      if (path === "/api/inventory/use" && request.method === "POST") return await useInventoryItem(request, user, env);
      if (path === "/api/inventory/equip" && request.method === "POST") return await equipInventoryItem(request, user, env);
      if (path === "/api/promo/redeem" && request.method === "POST") return await redeemPromoCode(request, user, env);
      if (path === "/api/leaderboards" && request.method === "GET") return await getLeaderboards(request, user, env);
      if (path === "/api/community-events" && request.method === "GET") return await getCommunityEvents(request, user, env);

      let publicMatch = path.match(/^\/api\/missions\/([^/]+)\/claim$/);
      if (publicMatch && request.method === "POST") return await claimMissionReward(request, user, env, decodeURIComponent(publicMatch[1]));
      publicMatch = path.match(/^\/api\/community-events\/([^/]+)\/claim$/);
      if (publicMatch && request.method === "POST") return await claimCommunityEvent(request, user, env, decodeURIComponent(publicMatch[1]));

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

function normalizeRank(value) {
  const rank = String(value || "free").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(RANK_RULES, rank) ? rank : "free";
}

function normalizeAccessRank(value) {
  const rank = normalizeRank(value);
  return rank === "boost" || rank === "vip" ? rank : "free";
}

function effectiveRank(user, env) {
  if (adminIds(env).has(String(user?.discord_id || ""))) return "admin";
  return normalizeRank(user?.account_rank || user?.rank || "free");
}

function rankRules(user, env) {
  return RANK_RULES[effectiveRank(user, env)];
}

function rankAllows(currentRank, requiredRank) {
  return Number(RANK_ORDER[normalizeRank(currentRank)] || 0) >= Number(RANK_ORDER[normalizeRank(requiredRank)] || 0);
}

async function loadUserRank(user, env) {
  if (adminIds(env).has(String(user?.discord_id || ""))) return "admin";
  const row = await env.DB.prepare("SELECT rank FROM user_ranks WHERE user_id=?").bind(user.id).first();
  return normalizeRank(row?.rank || "free");
}

function publicRank(user, env) {
  const rules = rankRules(user, env);
  return {
    key:rules.key,label:rules.label,emoji:rules.emoji,
    daily_generation_limit:rules.daily_generation_limit,
    generation_cooldown_seconds:rules.generation_cooldown_seconds,
    wheel_free_spins:rules.wheel_free_spins,
    daily_reward_multiplier:rules.daily_reward_multiplier
  };
}

function publicUser(user, env) {
  const rank = publicRank(user, env);
  return {
    discord_id:user.discord_id,
    username:user.username,
    display_name:user.global_name || user.username,
    avatar_url:avatarUrl(user),
    points:Number(user.points),
    total_earned:Number(user.total_earned),
    total_spent:Number(user.total_spent),
    rank,
    account_rank:rank.key,
    is_admin:rank.key === "admin"
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
  await env.DB.prepare("INSERT OR IGNORE INTO user_ranks(user_id,rank,updated_at) VALUES(?,'free',?)").bind(user.id,now).run();
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
  row.account_rank = await loadUserRank(row, env);
  return row;
}

function requireAdmin(user, env) {
  if (effectiveRank(user, env) !== "admin") throw httpError(403, "Accès administrateur requis.");
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
  const currentRank = effectiveRank(user,env);
  const services = await env.DB.prepare(`SELECT s.id,s.name,s.emoji,s.description,s.cooldown_seconds,s.enabled,
    COALESCE(sa.required_rank,'free') AS required_rank,COUNT(i.id) AS stock,MAX(0,COALESCE(c.next_allowed_at,0)-?) AS cooldown_ms
    FROM services s
    LEFT JOIN service_access sa ON sa.service_id=s.id
    LEFT JOIN inventory_lines i ON i.service_id=s.id
    LEFT JOIN generator_cooldowns c ON c.user_id=? AND c.service_id=s.id
    WHERE s.enabled=1 GROUP BY s.id ORDER BY s.created_at`).bind(now,user.id).all();
  const products = await env.DB.prepare(`SELECT p.id,p.name,p.emoji,p.description,p.price,p.enabled,COUNT(l.id) AS stock FROM products p LEFT JOIN product_lines l ON l.product_id=p.id WHERE p.enabled=1 AND p.id NOT LIKE 'points-%' GROUP BY p.id ORDER BY p.created_at`).all();
  const wheelRewards = await env.DB.prepare("SELECT id,emoji,label,points,weight FROM wheel_rewards ORDER BY created_at").all();
  const wheel = await getWheelState(user,env,now);
  const summary = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM deliveries WHERE user_id=?) AS generations,
    (SELECT COUNT(*) FROM purchases WHERE user_id=?) AS purchases`).bind(user.id,user.id).first();
  const dayKey = brusselsDayKey(now);
  const dailyGenerationLimit = await getUserDailyGenerationLimit(user, env);
  const generationsToday = await getDailyGenerationUsage(user, env, dayKey);
  const dailyGenerationRemaining = dailyGenerationLimit === 0 ? -1 : Math.max(0,dailyGenerationLimit-generationsToday);
  return json({
    rank:publicRank(user,env),
    services:services.results.map(s => {
      const requiredRank=normalizeAccessRank(s.required_rank);
      return {...s,required_rank:requiredRank,access_granted:rankAllows(currentRank,requiredRank),stock:Number(s.stock),cooldown_remaining:Math.ceil(Number(s.cooldown_ms)/1000)};
    }),
    products:[
      ...POINT_SHOP_CHESTS.map(p => ({...p,stock:-1,infinite_stock:true,enabled:1})),
      ...products.results.map(p => ({...p,stock:Number(p.stock),price:Number(p.price),infinite_stock:false}))
    ],
    wheel_rewards:wheelRewards.results.map(r => ({...r,points:Number(r.points),weight:Number(r.weight)})),
    wheel_cooldown_remaining:wheel.cooldown_remaining,
    wheel_cycle_reset_at:wheel.reset_at,
    wheel_free_spins_total:wheel.total,
    wheel_free_spins_used:wheel.used,
    wheel_free_spins_remaining:wheel.remaining,
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
  return rankRules(user,env).generation_cooldown_seconds;
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
  return rankRules(user,env).daily_generation_limit;
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
  const access = await env.DB.prepare("SELECT required_rank FROM service_access WHERE service_id=?").bind(service.id).first();
  const requiredRank = normalizeAccessRank(access?.required_rank || "free");
  if (!rankAllows(effectiveRank(user,env),requiredRank)) throw httpError(403, `Ce générateur est réservé au rang ${RANK_RULES[requiredRank].label}.`);

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
  const progression = await recordActivity(user,"generation",1,Number(await setting(env,"xp_generation","20")),env,{service_id:service.id,service_name:service.name});
  return json({
    delivery:{id,title:service.name,value:await decryptText(line.cipher_text,line.iv,env),created_at:now},
    next_allowed_at:nextAllowed,
    daily_generation_limit:quota.limit,
    generations_today:quota.used,
    daily_generation_remaining:quota.limit === 0 ? -1 : Math.max(0,quota.limit-quota.used),
    progression
  }, 200, env, request);
}

async function purchaseProduct(request, user, env) {
  const {product_id} = await parseJson(request);
  const virtualChest = POINT_SHOP_CHESTS.find(item => item.id === product_id);

  if (virtualChest) {
    const price = Number(virtualChest.price), now = Date.now();
    const deducted = await env.DB.prepare("UPDATE users SET points=points-?,total_spent=total_spent+?,updated_at=? WHERE id=? AND points>=? RETURNING points")
      .bind(price,price,now,user.id,price).first();
    if (!deducted) throw httpError(409, "Points insuffisants.");

    try {
      // Ligne produit technique nécessaire pour respecter la clé étrangère de purchases.
      await env.DB.prepare(`INSERT OR IGNORE INTO products(id,name,emoji,description,price,enabled,created_at,updated_at)
        VALUES(?,?,?,?,?,0,?,?)`).bind(virtualChest.id,virtualChest.name,virtualChest.emoji,virtualChest.description,price,now,now).run();
      await grantInventoryItem(user,virtualChest.item_key,1,env);
      const id = crypto.randomUUID();
      const message = `${virtualChest.name} ajouté à ton inventaire (stock illimité).`;
      const encrypted = await encryptText(message,env);
      await env.DB.prepare("INSERT INTO purchases(id,user_id,product_id,product_name,price,cipher_text,iv,created_at) VALUES(?,?,?,?,?,?,?,?)")
        .bind(id,user.id,virtualChest.id,virtualChest.name,price,encrypted.cipher_text,encrypted.iv,now).run();
      const progression = await recordActivity(user,"purchase",1,Number(await setting(env,"xp_purchase","35")),env,{product_id:virtualChest.id,product_name:virtualChest.name,price,item_key:virtualChest.item_key,infinite_stock:true});
      return json({purchase:{id,kind:"inventory",item_key:virtualChest.item_key,title:virtualChest.name,value:message,price,created_at:now},points:Number(deducted.points),progression},200,env,request);
    } catch (error) {
      await env.DB.prepare("UPDATE users SET points=points+?,total_spent=MAX(0,total_spent-?),updated_at=? WHERE id=?")
        .bind(price,price,Date.now(),user.id).run();
      throw error;
    }
  }

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
  const progression = await recordActivity(user,"purchase",1,Number(await setting(env,"xp_purchase","35")),env,{product_id:product.id,product_name:product.name,price});
  return json({purchase:{id,kind:"line",title:product.name,value:await decryptText(line.cipher_text,line.iv,env),price,created_at:now},points:Number(deducted.points),progression}, 200, env, request);
}

async function getWheelState(user, env, now = Date.now()) {
  const total = rankRules(user,env).wheel_free_spins;
  const cooldownSeconds = Math.max(1,Number(await setting(env,"wheel_cooldown_seconds","43200")));
  const row = await env.DB.prepare("SELECT cycle_ends_at,free_spins_used FROM wheel_cycle_usage WHERE user_id=?").bind(user.id).first();
  const resetAt = Math.max(0,Number(row?.cycle_ends_at || 0));
  if (!row || resetAt <= now) return {total,used:0,remaining:total,reset_at:0,cooldown_seconds:cooldownSeconds,cooldown_remaining:0};
  const used = Math.max(0,Math.min(total,Number(row.free_spins_used || 0)));
  const remaining = Math.max(0,total-used);
  return {total,used,remaining,reset_at:resetAt,cooldown_seconds:cooldownSeconds,cooldown_remaining:remaining>0?0:Math.ceil((resetAt-now)/1000)};
}

async function spinWheel(request, user, env) {
  const now = Date.now();
  const rewards = (await env.DB.prepare("SELECT * FROM wheel_rewards ORDER BY created_at").all()).results;
  if (!rewards.length) throw httpError(409, "Aucun gain configuré.");
  const totalWeight = rewards.reduce((sum,reward)=>sum+Math.max(0,Number(reward.weight || 0)),0);
  if (totalWeight <= 0) throw httpError(409,"Les probabilités de la roue sont invalides.");

  const state = await getWheelState(user,env,now);
  let ticketUsed = false;
  let freeSpinUsed = false;
  let cycleEndsAt = state.reset_at;
  let freeUsed = state.used;

  if (state.remaining > 0) {
    if (!cycleEndsAt) cycleEndsAt = now + state.cooldown_seconds * 1000;
    freeUsed += 1;
    freeSpinUsed = true;
    await env.DB.prepare(`INSERT INTO wheel_cycle_usage(user_id,cycle_ends_at,free_spins_used,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET cycle_ends_at=excluded.cycle_ends_at,free_spins_used=excluded.free_spins_used,updated_at=excluded.updated_at`)
      .bind(user.id,cycleEndsAt,freeUsed,now).run();
    await env.DB.prepare(`INSERT INTO wheel_cooldowns(user_id,next_allowed_at) VALUES(?,?)
      ON CONFLICT(user_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at`).bind(user.id,cycleEndsAt).run();
  } else {
    const ticket = await consumeInventoryItem(user,"wheel_ticket",1,env);
    ticketUsed = ticket.ok === true;
    if (!ticketUsed) throw httpError(429, `Tous tes tours gratuits sont utilisés. Prochains tours dans ${Math.ceil((state.reset_at-now)/1000)} seconde(s).`, {next_allowed_at:state.reset_at,ticket_required:true,free_spins_total:state.total,free_spins_used:state.used});
  }

  let pick = secureRandomUnit()*totalWeight;
  let chosen = rewards[rewards.length-1];
  for (const reward of rewards) {
    pick -= Math.max(0,Number(reward.weight || 0));
    if (pick <= 0) { chosen = reward; break; }
  }

  const points = Math.max(0,Number(chosen.points || 0));
  if (points > 0) await addPoints(user,points,env);
  await env.DB.prepare("INSERT INTO wheel_spins(id,user_id,reward_id,reward_label,points,created_at) VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,chosen.id,chosen.label,points,now).run();
  const progression = await recordActivity(user,"wheel",1,Number(await setting(env,"xp_wheel","15")),env,{reward_id:chosen.id,reward_label:chosen.label,points,ticket_used:ticketUsed,free_spin_used:freeSpinUsed});
  const after = await getWheelState(user,env,now);
  return json({reward:{id:chosen.id,emoji:chosen.emoji,label:chosen.label,points},next_allowed_at:after.reset_at,ticket_used:ticketUsed,free_spin_used:freeSpinUsed,free_spins_total:after.total,free_spins_used:after.used,free_spins_remaining:after.remaining,progression}, 200, env, request);
}

function weekKeyFromDayKey(dayKey) {
  const date = new Date(`${dayKey}T12:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function progressionPeriodKeys(timestamp = Date.now()) {
  const dayKey = brusselsDayKey(timestamp);
  return {dayKey, weekKey:weekKeyFromDayKey(dayKey), monthKey:dayKey.slice(0, 7)};
}

function dayDifference(fromKey, toKey) {
  if (!fromKey || !toKey) return 9999;
  const from = new Date(`${fromKey}T12:00:00Z`).getTime();
  const to = new Date(`${toKey}T12:00:00Z`).getTime();
  return Math.round((to - from) / 86400000);
}

function xpRequiredForLevel(level) {
  const safeLevel = Math.max(1, Math.trunc(Number(level || 1)));
  return 50 * safeLevel * (safeLevel - 1);
}

function levelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp || 0));
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + 0.08 * safeXp)) / 2));
}

function profileView(profile) {
  const xpTotal = Math.max(0, Number(profile?.xp_total || 0));
  const level = levelFromXp(xpTotal);
  const levelStart = xpRequiredForLevel(level);
  const nextStart = xpRequiredForLevel(level + 1);
  const current = Math.max(0, xpTotal - levelStart);
  const needed = Math.max(1, nextStart - levelStart);
  return {
    xp_total:xpTotal,
    level,
    xp_current:current,
    xp_needed:needed,
    xp_percent:Math.min(100, Math.round((current / needed) * 100)),
    streak_current:Math.max(0, Number(profile?.streak_current || 0)),
    streak_best:Math.max(0, Number(profile?.streak_best || 0)),
    last_daily_key:profile?.last_daily_key || null,
    active_title_key:profile?.active_title_key || null,
    active_cosmetic_key:profile?.active_cosmetic_key || null
  };
}

async function ensureProgressProfile(user, env) {
  const now = Date.now();
  await env.DB.prepare(`INSERT OR IGNORE INTO progress_profiles(user_id,xp_total,level,streak_current,streak_best,created_at,updated_at)
    VALUES(?,0,1,0,0,?,?)`).bind(user.id,now,now).run();
  return await env.DB.prepare("SELECT * FROM progress_profiles WHERE user_id=?").bind(user.id).first();
}

async function addPoints(user, points, env) {
  const amount = Math.trunc(Number(points || 0));
  if (!amount) {
    const row = await env.DB.prepare("SELECT points FROM users WHERE id=?").bind(user.id).first();
    return Number(row?.points || 0);
  }
  const row = await env.DB.prepare(`UPDATE users SET points=MAX(0,points+?),
    total_earned=total_earned+CASE WHEN ?>0 THEN ? ELSE 0 END,
    total_spent=total_spent+CASE WHEN ?<0 THEN ABS(?) ELSE 0 END,
    updated_at=? WHERE id=? RETURNING points`)
    .bind(amount,amount,amount,amount,amount,Date.now(),user.id).first();
  return Number(row?.points || 0);
}

async function inventoryItem(itemKey, env) {
  return await env.DB.prepare("SELECT * FROM item_catalog WHERE item_key=? AND active=1").bind(itemKey).first();
}

async function inventoryQuantity(user, itemKey, env) {
  const row = await env.DB.prepare("SELECT quantity FROM user_inventory WHERE user_id=? AND item_key=?").bind(user.id,itemKey).first();
  return Math.max(0, Number(row?.quantity || 0));
}

async function grantInventoryItem(user, itemKey, quantity, env) {
  const amount = Math.max(1, Math.min(1000, Math.trunc(Number(quantity || 1))));
  const item = await inventoryItem(itemKey, env);
  if (!item) throw httpError(500, `Objet d’inventaire introuvable : ${itemKey}`);
  const now = Date.now();
  const existing = await env.DB.prepare("SELECT quantity FROM user_inventory WHERE user_id=? AND item_key=?").bind(user.id,itemKey).first();
  if (!Number(item.stackable) && Number(existing?.quantity || 0) > 0) {
    const conversion = Math.max(0, Number(item.duplicate_points || 0)) * amount;
    if (conversion > 0) await addPoints(user, conversion, env);
    return {item_key:itemKey,name:item.name,emoji:item.emoji,quantity:0,duplicate:true,converted_points:conversion};
  }
  const storedAmount = Number(item.stackable) ? amount : 1;
  await env.DB.prepare(`INSERT INTO user_inventory(user_id,item_key,quantity,equipped,acquired_at,updated_at)
    VALUES(?,?,?,0,?,?)
    ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=user_inventory.quantity+excluded.quantity,updated_at=excluded.updated_at`)
    .bind(user.id,itemKey,storedAmount,now,now).run();
  return {item_key:itemKey,name:item.name,emoji:item.emoji,quantity:storedAmount,duplicate:false,converted_points:0};
}

async function consumeInventoryItem(user, itemKey, quantity, env) {
  const amount = Math.max(1, Math.trunc(Number(quantity || 1)));
  const row = await env.DB.prepare(`UPDATE user_inventory SET quantity=quantity-?,updated_at=?
    WHERE user_id=? AND item_key=? AND quantity>=? RETURNING quantity`)
    .bind(amount,Date.now(),user.id,itemKey,amount).first();
  return row ? {ok:true,quantity:Number(row.quantity)} : {ok:false,quantity:await inventoryQuantity(user,itemKey,env)};
}

async function activeXpMultiplier(user, env) {
  const now = Date.now();
  await env.DB.prepare("DELETE FROM user_effects WHERE user_id=? AND expires_at<=?").bind(user.id,now).run();
  const row = await env.DB.prepare("SELECT multiplier,expires_at FROM user_effects WHERE user_id=? AND effect_key='xp_boost_2x' AND expires_at>?")
    .bind(user.id,now).first();
  return row ? {multiplier:Math.max(1,Number(row.multiplier || 1)),expires_at:Number(row.expires_at)} : {multiplier:1,expires_at:null};
}

async function grantPendingLevelRewards(user, oldLevel, newLevel, env) {
  if (newLevel <= oldLevel) return [];
  const rows = await env.DB.prepare(`SELECT lr.* FROM level_rewards lr
    LEFT JOIN level_reward_claims c ON c.user_id=? AND c.level=lr.level
    WHERE lr.level>? AND lr.level<=? AND c.level IS NULL ORDER BY lr.level`).bind(user.id,oldLevel,newLevel).all();
  const rewards = [];
  for (const reward of rows.results || []) {
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO level_reward_claims(user_id,level,claimed_at) VALUES(?,?,?)")
      .bind(user.id,reward.level,Date.now()).run();
    if (!Number(claim.meta?.changes || 0)) continue;
    const points = Math.max(0, Number(reward.reward_points || 0));
    if (points) await addPoints(user,points,env);
    let item = null;
    if (reward.reward_item_key) item = await grantInventoryItem(user,reward.reward_item_key,1,env);
    rewards.push({level:Number(reward.level),label:reward.label,points,item});
  }
  return rewards;
}

async function addXp(user, baseXp, env) {
  const base = Math.max(0, Math.trunc(Number(baseXp || 0)));
  const before = await ensureProgressProfile(user,env);
  if (!base) return {awarded:0,multiplier:1,profile:profileView(before),level_rewards:[]};
  const boost = await activeXpMultiplier(user,env);
  const awarded = Math.max(0, Math.round(base * boost.multiplier));
  const oldLevel = levelFromXp(before.xp_total);
  const newXp = Number(before.xp_total || 0) + awarded;
  const newLevel = levelFromXp(newXp);
  const updated = await env.DB.prepare("UPDATE progress_profiles SET xp_total=?,level=?,updated_at=? WHERE user_id=? RETURNING *")
    .bind(newXp,newLevel,Date.now(),user.id).first();
  const levelRewards = await grantPendingLevelRewards(user,oldLevel,newLevel,env);
  return {awarded,multiplier:boost.multiplier,boost_expires_at:boost.expires_at,profile:profileView(updated),level_rewards:levelRewards};
}

function missionPeriodKey(scope, timestamp = Date.now()) {
  if (scope === "weekly") return progressionPeriodKeys(timestamp).weekKey;
  return "all";
}

async function updateMissionProgress(user, activityType, amount, env) {
  const missions = await env.DB.prepare(`SELECT m.*,COALESCE(ma.required_rank,'free') AS required_rank
    FROM missions m LEFT JOIN mission_access ma ON ma.mission_id=m.id
    WHERE m.active=1 AND (m.activity_type=? OR m.activity_type='any') ORDER BY m.sort_order`).bind(activityType).all();
  const now = Date.now();
  const currentRank = effectiveRank(user,env);
  for (const mission of missions.results || []) {
    if (!rankAllows(currentRank,mission.required_rank)) continue;
    const periodKey = missionPeriodKey(mission.scope,now);
    const increment = Math.max(0,Math.trunc(Number(amount || 0)));
    await env.DB.prepare(`INSERT INTO user_mission_progress(user_id,mission_id,period_key,progress,claimed,completed_at,updated_at)
      VALUES(?,?,?,?,0,?,?)
      ON CONFLICT(user_id,mission_id,period_key) DO UPDATE SET
        progress=user_mission_progress.progress+excluded.progress,
        completed_at=CASE WHEN user_mission_progress.progress+excluded.progress>=? THEN COALESCE(user_mission_progress.completed_at,?) ELSE user_mission_progress.completed_at END,
        updated_at=excluded.updated_at`)
      .bind(user.id,mission.id,periodKey,increment,increment>=Number(mission.target)?now:null,now,Number(mission.target),now).run();
  }
}

async function updateCommunityProgress(user, activityType, amount, env) {
  const now = Date.now();
  const events = await env.DB.prepare(`SELECT * FROM community_events WHERE active=1 AND starts_at<=? AND ends_at>=?
    AND (activity_type=? OR activity_type='any')`).bind(now,now,activityType).all();
  const increment = Math.max(0,Math.trunc(Number(amount || 0)));
  for (const event of events.results || []) {
    await env.DB.prepare(`INSERT INTO community_event_progress(event_id,progress,updated_at) VALUES(?,?,?)
      ON CONFLICT(event_id) DO UPDATE SET progress=community_event_progress.progress+excluded.progress,updated_at=excluded.updated_at`)
      .bind(event.id,increment,now).run();
    await env.DB.prepare(`INSERT INTO community_event_participants(event_id,user_id,contribution,claimed,updated_at) VALUES(?,?,?,0,?)
      ON CONFLICT(event_id,user_id) DO UPDATE SET contribution=community_event_participants.contribution+excluded.contribution,updated_at=excluded.updated_at`)
      .bind(event.id,user.id,increment,now).run();
  }
}

async function recordActivity(user, activityType, amount, baseXp, env, metadata = {}) {
  const now = Date.now();
  const keys = progressionPeriodKeys(now);
  const xp = await addXp(user,baseXp,env);
  await env.DB.prepare(`INSERT INTO activity_log(id,user_id,activity_type,amount,xp_awarded,day_key,week_key,month_key,metadata_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.id,activityType,Math.max(0,Math.trunc(Number(amount || 0))),xp.awarded,keys.dayKey,keys.weekKey,keys.monthKey,JSON.stringify(metadata || {}).slice(0,2000),now).run();
  await updateMissionProgress(user,activityType,amount,env);
  await updateCommunityProgress(user,activityType,amount,env);
  return xp;
}

async function logAwardedXp(user, activityType, awardedXp, env, metadata = {}) {
  const awarded = Math.max(0,Math.trunc(Number(awardedXp || 0)));
  if (!awarded) return;
  const now = Date.now();
  const keys = progressionPeriodKeys(now);
  await env.DB.prepare(`INSERT INTO activity_log(id,user_id,activity_type,amount,xp_awarded,day_key,week_key,month_key,metadata_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),user.id,activityType,0,awarded,keys.dayKey,keys.weekKey,keys.monthKey,JSON.stringify(metadata || {}).slice(0,2000),now).run();
}

async function progressionMissionRows(user, env) {
  const missions = await env.DB.prepare(`SELECT m.*,COALESCE(ma.required_rank,'free') AS required_rank
    FROM missions m LEFT JOIN mission_access ma ON ma.mission_id=m.id
    WHERE m.active=1 ORDER BY m.scope,m.sort_order,m.title`).all();
  const output = [];
  const currentRank = effectiveRank(user,env);
  for (const mission of missions.results || []) {
    const periodKey = missionPeriodKey(mission.scope);
    const progress = await env.DB.prepare(`SELECT progress,claimed,completed_at,claimed_at FROM user_mission_progress
      WHERE user_id=? AND mission_id=? AND period_key=?`).bind(user.id,mission.id,periodKey).first();
    const current = Math.max(0,Number(progress?.progress || 0));
    const requiredRank=normalizeAccessRank(mission.required_rank);
    output.push({
      id:mission.id,scope:mission.scope,title:mission.title,description:mission.description,activity_type:mission.activity_type,
      target:Number(mission.target),progress:current,percent:Math.min(100,Math.round((current/Number(mission.target))*100)),
      completed:current>=Number(mission.target),claimed:!!progress?.claimed,reward_points:Number(mission.reward_points || 0),
      reward_xp:Number(mission.reward_xp || 0),reward_item_key:mission.reward_item_key || null,period_key:periodKey,
      required_rank:requiredRank,access_granted:rankAllows(currentRank,requiredRank)
    });
  }
  return output;
}

async function progressionInventoryRows(user, env) {
  const rows = await env.DB.prepare(`SELECT ui.item_key,ui.quantity,ui.equipped,ui.acquired_at,ui.updated_at,
    ic.item_type,ic.rarity,ic.name,ic.emoji,ic.description,ic.stackable,ic.duplicate_points,ic.metadata_json
    FROM user_inventory ui JOIN item_catalog ic ON ic.item_key=ui.item_key
    WHERE ui.user_id=? AND ui.quantity>0 AND ic.active=1
    ORDER BY CASE ic.rarity WHEN 'legendary' THEN 1 WHEN 'epic' THEN 2 WHEN 'event' THEN 3 WHEN 'rare' THEN 4 ELSE 5 END,ic.item_type,ic.name`)
    .bind(user.id).all();
  return (rows.results || []).map(row => ({...row,quantity:Number(row.quantity),equipped:!!row.equipped,stackable:!!row.stackable}));
}

async function dailyRewardPreview(user, profile, env) {
  const nextStreak = Math.max(1,Number(profile?.streak_current || 0)+1);
  const basePoints = Math.max(0,Number(await setting(env,"daily_base_points","50"))) + Math.min(30,nextStreak)*5;
  const baseXp = Math.max(0,Number(await setting(env,"daily_base_xp","30"))) + Math.min(30,nextStreak)*3;
  const multiplier = rankRules(user,env).daily_reward_multiplier;
  return {points:Math.round(basePoints*multiplier),xp:Math.round(baseXp*multiplier),multiplier};
}

async function getProgression(request, user, env) {
  const profile = await ensureProgressProfile(user,env);
  const missions = await progressionMissionRows(user,env);
  const inventory = await progressionInventoryRows(user,env);
  const effects = await env.DB.prepare("SELECT effect_key,multiplier,expires_at FROM user_effects WHERE user_id=? AND expires_at>? ORDER BY expires_at").bind(user.id,Date.now()).all();
  const missionCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM user_mission_progress WHERE user_id=? AND completed_at IS NOT NULL").bind(user.id).first();
  const userRow = await env.DB.prepare("SELECT points,total_earned,total_spent FROM users WHERE id=?").bind(user.id).first();
  const title = profile.active_title_key ? await inventoryItem(profile.active_title_key,env) : null;
  const cosmetic = profile.active_cosmetic_key ? await inventoryItem(profile.active_cosmetic_key,env) : null;
  const today = brusselsDayKey();
  const preview = await dailyRewardPreview(user,profile,env);
  return json({
    rank:publicRank(user,env),
    profile:{...profileView(profile),missions_completed:Number(missionCount?.n || 0),points:Number(userRow?.points || 0),active_title:title?{key:title.item_key,name:title.name,emoji:title.emoji}:null,active_cosmetic:cosmetic?{key:cosmetic.item_key,name:cosmetic.name,emoji:cosmetic.emoji}:null},
    daily:{day_key:today,can_claim:profile.last_daily_key!==today,next_points:preview.points,next_xp:preview.xp,multiplier:preview.multiplier},
    missions,inventory,effects:(effects.results || []).map(x=>({...x,multiplier:Number(x.multiplier),expires_at:Number(x.expires_at)}))
  },200,env,request);
}

async function claimDailyReward(request, user, env) {
  const profile = await ensureProgressProfile(user,env);
  const today = brusselsDayKey();
  if (profile.last_daily_key === today) throw httpError(409,"La récompense quotidienne a déjà été récupérée aujourd’hui.");
  const difference = dayDifference(profile.last_daily_key,today);
  let streak = 1;
  let protectedStreak = false;
  if (difference === 1) streak = Number(profile.streak_current || 0) + 1;
  else if (difference === 2 && await inventoryQuantity(user,"streak_protector",env) > 0) {
    streak = Number(profile.streak_current || 0) + 1;
    protectedStreak = true;
  }
  const updated = await env.DB.prepare(`UPDATE progress_profiles SET streak_current=?,streak_best=MAX(streak_best,?),last_daily_key=?,updated_at=?
    WHERE user_id=? AND (last_daily_key IS NULL OR last_daily_key<>?) RETURNING *`)
    .bind(streak,streak,today,Date.now(),user.id,today).first();
  if (!updated) throw httpError(409,"La récompense quotidienne a déjà été récupérée aujourd’hui.");
  if (protectedStreak) await consumeInventoryItem(user,"streak_protector",1,env);
  const multiplier = rankRules(user,env).daily_reward_multiplier;
  const basePoints = Math.max(0,Number(await setting(env,"daily_base_points","50"))) + Math.min(30,streak)*5;
  const baseXp = Math.max(0,Number(await setting(env,"daily_base_xp","30"))) + Math.min(30,streak)*3;
  const points = Math.round(basePoints*multiplier);
  const rankedXp = Math.round(baseXp*multiplier);
  await addPoints(user,points,env);
  let milestoneItem = null;
  if (streak % 30 === 0) milestoneItem = "chest_legendary";
  else if (streak % 14 === 0) milestoneItem = "chest_epic";
  else if (streak % 7 === 0) milestoneItem = "chest_rare";
  else if (streak % 3 === 0) milestoneItem = "chest_common";
  const item = milestoneItem ? await grantInventoryItem(user,milestoneItem,1,env) : null;
  const xp = await recordActivity(user,"daily_claim",1,rankedXp,env,{streak,protected:protectedStreak,rank:effectiveRank(user,env),daily_multiplier:multiplier});
  return json({ok:true,streak,protected:protectedStreak,daily_multiplier:multiplier,reward:{points,xp:xp.awarded,item},profile:xp.profile},200,env,request);
}

async function claimMissionReward(request, user, env, missionId) {
  const mission = await env.DB.prepare(`SELECT m.*,COALESCE(ma.required_rank,'free') AS required_rank
    FROM missions m LEFT JOIN mission_access ma ON ma.mission_id=m.id WHERE m.id=? AND m.active=1`).bind(missionId).first();
  if (!mission) throw httpError(404,"Mission introuvable.");
  if (!rankAllows(effectiveRank(user,env),mission.required_rank)) throw httpError(403,`Cette mission est réservée au rang ${RANK_RULES[normalizeAccessRank(mission.required_rank)].label}.`);
  const periodKey = missionPeriodKey(mission.scope);
  const progress = await env.DB.prepare("SELECT * FROM user_mission_progress WHERE user_id=? AND mission_id=? AND period_key=?")
    .bind(user.id,mission.id,periodKey).first();
  if (!progress || Number(progress.progress)<Number(mission.target)) throw httpError(409,"Cette mission n’est pas encore terminée.");
  const claimed = await env.DB.prepare(`UPDATE user_mission_progress SET claimed=1,claimed_at=?,updated_at=?
    WHERE user_id=? AND mission_id=? AND period_key=? AND claimed=0 RETURNING claimed`)
    .bind(Date.now(),Date.now(),user.id,mission.id,periodKey).first();
  if (!claimed) throw httpError(409,"La récompense de cette mission a déjà été récupérée.");
  const points = Math.max(0,Number(mission.reward_points || 0));
  if (points) await addPoints(user,points,env);
  const item = mission.reward_item_key ? await grantInventoryItem(user,mission.reward_item_key,1,env) : null;
  const xp = await recordActivity(user,"mission_claim",1,Number(mission.reward_xp || 0),env,{mission_id:mission.id});
  return json({ok:true,reward:{points,xp:xp.awarded,item},profile:xp.profile},200,env,request);
}

function secureRandomUnit() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 4294967296;
}

function weightedReward(entries) {
  const total = entries.reduce((sum,item)=>sum+Number(item.weight || 0),0);
  let pick = secureRandomUnit()*Math.max(1,total);
  for (const entry of entries) {
    pick -= Number(entry.weight || 0);
    if (pick <= 0) return entry;
  }
  return entries[entries.length-1];
}

function randomBetween(min,max) {
  const a = Math.trunc(Number(min));
  const b = Math.trunc(Number(max));
  return a + Math.floor(secureRandomUnit()*(Math.max(a,b)-a+1));
}

function chestLootTable(rarity) {
  const tables = {
    common:[
      {weight:44,type:"points",min:50,max:140},{weight:28,type:"xp",min:35,max:90},{weight:12,type:"item",value:"wheel_ticket"},
      {weight:8,type:"item",value:"streak_protector"},{weight:5,type:"item",value:"xp_boost_2x"},{weight:3,type:"item",value:"chest_rare"}
    ],
    rare:[
      {weight:32,type:"points",min:150,max:350},{weight:24,type:"xp",min:100,max:220},{weight:15,type:"item",value:"wheel_ticket"},
      {weight:10,type:"item",value:"xp_boost_2x"},{weight:8,type:"item",value:"streak_protector"},{weight:6,type:"item",value:"cosmetic_red_aura"},{weight:5,type:"item",value:"chest_epic"}
    ],
    epic:[
      {weight:25,type:"points",min:400,max:850},{weight:22,type:"xp",min:250,max:500},{weight:14,type:"item",value:"xp_boost_2x"},
      {weight:12,type:"item",value:"cosmetic_neon_frame"},{weight:10,type:"item",value:"title_veteran"},{weight:9,type:"item",value:"chest_legendary"},{weight:8,type:"jackpot"}
    ],
    legendary:[
      {weight:24,type:"points",min:1000,max:2500},{weight:22,type:"xp",min:700,max:1400},{weight:15,type:"item",value:"cosmetic_crown"},
      {weight:15,type:"item",value:"title_legend"},{weight:12,type:"item",value:"chest_legendary"},{weight:12,type:"jackpot"}
    ],
    event:[
      {weight:25,type:"points",min:300,max:900},{weight:20,type:"xp",min:220,max:650},{weight:18,type:"item",value:"event_token"},
      {weight:12,type:"item",value:"xp_boost_2x"},{weight:10,type:"item",value:"cosmetic_red_aura"},{weight:8,type:"item",value:"chest_epic"},{weight:7,type:"jackpot"}
    ]
  };
  return tables[rarity] || tables.common;
}

async function applyChestReward(user, reward, env) {
  if (reward.type === "points") {
    const points = randomBetween(reward.min,reward.max);
    await addPoints(user,points,env);
    return {type:"points",points,label:`${points} points`};
  }
  if (reward.type === "xp") {
    const base = randomBetween(reward.min,reward.max);
    const xp = await addXp(user,base,env);
    await logAwardedXp(user,"chest_loot_xp",xp.awarded,env,{base_xp:base});
    return {type:"xp",xp:xp.awarded,label:`${xp.awarded} XP`};
  }
  if (reward.type === "item") {
    const item = await grantInventoryItem(user,reward.value,1,env);
    return {type:"item",item,label:item.duplicate?`${item.converted_points} points (doublon)`:`${item.emoji} ${item.name}`};
  }
  const points = randomBetween(1500,3500);
  const jackpotBaseXp = randomBetween(750,1600);
  const xp = await addXp(user,jackpotBaseXp,env);
  await logAwardedXp(user,"chest_jackpot_xp",xp.awarded,env,{base_xp:jackpotBaseXp});
  const item = await grantInventoryItem(user,"chest_legendary",1,env);
  await addPoints(user,points,env);
  return {type:"jackpot",points,xp:xp.awarded,item,label:`Jackpot : ${points} points, ${xp.awarded} XP et un coffre légendaire`};
}

async function openChest(user, item, env) {
  const consumed = await consumeInventoryItem(user,item.item_key,1,env);
  if (!consumed.ok) throw httpError(409,"Tu ne possèdes pas ce coffre.");
  const rarity = item.rarity === "event" ? "event" : item.rarity;

  if (["common","rare","epic","legendary"].includes(rarity)) {
    const limits = {
      common:{points:[20,119],xp:[10,69]},
      rare:{points:[100,399],xp:[50,199]},
      epic:{points:[250,699],xp:[150,400]},
      legendary:{points:[600,1499],xp:[300,700]}
    }[rarity];
    const points = randomBetween(limits.points[0],limits.points[1]);
    const boost = await activeXpMultiplier(user,env);
    const maxBaseXp = Math.max(1,Math.floor(limits.xp[1] / Math.max(1,boost.multiplier)));
    const minBaseXp = Math.min(limits.xp[0],maxBaseXp);
    const baseXp = randomBetween(minBaseXp,maxBaseXp);
    await addPoints(user,points,env);
    const xp = await addXp(user,baseXp,env);
    await logAwardedXp(user,"chest_loot_xp",xp.awarded,env,{base_xp:baseXp,chest:item.item_key,rarity});
    // 0 XP d'activité supplémentaire : le gain total du coffre reste dans le plafond annoncé.
    const activity = await recordActivity(user,"chest_open",1,0,env,{chest:item.item_key,rarity,points,xp:xp.awarded});
    return {
      ok:true,
      chest:{item_key:item.item_key,name:item.name,emoji:item.emoji,rarity},
      rewards:[
        {type:"points",points,label:`${points} points`},
        {type:"xp",xp:xp.awarded,label:`${xp.awarded} XP`}
      ],
      activity_xp:0,
      profile:activity.profile
    };
  }

  const count = 2;
  const rewards = [];
  for (let i=0;i<count;i++) rewards.push(await applyChestReward(user,weightedReward(chestLootTable(rarity)),env));
  const xp = await recordActivity(user,"chest_open",1,Number(await setting(env,"xp_chest","25")),env,{chest:item.item_key,rarity});
  return {ok:true,chest:{item_key:item.item_key,name:item.name,emoji:item.emoji,rarity},rewards,activity_xp:xp.awarded,profile:xp.profile};
}

async function useInventoryItem(request, user, env) {
  const body = await parseJson(request);
  const itemKey = String(body.item_key || "").trim();
  const item = await inventoryItem(itemKey,env);
  if (!item) throw httpError(404,"Objet introuvable.");
  if (item.item_type === "chest") return json(await openChest(user,item,env),200,env,request);
  if (item.item_type === "boost" && item.item_key === "xp_boost_2x") {
    const consumed = await consumeInventoryItem(user,item.item_key,1,env);
    if (!consumed.ok) throw httpError(409,"Tu ne possèdes pas ce boost.");
    const now = Date.now();
    const duration = 3600*1000;
    const existing = await env.DB.prepare("SELECT expires_at FROM user_effects WHERE user_id=? AND effect_key='xp_boost_2x'").bind(user.id).first();
    const expiresAt = Math.max(now,Number(existing?.expires_at || 0))+duration;
    await env.DB.prepare(`INSERT INTO user_effects(user_id,effect_key,multiplier,expires_at,created_at) VALUES(?,'xp_boost_2x',2,?,?)
      ON CONFLICT(user_id,effect_key) DO UPDATE SET multiplier=2,expires_at=excluded.expires_at`)
      .bind(user.id,expiresAt,now).run();
    return json({ok:true,message:"Boost XP ×2 activé pendant 60 minutes.",expires_at:expiresAt},200,env,request);
  }
  throw httpError(409,"Cet objet s’utilise automatiquement ou doit être équipé.");
}

async function equipInventoryItem(request, user, env) {
  await ensureProgressProfile(user,env);
  const body = await parseJson(request);
  const itemKey = String(body.item_key || "").trim();
  const item = await inventoryItem(itemKey,env);
  if (!item || !["title","cosmetic"].includes(item.item_type)) throw httpError(400,"Cet objet ne peut pas être équipé.");
  if (await inventoryQuantity(user,itemKey,env)<1) throw httpError(409,"Tu ne possèdes pas cet objet.");
  const owned = await env.DB.prepare(`SELECT ui.item_key FROM user_inventory ui JOIN item_catalog ic ON ic.item_key=ui.item_key
    WHERE ui.user_id=? AND ic.item_type=?`).bind(user.id,item.item_type).all();
  for (const row of owned.results || []) await env.DB.prepare("UPDATE user_inventory SET equipped=0,updated_at=? WHERE user_id=? AND item_key=?").bind(Date.now(),user.id,row.item_key).run();
  await env.DB.prepare("UPDATE user_inventory SET equipped=1,updated_at=? WHERE user_id=? AND item_key=?").bind(Date.now(),user.id,itemKey).run();
  const column = item.item_type === "title" ? "active_title_key" : "active_cosmetic_key";
  await env.DB.prepare(`UPDATE progress_profiles SET ${column}=?,updated_at=? WHERE user_id=?`).bind(itemKey,Date.now(),user.id).run();
  return json({ok:true,item:{item_key:itemKey,name:item.name,emoji:item.emoji,type:item.item_type}},200,env,request);
}

async function redeemPromoCode(request, user, env) {
  const body = await parseJson(request);
  const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g,"").slice(0,40);
  if (!code) throw httpError(400,"Entre un code promo.");
  const now = Date.now();
  const promo = await env.DB.prepare("SELECT * FROM promo_codes WHERE code=? AND active=1").bind(code).first();
  if (!promo || (Number(promo.starts_at)>0 && Number(promo.starts_at)>now) || (Number(promo.ends_at)>0 && Number(promo.ends_at)<now)) throw httpError(404,"Code promo invalide ou expiré.");
  if (await env.DB.prepare("SELECT 1 FROM promo_redemptions WHERE code=? AND user_id=?").bind(code,user.id).first()) throw httpError(409,"Tu as déjà utilisé ce code promo.");
  const usage = await env.DB.prepare(`UPDATE promo_codes SET used_count=used_count+1,updated_at=? WHERE code=?
    AND (max_uses=0 OR used_count<max_uses) RETURNING used_count`).bind(now,code).first();
  if (!usage) throw httpError(409,"Ce code promo a atteint sa limite d’utilisation.");
  await env.DB.prepare("INSERT INTO promo_redemptions(code,user_id,redeemed_at) VALUES(?,?,?)").bind(code,user.id,now).run();
  const points = Math.max(0,Number(promo.reward_points || 0));
  if (points) await addPoints(user,points,env);
  const item = promo.reward_item_key ? await grantInventoryItem(user,promo.reward_item_key,1,env) : null;
  const xp = await recordActivity(user,"promo_redeem",1,Number(promo.reward_xp || 0),env,{code});
  return json({ok:true,code,reward:{points,xp:xp.awarded,item},profile:xp.profile},200,env,request);
}

async function getLeaderboards(request, user, env) {
  const url = new URL(request.url);
  const categoryRaw = String(url.searchParams.get("category") || "xp");
  const periodRaw = String(url.searchParams.get("period") || "global");
  const category = ["xp","level","streak","missions","general"].includes(categoryRaw) ? categoryRaw : "xp";
  const period = ["weekly","monthly","global"].includes(periodRaw) ? periodRaw : "global";
  const keys = progressionPeriodKeys();
  let rows;
  if (period === "global" || category === "level" || category === "streak") {
    const order = category === "level" ? "level DESC,xp_total DESC" : category === "streak" ? "streak_best DESC,xp_total DESC" : category === "missions" ? "missions_completed DESC,xp_total DESC" : category === "general" ? "general_score DESC,xp_total DESC" : "xp_total DESC";
    rows = await env.DB.prepare(`SELECT u.id,u.discord_id,u.username,u.global_name,u.avatar,
      COALESCE(p.xp_total,0) AS xp_total,COALESCE(p.level,1) AS level,COALESCE(p.streak_best,0) AS streak_best,
      (SELECT COUNT(*) FROM user_mission_progress mp WHERE mp.user_id=u.id AND mp.completed_at IS NOT NULL) AS missions_completed,
      (COALESCE(p.xp_total,0)+(SELECT COUNT(*) FROM user_mission_progress mp WHERE mp.user_id=u.id AND mp.completed_at IS NOT NULL)*250+COALESCE(p.streak_best,0)*50) AS general_score
      FROM users u LEFT JOIN progress_profiles p ON p.user_id=u.id ORDER BY ${order} LIMIT 50`).all();
  } else {
    const keyColumn = period === "weekly" ? "week_key" : "month_key";
    const keyValue = period === "weekly" ? keys.weekKey : keys.monthKey;
    const scoreExpr = category === "missions" ? "SUM(CASE WHEN a.activity_type='mission_claim' THEN a.amount ELSE 0 END)" : category === "general" ? "SUM(a.xp_awarded + CASE WHEN a.activity_type='mission_claim' THEN 250 ELSE 0 END + CASE WHEN a.activity_type='daily_claim' THEN 25 ELSE 0 END)" : "SUM(a.xp_awarded)";
    rows = await env.DB.prepare(`SELECT u.id,u.discord_id,u.username,u.global_name,u.avatar,COALESCE(p.level,1) AS level,COALESCE(p.streak_best,0) AS streak_best,
      COALESCE(p.xp_total,0) AS xp_total,${scoreExpr} AS period_score,
      SUM(CASE WHEN a.activity_type='mission_claim' THEN a.amount ELSE 0 END) AS missions_completed
      FROM activity_log a JOIN users u ON u.id=a.user_id LEFT JOIN progress_profiles p ON p.user_id=u.id
      WHERE a.${keyColumn}=? GROUP BY u.id ORDER BY period_score DESC,MIN(a.created_at) ASC LIMIT 50`).bind(keyValue).all();
  }
  const entries = (rows.results || []).map((row,index) => {
    const fallbackScore = category === "level" ? row.level : category === "streak" ? row.streak_best : category === "missions" ? row.missions_completed : row.xp_total;
    const rawScore = row.period_score ?? row.general_score ?? fallbackScore ?? 0;
    return {
      rank:index+1,discord_id:row.discord_id,username:row.username,display_name:row.global_name || row.username,avatar_url:avatarUrl(row),
      xp_total:Number(row.xp_total || 0),level:Number(row.level || 1),streak_best:Number(row.streak_best || 0),missions_completed:Number(row.missions_completed || 0),
      score:Number(rawScore || 0),is_me:row.discord_id===user.discord_id
    };
  });
  return json({category,period,entries},200,env,request);
}

async function getCommunityEvents(request, user, env) {
  const now = Date.now();
  const rows = await env.DB.prepare(`SELECT e.*,COALESCE(ep.progress,0) AS progress,COALESCE(p.contribution,0) AS contribution,COALESCE(p.claimed,0) AS claimed
    FROM community_events e LEFT JOIN community_event_progress ep ON ep.event_id=e.id
    LEFT JOIN community_event_participants p ON p.event_id=e.id AND p.user_id=?
    WHERE e.active=1 AND e.ends_at>=? ORDER BY e.starts_at DESC`).bind(user.id,now-7*86400000).all();
  const events = (rows.results || []).map(row => ({...row,target:Number(row.target),progress:Number(row.progress),contribution:Number(row.contribution),claimed:!!row.claimed,completed:Number(row.progress)>=Number(row.target),percent:Math.min(100,Math.round((Number(row.progress)/Number(row.target))*100)),starts_at:Number(row.starts_at),ends_at:Number(row.ends_at),reward_points:Number(row.reward_points || 0),reward_xp:Number(row.reward_xp || 0)}));
  return json({events},200,env,request);
}

async function claimCommunityEvent(request, user, env, eventId) {
  const row = await env.DB.prepare(`SELECT e.*,COALESCE(ep.progress,0) AS progress,COALESCE(p.contribution,0) AS contribution,COALESCE(p.claimed,0) AS claimed
    FROM community_events e LEFT JOIN community_event_progress ep ON ep.event_id=e.id
    LEFT JOIN community_event_participants p ON p.event_id=e.id AND p.user_id=? WHERE e.id=?`).bind(user.id,eventId).first();
  if (!row) throw httpError(404,"Événement introuvable.");
  if (Number(row.progress)<Number(row.target)) throw httpError(409,"L’objectif communautaire n’est pas encore atteint.");
  if (Number(row.contribution)<=0) throw httpError(403,"Tu dois participer à l’événement pour récupérer sa récompense.");
  const claimed = await env.DB.prepare(`UPDATE community_event_participants SET claimed=1,claimed_at=?,updated_at=?
    WHERE event_id=? AND user_id=? AND claimed=0 RETURNING claimed`).bind(Date.now(),Date.now(),eventId,user.id).first();
  if (!claimed) throw httpError(409,"Cette récompense a déjà été récupérée.");
  const points = Math.max(0,Number(row.reward_points || 0));
  if (points) await addPoints(user,points,env);
  const item = row.reward_item_key ? await grantInventoryItem(user,row.reward_item_key,1,env) : null;
  const xp = await recordActivity(user,"community_claim",1,Number(row.reward_xp || 0),env,{event_id:eventId});
  return json({ok:true,reward:{points,xp:xp.awarded,item},profile:xp.profile},200,env,request);
}

async function progressionRewardItemKey(value, env) {
  const key = String(value || "").trim();
  if (!key) return null;
  const exists = await env.DB.prepare("SELECT 1 FROM item_catalog WHERE item_key=?").bind(key).first();
  if (!exists) throw httpError(400, "L’objet de récompense sélectionné n’existe pas.");
  return key;
}

function progressionActivityType(value, fallback = "generation") {
  const activity = String(value || fallback).trim().toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(activity)) throw httpError(400, "Type d’activité invalide.");
  return activity;
}

async function createMission(request, env) {
  const body = await parseJson(request);
  const title = String(body.title || "").trim().slice(0,100);
  if (!title) throw httpError(400, "Titre requis.");
  const scope = ["classic","weekly"].includes(body.scope) ? body.scope : "classic";
  const requiredRank = normalizeAccessRank(body.required_rank || "free");
  let id = String(body.id || slug(title)).trim().slice(0,64) || crypto.randomUUID();
  let suffix = 2;
  const baseId = id;
  while (await env.DB.prepare("SELECT 1 FROM missions WHERE id=?").bind(id).first()) id = `${baseId.slice(0,56)}-${suffix++}`;
  const rewardItemKey = await progressionRewardItemKey(body.reward_item_key, env);
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO missions(id,scope,title,description,activity_type,target,reward_points,reward_xp,reward_item_key,active,sort_order,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      id,scope,title,String(body.description || "").slice(0,500),progressionActivityType(body.activity_type),
      Math.max(1,Math.trunc(Number(body.target || 1))),Math.max(0,Math.trunc(Number(body.reward_points || 0))),
      Math.max(0,Math.trunc(Number(body.reward_xp || 0))),rewardItemKey,body.active===false?0:1,
      Math.trunc(Number(body.sort_order || 0)),now,now
    ).run();
  await env.DB.prepare(`INSERT INTO mission_access(mission_id,required_rank,updated_at) VALUES(?,?,?)
    ON CONFLICT(mission_id) DO UPDATE SET required_rank=excluded.required_rank,updated_at=excluded.updated_at`).bind(id,requiredRank,now).run();
  return json({ok:true,id},201,env,request);
}

async function updateMission(request, env, id) {
  const current = await env.DB.prepare("SELECT * FROM missions WHERE id=?").bind(id).first();
  if (!current) throw httpError(404, "Quête introuvable.");
  const body = await parseJson(request);
  const title = String(body.title ?? current.title).trim().slice(0,100);
  if (!title) throw httpError(400, "Titre requis.");
  const scope = ["classic","weekly"].includes(body.scope) ? body.scope : current.scope;
  const rewardItemKey = await progressionRewardItemKey(body.reward_item_key ?? current.reward_item_key, env);
  const access = await env.DB.prepare("SELECT required_rank FROM mission_access WHERE mission_id=?").bind(id).first();
  const requiredRank = normalizeAccessRank(body.required_rank ?? access?.required_rank ?? "free");
  await env.DB.prepare(`UPDATE missions SET scope=?,title=?,description=?,activity_type=?,target=?,reward_points=?,reward_xp=?,reward_item_key=?,active=?,sort_order=?,updated_at=? WHERE id=?`).bind(
    scope,title,String(body.description ?? current.description).slice(0,500),progressionActivityType(body.activity_type ?? current.activity_type),
    Math.max(1,Math.trunc(Number(body.target ?? current.target))),Math.max(0,Math.trunc(Number(body.reward_points ?? current.reward_points))),
    Math.max(0,Math.trunc(Number(body.reward_xp ?? current.reward_xp))),rewardItemKey,
    body.active===undefined?current.active:(body.active?1:0),Math.trunc(Number(body.sort_order ?? current.sort_order)),Date.now(),id
  ).run();
  await env.DB.prepare(`INSERT INTO mission_access(mission_id,required_rank,updated_at) VALUES(?,?,?)
    ON CONFLICT(mission_id) DO UPDATE SET required_rank=excluded.required_rank,updated_at=excluded.updated_at`).bind(id,requiredRank,Date.now()).run();
  return json({ok:true,id},200,env,request);
}

async function resetMissionProgress(request, env, id) {
  if (!await env.DB.prepare("SELECT 1 FROM missions WHERE id=?").bind(id).first()) throw httpError(404, "Quête introuvable.");
  const result = await env.DB.prepare("DELETE FROM user_mission_progress WHERE mission_id=?").bind(id).run();
  return json({ok:true,id,removed:Number(result.meta?.changes || 0)},200,env,request);
}

async function deleteMission(request, env, id) {
  if (!await env.DB.prepare("SELECT 1 FROM missions WHERE id=?").bind(id).first()) throw httpError(404, "Quête introuvable.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_mission_progress WHERE mission_id=?").bind(id),
    env.DB.prepare("DELETE FROM missions WHERE id=?").bind(id)
  ]);
  return json({ok:true,id},200,env,request);
}

async function updateCommunityEvent(request, env, id) {
  const current = await env.DB.prepare("SELECT * FROM community_events WHERE id=?").bind(id).first();
  if (!current) throw httpError(404, "Événement introuvable.");
  const body = await parseJson(request);
  const title = String(body.title ?? current.title).trim().slice(0,100);
  if (!title) throw httpError(400, "Titre requis.");
  const startsAt = Math.max(0,Number(body.starts_at ?? current.starts_at));
  const endsAt = Math.max(startsAt + 3600000,Number(body.ends_at ?? current.ends_at));
  const rewardItemKey = await progressionRewardItemKey(body.reward_item_key ?? current.reward_item_key, env);
  await env.DB.prepare(`UPDATE community_events SET title=?,description=?,emoji=?,activity_type=?,target=?,reward_points=?,reward_xp=?,reward_item_key=?,starts_at=?,ends_at=?,active=?,updated_at=? WHERE id=?`).bind(
    title,String(body.description ?? current.description).slice(0,500),String(body.emoji ?? current.emoji).slice(0,16),
    progressionActivityType(body.activity_type ?? current.activity_type),Math.max(1,Math.trunc(Number(body.target ?? current.target))),
    Math.max(0,Math.trunc(Number(body.reward_points ?? current.reward_points))),Math.max(0,Math.trunc(Number(body.reward_xp ?? current.reward_xp))),
    rewardItemKey,startsAt,endsAt,body.active===undefined?current.active:(body.active?1:0),Date.now(),id
  ).run();
  return json({ok:true,id},200,env,request);
}

async function resetCommunityEventProgress(request, env, id) {
  if (!await env.DB.prepare("SELECT 1 FROM community_events WHERE id=?").bind(id).first()) throw httpError(404, "Événement introuvable.");
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO community_event_progress(event_id,progress,updated_at) VALUES(?,0,?) ON CONFLICT(event_id) DO UPDATE SET progress=0,updated_at=excluded.updated_at`).bind(id,now),
    env.DB.prepare("DELETE FROM community_event_participants WHERE event_id=?").bind(id)
  ]);
  return json({ok:true,id},200,env,request);
}

async function deleteCommunityEvent(request, env, id) {
  if (!await env.DB.prepare("SELECT 1 FROM community_events WHERE id=?").bind(id).first()) throw httpError(404, "Événement introuvable.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM community_event_participants WHERE event_id=?").bind(id),
    env.DB.prepare("DELETE FROM community_event_progress WHERE event_id=?").bind(id),
    env.DB.prepare("DELETE FROM community_events WHERE id=?").bind(id)
  ]);
  return json({ok:true,id},200,env,request);
}

async function createCommunityEvent(request, env) {
  const body = await parseJson(request);
  const title = String(body.title || "").trim().slice(0,100);
  if (!title) throw httpError(400,"Titre requis.");
  const id = String(body.id || slug(title)).slice(0,64);
  const now = Date.now();
  const startsAt = Math.max(0,Number(body.starts_at || now));
  const endsAt = Math.max(startsAt+3600000,Number(body.ends_at || now+7*86400000));
  const rewardItemKey = await progressionRewardItemKey(body.reward_item_key, env);
  await env.DB.prepare(`INSERT INTO community_events(id,title,description,emoji,activity_type,target,reward_points,reward_xp,reward_item_key,starts_at,ends_at,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,title,String(body.description || "").slice(0,500),String(body.emoji || "🌍").slice(0,16),progressionActivityType(body.activity_type),Math.max(1,Math.trunc(Number(body.target || 1))),Math.max(0,Math.trunc(Number(body.reward_points || 0))),Math.max(0,Math.trunc(Number(body.reward_xp || 0))),rewardItemKey,startsAt,endsAt,body.active===false?0:1,now,now).run();
  await env.DB.prepare("INSERT OR IGNORE INTO community_event_progress(event_id,progress,updated_at) VALUES(?,0,?)").bind(id,now).run();
  return json({ok:true,id},201,env,request);
}

async function createPromoCode(request, env) {
  const body = await parseJson(request);
  const code = String(body.code || "").trim().toUpperCase().replace(/\s+/g,"").slice(0,40);
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw httpError(400,"Code promo invalide.");
  const now = Date.now();
  await env.DB.prepare(`INSERT INTO promo_codes(code,description,reward_points,reward_xp,reward_item_key,max_uses,used_count,starts_at,ends_at,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,0,?,?,?,?,?)`).bind(code,String(body.description || "").slice(0,300),Math.max(0,Math.trunc(Number(body.reward_points || 0))),Math.max(0,Math.trunc(Number(body.reward_xp || 0))),body.reward_item_key || null,Math.max(0,Math.trunc(Number(body.max_uses || 0))),Math.max(0,Number(body.starts_at || 0)),Math.max(0,Number(body.ends_at || 0)),body.active===false?0:1,now,now).run();
  return json({ok:true,code},201,env,request);
}
// ===== Fin progression V7 ====================================================

async function handleAdmin(request, user, env, path) {
  if (path === "/api/admin/overview" && request.method === "GET") return adminOverview(request, env);
  if (path === "/api/admin/history" && request.method === "GET") return adminHistory(request, env);
  if (path === "/api/admin/services" && request.method === "POST") return createService(request, env);
  if (path === "/api/admin/products" && request.method === "POST") return createProduct(request, env);
  if (path === "/api/admin/wheel" && request.method === "POST") return createWheelReward(request, env);
  if (path === "/api/admin/settings" && request.method === "PUT") return updateSettings(request, env);
  if (path === "/api/admin/missions" && request.method === "POST") return createMission(request, env);
  if (path === "/api/admin/community-events" && request.method === "POST") return createCommunityEvent(request, env);
  if (path === "/api/admin/promo-codes" && request.method === "POST") return createPromoCode(request, env);

  let match = path.match(/^\/api\/admin\/missions\/([^/]+)$/);
  if (match && request.method === "PUT") return updateMission(request, env, decodeURIComponent(match[1]));
  if (match && request.method === "DELETE") return deleteMission(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/admin\/missions\/([^/]+)\/reset$/);
  if (match && request.method === "POST") return resetMissionProgress(request, env, decodeURIComponent(match[1]));

  match = path.match(/^\/api\/admin\/community-events\/([^/]+)$/);
  if (match && request.method === "PUT") return updateCommunityEvent(request, env, decodeURIComponent(match[1]));
  if (match && request.method === "DELETE") return deleteCommunityEvent(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/admin\/community-events\/([^/]+)\/reset$/);
  if (match && request.method === "POST") return resetCommunityEventProgress(request, env, decodeURIComponent(match[1]));

  match = path.match(/^\/api\/admin\/services\/([^/]+)$/);
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
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/rank$/);
  if (match && (request.method === "PUT" || request.method === "POST")) return setUserRank(request, env, decodeURIComponent(match[1]));
  match = path.match(/^\/api\/admin\/users\/([^/]+)\/points$/);
  if (match && request.method === "POST") return adjustPoints(request, env, match[1]);
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
  const services = await env.DB.prepare(`SELECT s.*,COALESCE(sa.required_rank,'free') AS required_rank,COUNT(i.id) AS stock
    FROM services s LEFT JOIN service_access sa ON sa.service_id=s.id LEFT JOIN inventory_lines i ON i.service_id=s.id
    GROUP BY s.id ORDER BY s.created_at`).all();
  const products = await env.DB.prepare(`SELECT p.*,COUNT(l.id) AS stock FROM products p LEFT JOIN product_lines l ON l.product_id=p.id WHERE p.id NOT LIKE 'points-%' GROUP BY p.id ORDER BY p.created_at`).all();
  const wheel = await env.DB.prepare("SELECT * FROM wheel_rewards ORDER BY created_at").all();
  const missions = await env.DB.prepare(`SELECT m.*,COALESCE(ma.required_rank,'free') AS required_rank
    FROM missions m LEFT JOIN mission_access ma ON ma.mission_id=m.id ORDER BY m.scope,m.sort_order,m.title`).all();
  const communityEvents = await env.DB.prepare(`SELECT e.*,COALESCE(ep.progress,0) AS progress,
    (SELECT COUNT(*) FROM community_event_participants p WHERE p.event_id=e.id) AS participants
    FROM community_events e LEFT JOIN community_event_progress ep ON ep.event_id=e.id
    ORDER BY e.created_at DESC,e.title`).all();
  const itemCatalog = await env.DB.prepare("SELECT item_key,name,emoji,item_type,rarity FROM item_catalog ORDER BY item_type,rarity,name").all();
  const dayKey = brusselsDayKey();
  const users = await env.DB.prepare(`SELECT u.discord_id,u.username,u.global_name AS display_name,u.points,u.total_earned,u.total_spent,
    COALESCE(ur.rank,'free') AS stored_rank,
    COALESCE((SELECT dgu.used FROM daily_generation_usage dgu WHERE dgu.user_id=u.id AND dgu.day_key=?),0) AS generations_today,
    (SELECT COUNT(*) FROM deliveries d WHERE d.user_id=u.id) AS generations,
    (SELECT COUNT(*) FROM purchases p WHERE p.user_id=u.id) AS purchases
    FROM users u LEFT JOIN user_ranks ur ON ur.user_id=u.id
    ORDER BY u.created_at DESC LIMIT 200`).bind(dayKey).all();
  const settingsRows = await env.DB.prepare("SELECT key,value FROM app_settings").all();
  const history = await getAdminHistoryData(env);
  const timers = await getAdminTimersData(env);
  const settings = Object.fromEntries(settingsRows.results.map(x => [x.key,x.value]));
  return json({
    api_version:"progression-v7.6",
    rank_rules:RANK_RULES,
    services:services.results.map(x=>({...x,required_rank:normalizeAccessRank(x.required_rank),stock:Number(x.stock),cooldown_seconds:Number(x.cooldown_seconds),enabled:!!x.enabled})),
    products:products.results.map(x=>({...x,stock:Number(x.stock),price:Number(x.price),enabled:!!x.enabled})),
    wheel_rewards:wheel.results.map(x=>({...x,points:Number(x.points),weight:Number(x.weight)})),
    missions:missions.results.map(x=>({...x,required_rank:normalizeAccessRank(x.required_rank),target:Number(x.target),reward_points:Number(x.reward_points||0),reward_xp:Number(x.reward_xp||0),sort_order:Number(x.sort_order||0),active:!!x.active})),
    community_events:communityEvents.results.map(x=>({...x,target:Number(x.target),reward_points:Number(x.reward_points||0),reward_xp:Number(x.reward_xp||0),starts_at:Number(x.starts_at),ends_at:Number(x.ends_at),progress:Number(x.progress||0),participants:Number(x.participants||0),active:!!x.active})),
    item_catalog:itemCatalog.results || [],
    users:users.results.map(x=>{
      const accountRank=adminIds(env).has(x.discord_id)?"admin":normalizeRank(x.stored_rank);
      const rules=RANK_RULES[accountRank];
      return {...x,account_rank:accountRank,rank:rules,points:Number(x.points),total_earned:Number(x.total_earned),total_spent:Number(x.total_spent),generations:Number(x.generations),purchases:Number(x.purchases),generation_cooldown_seconds:rules.generation_cooldown_seconds,daily_generation_limit:rules.daily_generation_limit,generations_today:Number(x.generations_today || 0)};
    }),
    settings,history,timers,daily_usage_day:dayKey,daily_usage_timezone:"Europe/Brussels"
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
  await env.DB.prepare("INSERT INTO service_access(service_id,required_rank,updated_at) VALUES(?,?,?)").bind(id,normalizeAccessRank(body.required_rank || "free"),now).run();
  return json({ok:true,id},201,env,request);
}

async function updateService(request, env, id) {
  const body = await parseJson(request), current = await env.DB.prepare("SELECT * FROM services WHERE id=?").bind(id).first();
  if (!current) throw httpError(404,"Service introuvable.");
  const currentAccess = await env.DB.prepare("SELECT required_rank FROM service_access WHERE service_id=?").bind(id).first();
  const requiredRank = normalizeAccessRank(body.required_rank ?? currentAccess?.required_rank ?? "free");
  await env.DB.prepare("UPDATE services SET name=?,emoji=?,description=?,cooldown_seconds=?,enabled=?,updated_at=? WHERE id=?").bind(
    String(body.name ?? current.name).trim().slice(0,80),String(body.emoji ?? current.emoji).slice(0,16),String(body.description ?? current.description).slice(0,300),Math.max(0,Number(body.cooldown_seconds ?? current.cooldown_seconds)),body.enabled===undefined?current.enabled:(body.enabled?1:0),Date.now(),id).run();
  await env.DB.prepare(`INSERT INTO service_access(service_id,required_rank,updated_at) VALUES(?,?,?)
    ON CONFLICT(service_id) DO UPDATE SET required_rank=excluded.required_rank,updated_at=excluded.updated_at`).bind(id,requiredRank,Date.now()).run();
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
    wheel_cooldown_seconds:43200,
    starting_points:Math.max(0,Number(b.starting_points||0)),
    xp_generation:Math.max(0,Math.trunc(Number(b.xp_generation ?? 20))),
    xp_purchase:Math.max(0,Math.trunc(Number(b.xp_purchase ?? 35))),
    xp_wheel:Math.max(0,Math.trunc(Number(b.xp_wheel ?? 15))),
    xp_chest:Math.max(0,Math.trunc(Number(b.xp_chest ?? 25))),
    daily_base_points:Math.max(0,Math.trunc(Number(b.daily_base_points ?? 50))),
    daily_base_xp:Math.max(0,Math.trunc(Number(b.daily_base_xp ?? 30)))
  };
  await env.DB.batch(Object.entries(values).map(([k,v])=>env.DB.prepare("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(k,String(v))));
  return json({ok:true},200,env,request)
}

async function setUserRank(request, env, discordId) {
  const cleanId = String(discordId || "").trim();
  if (!/^\d{5,30}$/.test(cleanId)) throw httpError(400, "ID Discord invalide.");
  const body = await parseJson(request);
  const rank = normalizeRank(body.rank);
  if (!Object.prototype.hasOwnProperty.call(RANK_RULES,String(body.rank || "").toLowerCase())) throw httpError(400,"Rang invalide.");
  const user = await env.DB.prepare("SELECT id FROM users WHERE discord_id=?").bind(cleanId).first();
  if (!user) throw httpError(404,"Utilisateur introuvable. Il doit s’être connecté au site au moins une fois.");
  const now=Date.now();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_ranks(user_id,rank,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET rank=excluded.rank,updated_at=excluded.updated_at`).bind(user.id,rank,now),
    env.DB.prepare("DELETE FROM generator_cooldowns WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM wheel_cooldowns WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM wheel_cycle_usage WHERE user_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM app_settings WHERE key IN (?,?)").bind(`user_generation_cooldown:${cleanId}`,`user_daily_generation_limit:${cleanId}`)
  ]);
  return json({ok:true,discord_id:cleanId,rank:RANK_RULES[rank]},200,env,request);
}

async function adjustPoints(request,env,discordId){const {delta}=await parseJson(request),amount=Math.trunc(Number(delta));if(!Number.isFinite(amount)||Math.abs(amount)>1000000)throw httpError(400,"Ajustement invalide.");const row=await env.DB.prepare("UPDATE users SET points=MAX(0,points+?),total_earned=total_earned+CASE WHEN ?>0 THEN ? ELSE 0 END,total_spent=total_spent+CASE WHEN ?<0 THEN ABS(?) ELSE 0 END,updated_at=? WHERE discord_id=? RETURNING points").bind(amount,amount,amount,amount,amount,Date.now(),discordId).first();if(!row)throw httpError(404,"Utilisateur introuvable.");return json({ok:true,points:Number(row.points)},200,env,request)}


async function setUserTimer(request, env, discordId) {
  const cleanId = String(discordId || "").trim();
  if (!/^\d{5,30}$/.test(cleanId)) throw httpError(400, "ID Discord invalide.");
  const body = await parseJson(request);
  const type = String(body.type || "generator");
  const seconds = Math.trunc(Number(body.seconds));
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 31536000) throw httpError(400, "Durée invalide (0 à 31 536 000 secondes).");
  const user = await env.DB.prepare("SELECT id,discord_id,username,global_name FROM users WHERE discord_id=?").bind(cleanId).first();
  if (!user) throw httpError(404, "Utilisateur introuvable. Il doit s’être connecté au site au moins une fois.");
  user.account_rank = await loadUserRank(user, env);
  const now = Date.now();
  const nextAllowedAt = seconds === 0 ? 0 : now + seconds * 1000;

  if (type === "wheel") {
    if (seconds === 0) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM wheel_cooldowns WHERE user_id=?").bind(user.id),
        env.DB.prepare("DELETE FROM wheel_cycle_usage WHERE user_id=?").bind(user.id)
      ]);
    } else {
      const allowance=rankRules(user,env).wheel_free_spins;
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO wheel_cooldowns(user_id,next_allowed_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET next_allowed_at=excluded.next_allowed_at`).bind(user.id,nextAllowedAt),
        env.DB.prepare(`INSERT INTO wheel_cycle_usage(user_id,cycle_ends_at,free_spins_used,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET cycle_ends_at=excluded.cycle_ends_at,free_spins_used=excluded.free_spins_used,updated_at=excluded.updated_at`).bind(user.id,nextAllowedAt,allowance,now)
      ]);
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

