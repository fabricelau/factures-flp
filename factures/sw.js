/* Service worker — Factures FLP (v2).
   Réseau d'abord, copie en cache pour le hors-ligne : plus jamais de vieille
   version bloquée, et l'appli photo s'ouvre même sans réseau (les photos
   attendent alors dans la boîte d'envoi du téléphone). */
const CACHE = 'flp-v3';
const DATA = 'flp-donnees';        // dernière liste, miniatures, factures ouvertes : consultation hors-ligne
const MAX_FILES = 200;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k))))
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
  if (/\/f\/\d+\//.test(url.pathname)) {               // fichier d'une facture (adresse parlante)
    if (!url.searchParams.has('dl')) e.respondWith(fileNetFirst(req));
    return;
  }
  if (url.searchParams.has('a')) {
    const a = url.searchParams.get('a');
    if (a === 'list') return e.respondWith(listFirst(req));
    if (a === 'thumb') return e.respondWith(staleWhileRevalidate(req));
    if (a === 'file' && !url.searchParams.has('dl')) return e.respondWith(fileNetFirst(req));
    return;                                               // le reste de l'API : jamais en cache
  }
  const keep = req.mode === 'navigate' || /\.(css|js|png|webmanifest)$/.test(url.pathname) || /icon\.php|manifest/.test(url.pathname);
  if (!keep) return;
  e.respondWith(fetch(req).then(r => {
    if (r.ok && !r.redirected) { const cp = r.clone(); caches.open(CACHE).then(ca => ca.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode !== 'navigate' }).then(c => c || Response.error())));
});

/* Liste : réseau d'abord ; sans réseau, la dernière liste reçue, marquée « hors-ligne » */
async function listFirst(req) {
  const key = new Request(new URL('api.php?a=list', req.url).href);
  try {
    const r = await fetch(req);
    if (r.status === 401) { caches.delete(DATA); return r; }       // déconnecté : on efface la copie
    if (r.ok) { const cp = r.clone(); const body = await cp.blob();
      caches.open(DATA).then(c => c.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'X-FLP-Saved': new Date().toISOString() } }))); }
    return r;
  } catch (err) {
    const c = await caches.open(DATA).then(ca => ca.match(key));
    if (!c) throw err;
    const j = await c.json();
    j.offline = c.headers.get('X-FLP-Saved') || true;
    return new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } });
  }
}
/* Miniatures : la copie tout de suite, mise à jour en arrière-plan */
async function staleWhileRevalidate(req) {
  const ca = await caches.open(DATA), hit = await ca.match(req);
  const net = fetch(req).then(r => { if (r.ok) ca.put(req, r.clone()); return r; }).catch(() => null);
  return hit || (await net) || Response.error();
}
/* Factures ouvertes : réseau d'abord, gardées pour pouvoir les rouvrir sans réseau */
async function fileNetFirst(req) {
  const ca = await caches.open(DATA);
  try {
    const r = await fetch(req);
    if (r.ok) { await ca.put(req, r.clone()); trim(ca); }
    return r;
  } catch (err) {
    const hit = await ca.match(req);
    if (hit) return hit;
    throw err;
  }
}
async function trim(ca) {
  const ks = (await ca.keys()).filter(k => /[?&]a=file|\/f\/\d+\//.test(k.url));
  for (let i = 0; i < ks.length - MAX_FILES; i++) await ca.delete(ks[i]);
}
self.addEventListener('message', e => { if (e.data === 'flp-oublier') caches.delete(DATA); });
