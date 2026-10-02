// שמירה לעבודה גם בלי אינטרנט. כל שינוי גרסה מרענן את המטמון.
const PREFIX = `talbot-bridge:${self.registration.scope}:`;
const VERSION = `${PREFIX}v5`;
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png',
  './icons/icon-192.png', './icons/icon-512.png', './src/ui/install.js', './src/ui/app.js', './src/ai/client.js', './src/ai/worker.js', './src/ai/core.js', './src/ai/bid-ai.js', './src/ai/play-ai.js',
  './src/engine/cards.js', './src/engine/bidding.js', './src/engine/scoring.js', './src/engine/play.js',
  './src/game/board.js', './src/game/tournament.js', './src/game/chatter.js', './src/ui/chat.js',
  './vendor/bridge-solver/bridge_solver_wasm.js', './vendor/bridge-solver/bridge_solver_wasm_bg.wasm',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Versioned local assets: reliable offline startup even on a weak connection.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.registration.scope)) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(e.request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(e.request);
      if (res.ok) await cache.put(e.request, res.clone());
      return res;
    } catch {
      if (e.request.mode === 'navigate') {
        const home = await cache.match('./index.html');
        if (home) return home;
      }
      return Response.error();
    }
  })());
});
