/* Kurdish Ultra TV — Service Worker
   Caches the app shell + font CSS + hls.js for instant load + offline support.
   Stream segments (.ts / .m3u8) are NEVER cached — they are live and would
   waste battery if cached. M3U playlists from iptv-org are stored in a
   short-lived runtime cache (managed at the app layer via localStorage TTL).
*/
const VERSION   = "v3";
const APP_CACHE = "kut-app-" + VERSION;
const RUN_CACHE = "kut-run-" + VERSION;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js",
  "https://fonts.googleapis.com/css2?family=Oxanium:wght@600;700;800&family=Rajdhani:wght@500;600;700&display=swap",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(APP_CACHE).then(c =>
      Promise.all(APP_SHELL.map(u => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== APP_CACHE && k !== RUN_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isStreamRequest(url) {
  return /\.(m3u8|ts|key|aac|mp4|webm)(\?|$)/i.test(url) ||
         /\/hls\//i.test(url) ||
         /\/dash\//i.test(url);
}
function isFontGstaticRequest(url) {
  return /fonts\.gstatic\.com/.test(url);
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = req.url;

  // Never touch live stream segments — let the network handle them directly.
  if (isStreamRequest(url)) return;

  // Same-origin app shell → cache-first.
  if (url.startsWith(self.location.origin)) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(resp => {
        const copy = resp.clone();
        if (resp.ok) caches.open(APP_CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match("./index.html")))
    );
    return;
  }

  // Cross-origin: hls.js, font CSS, font files → stale-while-revalidate.
  if (
    /cdn\.jsdelivr\.net/.test(url) ||
    /fonts\.googleapis\.com/.test(url) ||
    isFontGstaticRequest(url)
  ) {
    e.respondWith(
      caches.open(RUN_CACHE).then(cache =>
        cache.match(req).then(cached => {
          const network = fetch(req).then(resp => {
            if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
            return resp;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // iptv-org playlist files → cache-with-fallback (24h TTL handled in app).
  if (/iptv-org\.github\.io/.test(url)) {
    e.respondWith(
      caches.open(RUN_CACHE).then(cache =>
        fetch(req).then(resp => {
          if (resp && resp.ok) cache.put(req, resp.clone()).catch(() => {});
          return resp;
        }).catch(() => cache.match(req))
      )
    );
    return;
  }

  // Everything else: try cache, then network.
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(() => cached))
  );
});

self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});
