/* Semester HQ service worker — offline app shell.
   RULE: whenever a ?v= version bumps in index.html, bump CACHE here too,
   or installed apps keep precaching the old assets. */
'use strict';

const CACHE = 'shq-v1';
const FONT_CACHE = 'shq-fonts';
const SHELL = [
  './',
  './app.css?v=4',
  './app.js?v=4',
  './parsers.js?v=3',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

// The Google Fonts stylesheet is precached because reloads often serve it
// from the browser's memory cache, bypassing the SW — without it offline
// boots lose the @font-face rules even though the .woff2 files are cached.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500;600&display=swap';

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then((c) => c.addAll(SHELL)),
    caches.open(FONT_CACHE).then((c) => c.add(FONT_CSS)).catch(() => {})
  ]).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigations: network-first so updates land, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // Google Fonts: stale-while-revalidate so type survives offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONT_CACHE).then((c) =>
        c.match(req).then((hit) => {
          const refresh = fetch(req).then((res) => { c.put(req, res.clone()); return res; }).catch(() => hit);
          return hit || refresh;
        })
      )
    );
    return;
  }

  // Same-origin assets: cache-first (they're ?v= versioned).
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req))
    );
  }
  // Everything else (api.github.com, jsDelivr pdf.js): untouched.
});
