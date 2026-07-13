const CACHE_NAME = "opiumstore-v75";
const OFFLINE_URL = "./index.html?v=20260713-v75";
const APP_SHELL = [
  OFFLINE_URL,
  "./styles.css?v=20260713-v75",
  "./progression.css?v=20260713-v75",
  "./app.js?v=20260713-v75",
  "./config.js?v=20260713-v75",
  "./manifest.webmanifest?v=20260713-v75",
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
