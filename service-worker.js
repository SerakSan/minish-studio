'use strict';
const VERSION = 'minish-studio-1.0';
const CACHE = VERSION + ':' + self.registration.scope;
const SHELL = [
  './', './index.html', './studio.css', './maker.css', './studio.js', './library.js', './controls.js', './animation-engine.js', './simple-animation.js', './animation-export.js', './ezlo-switch.js', './ezlo-switch.css', './animation-ui.js', './animation.css', './examples/animation-demo.js', './random-scenes.js', './pwa.js',
  './assets/catalog.js', './assets/pieces.js', './assets/game-ui.js', './assets/full-bosses.js',
  './assets/sprites.js', './assets/curated.js', './assets/legacy-bosses.js', './assets/logo.js', './examples/starter.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './CREDITS.md', './ASSET_RIGHTS.md', './PRIVACY.md'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener('activate', event => {
  const suffix = ':' + self.registration.scope;
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('minish-studio-') || key.startsWith('minish-maker-')) && key.endsWith(suffix) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (!url.href.startsWith(self.registration.scope) || url.origin !== self.location.origin) return;
  const relative = url.href.slice(self.registration.scope.length).split('?')[0];
  // Large optional packs are downloaded normally, rather than copied into browser storage.
  if (/\.zip$/i.test(relative)) return;
  const shell = SHELL.includes('./' + relative) || relative === '';
  if (!shell && !/^(assets|icons|examples)\//.test(relative)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const saved = await cache.match(event.request, { ignoreSearch: true });
    if (saved) return saved;
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type === 'basic') await cache.put(event.request, response.clone());
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw error;
    }
  })());
});
