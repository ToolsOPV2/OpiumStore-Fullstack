(() => {
  "use strict";

  const config = window.OPIUM_CONFIG || {};
  const API_BASE = String(config.API_BASE || "").replace(/\/$/, "");
  const AUTOSHOP_URL = config.AUTOSHOP_URL || "https://opiumshop.onrender.com/";
  const DISCORD_URL = config.DISCORD_URL || config.SUPPORT_URL || "";
  const TOKEN_KEY = "opium_store_session";

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || "",
    me: null,
    catalog: null,
    wallet: [],
    admin: null,
    adminHistory: null,
    adminHistoryLoading: false,
    page: "home",
    adminTab: "services",
    wheelRotation: 0,
    wheelBusy: false,
    generatorResult: null,
    purchaseResult: null
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

  function setUserChrome() {
    if (!state.me) return;
    $("#sidebarName").textContent = state.me.display_name || state.me.username;
    $("#sidebarDiscord").textContent = `@${state.me.username}`;
    $("#sidebarRole").textContent = state.me.is_admin ? "Administrateur" : "Membre";
    $("#sidebarAvatar").src = avatarUrl(state.me);
    $("#topAvatar").src = avatarUrl(state.me);
    $("#topPoints").textContent = formatNumber(state.me.points);
    $("#adminNav").classList.toggle("hidden", !state.me.is_admin);
    $("#autoshopLink").href = AUTOSHOP_URL;
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
    const [me, catalog, wallet] = await Promise.all([
      api("/api/me"),
      api("/api/catalog"),
      api("/api/wallet")
    ]);
    state.me = me.user;
    state.catalog = catalog;
    state.wallet = wallet.items || [];
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
    return `<section class="page">
      <article class="hero">
        <div class="hero-inner">
          <div class="hero-copy">
            <span class="eyebrow">BIENVENUE SUR OPIUMSTORE HUB</span>
            <h1>Salut, ${escapeHtml(state.me.display_name || state.me.username)}.</h1>
            <p>Ton compte Discord est connecté. Tes points, achats, générations et cooldowns sont maintenant enregistrés dans la base partagée.</p>
            <div class="toolbar">
              <button class="btn btn-primary" data-page="generator">⚡ Ouvrir le générateur</button>
              <button class="btn btn-secondary" data-page="shop">🎁 Boutique points</button>
            </div>
          </div>
          <img src="assets/logo.png" class="hero-logo" alt="OpiumStore">
        </div>
      </article>
      <section class="section grid grid-4">
        ${statCard("Solde points", `${formatNumber(state.me.points)} pts`, `${formatNumber(state.me.total_earned)} gagnés au total`, "◈")}
        ${statCard("Générations", formatNumber(s.generations || 0), "Lignes reçues", "⚡")}
        ${statCard("Achats", formatNumber(s.purchases || 0), "Récompenses achetées", "🎁")}
        ${statCard("Wallet", formatNumber(state.wallet.length), "Éléments disponibles", "▰")}
      </section>
      <section class="section">
        <div class="section-head"><div><h2>Services disponibles</h2><p>Le stock est partagé entre tous les membres.</p></div></div>
        <div class="grid grid-3">${(state.catalog?.services || []).slice(0,6).map(serviceCard).join("") || '<div class="empty">Aucun service disponible.</div>'}</div>
      </section>
    </section>`;
  }

  function serviceCard(s) {
    const wait = Number(s.cooldown_remaining || 0);
    const dailyRemaining = Number(state.catalog?.daily_generation_remaining);
    const dailyBlocked = Number.isFinite(dailyRemaining) && dailyRemaining === 0;
    const disabled = s.stock <= 0 || wait || dailyBlocked;
    const buttonLabel = s.stock <= 0 ? "Stock épuisé" : dailyBlocked ? "Limite journalière atteinte" : wait ? `Cooldown ${remaining(wait)}` : "Générer";
    return `<article class="card service-card">
      <div class="service-top"><div class="emoji-box">${escapeHtml(s.emoji)}</div><span class="badge ${s.stock > 0 ? "badge-green" : "badge-red"}">${formatNumber(s.stock)} en stock</span></div>
      <div><h3>${escapeHtml(s.name)}</h3><p class="muted">${escapeHtml(s.description || "Distribution automatique dans l’ordre du stock.")}</p></div>
      <div class="${wait ? "cooldown" : "stock"}">${wait ? `Disponible dans ${remaining(wait)}` : dailyBlocked ? "Quota journalier utilisé" : "Disponible maintenant"}</div>
      <button class="btn btn-primary" data-generate="${escapeHtml(s.id)}" ${disabled ? "disabled" : ""}>${buttonLabel}</button>
    </article>`;
  }

  function generatorPage() {
    const limit = Number(state.catalog?.daily_generation_limit ?? 6);
    const used = Number(state.catalog?.generations_today || 0);
    const remainingToday = Number(state.catalog?.daily_generation_remaining);
    const quotaText = limit === 0
      ? `Illimité · ${formatNumber(used)} génération(s) aujourd’hui`
      : `${formatNumber(used)} / ${formatNumber(limit)} aujourd’hui · ${formatNumber(Math.max(0, Number.isFinite(remainingToday) ? remainingToday : limit - used))} restante(s)`;
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">DISTRIBUTION FIFO</span><h2>Générateur</h2><p>La première demande reçoit la première ligne du stock, puis la suivante reçoit la ligne 2.</p></div><span class="badge badge-green">${quotaText}</span></div>
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
          <div class="admin-list"><div>✅ 6 générations par jour</div><div>⏱️ Cooldown de 15 minutes</div><div>🎁 Accès aux services publics</div><div>📦 Stocks selon disponibilité</div></div>
          <button class="btn btn-green" data-page="generator" style="margin-top:auto">Commencer gratuitement</button>
        </article>

        <article class="card" style="display:flex;flex-direction:column;gap:16px;border:1px solid rgba(59,130,246,.55);box-shadow:0 0 32px rgba(37,99,235,.13)">
          <div><div class="emoji-box">🚀</div><span class="eyebrow">BOOST</span><h2>Accès Boost</h2><div class="stat-value">Boost Discord</div><p class="muted">Pour les membres qui boostent le serveur et veulent plus de générations.</p></div>
          <div class="admin-list"><div>✅ 15 générations par jour</div><div>⏱️ Cooldown de 2 minutes</div><div>🚀 Avantage membre boost</div><div>📦 Plus de confort d’utilisation</div></div>
          <div style="margin-top:auto">${discordButton}</div>
        </article>

        <article class="card" style="display:flex;flex-direction:column;gap:16px;border:1px solid rgba(168,85,247,.65);box-shadow:0 0 38px rgba(168,85,247,.18)">
          <div><div class="emoji-box">👑</div><span class="eyebrow">VIP</span><h2>VIP à vie</h2><div class="stat-value">6,99 € <small>à vie</small></div><p class="muted">L’offre premium pour profiter au maximum du générateur OpiumGen.</p></div>
          <div class="admin-list"><div>♾️ Générations illimitées par jour</div><div>⏱️ Cooldown réduit à 1 minute</div><div>👑 Accès aux services VIP uniquement</div><div>🚀 Accès premium</div><div>🛠️ Support plus rapide</div></div>
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
    return `<article class="card product-card">
      <div class="product-top"><div class="emoji-box">${escapeHtml(p.emoji)}</div><span class="badge badge-yellow">${formatNumber(p.price)} pts</span></div>
      <div><h3>${escapeHtml(p.name)}</h3><p class="muted">${escapeHtml(p.description || "Récompense numérique.")}</p></div>
      <span class="stock">${formatNumber(p.stock)} ligne(s) disponible(s)</span>
      <button class="btn btn-primary" data-buy="${escapeHtml(p.id)}" ${p.stock <= 0 || state.me.points < p.price ? "disabled" : ""}>${p.stock <= 0 ? "Rupture de stock" : state.me.points < p.price ? "Points insuffisants" : "Acheter"}</button>
    </article>`;
  }

  function shopPage() {
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">BOUTIQUE POINTS</span><h2>Récompenses</h2><p>Chaque achat distribue la prochaine phrase ou ligne disponible.</p></div><div class="points-pill"><span>◈</span><b>${formatNumber(state.me.points)}</b><small>pts</small></div></div>
      ${state.purchaseResult ? `<div class="line-result"><b>Achat réussi :</b><div class="secret-line">${escapeHtml(state.purchaseResult.value)}</div><button class="btn btn-green" data-copy="${escapeHtml(state.purchaseResult.value)}">Copier la récompense</button></div>` : ""}
      <div class="grid grid-3">${(state.catalog?.products || []).map(productCard).join("") || '<div class="empty">Aucune récompense en vente.</div>'}</div>
    </section>`;
  }

  function walletPage() {
    const items = state.wallet || [];
    return `<section class="page">
      <div class="section-head"><div><span class="eyebrow">WALLET</span><h2>Tes livraisons</h2><p>Les lignes déjà reçues restent liées à ton compte Discord.</p></div></div>
      <article class="card">${items.length ? items.map((item) => `<div class="wallet-item"><div class="emoji-box">${item.kind === "generation" ? "⚡" : "🎁"}</div><div><b>${escapeHtml(item.title)}</b><div class="wallet-line">${escapeHtml(item.value)}</div><div class="wallet-meta">${formatDate(item.created_at)}</div></div><button class="btn btn-small btn-secondary" data-copy="${escapeHtml(item.value)}">Copier</button></div>`).join("") : '<div class="empty">Ton Wallet est encore vide.</div>'}</article>
    </section>`;
  }

  function wheelPage() {
    const rewards = state.catalog?.wheel_rewards || [];
    const n = Math.max(1, rewards.length);
    const palette = ["#0284c7", "#2563eb", "#0891b2", "#0f766e", "#7c3aed", "#0369a1", "#1d4ed8", "#0e7490"];
    const gradient = rewards.map((_, i) => `${palette[i % palette.length]} ${(i * 360) / n}deg ${((i + 1) * 360) / n}deg`).join(",");
    const labels = rewards.map((r, i) => {
      const angle = (-90 + (i + .5) * 360 / n) * Math.PI / 180;
      const x = 50 + 36 * Math.cos(angle), y = 50 + 36 * Math.sin(angle);
      return `<span class="wheel-label" style="left:${x}%;top:${y}%">${escapeHtml(r.emoji)}</span>`;
    }).join("");
    const wait = Number(state.catalog?.wheel_cooldown_remaining || 0);
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">ROUE DES POINTS</span><h2>Tente ta chance</h2><p>Les gains et le cooldown sont contrôlés par le serveur.</p></div></div>
      <div class="wheel-layout"><div class="wheel-stage"><div class="wheel-pointer"></div><div id="wheelDisk" class="wheel" style="background:conic-gradient(${gradient});transform:rotate(${state.wheelRotation}deg)">${labels}<div class="wheel-center">OS</div></div></div>
      <article class="card"><h3>Gains possibles</h3><div class="admin-list">${rewards.map(r => `<div class="wallet-item"><div class="emoji-box">${escapeHtml(r.emoji)}</div><div><b>${escapeHtml(r.label)}</b><div class="wallet-meta">${formatNumber(r.points)} points</div></div></div>`).join("")}</div><button id="spinBtn" class="btn btn-primary btn-lg" ${wait || state.wheelBusy ? "disabled" : ""}>${wait ? `Disponible dans ${remaining(wait)}` : state.wheelBusy ? "La roue tourne…" : "Faire tourner la roue"}</button></article></div>
    </section>`;
  }

  function adminPage() {
    if (!state.me?.is_admin) return `<div class="empty">Accès refusé.</div>`;
    if (!state.admin) return `<div class="empty">Chargement du panel admin…</div>`;
    const tabs = [["services","Services"],["products","Boutique"],["wheel","Roue"],["users","Utilisateurs"],["timers","Timers utilisateurs"],["history","Historique"],["settings","Réglages"]];
    return `<section class="page"><div class="section-head"><div><span class="eyebrow">ADMINISTRATION</span><h2>Panel serveur</h2><p>Toutes les modifications s’appliquent immédiatement à tous les utilisateurs.</p></div></div><div class="admin-tabs">${tabs.map(([id,label]) => `<button class="admin-tab ${state.adminTab===id?"active":""}" data-admin-tab="${id}">${label}</button>`).join("")}</div>${adminTabContent()}</section>`;
  }

  function adminTabContent() {
    if (state.adminTab === "services") return adminServices();
    if (state.adminTab === "products") return adminProducts();
    if (state.adminTab === "wheel") return adminWheel();
    if (state.adminTab === "users") return adminUsers();
    if (state.adminTab === "timers") return adminTimers();
    if (state.adminTab === "history") return adminHistory();
    return adminSettings();
  }

  function adminServices() {
    const items = state.admin.services || [];
    return `<div class="admin-list">${items.map(s => `<article class="admin-card"><div class="form-grid"><div class="field"><label>Nom</label><input class="input" id="svc-name-${s.id}" value="${escapeHtml(s.name)}"></div><div class="field"><label>Emoji</label><input class="input" id="svc-emoji-${s.id}" value="${escapeHtml(s.emoji)}"></div><div class="field"><label>Cooldown (secondes)</label><input class="input" type="number" min="0" id="svc-cooldown-${s.id}" value="${s.cooldown_seconds}"></div><div class="field"><label>Stock actuel</label><input class="input" value="${s.stock}" disabled></div></div><div class="field" style="margin-top:12px"><label>Description</label><input class="input" id="svc-desc-${s.id}" value="${escapeHtml(s.description || "")}"></div><div class="field" style="margin-top:12px"><label>Réalimenter — une ligne par ligne</label><textarea class="textarea" id="svc-lines-${s.id}" placeholder="ligne 1\nligne 2\nligne 3"></textarea></div><div class="admin-actions"><button class="btn btn-primary btn-small" data-save-service="${s.id}">Enregistrer</button><button class="btn btn-green btn-small" data-restock-service="${s.id}">Ajouter les lignes</button><button class="btn btn-secondary btn-small" data-toggle-service="${s.id}" data-enabled="${s.enabled ? 1 : 0}">${s.enabled ? "Désactiver" : "Activer"}</button><button class="btn btn-red btn-small" data-clear-service="${s.id}">Vider le stock</button><button class="btn btn-red btn-small" data-delete-service="${s.id}">Supprimer</button></div></article>`).join("")}
      <article class="admin-card"><h3>Ajouter un service</h3><div class="form-grid"><div class="field"><label>Nom</label><input id="newSvcName" class="input" placeholder="Nom du service"></div><div class="field"><label>Emoji</label><input id="newSvcEmoji" class="input" value="⚡"></div><div class="field"><label>Cooldown</label><input id="newSvcCooldown" class="input" type="number" value="10"></div><div class="field"><label>Description</label><input id="newSvcDesc" class="input" placeholder="Description"></div></div><button id="addServiceBtn" class="btn btn-primary" style="margin-top:13px">Ajouter le service</button></article></div>`;
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
      <article class="admin-card">
        <h3>⚙️ Limites par utilisateur</h3>
        <p class="muted">Réglages par défaut : <b>15 minutes</b> entre deux générations et <b>6 générations par jour</b>. Le cooldown et la limite sont liés à l’ID Discord, sans bloquer les autres utilisateurs. Mets <b>0 génération/jour</b> pour un accès illimité.</p>
        <div class="form-grid">
          <div class="field"><label>ID Discord</label><input id="directUserCooldownId" class="input" inputmode="numeric" placeholder="123456789012345678"></div>
          <div class="field"><label>Temps de génération (minutes)</label><input id="directUserCooldownMinutes" class="input" type="number" min="0" max="525600" step="1" value="15"></div>
          <div class="field"><label>Générations par jour</label><input id="directUserDailyLimit" class="input" type="number" min="0" max="100000" step="1" value="6"></div>
        </div>
        <div class="admin-actions">
          <button id="saveDirectUserCooldownBtn" class="btn btn-primary">Enregistrer le temps</button>
          <button id="saveDirectUserDailyLimitBtn" class="btn btn-green">Enregistrer la limite/jour</button>
          <span class="muted">API : ${apiVersion}</span>
        </div>
      </article>
      ${users.length ? users.map(u => {
        const seconds = Number.isFinite(Number(u.generation_cooldown_seconds)) ? Number(u.generation_cooldown_seconds) : 900;
        const minutes = Math.max(0, seconds / 60);
        const dailyLimit = Number.isFinite(Number(u.daily_generation_limit)) ? Math.max(0, Number(u.daily_generation_limit)) : 6;
        const today = Math.max(0, Number(u.generations_today || 0));
        const quotaLabel = dailyLimit === 0 ? `${formatNumber(today)} aujourd’hui · illimité` : `${formatNumber(today)} / ${formatNumber(dailyLimit)} aujourd’hui`;
        return `<article class="admin-card">
          <div class="section-head" style="margin-bottom:12px"><div><h3>${escapeHtml(u.display_name || u.username)}</h3><p class="muted">@${escapeHtml(u.username || "inconnu")} · ID ${escapeHtml(u.discord_id)}</p></div><span class="badge badge-green">${quotaLabel}</span></div>
          <div class="form-grid">
            <div class="field"><label>Points</label><div class="toolbar"><input class="input" type="number" id="user-points-${u.discord_id}" value="100"><button class="btn btn-green btn-small" data-user-points="${u.discord_id}">Ajuster</button></div></div>
            <div class="field"><label>Temps gen (minutes)</label><div class="toolbar"><input class="input" type="number" min="0" max="525600" step="1" id="user-gen-time-${u.discord_id}" value="${escapeHtml(minutes)}"><button class="btn btn-primary btn-small" data-user-gen-time="${u.discord_id}">Enregistrer</button></div></div>
            <div class="field"><label>Générations par jour (0 = illimité)</label><div class="toolbar"><input class="input" type="number" min="0" max="100000" step="1" id="user-daily-limit-${u.discord_id}" value="${escapeHtml(dailyLimit)}"><button class="btn btn-primary btn-small" data-user-daily-limit="${u.discord_id}">Enregistrer</button></div></div>
            <div class="field"><label>Générations totales</label><input class="input" value="${formatNumber(u.generations)}" disabled></div>
            <div class="field"><label>Achats boutique</label><input class="input" value="${formatNumber(u.purchases)}" disabled></div>
            <div class="field"><label>Timer actif</label><button class="btn btn-secondary" data-open-user-timer="${u.discord_id}">Voir / réinitialiser</button></div>
          </div>
        </article>`;
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
    return `<article class="admin-card"><h3>Réglages globaux</h3><div class="form-grid"><div class="field"><label>Temps gen par défaut (minutes)</label><input id="settingDefaultGenCooldown" class="input" type="number" min="0" value="${escapeHtml(Number(settings.default_generation_cooldown_seconds || 900) / 60)}"></div><div class="field"><label>Générations/jour par défaut</label><input id="settingDefaultDailyLimit" class="input" type="number" min="0" max="100000" value="${escapeHtml(settings.default_daily_generation_limit ?? 6)}"></div><div class="field"><label>Cooldown roue (secondes)</label><input id="settingWheelCooldown" class="input" type="number" min="0" value="${escapeHtml(settings.wheel_cooldown_seconds || 3600)}"></div><div class="field"><label>Points de départ</label><input id="settingStartPoints" class="input" type="number" min="0" value="${escapeHtml(settings.starting_points || 500)}"></div></div><button id="saveSettingsBtn" class="btn btn-primary" style="margin-top:13px">Enregistrer les réglages</button><p class="muted">Valeurs par défaut : 15 minutes et 6 générations par jour. Mets 0 génération/jour pour une limite globale illimitée. Les réglages personnels des utilisateurs restent prioritaires.</p></article>`;
  }

  function render() {
    if (!state.me || !state.catalog) return;
    setUserChrome();
    $$("[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === state.page));
    const titles = {home:"Accueil",generator:"Générateur",vip:"VIP & offres",shop:"Boutique points",wheel:"Roue",wallet:"Wallet",admin:"Administration"};
    $("#pageTitle").textContent = titles[state.page] || "OpiumStore Hub";
    if (state.page === "generator") main.innerHTML = generatorPage();
    else if (state.page === "vip") main.innerHTML = vipPage();
    else if (state.page === "shop") main.innerHTML = shopPage();
    else if (state.page === "wheel") main.innerHTML = wheelPage();
    else if (state.page === "wallet") main.innerHTML = walletPage();
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
      showToast("Achat réussi. La prochaine ligne du stock t’a été livrée.");
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
        showToast(`${result.reward.emoji} ${result.reward.label} : +${formatNumber(result.reward.points)} points`);
        await refreshAll();
      }, 4300);
    } catch (error) {
      state.wheelBusy = false;
      showToast(error.message, true);
      await refreshAll();
    }
  }

  function linesFromTextarea(id) {
    return ($(id)?.value || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  }

  async function adminRequest(path, method, body, success) {
    try {
      await api(path, {method, body: body === undefined ? undefined : JSON.stringify(body)});
      showToast(success);
      state.admin = await api("/api/admin/overview");
      state.adminHistory = state.admin.history || state.adminHistory;
      await refreshAll(false);
      render();
    } catch (error) { showToast(error.message, true); }
  }

  async function handleAdminAction(target) {
    const id = target.dataset.saveService || target.dataset.restockService || target.dataset.clearService || target.dataset.deleteService || target.dataset.toggleService;
    if (target.dataset.saveService) return adminRequest(`/api/admin/services/${id}`, "PUT", {name:$(`#svc-name-${id}`).value,emoji:$(`#svc-emoji-${id}`).value,description:$(`#svc-desc-${id}`).value,cooldown_seconds:Number($(`#svc-cooldown-${id}`).value),enabled:true}, "Service enregistré.");
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
    if (target.dataset.userPoints) return adminRequest(`/api/admin/users/${target.dataset.userPoints}/points`, "POST", {delta:Number($(`#user-points-${target.dataset.userPoints}`).value)}, "Points ajustés.");
    if (target.dataset.userGenTime) {
      const discordId = target.dataset.userGenTime;
      const minutes = Number($(`#user-gen-time-${discordId}`).value);
      if (!Number.isFinite(minutes) || minutes < 0) return showToast("Entre une durée valide en minutes.", true);
      return adminRequest(`/api/admin/users/${encodeURIComponent(discordId)}/generation-cooldown`, "PUT", {minutes}, "Temps de génération enregistré.");
    }
    if (target.dataset.userDailyLimit) {
      const discordId = target.dataset.userDailyLimit;
      const limit = Number($(`#user-daily-limit-${discordId}`).value);
      if (!Number.isInteger(limit) || limit < 0 || limit > 100000) return showToast("Entre une limite entière entre 0 et 100 000.", true);
      return adminRequest(`/api/admin/users/${encodeURIComponent(discordId)}/generation-limit`, "PUT", {limit}, "Limite journalière enregistrée.");
    }
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
    if (event.target.id === "saveDirectUserCooldownBtn") {
      const discordId = String($("#directUserCooldownId")?.value || "").trim();
      const minutes = Number($("#directUserCooldownMinutes")?.value);
      if (!/^\d{5,30}$/.test(discordId)) { showToast("Entre un ID Discord valide.", true); return; }
      if (!Number.isFinite(minutes) || minutes < 0) { showToast("Entre une durée valide en minutes.", true); return; }
      await adminRequest(`/api/admin/users/${encodeURIComponent(discordId)}/generation-cooldown`, "PUT", {minutes}, "Temps de génération enregistré pour cet utilisateur.");
      return;
    }
    if (event.target.id === "saveDirectUserDailyLimitBtn") {
      const discordId = String($("#directUserCooldownId")?.value || "").trim();
      const limit = Number($("#directUserDailyLimit")?.value);
      if (!/^\d{5,30}$/.test(discordId)) { showToast("Entre un ID Discord valide.", true); return; }
      if (!Number.isInteger(limit) || limit < 0 || limit > 100000) { showToast("Entre une limite entière entre 0 et 100 000.", true); return; }
      await adminRequest(`/api/admin/users/${encodeURIComponent(discordId)}/generation-limit`, "PUT", {limit}, "Limite journalière enregistrée pour cet utilisateur.");
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
    const adminAction = event.target.closest("[data-save-service],[data-restock-service],[data-clear-service],[data-delete-service],[data-toggle-service],[data-save-product],[data-restock-product],[data-clear-product],[data-delete-product],[data-toggle-product],[data-save-wheel],[data-delete-wheel],[data-user-points],[data-user-gen-time],[data-user-daily-limit]");
    if (adminAction) { await handleAdminAction(adminAction); return; }
    if (event.target.id === "applyUserTimerBtn") {
      await saveUserTimer({discordId:$("#timerDiscordId").value,type:$("#timerType").value,serviceId:$("#timerService").value,seconds:$("#timerSeconds").value});
      return;
    }
    if (event.target.id === "spinBtn") { await handleSpin(); return; }
    if (event.target.id === "addServiceBtn") {
      await adminRequest("/api/admin/services", "POST", {name:$("#newSvcName").value,emoji:$("#newSvcEmoji").value,description:$("#newSvcDesc").value,cooldown_seconds:Number($("#newSvcCooldown").value)}, "Service ajouté."); return;
    }
    if (event.target.id === "addProductBtn") {
      await adminRequest("/api/admin/products", "POST", {name:$("#newProdName").value,emoji:$("#newProdEmoji").value,description:$("#newProdDesc").value,price:Number($("#newProdPrice").value)}, "Récompense ajoutée."); return;
    }
    if (event.target.id === "addWheelBtn") {
      await adminRequest("/api/admin/wheel", "POST", {emoji:$("#newWheelEmoji").value,label:$("#newWheelLabel").value,points:Number($("#newWheelPoints").value),weight:Number($("#newWheelWeight").value)}, "Gain ajouté."); return;
    }
    if (event.target.id === "saveSettingsBtn") {
      await adminRequest("/api/admin/settings", "PUT", {default_generation_cooldown_minutes:Number($("#settingDefaultGenCooldown").value),default_daily_generation_limit:Number($("#settingDefaultDailyLimit").value),wheel_cooldown_seconds:Number($("#settingWheelCooldown").value),starting_points:Number($("#settingStartPoints").value)}, "Réglages enregistrés."); return;
    }
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
