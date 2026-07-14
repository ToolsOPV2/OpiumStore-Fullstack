const CACHE_NAME = "opiumstore-v79";
const OFFLINE_URL = "./index.html?v=20260714-v79";
const APP_SHELL = [
  OFFLINE_URL,
  "./styles.css?v=20260714-v79",
  "./progression.css?v=20260714-v79",
  "./app.js?v=20260714-v79",
  "./config.js?v=20260714-v79",
  "./manifest.webmanifest?v=20260714-v79",
  "./assets/logo.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(APP_SHELL.map(async path => {
      try {
        const response = await fetch(new Request(path, {cache:"reload"}));
        if (response.ok) await cache.put(path, response);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, {cache:"no-store"});
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return (await caches.match(request)) || (request.mode === "navigate" ? await caches.match(OFFLINE_URL) : Response.error());
    }
  })());
});

self.addEventListener("push", event => {
  event.waitUntil(self.registration.showNotification("OpiumStore", {
    body:"Une récompense quotidienne ou un tour de roue est disponible.",
    icon:"./assets/icon-192.png",
    badge:"./assets/icon-192.png",
    tag:"opiumstore-reward-ready",
    renotify:false,
    data:{url:"./"},
    actions:[{action:"open",title:"Ouvrir OpiumStore"}]
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || "./", self.location.origin).href;
    const windows = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
