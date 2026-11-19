// Offline support: the app and its lessons are cached on the device.
const VERSION = "v1";
const CORE = [
  "./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/main.js", "js/data.js", "js/store.js", "js/srs.js", "js/speech.js", "js/writing.js", "js/sync.js", "js/config.js",
  "data/kana.json", "data/kanji-n5.json", "data/vocab-n5.json", "data/strokes-core.json",
  "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(`core-${VERSION}`).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Sync requests always go to the network.
  if (url.hostname.endsWith("supabase.co")) return;
  e.respondWith((async () => {
    const cached = await caches.match(e.request, { ignoreSearch: true });
    const network = fetch(e.request).then(async (res) => {
      if (res.ok && (url.origin === location.origin || url.hostname === "cdn.jsdelivr.net")) {
        const c = await caches.open(url.pathname.includes("/data/") ? `data-${VERSION}` : `core-${VERSION}`);
        c.put(e.request, res.clone());
      }
      return res;
    }).catch(() => cached);
    // App files: use the cache straight away and refresh it in the background.
    return cached || network;
  })());
});
