// שמירה לעבודה גם בלי אינטרנט. כל שינוי גרסה מרענן את המטמון.
const VERSION = 'bridge-v2';
const ASSETS = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icons/icon.svg', './icons/icon-180.png',
  './src/ui/app.js', './src/ai/client.js', './src/ai/worker.js', './src/ai/core.js', './src/ai/bid-ai.js', './src/ai/play-ai.js',
  './src/engine/cards.js', './src/engine/bidding.js', './src/engine/scoring.js', './src/engine/play.js',
  './src/game/board.js', './src/game/tournament.js', './src/game/chatter.js', './src/ui/chat.js',
  './vendor/bridge-solver/bridge_solver_wasm.js', './vendor/bridge-solver/bridge_solver_wasm_bg.wasm',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// קודם רשת (כדי לקבל עדכונים), ואם אין רשת - מהמטמון
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
    }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
