// ─── Trawley Coin service worker ─────────────────────────────────────────────
// App shell is cached so both apps open instantly (and offline once visited).
// Firestore/Google API traffic is never intercepted — live sync stays live.

const CACHE = 'trawley-coin-v6';

// Resolve against the SW's own scope so the app works from any subfolder
// (e.g. GitHub Pages at /trawley-coin/), not just a domain root.
const SCOPE = self.registration ? self.registration.scope : './';
const at = (p) => new URL(p, SCOPE).toString();

const PRECACHE = [
  '',
  'index.html',
  'shared/style.css',
  'shared/store.js',
  'shared/config.js',
  'parent/',
  'parent/index.html',
  'parent/app.js',
  'parent/manifest.json',
  'kid/',
  'kid/index.html',
  'kid/app.js',
  'kid/manifest.json',
  'icons/kid.svg',
  'icons/parent.svg',
].map(at);

const ICONS = [
  'icons/kid-192.png', 'icons/kid-512.png', 'icons/kid-180.png',
  'icons/parent-192.png', 'icons/parent-512.png', 'icons/parent-180.png',
].map(at);

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // The app shell must all land, or this version doesn't replace a working
    // cache. Icons are best-effort.
    await c.addAll(PRECACHE);
    await Promise.allSettled(ICONS.map((u) => c.add(u)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) {
      // only our own stale versions — Cache Storage is origin-wide, and the
      // sibling apps (hoop-maths, rail-runner) keep their caches here too
      if (key.startsWith('trawley-coin-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req) {
  const c = await caches.open(CACHE);
  const cached = await c.match(req);
  const fetching = fetch(req)
    .then((res) => {
      if (res && res.ok) c.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await fetching;
  return fresh || Response.error();
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch {
    const cached = await c.match(req);
    if (cached) return cached;
    // Only page loads fall back to the shell — never scripts, styles or images,
    // which would otherwise receive HTML and break the page.
    if (req.mode === 'navigate') {
      const path = new URL(req.url).pathname;
      const shell = (await c.match(at(path.includes('/parent') ? 'parent/index.html' : 'kid/index.html')))
        || (await c.match(at('index.html')));
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Same-origin: always prefer the network so app updates arrive immediately;
  // the cache is the offline fallback.
  if (url.origin === location.origin) {
    e.respondWith(networkFirst(req));
    return;
  }

  // Firebase SDK files from gstatic can be cached for offline starts.
  // Everything else cross-origin (Firestore RPCs, auth) passes straight through.
  if (url.hostname === 'www.gstatic.com') {
    e.respondWith(staleWhileRevalidate(req));
  }
});
