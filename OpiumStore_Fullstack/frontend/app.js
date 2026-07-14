(() => {
  "use strict";

  const config = window.OPIUM_CONFIG || {};
  const API_BASE = String(config.API_BASE || "").replace(/\/$/, "");
  const AUTOSHOP_URL = window.OPIUM_AUTOSHOP_URL || "https://opium-store.opiumstore.workers.dev/";
  const DISCORD_URL = config.DISCORD_URL || config.SUPPORT_URL || "";
  const TOKEN_KEY = "opium_store_session";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    me: null,
    catalog: null,
    wallet: [],
    progression: null,
    leaderboards: null,
    communityEvents: null,
    pushConfig: null,
    leaderboardCategory: "xp",
    leaderboardPeriod: "global",
    admin: null,
    adminHistory: null,
    adminHistoryLoading: false,
    page: "home",
    adminTab: "services",
    wheelRotation: 0,
    wheelBusy: false,
    generatorResult: null,
    purchaseResult: null,
    installPrompt: null,
    appInstalled: window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true
  };

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const boot = $("#boot");
  const loginView = $("#loginView");
  const app = $("#app");
  const main = $("#main");
  const toast = $("#toast");

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("fr-BE").format(Number(value || 0));
  }

  function formatDate(value) {
    return new Date(Number(value)).toLocaleString("fr-BE", {day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit"});
  }

  function datetimeLocalValue(value) {
    const date = new Date(Number(value || Date.now()));
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function datetimeInputValue(id) {
    const value = document.getElementById(id)?.value;
    return value ? new Date(value).getTime() : 0;
  }

  function activityOptions(selected = "generation", includeAny = true) {
    const options = [
      ["generation", "Générations"], ["purchase", "Achats boutique"], ["wheel", "Roue"],
      ["chest_open", "Ouverture de coffres"], ["daily_claim", "Récompenses quotidiennes"],
      ["promo", "Codes promos"], ["mission_claim", "Missions récupérées"],
      ["community_claim", "Récompenses d’événement"], ["daily_challenge_claim", "Défis quotidiens"],
      ["gift_sent", "Cadeaux envoyés"], ["achievement_unlock", "Succès débloqués"]
    ];
    if (includeAny) options.push(["any", "Toutes les activités"]);
    return options.map(([value,label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
  }

  function itemRewardOptions(selected = "") {
    const items = state.admin?.item_catalog || [];
    return `<option value="">Aucun objet</option>${items.map(item => `<option value="${escapeHtml(item.item_key)}" ${item.item_key === selected ? "selected" : ""}>${escapeHtml(item.emoji)} ${escapeHtml(item.name)} — ${escapeHtml(item.item_key)}</option>`).join("")}`;
  }

  function remaining(seconds) {
    const s = Math.max(0, Math.ceil(Number(seconds || 0)));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }

  function showToast(message, error = false) {
    toast.textContent = message;
    toast.className = `toast show${error ? " error" : ""}`;
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.className = "toast", 3200);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copié dans le presse-papiers.");
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      showToast("Copié dans le presse-papiers.");
    }
  }

  function isStandaloneApp() {
    return state.appInstalled || window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  }

  async function installApplication() {
    if (isStandaloneApp()) {
      showToast("L’application OpiumStore est déjà installée.");
      return;
    }
    if (!state.installPrompt) {
      showToast("Utilise le menu du navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».", true);
      return;
    }
    const prompt = state.installPrompt;
    state.installPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice.catch(() => ({outcome:"dismissed"}));
    if (choice.outcome === "accepted") showToast("Installation d’OpiumStore lancée.");
    else showToast("Installation annulée.");
    render();
  }

  async function api(path, options = {}) {
    if (!API_BASE || API_BASE.includes("YOUR-WORKER")) {
      throw new Error("Configure d’abord API_BASE dans frontend/config.js.");
    }
    const headers = new Headers(options.headers || {});
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (state.token) headers.set("Authorization", `Bearer ${state.token}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {cache:"no-store", ...options, headers, signal: controller.signal});
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("Le serveur met trop de temps à répondre. Réessaie dans quelques secondes.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      state.token = "";
      state.me = null;
      showLogin();
    }
    if (!response.ok) {
      const err = new Error(payload.error || payload.message || `Erreur HTTP ${response.status}`);
      err.status = response.status;
      err.data = payload;
      throw err;
    }
    return payload;
  }

  function avatarUrl(user) {
    return user?.avatar_url || "assets/logo.png";
  }

  function rankInfo(value) {
    const key = String(value?.key || value || "free").toLowerCase();
    return ({
      free:{key:"free",label:"Free",emoji:"🆓",className:"rank-free"},
      boost:{key:"boost",label:"Boost",emoji:"🚀",className:"rank-boost"},
      vip:{key:"vip",label:"VIP",emoji:"👑",className:"rank-vip"},
      admin:{key:"admin",label:"Admin",emoji:"🛡️",className:"rank-admin"}
    })[key] || {key:"free",label:"Free",emoji:"🆓",className:"rank-free"};
  }

  function rankOptions(selected = "free") {
    return ["free","boost","vip","admin"].map(key => {
      const rank=rankInfo(key);
      return `<option value="${key}" ${key===selected?"selected":""}>${rank.emoji} ${rank.label}</option>`;
    }).join("");
  }

  function accessRankOptions(selected = "free") {
    return ["free","boost","vip"].map(key => {
      const rank=rankInfo(key);
      return `<option value="${key}" ${key===selected?"selected":""}>${rank.emoji} ${rank.label}</option>`;
    }).join("");
  }
  function setUserChrome() {
    if (!state.me) return;
    $("#sidebarName").textContent = state.me.display_name || state.me.username;
    $("#sidebarDiscord").textContent = `@${state.me.username}`;
    const rank=rankInfo(state.me.rank || state.me.account_rank);
    const role=$("#sidebarRole");
    role.textContent = `${rank.emoji} ${rank.label}`;
    role.className = `role-chip ${rank.className}`;
    $("#sidebarAvatar").src = avatarUrl(state.me);
    $("#topAvatar").src = avatarUrl(state.me);
    $("#topPoints").textContent = formatNumber(state.me.points);
    const profile = state.progression?.profile;
    if ($("#topLevel")) $("#topLevel").textContent = formatNumber(profile?.level || 1);
    $("#adminNav").classList.toggle("hidden", !state.me.is_admin);
    const autoshopLink = $("#autoshopLink");
    if (autoshopLink) { autoshopLink.href = AUTOSHOP_URL; autoshopLink.dataset.autoshopLink = "true"; }
  }


  function showLogin() {
    boot.classList.add("hidden");
    app.classList.add("hidden");
    loginView.classList.remove("hidden");
  }

  function showApp() {
    boot.classList.add("hidden");
    loginView.classList.add("hidden");
    app.classList.remove("hidden");
    setUserChrome();
  }

  async function exchangeAuthCode() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const code = hash.get("auth_code");
    const error = hash.get("auth_error");
    if (error) {
      history.replaceState(null, "", location.pathname);
      throw new Error(error);
    }
    if (!code) return false;
    history.replaceState(null, "", location.pathname);
    const result = await api("/auth/exchange", {method:"POST", body:JSON.stringify({code})});
    state.token = result.token;
    localStorage.setItem(TOKEN_KEY, state.token);
    return true;
  }

  async function loadBaseData() {
    const [me, catalog, wallet, progression, pushConfig] = await Promise.all([
      api("/api/me"),
      api("/api/catalog"),
      api("/api/wallet"),
      api("/api/progression"),
      api("/api/push/config").catch(() => ({configured:false,subscribed:false,public_key:""}))
    ]);
    state.me = me.user;
    state.catalog = catalog;
    state.wallet = wallet.items || [];
    state.progression = progression;
    state.pushConfig = pushConfig;
  }

  async function refreshAll(renderAfter = true) {
    await loadBaseData();
    setUserChrome();
    if (state.me.is_admin && state.page === "admin") {
      state.admin = await api(`/api/admin/overview?ts=${Date.now()}`);
      state.adminHistory = state.admin.history || state.adminHistory;
    }
    if (renderAfter) render();
  }

  function statCard(label, value, sub, icon) {
    return `<article class="card"><div class="stat-row"><div><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-sub">${escapeHtml(sub)}</div></div><div class="stat-icon">${icon}</div></div></article>`;
  }

  function homePage() {
    const s = state.catalog?.summary || {};
    const p = state.progression?.profile || {};
    const daily = state.progression?.daily || {};
    return `<section class="page">
      <article class="hero">
        <div class="hero-inner">
          <div class="hero-copy">
            <span class="eyebrow">BIENVENUE SUR OPIUMSTORE HUB</span>
            <h1>Salut, ${escapeHtml(state.me.display_name || state.me.username)}.</h1><span class="rank-badge ${rankInfo(state.me.account_rank).className}">${rankInfo(state.me.account_rank).emoji} Rang ${rankInfo(state.me.account_rank).label}</span>
            <p>Progresse en utilisant le générateur, en accomplissant des missions, en ouvrant des coffres et en participant aux événements communautaires.</p>
            <div class="toolbar">
              <button class="btn btn-primary" data-page="generator">⚡ Ouvrir le générateur</button>
              <button class="btn btn-secondary" data-page="progression">⭐ Voir ma progression</button>
            </div>
          </div>
          <img src="assets/logo.png" class="hero-logo" alt="OpiumStore">
        </div>
      </article>
      <section class="section grid grid-4">
        ${statCard("Niveau", formatNumber(p.level || 1), `${formatNumber(p.xp_total || 0)} XP au total`, "⭐")}
        ${statCard("Série actuelle", `${formatNumber(p.streak_current || 0)} jour(s)`, `Record : ${formatNumber(p.streak_best || 0)} jour(s)`, "🔥")}
        ${statCard("Solde points", `${formatNumber(state.me.points)} pts`, `${formatNumber(state.me.total_earned)} gagnés au total`, "◈")}
        ${statCard("Missions", formatNumber(p.missions_completed || 0), "Récompenses récupérées", "🏆")}
      </section>
      <section class="section grid grid-2">
        ${xpCard()}
        <article class="card daily-card">
          <div class="card-heading"><div class="emoji-box">🎁</div><div><span class="eyebrow">RÉCOMPENSE QUOTIDIENNE</span><h3>${daily.can_claim ? "Ta récompense est prête" : "Déjà récupérée aujourd’hui"}</h3></div></div>
          <p class="muted">Prochaine récompense : <b>${formatNumber(daily.next_points || 0)} points</b> et <b>${formatNumber(daily.next_xp || 0)} XP</b>.</p>
          <button class="btn btn-green" data-claim-daily ${daily.can_claim ? "" : "disabled"}>${daily.can_claim ? "Récupérer maintenant" : "Reviens demain"}</button>
        </article>
      </section>
      <section class="section">
        <div class="section-head"><div><h2>Services disponibles</h2><p>Chaque génération réussie rapporte de l’XP.</p></div></div>
        <div class="grid grid-3">${(state.catalog?.services || []).slice(0,6).map(serviceCard).join("") || '<div class="empty">Aucun service disponible.</div>'}</div>
      </section>
    </section>`;
  }
  function serviceCard(s) {
    const wait = Number(s.cooldown_remaining || 0);
    const dailyRemaining = Number(state.catalog?.daily_generation_remaining);
    const dailyBlocked = Number.isFinite(dailyRemaining) && dailyRemaining === 0;
    const locked = s.access_granted === false;
    const required=rankInfo(s.required_rank || "free");
    const disabled = locked || s.stock <= 0 || wait || dailyBlocked;
    const buttonLabel = locked ? `Réservé ${required.label}` : s.stock <= 0 ? "Stock épuisé" : dailyBlocked ? "Limite journalière atteinte" : wait ? `Cooldown ${remaining(wait)}` : "Générer";
    return `<article class="card service-card ${locked ? "service-locked" : ""}">
      <div class="service-top"><div class="emoji-box">${escapeHtml(s.emoji)}</div><div class="toolbar"><span class="badge ${required.className}">${required.emoji} ${required.label}</span><span class="badge ${s.stock > 0 ? "badge-green" : "badge-red"}">${formatNumber(s.stock)} en stock</span></div></div>
      <div><h3>${escapeHtml(s.name)}</h3><p class="muted">${escapeHtml(s.description || "Distribution automatique dans l’ordre du stock.")}</p></div>
      <div class="${locked ? "access-locked" : wait ? "cooldown" : "stock"}">${locked ? `🔒 Rang ${required.label} requis` : wait ? `Disponible dans ${remaining(wait)}` : dailyBlocked ? "Quota journalier utilisé" : "Disponible maintenant"}</div>
      <button class="btn btn-primary" data-generate="${escapeHtml(s.id)}" ${disabled ? "disabled" : ""}>${buttonLabel}</button>
    </article>`;
  }
  function generatorPage() {
    const limit = Number(state.catalog?.daily_generation_limit ?? 6);
    const used = Number(state.catalog?.generations_today || 0);
    const remainingToday = Number(state.catalog?.daily_generation_remaining);
    const rank=rankInfo(state.me.account_rank);
    const cooldown=Number(state.me.rank?.generation_cooldown_seconds || state.catalog?.rank?.generation_cooldown_seconds || 900);
    const quotaText = limit === 0 ? `Illimité · ${formatNumber(used)} génération(s) aujourd’hui` : `${formatNumber(used)} / ${formatNumber(limit)} aujourd’hui · ${formatNumber(Math.max(0, Number.isFinite(remainingToday) ? remainingToday : limit - used))} restante(s)`;
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">DISTRIBUTION FIFO</span><h2>Générateur</h2><p>Rang actuel : <b>${rank.emoji} ${rank.label}</b> · cooldown automatique : <b>${remaining(cooldown)}</b>.</p></div><span class="badge badge-green">${quotaText}</span></div>
      ${state.generatorResult ? `<div class="line-result"><b>Ta ligne vient d’être livrée :</b><div class="secret-line">${escapeHtml(state.generatorResult.value)}</div><div class="toolbar"><button class="btn btn-green" data-copy="${escapeHtml(state.generatorResult.value)}">Copier</button><button class="btn btn-secondary" data-page="wallet">Voir le Wallet</button></div></div>` : ""}
      <div class="section grid grid-3">${(state.catalog?.services || []).map(serviceCard).join("") || '<div class="empty">Aucun service activé.</div>'}</div>
    </section>`;
  }


  function vipPage() {
    const supportButton = DISCORD_URL
      ? `<a class="btn btn-primary" href="${escapeHtml(DISCORD_URL)}" target="_blank" rel="noopener">Ouvrir un ticket</a>`
      : `<button class="btn btn-primary" data-support-link>Ouvrir un ticket</button>`;
    const discordButton = DISCORD_URL
      ? `<a class="btn btn-secondary" href="${escapeHtml(DISCORD_URL)}" target="_blank" rel="noopener">Se connecter avec Discord</a>`
      : `<button class="btn btn-secondary" data-support-link>Se connecter avec Discord</button>`;
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">OFFRES OPIUMGEN</span><h2>Choisis ton accès</h2><p>Commence gratuitement, profite des avantages Boost ou passe VIP à vie.</p></div></div>

      <div class="grid grid-3">
        <article class="card" style="display:flex;flex-direction:column;gap:16px">
          <div><div class="emoji-box">🆓</div><span class="eyebrow">GRATUIT</span><h2>Accès gratuit</h2><div class="stat-value">0€ <small>/ jour</small></div><p class="muted">Pour utiliser le générateur gratuitement avec une limite simple.</p></div>
          <div class="admin-list"><div>✅ 6 générations par jour</div><div>⏱️ Cooldown de 15 minutes</div><div>🎡 1 tour de roue gratuit toutes les 12 h</div><div>🎁 Accès aux services publics</div><div>📦 Stocks selon disponibilité</div></div>
          <button class="btn btn-green" data-page="generator" style="margin-top:auto">Commencer gratuitement</button>
        </article>

        <article class="card" style="display:flex;flex-direction:column;gap:16px;border:1px solid rgba(59,130,246,.55);box-shadow:0 0 32px rgba(37,99,235,.13)">
          <div><div class="emoji-box">🚀</div><span class="eyebrow">BOOST</span><h2>Accès Boost</h2><div class="stat-value">Boost Discord</div><p class="muted">Pour les membres qui boostent le serveur et veulent plus de générations.</p></div>
          <div class="admin-list"><div>✅ 15 générations par jour</div><div>⏱️ Cooldown de 2 minutes</div><div>🎡 2 tours de roue gratuits toutes les 12 h</div><div>🎁 Récompense quotidienne +20 %</div><div>🚀 Accès aux services Boost</div><div>📦 Plus de confort d’utilisation</div></div>
          <div style="margin-top:auto">${discordButton}</div>
        </article>

        <article class="card" style="display:flex;flex-direction:column;gap:16px;border:1px solid rgba(168,85,247,.65);box-shadow:0 0 38px rgba(168,85,247,.18)">
          <div><div class="emoji-box">👑</div><span class="eyebrow">VIP</span><h2>VIP à vie</h2><div class="stat-value">6,99 € <small>à vie</small></div><p class="muted">L’offre premium pour profiter au maximum du générateur OpiumGen.</p></div>
          <div class="admin-list"><div>♾️ Générations illimitées par jour</div><div>⏱️ Cooldown réduit à 1 minute</div><div>🎡 3 tours de roue gratuits toutes les 12 h</div><div>🎁 Récompense quotidienne +50 %</div><div>👑 Accès aux services VIP</div><div>🚀 Accès aux services Boost</div><div>🚀 Accès premium</div></div>
          <a class="btn btn-primary" href="${escapeHtml(AUTOSHOP_URL)}" target="_blank" rel="noopener" style="margin-top:auto">Devenir VIP</a>
        </article>
      </div>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">SUPPORT</span><h2>Besoin d’aide ?</h2></div></div>
        <div class="grid grid-2">
          <article class="card"><div class="emoji-box">🎫</div><h3>Ticket Discord</h3><p class="muted">Support rapide</p><p>En cas de problème avec une génération, ouvre un ticket sur le Discord. Pense à indiquer ton pseudo, le service et l’heure de génération.</p>${supportButton}</article>
          <article class="card"><div class="emoji-box">🛠️</div><h3>Aide</h3><p class="muted">Avant de contacter</p><div class="admin-list"><div>Vérifie ton stock et ton cooldown.</div><div>Vérifie si le service est en maintenance.</div><div>Ajoute une capture du message d’erreur.</div></div></article>
        </div>
      </section>

      <section class="section">
        <div class="section-head"><div><span class="eyebrow">RÈGLEMENT</span><h2>Utilisation responsable</h2></div></div>
        <article class="card"><div class="admin-list"><div>✅ Utilise uniquement des ressources, codes ou licences que tu as le droit de distribuer.</div><div>🚫 Le partage d’accès volés, piratés ou obtenus illégalement est interdit.</div><div>🛠️ Certains services peuvent être mis en maintenance temporairement.</div><div>📩 En cas de problème, contacte le support du serveur Discord.</div></div></article>
      </section>
    </section>`;
  }

  function productCard(p) {
    const infinite = p.infinite_stock === true || Number(p.stock) < 0;
    const unavailable = !infinite && Number(p.stock) <= 0;
    const deal = p.daily_deal === true && Number(p.discount_percent) > 0;
    return `<article class="card product-card ${p.item_key ? `rarity-${escapeHtml(p.rarity || "common")}` : ""} ${deal ? "daily-deal-card" : ""}">
      ${deal ? `<div class="daily-deal-ribbon">−${formatNumber(p.discount_percent)}%</div>` : ""}
      <div class="product-top"><div class="emoji-box">${escapeHtml(p.emoji)}</div><span class="badge badge-yellow">${deal ? `<s>${formatNumber(p.base_price)}</s> ` : ""}${formatNumber(p.price)} pts</span></div>
      <div><h3>${escapeHtml(p.name)}</h3><p class="muted">${escapeHtml(p.description || "Récompense numérique.")}</p></div>
      <span class="stock">${infinite ? "∞ Stock illimité" : `${formatNumber(p.stock)} ligne(s) disponible(s)`}</span>
      <button class="btn btn-primary" data-buy="${escapeHtml(p.id)}" ${unavailable || state.me.points < p.price ? "disabled" : ""}>${unavailable ? "Rupture de stock" : state.me.points < p.price ? "Points insuffisants" : p.item_type === "ticket" ? "Acheter le ticket" : p.item_key ? "Acheter le coffre" : "Acheter"}</button>
    </article>`;
  }

  function shopPage() {
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">BOUTIQUE POINTS</span><h2>Récompenses</h2><p>Chaque achat distribue la prochaine phrase ou ligne disponible.</p></div><div class="points-pill"><span>◈</span><b>${formatNumber(state.me.points)}</b><small>pts</small></div></div>
      <article class="card daily-deals-banner"><div class="emoji-box">🛍️</div><div><h3>Offres du jour</h3><p class="muted">Une sélection d’articles reçoit automatiquement une nouvelle réduction chaque jour.</p></div><span class="badge badge-green">Mise à jour quotidienne</span></article>
      ${state.purchaseResult ? `<div class="line-result"><b>Achat réussi :</b><div class="secret-line">${escapeHtml(state.purchaseResult.value)}</div>${state.purchaseResult.kind === "inventory" ? `<button class="btn btn-green" data-page="wallet">Voir dans le Wallet</button>` : `<button class="btn btn-green" data-copy="${escapeHtml(state.purchaseResult.value)}">Copier la récompense</button>`}</div>` : ""}
      <div class="grid grid-3">${(state.catalog?.products || []).map(productCard).join("") || '<div class="empty">Aucune récompense en vente.</div>'}</div>
    </section>`;
  }

  function walletPage() {
    const deliveries = state.wallet || [];
    const inventory = state.progression?.inventory || [];
    const effects = state.progression?.effects || [];
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">WALLET & INVENTAIRE</span><h2>Tes objets et livraisons</h2><p>Utilise tes coffres et boosts, équipe tes titres et offre certains objets à d’autres membres.</p></div></div>
      ${effects.length ? `<article class="card active-effects"><h3>🔥 Effets actifs</h3>${effects.map(effect => `<div class="effect-row"><b>Boost XP ×${formatNumber(effect.multiplier)}</b><span>jusqu’au ${formatDate(effect.expires_at)}</span></div>`).join("")}</article>` : ""}
      <section class="section">
        <div class="section-head"><div><h2>Inventaire</h2><p>${formatNumber(inventory.reduce((sum,item)=>sum+Number(item.quantity || 0),0))} objet(s) possédé(s)</p></div></div>
        <div class="inventory-grid">${inventory.length ? inventory.map(inventoryCard).join("") : '<div class="empty">Ton inventaire est vide. Termine des missions pour recevoir tes premiers coffres.</div>'}</div>
      </section>
      <section class="section">
        <div class="section-head"><div><h2>Livraisons</h2><p>Les lignes déjà reçues restent disponibles ici.</p></div></div>
        <article class="card">${deliveries.length ? deliveries.map((item) => `<div class="wallet-item"><div class="emoji-box">${item.kind === "generation" ? "⚡" : "🎁"}</div><div><b>${escapeHtml(item.title)}</b><div class="wallet-line">${escapeHtml(item.value)}</div><div class="wallet-meta">${formatDate(item.created_at)}</div></div><button class="btn btn-small btn-secondary" data-copy="${escapeHtml(item.value)}">Copier</button></div>`).join("") : '<div class="empty">Ton Wallet ne contient encore aucune livraison.</div>'}</article>
      </section>
    </section>`;
  }
  function wheelPage() {
    const rewards = state.catalog?.wheel_rewards || [];
    const n = Math.max(1, rewards.length);
    const palette = ["#0284c7", "#2563eb", "#0891b2", "#0f766e", "#7c3aed", "#0369a1", "#1d4ed8", "#0e7490"];
    const gradient = rewards.map((_, i) => `${palette[i % palette.length]} ${(i * 360) / n}deg ${((i + 1) * 360) / n}deg`).join(",");
    const labels = rewards.map((r, i) => { const angle=(-90+(i+.5)*360/n)*Math.PI/180; return `<span class="wheel-label" style="left:${50+36*Math.cos(angle)}%;top:${50+36*Math.sin(angle)}%">${escapeHtml(r.emoji)}</span>`; }).join("");
    const wait = Number(state.catalog?.wheel_cooldown_remaining || 0);
    const tickets = itemQuantity("wheel_ticket");
    const freeRemaining=Number(state.catalog?.wheel_free_spins_remaining || 0);
    const freeTotal=Number(state.catalog?.wheel_free_spins_total || 1);
    const usable = freeRemaining > 0 || tickets > 0;
    const buttonText = state.wheelBusy ? "La roue tourne…" : freeRemaining > 0 ? `Tour gratuit (${freeRemaining}/${freeTotal})` : tickets > 0 ? `Utiliser un ticket (${formatNumber(tickets)})` : `Disponible dans ${remaining(wait)}`;
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">ROUE DES POINTS</span><h2>Tente ta chance</h2><p>Les tours gratuits se renouvellent toutes les 12 heures selon ton rang. Un ticket permet de rejouer avant la fin du délai.</p></div><div class="toolbar"><span class="badge badge-green">🎡 ${freeRemaining}/${freeTotal} gratuit(s)</span><span class="badge badge-yellow">🎟️ ${formatNumber(tickets)} ticket(s)</span></div></div>
      <div class="wheel-layout"><div class="wheel-stage"><div class="wheel-pointer"></div><div id="wheelDisk" class="wheel" style="background:conic-gradient(${gradient});transform:rotate(${state.wheelRotation}deg)">${labels}<div class="wheel-center">OS</div></div></div>
      <article class="card"><h3>Gains possibles</h3><div class="admin-list">${rewards.map(r => `<div class="wallet-item"><div class="emoji-box">${escapeHtml(r.emoji)}</div><div><b>${escapeHtml(r.label)}</b><div class="wallet-meta">${formatNumber(r.points)} points</div></div></div>`).join("")}</div><button id="spinBtn" class="btn btn-primary btn-lg" ${!usable || state.wheelBusy ? "disabled" : ""}>${buttonText}</button>${freeRemaining===0?`<p class="muted">Prochains tours gratuits dans ${remaining(wait)}.</p>`:""}</article></div>
    </section>`;
  }


  function itemQuantity(itemKey) {
    return Number((state.progression?.inventory || []).find(item => item.item_key === itemKey)?.quantity || 0);
  }

  function rarityName(rarity) {
    return ({common:"Commun",rare:"Rare",epic:"Épique",legendary:"Légendaire",event:"Événementiel"})[rarity] || "Commun";
  }

  function xpCard() {
    const p = state.progression?.profile || {};
    return `<article class="card xp-card">
      <div class="xp-card-head"><div><span class="eyebrow">PROGRESSION</span><h3>Niveau ${formatNumber(p.level || 1)}</h3></div><div class="level-orb">${formatNumber(p.level || 1)}</div></div>
      <div class="xp-line"><span>${formatNumber(p.xp_current || 0)} / ${formatNumber(p.xp_needed || 1)} XP</span><b>${formatNumber(p.xp_percent || 0)}%</b></div>
      <div class="progress-track"><span style="width:${Math.max(0,Math.min(100,Number(p.xp_percent || 0)))}%"></span></div>
      <p class="muted">XP total : ${formatNumber(p.xp_total || 0)}${p.active_title ? ` · Titre : ${escapeHtml(p.active_title.emoji)} ${escapeHtml(p.active_title.name)}` : ""}</p>
    </article>`;
  }
  function missionCard(mission) {
    const locked=mission.access_granted === false;
    const required=rankInfo(mission.required_rank || "free");
    const ready = !locked && mission.completed && !mission.claimed;
    const status = locked ? `Réservée ${required.label}` : mission.claimed ? "Récompense récupérée" : ready ? "Mission terminée" : `${formatNumber(mission.progress)} / ${formatNumber(mission.target)}`;
    return `<article class="mission-card ${locked ? "mission-locked" : mission.claimed ? "claimed" : ready ? "ready" : ""}">
      <div class="mission-top"><span class="mission-scope">${mission.scope === "weekly" ? "HEBDOMADAIRE" : "CLASSIQUE"}</span><span class="badge ${required.className}">${required.emoji} ${required.label}</span><span>${status}</span></div>
      <h3>${escapeHtml(mission.title)}</h3><p>${escapeHtml(mission.description)}</p>
      <div class="progress-track small"><span style="width:${mission.percent}%"></span></div>
      <div class="mission-reward"><span>🎁 ${formatNumber(mission.reward_points)} pts · ${formatNumber(mission.reward_xp)} XP${mission.reward_item_key ? ` · ${escapeHtml(mission.reward_item_key)}` : ""}</span><button class="btn btn-small ${ready ? "btn-green" : "btn-secondary"}" data-claim-mission="${escapeHtml(mission.id)}" ${ready ? "" : "disabled"}>${locked ? "Rang requis" : mission.claimed ? "Récupérée" : ready ? "Récupérer" : "En cours"}</button></div>
    </article>`;
  }


  function promoPage() {
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">CODES PROMOS</span><h2>Utiliser un code</h2><p>Entre ici un code créé depuis le panel administrateur. Chaque code ne peut être utilisé qu’une seule fois par compte.</p></div><span class="badge badge-yellow">🎟️ Récompenses</span></div>
      <article class="card promo-redeem-card">
        <div class="promo-redeem-icon">🎟️</div>
        <div class="promo-redeem-copy"><h3>Ton code OpiumStore</h3><p class="muted">Les majuscules et minuscules sont acceptées. Les espaces au début et à la fin sont supprimés automatiquement.</p></div>
        <div class="promo-redeem-form"><input id="promoCodeInput" class="input" autocomplete="off" maxlength="40" placeholder="EXEMPLE : OPIUM2026"><button class="btn btn-primary" data-redeem-promo>Utiliser le code</button></div>
      </article>
      <article class="card"><h3>Comment ça marche ?</h3><div class="admin-list"><div>1. Récupère un code donné par un administrateur.</div><div>2. Colle-le dans le champ ci-dessus.</div><div>3. Clique sur <b>Utiliser le code</b>.</div><div>4. Les points, l’XP ou le coffre sont ajoutés immédiatement à ton compte.</div></div></article>
    </section>`;
  }

  function urlBase64ToUint8Array(base64String) {
    const padding="=".repeat((4-base64String.length%4)%4);
    const base64=(base64String+padding).replace(/-/g,"+").replace(/_/g,"/");
    const raw=atob(base64);
    return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));
  }

  async function enablePushNotifications() {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("Les notifications push ne sont pas compatibles avec ce navigateur.");
      if (!state.pushConfig?.configured || !state.pushConfig?.public_key) throw new Error("Les notifications push ne sont pas encore configurées sur le Worker.");
      const permission=await Notification.requestPermission();
      if (permission!=="granted") throw new Error("Autorisation de notification refusée.");
      const registration=await navigator.serviceWorker.ready;
      let subscription=await registration.pushManager.getSubscription();
      if (!subscription) subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBase64ToUint8Array(state.pushConfig.public_key)});
      await api("/api/push/subscribe",{method:"POST",body:JSON.stringify({subscription:subscription.toJSON(),notify_daily:true,notify_wheel:true})});
      state.pushConfig={...state.pushConfig,subscribed:true};
      showToast("Notifications push activées.");
      render();
    } catch(error) {showToast(error.message,true);}
  }

  async function disablePushNotifications() {
    try {
      const registration=await navigator.serviceWorker.ready;
      const subscription=await registration.pushManager.getSubscription();
      const endpoint=subscription?.endpoint || "";
      if (subscription) await subscription.unsubscribe();
      await api("/api/push/unsubscribe",{method:"POST",body:JSON.stringify({endpoint})});
      state.pushConfig={...state.pushConfig,subscribed:false};
      showToast("Notifications push désactivées.");
      render();
    } catch(error) {showToast(error.message,true);}
  }

  function settingsPage() {
    const push=state.pushConfig || {};
    const compatible=("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">PARAMÈTRES</span><h2>Notifications et application</h2><p>Gère les alertes liées à ton compte.</p></div></div>
      <article class="card push-settings-card"><div class="emoji-box">🔔</div><div><h3>Notifications push</h3><p class="muted">Reçois une alerte lorsque ta récompense quotidienne ou tes tours de roue sont disponibles, même lorsque le site est fermé.</p><div class="toolbar"><span class="badge ${push.subscribed ? "badge-green" : "badge-yellow"}">${push.subscribed ? "Activées" : "Désactivées"}</span><span class="badge ${compatible && push.configured ? "badge-green" : "badge-red"}">${compatible && push.configured ? "Compatible" : "Indisponible"}</span></div></div><button class="btn ${push.subscribed ? "btn-secondary" : "btn-primary"}" data-${push.subscribed ? "disable" : "enable"}-push ${!compatible || !push.configured ? "disabled" : ""}>${push.subscribed ? "Désactiver" : "Activer les notifications"}</button></article>
      <article class="card"><h3>📱 Conseil</h3><p class="muted">Sur iPhone, installe d’abord OpiumStore sur l’écran d’accueil, puis ouvre l’application installée pour activer les notifications.</p><button class="btn btn-secondary" data-page="appinstall">Installer l’application</button></article>
    </section>`;
  }

  function appInstallPage() {
    const installed = isStandaloneApp();
    const canPrompt = !!state.installPrompt;
    const buttonText = installed ? "Application déjà installée" : canPrompt ? "Installer OpiumStore" : "Voir les instructions d’installation";
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">APPLICATION OPIUMSTORE</span><h2>Installer le Hub sur ton appareil</h2><p>Installe le site comme une application indépendante, avec son icône et sa propre fenêtre.</p></div><span class="badge ${installed ? "badge-green" : "badge-yellow"}">${installed ? "✓ Installée" : "PWA"}</span></div>
      <article class="card install-app-card">
        <img src="assets/icon-192.png" alt="Icône OpiumStore" class="install-app-icon">
        <div><h3>OpiumStore Hub</h3><p class="muted">Connexion Discord, progression, coffres, Wallet, événements et Boutique points dans une application installable depuis le Web.</p></div>
        <button id="installAppBtn" class="btn btn-primary btn-lg" ${installed ? "disabled" : ""}>${buttonText}</button>
      </article>
      <div class="grid grid-2 install-guide-grid">
        <article class="card"><h3>💻 Chrome / Edge sur Windows</h3><div class="admin-list"><div>1. Ouvre ton site OpiumStore.</div><div>2. Clique sur <b>Installer OpiumStore</b>.</div><div>3. Si le bouton n’apparaît pas, ouvre le menu ⋮ puis choisis <b>Installer cette page en tant qu’application</b>.</div><div>4. L’application sera disponible dans le menu Démarrer et sur le bureau selon ton choix.</div></div></article>
        <article class="card"><h3>📱 Android / iPhone</h3><div class="admin-list"><div><b>Android :</b> Chrome → menu ⋮ → Installer l’application.</div><div><b>iPhone :</b> Safari → bouton Partager → Sur l’écran d’accueil.</div><div>Une fois installée, ouvre-la depuis son icône comme une application normale.</div></div></article>
      </div>
    </section>`;
  }

  function dailyChallengeCard(challenge) {
    const ready=challenge.completed && !challenge.claimed;
    return `<article class="mission-card daily-challenge ${challenge.claimed ? "claimed" : ready ? "ready" : ""}">
      <div class="mission-top"><span class="mission-scope">QUOTIDIEN</span><span>${challenge.claimed ? "Récupéré" : ready ? "Terminé" : `${formatNumber(challenge.progress)} / ${formatNumber(challenge.target)}`}</span></div>
      <h3>${escapeHtml(challenge.emoji)} ${escapeHtml(challenge.title)}</h3><p>${escapeHtml(challenge.description)}</p>
      <div class="progress-track small"><span style="width:${challenge.percent}%"></span></div>
      <div class="mission-reward"><span>🎁 ${formatNumber(challenge.reward_points)} pts · ${formatNumber(challenge.reward_xp)} XP${challenge.reward_item_key ? ` · ${escapeHtml(challenge.reward_item_key)}` : ""}</span><button class="btn btn-small ${ready ? "btn-green" : "btn-secondary"}" data-claim-daily-challenge="${challenge.slot}" ${ready ? "" : "disabled"}>${challenge.claimed ? "Récupéré" : ready ? "Récupérer" : "En cours"}</button></div>
    </article>`;
  }

  function achievementCard(achievement) {
    return `<article class="achievement-card ${achievement.unlocked ? "unlocked" : "locked"}"><div class="achievement-icon">${escapeHtml(achievement.emoji)}</div><div><span class="eyebrow">${achievement.unlocked ? "SUCCÈS DÉBLOQUÉ" : "SUCCÈS SECRET"}</span><h3>${escapeHtml(achievement.title)}</h3><p class="muted">${escapeHtml(achievement.description)}</p>${achievement.unlocked ? `<small>🎁 ${formatNumber(achievement.reward_points)} pts · ${formatNumber(achievement.reward_xp)} XP${achievement.reward_item_key ? ` · ${escapeHtml(achievement.reward_item_key)}` : ""}</small>` : ""}</div></article>`;
  }

  function progressionPage() {
    const data = state.progression || {};
    const p = data.profile || {};
    const daily = data.daily || {};
    const classic = (data.missions || []).filter(m => m.scope === "classic");
    const weekly = (data.missions || []).filter(m => m.scope === "weekly");
    const dailyChallenges = data.daily_challenges || [];
    const achievements = data.secret_achievements || [];
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">NIVEAUX ET XP</span><h2>Ta progression</h2><p>Gagne de l’XP avec toutes les activités du Hub et débloque des récompenses de niveaux.</p></div><span class="badge badge-yellow">⭐ ${formatNumber(p.xp_total || 0)} XP</span></div>
      <div class="grid grid-2">${xpCard()}<article class="card streak-card"><div class="streak-flame">🔥</div><div><span class="eyebrow">SÉRIE DE CONNEXION</span><h3>${formatNumber(p.streak_current || 0)} jour(s)</h3><p>Meilleur record : <b>${formatNumber(p.streak_best || 0)} jour(s)</b></p></div><button class="btn btn-green" data-claim-daily ${daily.can_claim ? "" : "disabled"}>${daily.can_claim ? `Récupérer ${formatNumber(daily.next_points)} pts + ${formatNumber(daily.next_xp)} XP` : "Récompense déjà récupérée"}</button></article></div>
      <section class="section"><article class="card promo-card promo-card-link"><div><h3>🎟️ Tu as un code promo ?</h3><p class="muted">Ouvre la page dédiée pour récupérer tes points, ton XP ou ton coffre.</p></div><button class="btn btn-primary" data-page="promo">Utiliser un code</button></article></section>
      <section class="section"><div class="section-head"><div><h2>🎯 Défis quotidiens</h2><p>Trois objectifs personnels sont tirés automatiquement chaque jour.</p></div></div><div class="mission-grid">${dailyChallenges.map(dailyChallengeCard).join("") || '<div class="empty">Aucun défi quotidien.</div>'}</div></section>
      <section class="section"><div class="section-head"><div><h2>🕵️ Succès secrets</h2><p>Les objectifs restent cachés jusqu’à leur déblocage.</p></div></div><div class="achievement-grid">${achievements.map(achievementCard).join("") || '<div class="empty">Aucun succès secret.</div>'}</div></section>
      <section class="section"><div class="section-head"><div><h2>Missions hebdomadaires</h2><p>La progression repart chaque semaine.</p></div></div><div class="mission-grid">${weekly.map(missionCard).join("") || '<div class="empty">Aucune mission hebdomadaire.</div>'}</div></section>
      <section class="section"><div class="section-head"><div><h2>Missions classiques</h2><p>Des objectifs permanents pour avancer à ton rythme.</p></div></div><div class="mission-grid">${classic.map(missionCard).join("") || '<div class="empty">Aucune mission classique.</div>'}</div></section>
    </section>`;
  }

  function inventoryCard(item) {
    let action = "";
    if (["chest","boost"].includes(item.item_type)) action = `<button class="btn btn-small btn-primary" data-use-item="${escapeHtml(item.item_key)}">${item.item_type === "chest" ? "Ouvrir" : "Activer"}</button>`;
    else if (["title","cosmetic"].includes(item.item_type)) action = `<button class="btn btn-small ${item.equipped ? "btn-green" : "btn-secondary"}" data-equip-item="${escapeHtml(item.item_key)}" ${item.equipped ? "disabled" : ""}>${item.equipped ? "Équipé" : "Équiper"}</button>`;
    else if (item.item_type === "ticket") action = `<span class="inventory-note">Utilisé automatiquement par la roue</span>`;
    else if (item.item_type === "protector") action = `<span class="inventory-note">Protection automatique</span>`;
    const gift = item.giftable ? `<button class="btn btn-small btn-secondary" data-gift-item="${escapeHtml(item.item_key)}" data-gift-name="${escapeHtml(item.name)}">🎁 Offrir</button>` : "";
    return `<article class="inventory-card rarity-${escapeHtml(item.rarity)}"><div class="inventory-icon">${escapeHtml(item.emoji)}</div><div class="inventory-copy"><span class="rarity-chip">${rarityName(item.rarity)}</span><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description)}</p><b>Quantité : ${formatNumber(item.quantity)}</b></div><div class="inventory-actions">${action}${gift}</div></article>`;
  }

  function leaderboardScore(entry) {
    const category = state.leaderboardCategory;
    if (category === "level") return `Niveau ${formatNumber(entry.level)}`;
    if (category === "streak") return `${formatNumber(entry.streak_best)} jour(s)`;
    if (category === "missions") return `${formatNumber(entry.missions_completed)} mission(s)`;
    return `${formatNumber(entry.score)} ${category === "xp" ? "XP" : "pts"}`;
  }

  function leaderboardsPage() {
    const entries = state.leaderboards?.entries || [];
    const categories = [["xp","XP total"],["level","Niveau"],["streak","Meilleure série"],["missions","Missions"],["general","Progression générale"]];
    const periods = [["weekly","Semaine"],["monthly","Mois"],["global","Global"]];
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">CLASSEMENTS</span><h2>Compare ta progression</h2><p>Classements hebdomadaires, mensuels et globaux.</p></div></div>
      <article class="card leaderboard-filters"><div>${categories.map(([key,label])=>`<button class="filter-chip ${state.leaderboardCategory===key?"active":""}" data-leaderboard-category="${key}">${label}</button>`).join("")}</div><div>${periods.map(([key,label])=>`<button class="filter-chip ${state.leaderboardPeriod===key?"active":""}" data-leaderboard-period="${key}">${label}</button>`).join("")}</div></article>
      <article class="card leaderboard-card">${entries.length ? entries.map(entry => `<div class="leaderboard-row ${entry.is_me ? "is-me" : ""}"><div class="rank rank-${entry.rank}">${entry.rank <= 3 ? ["🥇","🥈","🥉"][entry.rank-1] : `#${entry.rank}`}</div><img src="${escapeHtml(entry.avatar_url)}" alt="" class="leader-avatar"><div class="leader-user"><b>${escapeHtml(entry.display_name)}</b><span>@${escapeHtml(entry.username)} · niv. ${formatNumber(entry.level)}</span></div><strong>${leaderboardScore(entry)}</strong></div>`).join("") : '<div class="empty">Aucune donnée pour cette période.</div>'}</article>
    </section>`;
  }

  function eventsPage() {
    const events = state.communityEvents?.events || [];
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">ÉVÉNEMENTS COMMUNAUTAIRES</span><h2>Des objectifs pour toute la communauté</h2><p>Participe aux activités communes puis récupère ta récompense lorsque l’objectif est atteint.</p></div></div>
      <div class="event-grid">${events.length ? events.map(event => `<article class="event-card"><div class="event-head"><div class="event-icon">${escapeHtml(event.emoji)}</div><div><h3>${escapeHtml(event.title)}</h3><p>${escapeHtml(event.description)}</p></div></div><div class="event-numbers"><b>${formatNumber(event.progress)} / ${formatNumber(event.target)}</b><span>Ta contribution : ${formatNumber(event.contribution)}</span></div><div class="progress-track"><span style="width:${event.percent}%"></span></div><div class="event-reward"><span>🎁 ${formatNumber(event.reward_points)} pts · ${formatNumber(event.reward_xp)} XP${event.reward_item_key ? ` · ${escapeHtml(event.reward_item_key)}` : ""}</span><button class="btn btn-small btn-green" data-claim-event="${escapeHtml(event.id)}" ${event.completed && event.contribution>0 && !event.claimed ? "" : "disabled"}>${event.claimed ? "Récupérée" : event.completed ? event.contribution>0 ? "Récupérer" : "Participation requise" : "Objectif en cours"}</button></div><small>Fin : ${formatDate(event.ends_at)}</small></article>`).join("") : '<div class="empty">Aucun événement actif.</div>'}</div>
    </section>`;
  }

  function playRewardSound(rarity = "common") {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const notes = {
        common:[392,523], rare:[440,587,740], epic:[392,523,659,784], legendary:[523,659,784,1047,1319], event:[349,523,698,1047]
      }[rarity] || [392,523];
      notes.forEach((frequency,index) => {
        const oscillator=context.createOscillator();
        const gain=context.createGain();
        oscillator.type=rarity === "legendary" ? "triangle" : "sine";
        oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(0.0001,context.currentTime+index*.09);
        gain.gain.exponentialRampToValueAtTime(.12,context.currentTime+index*.09+.02);
        gain.gain.exponentialRampToValueAtTime(0.0001,context.currentTime+index*.09+.22);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(context.currentTime+index*.09);
        oscillator.stop(context.currentTime+index*.09+.24);
      });
      setTimeout(()=>context.close().catch(()=>{}),1200);
    } catch {}
  }

  function showRewardModal(title, html, rarity = "common", icon = "🎉") {
    $("#modalContent").innerHTML = `<div class="reward-modal reward-${escapeHtml(rarity)}"><div class="reward-rays"></div><div class="reward-burst">${escapeHtml(icon)}</div><h2>${escapeHtml(title)}</h2>${html}<button class="btn btn-primary" data-close-reward>Continuer</button></div>`;
    $("#modal").classList.remove("hidden");
    $("#modal").setAttribute("aria-hidden", "false");
    playRewardSound(rarity);
  }

  function adminProgression() {
    const events = state.admin.community_events || [];
    const missions = state.admin.missions || [];
    return `<div class="admin-list">
      <div class="admin-section-title"><div><h3>🌍 Événements communautaires</h3><p class="muted">Crée et modifie les objectifs visibles par toute la communauté.</p></div><span class="badge badge-green">${formatNumber(events.length)} événement(s)</span></div>
      <article class="admin-card"><h4>Créer un événement</h4><div class="form-grid">
        <div class="field"><label>Titre</label><input id="newEventTitle" class="input" placeholder="Objectif communautaire"></div>
        <div class="field"><label>Emoji</label><input id="newEventEmoji" class="input" value="🌍"></div>
        <div class="field"><label>Activité</label><select id="newEventActivity" class="input">${activityOptions("generation", true)}</select></div>
        <div class="field"><label>Objectif</label><input id="newEventTarget" class="input" type="number" min="1" value="100"></div>
        <div class="field"><label>Durée (jours)</label><input id="newEventDays" class="input" type="number" min="1" value="7"></div>
        <div class="field"><label>Points</label><input id="newEventPoints" class="input" type="number" min="0" value="500"></div>
        <div class="field"><label>XP</label><input id="newEventXp" class="input" type="number" min="0" value="350"></div>
        <div class="field"><label>Objet offert</label><select id="newEventItem" class="input">${itemRewardOptions("")}</select></div>
      </div><div class="field" style="margin-top:12px"><label>Description</label><input id="newEventDescription" class="input" placeholder="Description de l’événement"></div><button id="createCommunityEventBtn" class="btn btn-primary" style="margin-top:13px">Créer l’événement</button></article>

      ${events.map(event => `<article class="admin-card">
        <div class="status-line"><div><h4>${escapeHtml(event.emoji)} ${escapeHtml(event.title)}</h4><code>${escapeHtml(event.id)}</code></div><span class="badge ${event.active ? "badge-green" : "badge-red"}">${event.active ? "Actif" : "Désactivé"} · ${formatNumber(event.progress)} / ${formatNumber(event.target)}</span></div>
        <div class="form-grid">
          <div class="field"><label>Titre</label><input id="event-title-${event.id}" class="input" value="${escapeHtml(event.title)}"></div>
          <div class="field"><label>Emoji</label><input id="event-emoji-${event.id}" class="input" value="${escapeHtml(event.emoji)}"></div>
          <div class="field"><label>Activité</label><select id="event-activity-${event.id}" class="input">${activityOptions(event.activity_type, true)}</select></div>
          <div class="field"><label>Objectif</label><input id="event-target-${event.id}" class="input" type="number" min="1" value="${event.target}"></div>
          <div class="field"><label>Début</label><input id="event-start-${event.id}" class="input" type="datetime-local" value="${datetimeLocalValue(event.starts_at)}"></div>
          <div class="field"><label>Fin</label><input id="event-end-${event.id}" class="input" type="datetime-local" value="${datetimeLocalValue(event.ends_at)}"></div>
          <div class="field"><label>Points</label><input id="event-points-${event.id}" class="input" type="number" min="0" value="${event.reward_points}"></div>
          <div class="field"><label>XP</label><input id="event-xp-${event.id}" class="input" type="number" min="0" value="${event.reward_xp}"></div>
          <div class="field"><label>Objet offert</label><select id="event-item-${event.id}" class="input">${itemRewardOptions(event.reward_item_key || "")}</select></div>
          <label class="check-row"><input id="event-active-${event.id}" type="checkbox" ${event.active ? "checked" : ""}> Événement actif</label>
        </div>
        <div class="field" style="margin-top:12px"><label>Description</label><textarea id="event-description-${event.id}" class="textarea" style="min-height:90px">${escapeHtml(event.description || "")}</textarea></div>
        <div class="admin-actions"><button class="btn btn-primary btn-small" data-save-community-event="${escapeHtml(event.id)}">Enregistrer</button><button class="btn btn-secondary btn-small" data-reset-community-event="${escapeHtml(event.id)}">Remettre la progression à 0</button><button class="btn btn-red btn-small" data-delete-community-event="${escapeHtml(event.id)}">Supprimer</button></div>
      </article>`).join("") || '<div class="empty">Aucun événement enregistré.</div>'}

      <div class="admin-section-title"><div><h3>🏆 Quêtes et missions</h3><p class="muted">Modifie les objectifs classiques et hebdomadaires ainsi que leurs récompenses.</p></div><span class="badge badge-yellow">${formatNumber(missions.length)} quête(s)</span></div>
      <article class="admin-card"><h4>Créer une quête</h4><div class="form-grid">
        <div class="field"><label>Titre</label><input id="newMissionTitle" class="input" placeholder="Nouvelle quête"></div>
        <div class="field"><label>Type</label><select id="newMissionScope" class="input"><option value="classic">Classique</option><option value="weekly">Hebdomadaire</option></select></div>
        <div class="field"><label>Activité</label><select id="newMissionActivity" class="input">${activityOptions("generation", true)}</select></div>
        <div class="field"><label>Objectif</label><input id="newMissionTarget" class="input" type="number" min="1" value="5"></div>
        <div class="field"><label>Points</label><input id="newMissionPoints" class="input" type="number" min="0" value="150"></div>
        <div class="field"><label>XP</label><input id="newMissionXp" class="input" type="number" min="0" value="100"></div>
        <div class="field"><label>Objet offert</label><select id="newMissionItem" class="input">${itemRewardOptions("")}</select></div>
        <div class="field"><label>Ordre</label><input id="newMissionOrder" class="input" type="number" value="100"></div><div class="field"><label>Rang requis</label><select id="newMissionRank" class="input">${accessRankOptions("free")}</select></div>
      </div><div class="field" style="margin-top:12px"><label>Description</label><input id="newMissionDescription" class="input" placeholder="Description de la quête"></div><button id="createMissionBtn" class="btn btn-primary" style="margin-top:13px">Créer la quête</button></article>

      ${missions.map(mission => `<article class="admin-card">
        <div class="status-line"><div><h4>${mission.scope === "weekly" ? "📅" : "🎯"} ${escapeHtml(mission.title)}</h4><code>${escapeHtml(mission.id)}</code></div><span class="badge ${mission.active ? "badge-green" : "badge-red"}">${mission.active ? "Active" : "Désactivée"} · ${mission.scope === "weekly" ? "Hebdomadaire" : "Classique"}</span></div>
        <div class="form-grid">
          <div class="field"><label>Titre</label><input id="mission-title-${mission.id}" class="input" value="${escapeHtml(mission.title)}"></div>
          <div class="field"><label>Type</label><select id="mission-scope-${mission.id}" class="input"><option value="classic" ${mission.scope === "classic" ? "selected" : ""}>Classique</option><option value="weekly" ${mission.scope === "weekly" ? "selected" : ""}>Hebdomadaire</option></select></div>
          <div class="field"><label>Activité</label><select id="mission-activity-${mission.id}" class="input">${activityOptions(mission.activity_type, true)}</select></div>
          <div class="field"><label>Objectif</label><input id="mission-target-${mission.id}" class="input" type="number" min="1" value="${mission.target}"></div>
          <div class="field"><label>Points</label><input id="mission-points-${mission.id}" class="input" type="number" min="0" value="${mission.reward_points}"></div>
          <div class="field"><label>XP</label><input id="mission-xp-${mission.id}" class="input" type="number" min="0" value="${mission.reward_xp}"></div>
          <div class="field"><label>Objet offert</label><select id="mission-item-${mission.id}" class="input">${itemRewardOptions(mission.reward_item_key || "")}</select></div>
          <div class="field"><label>Ordre</label><input id="mission-order-${mission.id}" class="input" type="number" value="${mission.sort_order}"></div><div class="field"><label>Rang requis</label><select id="mission-rank-${mission.id}" class="input">${accessRankOptions(mission.required_rank || "free")}</select></div>
          <label class="check-row"><input id="mission-active-${mission.id}" type="checkbox" ${mission.active ? "checked" : ""}> Quête active</label>
        </div>
        <div class="field" style="margin-top:12px"><label>Description</label><textarea id="mission-description-${mission.id}" class="textarea" style="min-height:90px">${escapeHtml(mission.description || "")}</textarea></div>
        <div class="admin-actions"><button class="btn btn-primary btn-small" data-save-mission="${escapeHtml(mission.id)}">Enregistrer</button><button class="btn btn-secondary btn-small" data-reset-mission="${escapeHtml(mission.id)}">Réinitialiser les progressions</button><button class="btn btn-red btn-small" data-delete-mission="${escapeHtml(mission.id)}">Supprimer</button></div>
      </article>`).join("") || '<div class="empty">Aucune quête enregistrée.</div>'}

      <div class="admin-section-title"><div><h3>🎟️ Codes promos</h3><p class="muted">Crée un code utilisable une fois par membre.</p></div></div>
      <article class="admin-card"><div class="form-grid"><div class="field"><label>Code</label><input id="newPromoCode" class="input" placeholder="OPIUM2026"></div><div class="field"><label>Utilisations max (0 = illimité)</label><input id="newPromoUses" class="input" type="number" min="0" value="100"></div><div class="field"><label>Points</label><input id="newPromoPoints" class="input" type="number" min="0" value="250"></div><div class="field"><label>XP</label><input id="newPromoXp" class="input" type="number" min="0" value="150"></div><div class="field"><label>Objet facultatif</label><select id="newPromoItem" class="input">${itemRewardOptions("")}</select></div><div class="field"><label>Description</label><input id="newPromoDescription" class="input" placeholder="Code communautaire"></div></div><button id="createPromoCodeBtn" class="btn btn-primary" style="margin-top:13px">Créer le code</button></article>
    </div>`;
  }

  function adminPage() {
    if (!state.me?.is_admin) return `<div class="empty">Accès refusé.</div>`;
    if (!state.admin) return `<div class="empty">Chargement du panel admin…</div>`;
    const tabs = [["services","Services"],["products","Boutique"],["wheel","Roue"],["progression","Progression"],["users","Utilisateurs"],["timers","Timers utilisateurs"],["history","Historique"],["settings","Réglages"]];
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">ADMINISTRATION</span><h2>Panel serveur</h2><p>Toutes les modifications s’appliquent immédiatement à tous les utilisateurs.</p></div></div><div class="admin-tabs">${tabs.map(([id,label]) => `<button class="admin-tab ${state.adminTab===id?"active":""}" data-admin-tab="${id}">${label}</button>`).join("")}</div>${adminTabContent()}</section>`;
  }

  function adminTabContent() {
    if (state.adminTab === "services") return adminServices();
    if (state.adminTab === "products") return adminProducts();
    if (state.adminTab === "wheel") return adminWheel();
    if (state.adminTab === "progression") return adminProgression();
    if (state.adminTab === "users") return adminUsers();
    if (state.adminTab === "timers") return adminTimers();
    if (state.adminTab === "history") return adminHistory();
    return adminSettings();
  }
  function adminServices() {
    const items = state.admin.services || [];
    return `<div class="admin-list">${items.map(s => `<article class="admin-card"><div class="form-grid"><div class="field"><label>Nom</label><input class="input" id="svc-name-${s.id}" value="${escapeHtml(s.name)}"></div><div class="field"><label>Emoji</label><input class="input" id="svc-emoji-${s.id}" value="${escapeHtml(s.emoji)}"></div><div class="field"><label>Rang minimum</label><select class="input" id="svc-rank-${s.id}">${accessRankOptions(s.required_rank || "free")}</select></div><div class="field"><label>Stock actuel</label><input class="input" value="${s.stock}" disabled></div></div><div class="field" style="margin-top:12px"><label>Description</label><input class="input" id="svc-desc-${s.id}" value="${escapeHtml(s.description || "")}"></div><div class="field" style="margin-top:12px"><label>Réalimenter — une ligne par ligne</label><textarea class="textarea" id="svc-lines-${s.id}" placeholder="ligne 1
  ligne 2
  ligne 3"></textarea></div><div class="admin-actions"><button class="btn btn-primary btn-small" data-save-service="${s.id}">Enregistrer</button><button class="btn btn-green btn-small" data-restock-service="${s.id}">Ajouter les lignes</button><button class="btn btn-secondary btn-small" data-toggle-service="${s.id}" data-enabled="${s.enabled ? 1 : 0}">${s.enabled ? "Désactiver" : "Activer"}</button><button class="btn btn-red btn-small" data-clear-service="${s.id}">Vider le stock</button><button class="btn btn-red btn-small" data-delete-service="${s.id}">Supprimer</button></div></article>`).join("")}
      <article class="admin-card"><h3>Ajouter un service</h3><div class="form-grid"><div class="field"><label>Nom</label><input id="newSvcName" class="input" placeholder="Nom du service"></div><div class="field"><label>Emoji</label><input id="newSvcEmoji" class="input" value="⚡"></div><div class="field"><label>Rang minimum</label><select id="newSvcRank" class="input">${accessRankOptions("free")}</select></div><div class="field"><label>Description</label><input id="newSvcDesc" class="input" placeholder="Description"></div></div><button id="addServiceBtn" class="btn btn-primary" style="margin-top:13px">Ajouter le service</button></article></div>`;
  }


  function adminProducts() {
    const items = state.admin.products || [];
    return `<div class="admin-list">${items.map(p => `<article class="admin-card"><div class="form-grid"><div class="field"><label>Nom</label><input class="input" id="prod-name-${p.id}" value="${escapeHtml(p.name)}"></div><div class="field"><label>Emoji</label><input class="input" id="prod-emoji-${p.id}" value="${escapeHtml(p.emoji)}"></div><div class="field"><label>Prix en points</label><input class="input" type="number" min="0" id="prod-price-${p.id}" value="${p.price}"></div><div class="field"><label>Stock actuel</label><input class="input" value="${p.stock}" disabled></div></div><div class="field" style="margin-top:12px"><label>Description</label><input class="input" id="prod-desc-${p.id}" value="${escapeHtml(p.description || "")}"></div><div class="field" style="margin-top:12px"><label>Réalimenter les récompenses — une phrase ou ligne par ligne</label><textarea class="textarea" id="prod-lines-${p.id}" placeholder="phrase 1\nphrase 2\nphrase 3"></textarea></div><div class="admin-actions"><button class="btn btn-primary btn-small" data-save-product="${p.id}">Enregistrer</button><button class="btn btn-green btn-small" data-restock-product="${p.id}">Ajouter les lignes</button><button class="btn btn-secondary btn-small" data-toggle-product="${p.id}" data-enabled="${p.enabled ? 1 : 0}">${p.enabled ? "Désactiver" : "Activer"}</button><button class="btn btn-red btn-small" data-clear-product="${p.id}">Vider le stock</button><button class="btn btn-red btn-small" data-delete-product="${p.id}">Supprimer</button></div></article>`).join("")}
      <article class="admin-card"><h3>Ajouter une récompense</h3><div class="form-grid"><div class="field"><label>Nom</label><input id="newProdName" class="input" placeholder="Nom"></div><div class="field"><label>Emoji</label><input id="newProdEmoji" class="input" value="🎁"></div><div class="field"><label>Prix</label><input id="newProdPrice" class="input" type="number" value="100"></div><div class="field"><label>Description</label><input id="newProdDesc" class="input" placeholder="Description"></div></div><button id="addProductBtn" class="btn btn-primary" style="margin-top:13px">Ajouter la récompense</button></article></div>`;
  }

  function adminWheel() {
    const items = state.admin.wheel_rewards || [];
    return `<div class="admin-list">${items.map(r => `<article class="admin-card"><div class="form-grid"><div class="field"><label>Emoji</label><input class="input" id="wheel-emoji-${r.id}" value="${escapeHtml(r.emoji)}"></div><div class="field"><label>Nom du gain</label><input class="input" id="wheel-label-${r.id}" value="${escapeHtml(r.label)}"></div><div class="field"><label>Points</label><input class="input" type="number" min="0" id="wheel-points-${r.id}" value="${r.points}"></div><div class="field"><label>Poids / chance</label><input class="input" type="number" min="1" id="wheel-weight-${r.id}" value="${r.weight}"></div></div><div class="admin-actions"><button class="btn btn-primary btn-small" data-save-wheel="${r.id}">Enregistrer</button><button class="btn btn-red btn-small" data-delete-wheel="${r.id}">Supprimer</button></div></article>`).join("")}
      <article class="admin-card"><h3>Ajouter un gain</h3><div class="form-grid"><div class="field"><label>Emoji</label><input id="newWheelEmoji" class="input" value="🎁"></div><div class="field"><label>Nom</label><input id="newWheelLabel" class="input" value="Nouveau gain"></div><div class="field"><label>Points</label><input id="newWheelPoints" class="input" type="number" value="100"></div><div class="field"><label>Poids</label><input id="newWheelWeight" class="input" type="number" value="1"></div></div><button id="addWheelBtn" class="btn btn-primary" style="margin-top:13px">Ajouter à la roue</button></article></div>`;
  }
  function adminUsers() {
    const users = state.admin.users || [];
    const apiVersion = escapeHtml(state.admin.api_version || "version inconnue");
    return `<div class="admin-list">
      <article class="admin-card"><h3>👥 Rangs automatiques</h3><p class="muted">Free : 6 générations/jour, 15 min, 1 roue. Boost : 15/jour, 2 min, 2 roues, quotidien +20 %. VIP : illimité, 1 min, 3 roues, quotidien +50 %. Admin possède les accès VIP et le panel.</p><span class="muted">API : ${apiVersion}</span></article>
      ${users.length ? users.map(u => {
        const rank=rankInfo(u.account_rank);
        const dailyLimit=Number(u.daily_generation_limit);
        const today=Math.max(0,Number(u.generations_today || 0));
        const quotaLabel=dailyLimit===0?`${formatNumber(today)} aujourd’hui · illimité`:`${formatNumber(today)} / ${formatNumber(dailyLimit)} aujourd’hui`;
        return `<article class="admin-card"><div class="section-head" style="margin-bottom:12px"><div><h3>${escapeHtml(u.display_name || u.username)}</h3><p class="muted">@${escapeHtml(u.username || "inconnu")} · ID ${escapeHtml(u.discord_id)}</p></div><span class="rank-badge ${rank.className}">${rank.emoji} ${rank.label}</span></div>
          <div class="form-grid">
            <div class="field"><label>Rang du membre</label><div class="toolbar"><select class="input" id="user-rank-${u.discord_id}">${rankOptions(u.account_rank)}</select><button class="btn btn-primary btn-small" data-user-rank="${u.discord_id}">Appliquer</button></div></div>
            <div class="field"><label>Points</label><div class="toolbar"><input class="input" type="number" id="user-points-${u.discord_id}" value="100"><button class="btn btn-green btn-small" data-user-points="${u.discord_id}">Ajuster</button></div></div>
            <div class="field"><label>Limites automatiques</label><input class="input" value="${quotaLabel} · cooldown ${remaining(u.generation_cooldown_seconds)}" disabled></div>
            <div class="field"><label>Tours gratuits / 12 h</label><input class="input" value="${formatNumber(u.rank?.wheel_free_spins || 1)}" disabled></div>
            <div class="field"><label>Bonus quotidien</label><input class="input" value="+${Math.round(((u.rank?.daily_reward_multiplier || 1)-1)*100)} %" disabled></div>
            <div class="field"><label>Timer actif</label><button class="btn btn-secondary" data-open-user-timer="${u.discord_id}">Voir / réinitialiser</button></div>
          </div></article>`;
      }).join("") : `<article class="admin-card"><div class="empty">Aucun utilisateur enregistré.</div></article>`}
    </div>`;
  }


  function timerRemainingAt(timestamp) {
    return remaining(Math.max(0, Math.ceil((Number(timestamp || 0) - Date.now()) / 1000)));
  }

  function adminTimers() {
    const services = state.admin.services || [];
    const timers = state.admin.timers || {generator:[],wheel:[]};
    const generatorTimers = timers.generator || [];
    const wheelTimers = timers.wheel || [];
    const serviceOptions = services.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.emoji)} ${escapeHtml(s.name)}</option>`).join("");
    return `<div class="admin-list">
      <article class="admin-card"><h3>⏱ Modifier le timer d’un utilisateur</h3><p class="muted">Entre directement son ID Discord. Mets <b>0 seconde</b> pour supprimer le cooldown immédiatement.</p><div class="form-grid"><div class="field"><label>ID Discord</label><input id="timerDiscordId" class="input" inputmode="numeric" placeholder="123456789012345678"></div><div class="field"><label>Type</label><select id="timerType" class="input"><option value="generator">Générateur</option><option value="wheel">Roue</option></select></div><div class="field"><label>Service du générateur</label><select id="timerService" class="input">${serviceOptions}</select></div><div class="field"><label>Temps restant (secondes)</label><input id="timerSeconds" class="input" type="number" min="0" max="31536000" value="0"></div></div><button id="applyUserTimerBtn" class="btn btn-primary" style="margin-top:13px">Appliquer le timer</button></article>
      <article class="admin-card"><h3>⚡ Timers générateur actifs</h3><div style="overflow:auto"><table class="user-table"><thead><tr><th>Utilisateur</th><th>Service</th><th>Temps restant</th><th>Fin</th><th></th></tr></thead><tbody>${generatorTimers.length ? generatorTimers.map(x => `<tr><td><b>${escapeHtml(x.display_name || x.username)}</b><br><small class="muted">${escapeHtml(x.discord_id)}</small></td><td>${escapeHtml(x.service_name)}</td><td>${timerRemainingAt(x.next_allowed_at)}</td><td>${formatDate(x.next_allowed_at)}</td><td><button class="btn btn-red btn-small" data-reset-user-timer="1" data-timer-user="${escapeHtml(x.discord_id)}" data-timer-type="generator" data-timer-service="${escapeHtml(x.service_id)}">Réinitialiser</button></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">Aucun timer générateur actif.</div></td></tr>`}</tbody></table></div></article>
      <article class="admin-card"><h3>🎲 Timers roue actifs</h3><div style="overflow:auto"><table class="user-table"><thead><tr><th>Utilisateur</th><th>Temps restant</th><th>Fin</th><th></th></tr></thead><tbody>${wheelTimers.length ? wheelTimers.map(x => `<tr><td><b>${escapeHtml(x.display_name || x.username)}</b><br><small class="muted">${escapeHtml(x.discord_id)}</small></td><td>${timerRemainingAt(x.next_allowed_at)}</td><td>${formatDate(x.next_allowed_at)}</td><td><button class="btn btn-red btn-small" data-reset-user-timer="1" data-timer-user="${escapeHtml(x.discord_id)}" data-timer-type="wheel">Réinitialiser</button></td></tr>`).join("") : `<tr><td colspan="4"><div class="empty">Aucun timer roue actif.</div></td></tr>`}</tbody></table></div></article>
    </div>`;
  }

  function shortId(value) {
    const text = String(value || "");
    return text.length > 16 ? `${text.slice(0, 8)}…${text.slice(-6)}` : text;
  }

  function adminHistory() {
    if (state.adminHistoryLoading) return `<article class="admin-card"><div class="empty">Chargement de l’historique…</div></article>`;
    const history = state.adminHistory;
    if (!history) return `<article class="admin-card"><div class="empty"><b>Historique non chargé.</b><br><br><button class="btn btn-primary" id="refreshHistoryBtn">Charger l’historique</button></div></article>`;
    const generations = history.generations || [];
    const purchases = history.purchases || [];
    const totals = history.totals || {};
    const userCell = (item) => `<b>${escapeHtml(item.display_name || item.username || "Utilisateur")}</b><br><small class="muted">@${escapeHtml(item.username || "inconnu")} · ${escapeHtml(item.discord_id || "")}</small>`;
    return `<div class="admin-list">
      <div class="grid grid-3">
        ${statCard("Générations totales", formatNumber(totals.generations || 0), `${formatNumber(generations.length)} dernières affichées`, "⚡")}
        ${statCard("Achats totaux", formatNumber(totals.purchases || 0), `${formatNumber(purchases.length)} derniers affichés`, "🎁")}
        ${statCard("Points dépensés", `${formatNumber(totals.points_spent || 0)} pts`, "Dans la boutique points", "◈")}
      </div>
      <div class="toolbar" style="justify-content:flex-end"><button class="btn btn-secondary btn-small" id="refreshHistoryBtn">↻ Actualiser</button></div>
      <article class="admin-card"><h3>⚡ Historique des générations</h3><p class="muted">Les 250 générations les plus récentes. Le contenu livré reste masqué.</p><div style="overflow:auto"><table class="user-table"><thead><tr><th>Date</th><th>Utilisateur Discord</th><th>Service</th><th>Référence</th></tr></thead><tbody>${generations.length ? generations.map(item => `<tr><td>${formatDate(item.created_at)}</td><td>${userCell(item)}</td><td><b>${escapeHtml(item.service_name)}</b><br><small class="muted">${escapeHtml(item.service_id)}</small></td><td><code>${escapeHtml(shortId(item.id))}</code></td></tr>`).join("") : `<tr><td colspan="4"><div class="empty">Aucune génération enregistrée.</div></td></tr>`}</tbody></table></div></article>
      <article class="admin-card"><h3>🎁 Historique des achats boutique points</h3><p class="muted">Les 250 achats les plus récents. Les phrases ou lignes livrées ne sont pas affichées.</p><div style="overflow:auto"><table class="user-table"><thead><tr><th>Date</th><th>Utilisateur Discord</th><th>Récompense</th><th>Prix</th><th>Référence</th></tr></thead><tbody>${purchases.length ? purchases.map(item => `<tr><td>${formatDate(item.created_at)}</td><td>${userCell(item)}</td><td><b>${escapeHtml(item.product_name)}</b><br><small class="muted">${escapeHtml(item.product_id)}</small></td><td><b>${formatNumber(item.price)} pts</b></td><td><code>${escapeHtml(shortId(item.id))}</code></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">Aucun achat enregistré.</div></td></tr>`}</tbody></table></div></article>
    </div>`;
  }

  async function loadAdminHistory(force = false) {
    if (state.adminHistoryLoading || (state.adminHistory && !force)) return;
    state.adminHistoryLoading = true;
    render();
    try {
      // L’overview contient déjà l’historique sur la version V3.
      const overview = await api(`/api/admin/overview?ts=${Date.now()}`);
      state.admin = overview;
      state.adminHistory = overview.history || await api(`/api/admin/history?ts=${Date.now()}`);
    } catch (error) {
      console.error("Historique admin:", error);
      showToast(`Historique indisponible : ${error.message}`, true);
      state.adminHistory = null;
    } finally {
      state.adminHistoryLoading = false;
      render();
    }
  }

  function adminSettings() {
    const settings = state.admin.settings || {};
    const discord = state.admin.discord_integration || {};
    return `<div class="admin-list">
      <article class="admin-card"><h3>🤖 Intégration Discord</h3><p class="muted">Les rangs sont synchronisés lors de chaque connexion Discord. Le salon de réassort correspond au salon dans lequel le webhook Discord a été créé.</p><div class="form-grid"><div class="field"><label>Serveur Discord</label><input class="input" value="${discord.guild_configured ? "Configuré" : "DISCORD_GUILD_ID manquant"}" disabled></div><div class="field"><label>Rôle Boost</label><input class="input" value="${discord.boost_role_configured ? "Configuré" : "DISCORD_BOOST_ROLE_ID manquant"}" disabled></div><div class="field"><label>Rôle VIP</label><input class="input" value="${discord.vip_role_configured ? "Configuré" : "DISCORD_VIP_ROLE_ID manquant"}" disabled></div><div class="field"><label>Annonce de réassort</label><input class="input" value="${discord.restock_webhook_configured && discord.client_role_configured ? "Webhook + rôle client configurés" : "Webhook ou rôle client manquant"}" disabled></div></div></article>
      <article class="admin-card"><h3>🛡️ Limites automatiques par rang</h3><p class="muted">Les quotas et cooldowns ne sont plus modifiables manuellement : Free = 6/jour et 15 min · Boost = 15/jour et 2 min · VIP/Admin = illimité et 1 min. La roue se recharge toutes les 12 heures avec 1, 2 ou 3 tours gratuits selon le rang.</p><div class="form-grid"><div class="field"><label>Cycle de la roue</label><input class="input" value="12 heures (fixe)" disabled></div><div class="field"><label>Points de départ</label><input id="settingStartPoints" class="input" type="number" min="0" value="${escapeHtml(settings.starting_points || 500)}"></div></div></article>
      <article class="admin-card"><h3>⭐ Récompenses XP</h3><div class="form-grid"><div class="field"><label>XP par génération</label><input id="settingXpGeneration" class="input" type="number" min="0" value="${escapeHtml(settings.xp_generation ?? 20)}"></div><div class="field"><label>XP par achat</label><input id="settingXpPurchase" class="input" type="number" min="0" value="${escapeHtml(settings.xp_purchase ?? 35)}"></div><div class="field"><label>XP par roue</label><input id="settingXpWheel" class="input" type="number" min="0" value="${escapeHtml(settings.xp_wheel ?? 15)}"></div><div class="field"><label>XP ouverture coffre</label><input id="settingXpChest" class="input" type="number" min="0" value="${escapeHtml(settings.xp_chest ?? 25)}"></div><div class="field"><label>Points quotidiens de base</label><input id="settingDailyPoints" class="input" type="number" min="0" value="${escapeHtml(settings.daily_base_points ?? 50)}"></div><div class="field"><label>XP quotidienne de base</label><input id="settingDailyXp" class="input" type="number" min="0" value="${escapeHtml(settings.daily_base_xp ?? 30)}"></div></div></article>
      <button id="saveSettingsBtn" class="btn btn-primary">Enregistrer les récompenses</button><p class="muted">Les bonus Boost (+20 %) et VIP/Admin (+50 %) sont appliqués automatiquement côté serveur.</p></div>`;
  }

  function render() {
    if (!state.me || !state.catalog || !state.progression) return;
    setUserChrome();
    $$('[data-page]').forEach(el => el.classList.toggle("active", el.dataset.page === state.page));
    const titles = {home:"Accueil",generator:"Générateur",vip:"VIP & offres",shop:"Boutique points",promo:"Code promo",wheel:"Roue",progression:"Progression",leaderboards:"Classements",events:"Événements",wallet:"Wallet & inventaire",settings:"Paramètres",appinstall:"Installer l’application",admin:"Administration"};
    $("#pageTitle").textContent = titles[state.page] || "OpiumStore Hub";
    if (state.page === "generator") main.innerHTML = generatorPage();
    else if (state.page === "vip") main.innerHTML = vipPage();
    else if (state.page === "shop") main.innerHTML = shopPage();
    else if (state.page === "promo") main.innerHTML = promoPage();
    else if (state.page === "appinstall") main.innerHTML = appInstallPage();
    else if (state.page === "wheel") main.innerHTML = wheelPage();
    else if (state.page === "progression") main.innerHTML = progressionPage();
    else if (state.page === "leaderboards") main.innerHTML = leaderboardsPage();
    else if (state.page === "events") main.innerHTML = eventsPage();
    else if (state.page === "wallet") main.innerHTML = walletPage();
    else if (state.page === "settings") main.innerHTML = settingsPage();
    else if (state.page === "admin") main.innerHTML = adminPage();
    else main.innerHTML = homePage();
  }

  async function go(page) {
    if (page === "admin" && !state.me?.is_admin) return;
    state.page = page;
    state.generatorResult = null;
    state.purchaseResult = null;
    closeMobileMenu();

    if (page === "admin") {
      state.admin = null;
      state.adminHistory = null;
      state.adminHistoryLoading = false;
      render();
      window.scrollTo({top:0, behavior:"smooth"});
      try {
        state.admin = await api("/api/admin/overview");
        state.adminHistory = state.admin.history || null;
        render();
      } catch (error) {
        main.innerHTML = `<section class="page"><div class="empty"><b>Impossible de charger le panel admin.</b><br><span class="muted">${escapeHtml(error.message)}</span><br><br><button class="btn btn-primary" id="retryAdminBtn">Réessayer</button></div></section>`;
        showToast(error.message, true);
      }
      return;
    }

    try {
      if (page === "leaderboards") state.leaderboards = await api(`/api/leaderboards?category=${encodeURIComponent(state.leaderboardCategory)}&period=${encodeURIComponent(state.leaderboardPeriod)}`);
      if (page === "events") state.communityEvents = await api("/api/community-events");
    } catch (error) {
      showToast(error.message, true);
    }
    render();
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function openMobileMenu() {
    $("#sidebar").classList.add("open");
    $("#mobileOverlay").classList.add("show");
  }
  function closeMobileMenu() {
    $("#sidebar").classList.remove("open");
    $("#mobileOverlay").classList.remove("show");
  }

  async function handleGenerate(serviceId) {
    try {
      const button = document.querySelector(`[data-generate="${CSS.escape(serviceId)}"]`);
      if (button) { button.disabled = true; button.textContent = "Distribution…"; }
      const result = await api("/api/generate", {method:"POST", body:JSON.stringify({service_id:serviceId})});
      state.generatorResult = result.delivery;
      showToast("Ligne distribuée et enregistrée dans le Wallet.");
      await refreshAll(false);
      state.page = "generator";
      render();
    } catch (error) {
      showToast(error.message, true);
      await refreshAll();
    }
  }

  async function handlePurchase(productId) {
    try {
      const result = await api("/api/shop/purchase", {method:"POST", body:JSON.stringify({product_id:productId})});
      state.purchaseResult = result.purchase;
      showToast(result.purchase?.kind === "inventory" ? "Coffre acheté : il a été ajouté à ton inventaire." : "Achat réussi. La prochaine ligne du stock t’a été livrée.");
      await refreshAll(false);
      state.page = "shop";
      render();
    } catch (error) {
      showToast(error.message, true);
      await refreshAll();
    }
  }

  async function handleSpin() {
    if (state.wheelBusy) return;
    state.wheelBusy = true;
    render();
    try {
      const result = await api("/api/wheel/spin", {method:"POST"});
      const rewards = state.catalog.wheel_rewards || [];
      const index = Math.max(0, rewards.findIndex(r => r.id === result.reward.id));
      const slice = 360 / Math.max(1, rewards.length);
      const target = 360 - (index * slice + slice / 2);
      state.wheelRotation += 5 * 360 + target;
      const disk = $("#wheelDisk");
      if (disk) disk.style.transform = `rotate(${state.wheelRotation}deg)`;
      setTimeout(async () => {
        state.wheelBusy = false;
        showToast(`${result.reward.emoji} ${result.reward.label} : +${formatNumber(result.reward.points)} points${result.ticket_used ? " · ticket utilisé" : ""}`);
        await refreshAll();
      }, 4300);
    } catch (error) {
      state.wheelBusy = false;
      showToast(error.message, true);
      await refreshAll();
    }
  }

  function rewardSummary(reward) {
    const parts = [];
    if (reward?.points) parts.push(`+${formatNumber(reward.points)} points`);
    if (reward?.xp) parts.push(`+${formatNumber(reward.xp)} XP`);
    if (reward?.item) parts.push(`${reward.item.emoji || "🎁"} ${reward.item.name || reward.item.item_key}`);
    return parts.join(" · ") || "Récompense récupérée";
  }

  async function progressionAction(path, body, successTitle) {
    try {
      const result = await api(path, {method:"POST", body:body === undefined ? undefined : JSON.stringify(body)});
      await refreshAll(false);
      if (state.page === "events") state.communityEvents = await api("/api/community-events");
      if (state.page === "leaderboards") state.leaderboards = await api(`/api/leaderboards?category=${encodeURIComponent(state.leaderboardCategory)}&period=${encodeURIComponent(state.leaderboardPeriod)}`);
      render();
      const details = result.rewards
        ? result.rewards.map(r => `<div class="reward-line">${r.type === "points" ? "◈" : r.type === "xp" ? "⭐" : "🎁"} ${escapeHtml(r.label || r.item?.name || r.value || "Récompense")}</div>`).join("")
        : result.message
        ? `<p>${escapeHtml(result.message)}</p>`
        : result.item
        ? `<p>${escapeHtml(result.item.emoji || "🎁")} ${escapeHtml(result.item.name || "Objet équipé")}</p>`
        : `<p>${escapeHtml(rewardSummary(result.reward))}</p>`;
      const rarity = result.chest?.rarity || result.reward?.item?.rarity || "common";
      const title = result.chest ? `${result.chest.name} ouvert` : successTitle;
      const icon = result.chest?.emoji || (result.reward?.item?.emoji) || "🎉";
      showRewardModal(title, details, rarity, icon);
      return result;
    } catch (error) {
      showToast(error.message, true);
      return null;
    }
  }

  async function reloadLeaderboard() {
    try {
      state.leaderboards = await api(`/api/leaderboards?category=${encodeURIComponent(state.leaderboardCategory)}&period=${encodeURIComponent(state.leaderboardPeriod)}`);
      render();
    } catch (error) { showToast(error.message, true); }
  }

  function linesFromTextarea(id) {
    return ($(id)?.value || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }

  async function adminRequest(path, method, body, success) {
    try {
      const result = await api(path, {method, body: body === undefined ? undefined : JSON.stringify(body)});
      let message = success;
      if (result?.discord_announcement) {
        if (result.discord_announcement.sent) message += " Annonce Discord envoyée dans le salon de réassort.";
        else if (result.discord_announcement.reason === "webhook_missing") message += " Annonce Discord non envoyée : webhook non configuré.";
        else message += " Le stock est ajouté, mais l’annonce Discord a échoué.";
      }
      showToast(message, !!(result?.discord_announcement && !result.discord_announcement.sent));
      state.admin = await api("/api/admin/overview");
      state.adminHistory = state.admin.history || state.adminHistory;
      await refreshAll(false);
      render();
    } catch (error) { showToast(error.message, true); }
  }

  async function handleAdminAction(target) {
    const id = target.dataset.saveService || target.dataset.restockService || target.dataset.clearService || target.dataset.deleteService || target.dataset.toggleService;
    if (target.dataset.saveService) return adminRequest(`/api/admin/services/${id}`, "PUT", {name:$(`#svc-name-${id}`).value,emoji:$(`#svc-emoji-${id}`).value,description:$(`#svc-desc-${id}`).value,required_rank:$(`#svc-rank-${id}`).value,enabled:true}, "Service enregistré.");
    if (target.dataset.restockService) return adminRequest(`/api/admin/services/${id}/restock`, "POST", {lines:linesFromTextarea(`#svc-lines-${id}`)}, "Stock du générateur réalimenté.");
    if (target.dataset.clearService) return confirm("Vider tout le stock de ce service ?") && adminRequest(`/api/admin/services/${id}/stock`, "DELETE", undefined, "Stock vidé.");
    if (target.dataset.deleteService) return confirm("Supprimer ce service et son stock ?") && adminRequest(`/api/admin/services/${id}`, "DELETE", undefined, "Service supprimé.");
    if (target.dataset.toggleService) return adminRequest(`/api/admin/services/${id}`, "PUT", {enabled:target.dataset.enabled !== "1"}, "Statut modifié.");

    const pid = target.dataset.saveProduct || target.dataset.restockProduct || target.dataset.clearProduct || target.dataset.deleteProduct || target.dataset.toggleProduct;
    if (target.dataset.saveProduct) return adminRequest(`/api/admin/products/${pid}`, "PUT", {name:$(`#prod-name-${pid}`).value,emoji:$(`#prod-emoji-${pid}`).value,description:$(`#prod-desc-${pid}`).value,price:Number($(`#prod-price-${pid}`).value),enabled:true}, "Récompense enregistrée.");
    if (target.dataset.restockProduct) return adminRequest(`/api/admin/products/${pid}/restock`, "POST", {lines:linesFromTextarea(`#prod-lines-${pid}`)}, "Phrases ajoutées dans l’ordre.");
    if (target.dataset.clearProduct) return confirm("Vider toutes les phrases de cette récompense ?") && adminRequest(`/api/admin/products/${pid}/stock`, "DELETE", undefined, "Stock vidé.");
    if (target.dataset.deleteProduct) return confirm("Supprimer cette récompense ?") && adminRequest(`/api/admin/products/${pid}`, "DELETE", undefined, "Récompense supprimée.");
    if (target.dataset.toggleProduct) return adminRequest(`/api/admin/products/${pid}`, "PUT", {enabled:target.dataset.enabled !== "1"}, "Statut modifié.");

    if (target.dataset.saveWheel) {
      const wid = target.dataset.saveWheel;
      return adminRequest(`/api/admin/wheel/${wid}`, "PUT", {emoji:$(`#wheel-emoji-${wid}`).value,label:$(`#wheel-label-${wid}`).value,points:Number($(`#wheel-points-${wid}`).value),weight:Number($(`#wheel-weight-${wid}`).value)}, "Gain enregistré.");
    }
    if (target.dataset.deleteWheel) return confirm("Supprimer ce gain ?") && adminRequest(`/api/admin/wheel/${target.dataset.deleteWheel}`, "DELETE", undefined, "Gain supprimé.");

    if (target.dataset.saveCommunityEvent) {
      const eid = target.dataset.saveCommunityEvent;
      return adminRequest(`/api/admin/community-events/${encodeURIComponent(eid)}`, "PUT", {
        title:document.getElementById(`event-title-${eid}`).value,
        emoji:document.getElementById(`event-emoji-${eid}`).value,
        description:document.getElementById(`event-description-${eid}`).value,
        activity_type:document.getElementById(`event-activity-${eid}`).value,
        target:Number(document.getElementById(`event-target-${eid}`).value),
        starts_at:datetimeInputValue(`event-start-${eid}`),
        ends_at:datetimeInputValue(`event-end-${eid}`),
        reward_points:Number(document.getElementById(`event-points-${eid}`).value),
        reward_xp:Number(document.getElementById(`event-xp-${eid}`).value),
        reward_item_key:document.getElementById(`event-item-${eid}`).value || null,
        active:document.getElementById(`event-active-${eid}`).checked
      }, "Événement communautaire enregistré.");
    }
    if (target.dataset.resetCommunityEvent) return confirm("Remettre la progression et toutes les contributions de cet événement à zéro ?") && adminRequest(`/api/admin/community-events/${encodeURIComponent(target.dataset.resetCommunityEvent)}/reset`, "POST", {}, "Progression de l’événement réinitialisée.");
    if (target.dataset.deleteCommunityEvent) return confirm("Supprimer définitivement cet événement et ses contributions ?") && adminRequest(`/api/admin/community-events/${encodeURIComponent(target.dataset.deleteCommunityEvent)}`, "DELETE", undefined, "Événement supprimé.");

    if (target.dataset.saveMission) {
      const mid = target.dataset.saveMission;
      return adminRequest(`/api/admin/missions/${encodeURIComponent(mid)}`, "PUT", {
        title:document.getElementById(`mission-title-${mid}`).value,
        scope:document.getElementById(`mission-scope-${mid}`).value,
        description:document.getElementById(`mission-description-${mid}`).value,
        activity_type:document.getElementById(`mission-activity-${mid}`).value,
        target:Number(document.getElementById(`mission-target-${mid}`).value),
        reward_points:Number(document.getElementById(`mission-points-${mid}`).value),
        reward_xp:Number(document.getElementById(`mission-xp-${mid}`).value),
        reward_item_key:document.getElementById(`mission-item-${mid}`).value || null,
        sort_order:Number(document.getElementById(`mission-order-${mid}`).value),
        required_rank:document.getElementById(`mission-rank-${mid}`).value,
        active:document.getElementById(`mission-active-${mid}`).checked
      }, "Quête enregistrée.");
    }
    if (target.dataset.resetMission) return confirm("Réinitialiser la progression de cette quête pour tous les membres ?") && adminRequest(`/api/admin/missions/${encodeURIComponent(target.dataset.resetMission)}/reset`, "POST", {}, "Progressions de la quête réinitialisées.");
    if (target.dataset.deleteMission) return confirm("Supprimer définitivement cette quête et toutes ses progressions ?") && adminRequest(`/api/admin/missions/${encodeURIComponent(target.dataset.deleteMission)}`, "DELETE", undefined, "Quête supprimée.");

    if (target.dataset.userRank) { const discordId=target.dataset.userRank; return adminRequest(`/api/admin/users/${encodeURIComponent(discordId)}/rank`, "PUT", {rank:$(`#user-rank-${discordId}`).value}, "Rang utilisateur enregistré."); }
    if (target.dataset.userPoints) return adminRequest(`/api/admin/users/${target.dataset.userPoints}/points`, "POST", {delta:Number($(`#user-points-${target.dataset.userPoints}`).value)}, "Points ajustés.");
  }

  async function saveUserTimer({discordId, type, serviceId, seconds}) {
    const cleanId = String(discordId || "").trim();
    if (!/^\d{5,30}$/.test(cleanId)) return showToast("Entre un ID Discord valide.", true);
    await adminRequest(`/api/admin/users/${encodeURIComponent(cleanId)}/timer`, "PUT", {
      type,
      service_id:type === "generator" ? serviceId : undefined,
      seconds:Number(seconds)
    }, Number(seconds) === 0 ? "Timer réinitialisé." : "Timer utilisateur modifié.");
  }

  document.addEventListener("click", async (event) => {
    const closeReward = event.target.closest("[data-close-reward]");
    if (closeReward) { $("#modal").classList.add("hidden"); $("#modal").setAttribute("aria-hidden","true"); return; }
    const claimDaily = event.target.closest("[data-claim-daily]");
    if (claimDaily) { await progressionAction("/api/daily/claim", undefined, "Récompense quotidienne"); return; }
    const claimDailyChallenge = event.target.closest("[data-claim-daily-challenge]");
    if (claimDailyChallenge) { await progressionAction(`/api/daily-challenges/${encodeURIComponent(claimDailyChallenge.dataset.claimDailyChallenge)}/claim`, undefined, "Défi quotidien terminé"); return; }
    const claimMission = event.target.closest("[data-claim-mission]");
    if (claimMission) { await progressionAction(`/api/missions/${encodeURIComponent(claimMission.dataset.claimMission)}/claim`, undefined, "Mission terminée"); return; }
    const useItem = event.target.closest("[data-use-item]");
    if (useItem) { await progressionAction("/api/inventory/use", {item_key:useItem.dataset.useItem}, "Objet utilisé"); return; }
    const equipItem = event.target.closest("[data-equip-item]");
    if (equipItem) { await progressionAction("/api/inventory/equip", {item_key:equipItem.dataset.equipItem}, "Objet équipé"); return; }
    const giftItem = event.target.closest("[data-gift-item]");
    if (giftItem) {
      const receiver=prompt(`ID Discord du membre qui recevra « ${giftItem.dataset.giftName || "cet objet"} » :`);
      if (!receiver) return;
      const quantity=Number(prompt("Quantité à offrir :","1") || 0);
      if (!Number.isInteger(quantity) || quantity<1) return showToast("Quantité invalide.",true);
      await progressionAction("/api/inventory/gift",{item_key:giftItem.dataset.giftItem,receiver_discord_id:receiver.trim(),quantity},"Cadeau envoyé");
      return;
    }
    const redeemPromo = event.target.closest("[data-redeem-promo]");
    if (redeemPromo) { const code=String($("#promoCodeInput")?.value||"").trim(); if(!code)return showToast("Entre un code promo.",true); await progressionAction("/api/promo/redeem", {code}, "Code promo utilisé"); return; }
    const claimEvent = event.target.closest("[data-claim-event]");
    if (claimEvent) { await progressionAction(`/api/community-events/${encodeURIComponent(claimEvent.dataset.claimEvent)}/claim`, undefined, "Événement terminé"); return; }
    const category = event.target.closest("[data-leaderboard-category]");
    if (category) { state.leaderboardCategory=category.dataset.leaderboardCategory; await reloadLeaderboard(); return; }
    const period = event.target.closest("[data-leaderboard-period]");
    if (period) { state.leaderboardPeriod=period.dataset.leaderboardPeriod; await reloadLeaderboard(); return; }
    const pageTarget = event.target.closest("[data-page]");
    if (pageTarget) { event.preventDefault(); await go(pageTarget.dataset.page); return; }
    if (event.target.id === "retryAdminBtn") { await go("admin"); return; }
    const copy = event.target.closest("[data-copy]");
    if (copy) { await copyText(copy.dataset.copy); return; }
    const generate = event.target.closest("[data-generate]");
    if (generate) { await handleGenerate(generate.dataset.generate); return; }
    const buy = event.target.closest("[data-buy]");
    if (buy) { await handlePurchase(buy.dataset.buy); return; }
    const adminTab = event.target.closest("[data-admin-tab]");
    if (adminTab) {
      state.adminTab = adminTab.dataset.adminTab;
      render();
      if (state.adminTab === "history") await loadAdminHistory();
      return;
    }
    if (event.target.id === "refreshHistoryBtn") { await loadAdminHistory(true); return; }
    const openTimer = event.target.closest("[data-open-user-timer]");
    if (openTimer) {
      state.adminTab = "timers";
      render();
      const input = $("#timerDiscordId");
      if (input) input.value = openTimer.dataset.openUserTimer;
      return;
    }
    const supportLink = event.target.closest("[data-support-link]");
    if (supportLink) {
      showToast("Ajoute DISCORD_URL dans frontend/config.js pour ouvrir ton serveur Discord.", true);
      return;
    }
    const resetTimer = event.target.closest("[data-reset-user-timer]");
    if (resetTimer) {
      await saveUserTimer({discordId:resetTimer.dataset.timerUser,type:resetTimer.dataset.timerType,serviceId:resetTimer.dataset.timerService || "",seconds:0});
      return;
    }
    const adminAction = event.target.closest("[data-save-service],[data-restock-service],[data-clear-service],[data-delete-service],[data-toggle-service],[data-save-product],[data-restock-product],[data-clear-product],[data-delete-product],[data-toggle-product],[data-save-wheel],[data-delete-wheel],[data-save-community-event],[data-reset-community-event],[data-delete-community-event],[data-save-mission],[data-reset-mission],[data-delete-mission],[data-user-rank],[data-user-points]");
    if (adminAction) { await handleAdminAction(adminAction); return; }
    if (event.target.id === "applyUserTimerBtn") {
      await saveUserTimer({discordId:$("#timerDiscordId").value,type:$("#timerType").value,serviceId:$("#timerService").value,seconds:$("#timerSeconds").value});
      return;
    }
    const enablePush=event.target.closest("[data-enable-push]");
    if (enablePush) {await enablePushNotifications();return;}
    const disablePush=event.target.closest("[data-disable-push]");
    if (disablePush) {await disablePushNotifications();return;}
    if (event.target.id === "installAppBtn") { await installApplication(); return; }
    if (event.target.id === "spinBtn") { await handleSpin(); return; }
    if (event.target.id === "createCommunityEventBtn") {
      const days=Math.max(1,Number($("#newEventDays").value||7));
      await adminRequest("/api/admin/community-events", "POST", {title:$("#newEventTitle").value,emoji:$("#newEventEmoji").value,description:$("#newEventDescription").value,activity_type:$("#newEventActivity").value,target:Number($("#newEventTarget").value),reward_points:Number($("#newEventPoints").value),reward_xp:Number($("#newEventXp").value),reward_item_key:$("#newEventItem").value||null,ends_at:Date.now()+days*86400000}, "Événement créé."); return;
    }
    if (event.target.id === "createMissionBtn") {
      await adminRequest("/api/admin/missions", "POST", {title:$("#newMissionTitle").value,scope:$("#newMissionScope").value,description:$("#newMissionDescription").value,activity_type:$("#newMissionActivity").value,target:Number($("#newMissionTarget").value),reward_points:Number($("#newMissionPoints").value),reward_xp:Number($("#newMissionXp").value),reward_item_key:$("#newMissionItem").value||null,sort_order:Number($("#newMissionOrder").value),required_rank:$("#newMissionRank").value,active:true}, "Quête créée."); return;
    }
    if (event.target.id === "createPromoCodeBtn") {
      await adminRequest("/api/admin/promo-codes", "POST", {code:$("#newPromoCode").value,description:$("#newPromoDescription").value,max_uses:Number($("#newPromoUses").value),reward_points:Number($("#newPromoPoints").value),reward_xp:Number($("#newPromoXp").value),reward_item_key:String($("#newPromoItem").value||"").trim()||null}, "Code promo créé."); return;
    }
    if (event.target.id === "addServiceBtn") {
      await adminRequest("/api/admin/services", "POST", {name:$("#newSvcName").value,emoji:$("#newSvcEmoji").value,description:$("#newSvcDesc").value,required_rank:$("#newSvcRank").value}, "Service ajouté."); return;
    }
    if (event.target.id === "addProductBtn") {
      await adminRequest("/api/admin/products", "POST", {name:$("#newProdName").value,emoji:$("#newProdEmoji").value,description:$("#newProdDesc").value,price:Number($("#newProdPrice").value)}, "Récompense ajoutée."); return;
    }
    if (event.target.id === "addWheelBtn") {
      await adminRequest("/api/admin/wheel", "POST", {emoji:$("#newWheelEmoji").value,label:$("#newWheelLabel").value,points:Number($("#newWheelPoints").value),weight:Number($("#newWheelWeight").value)}, "Gain ajouté."); return;
    }
    if (event.target.id === "saveSettingsBtn") {
      await adminRequest("/api/admin/settings", "PUT", {wheel_cooldown_seconds:43200,starting_points:Number($("#settingStartPoints").value),xp_generation:Number($("#settingXpGeneration").value),xp_purchase:Number($("#settingXpPurchase").value),xp_wheel:Number($("#settingXpWheel").value),xp_chest:Number($("#settingXpChest").value),daily_base_points:Number($("#settingDailyPoints").value),daily_base_xp:Number($("#settingDailyXp").value)}, "Réglages enregistrés."); return;
    }
  });

  document.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" || event.target?.id !== "promoCodeInput") return;
    event.preventDefault();
    const code = String(event.target.value || "").trim();
    if (!code) return showToast("Entre un code promo.", true);
    await progressionAction("/api/promo/redeem", {code}, "Code promo utilisé");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    if (state.page === "appinstall") render();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    state.appInstalled = true;
    showToast("OpiumStore a été installé avec succès.");
    if (state.page === "appinstall") render();
  });

  $("#discordLoginBtn").addEventListener("click", () => {
    if (!API_BASE || API_BASE.includes("YOUR-WORKER")) return showToast("Configure API_BASE dans config.js.", true);
    location.href = `${API_BASE}/auth/discord/start`;
  });
  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("/api/logout", {method:"POST"}); } catch {}
    localStorage.removeItem(TOKEN_KEY); state.token=""; state.me=null; showLogin();
  });
  $("#refreshBtn").addEventListener("click", async () => { try { await refreshAll(); showToast("Données actualisées."); } catch(e){ showToast(e.message,true); } });
  $("#menuBtn").addEventListener("click", openMobileMenu);
  $("#mobileOverlay").addEventListener("click", closeMobileMenu);
  $("#modalClose").addEventListener("click", () => $("#modal").classList.add("hidden"));

  async function init() {
    try {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js?v=20260714-v77", {updateViaCache:"none"})
          .then(registration => registration.update())
          .catch(error => console.warn("Service Worker:", error));
      }
      await exchangeAuthCode();
      if (!state.token) return showLogin();
      await loadBaseData();
      showApp();
      render();
    } catch (error) {
      console.error(error);
      localStorage.removeItem(TOKEN_KEY);
      state.token = "";
      showLogin();
      showToast(error.message, true);
    }
  }

  init();
})();
