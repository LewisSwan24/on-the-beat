// ON THE BEAT — the shell, kept so the app still opens where there is no
// signal. Pages come from the network when it answers and from here when it
// does not. The socket, the shows and the clips are never kept: what the room
// says is only ever the room's to say, live.

// v2: v1 could have kept the staff page as the shell ('/'), since it keeps every page it fetched there.
const SHELL = 'otb-shell-v2';
const FONTS = 'otb-fonts-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== FONTS).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/clip/'))) return;
  // The staff page is live or nothing, and never the app's shell.
  if (url.origin === location.origin && ['/staff', '/staff/', '/staff.html'].includes(url.pathname)) return;

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== location.origin) return;

  // Built assets carry their hash in the name, so a cached one is never stale.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Everything else: the network first, the shell when it is not there.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (e.request.mode === 'navigate' || url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest'))) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put(e.request.mode === 'navigate' ? '/' : e.request, copy));
    }
    return res;
  }).catch(async () => (await caches.match(e.request.mode === 'navigate' ? '/' : e.request)) || Response.error()));
});
