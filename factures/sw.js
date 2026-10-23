/* Service worker — Factures FLP (v2).
   Réseau d'abord, copie en cache pour le hors-ligne : plus jamais de vieille
   version bloquée, et l'appli photo s'ouvre même sans réseau (les photos
   attendent alors dans la boîte d'envoi du téléphone). */
const CACHE = 'flp-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // envois : toujours le réseau
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    // bibliothèques (lecture, PDF) : cache d'abord, elles ne changent jamais
    if (/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(url.host)) {
      e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)); return r; })));
    }
    return;
  }
  if (url.searchParams.has('a')) return;                  // api.php : jamais en cache
  const keep = req.mode === 'navigate' || /\.(css|js|png|webmanifest)$/.test(url.pathname) || /icon\.php|manifest/.test(url.pathname);
  if (!keep) return;
  e.respondWith(fetch(req).then(r => {
    if (r.ok && !r.redirected) { const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode !== 'navigate' }).then(c => c || Response.error())));
});
