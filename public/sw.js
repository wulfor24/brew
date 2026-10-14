// Installable app shell. Every request goes straight to the network (no cache), so a home-screen install
// always runs the latest deploy; if the network is down, the page says so instead of a browser error.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response('<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><body style="font:16px -apple-system,Inter,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#F5F5F4;color:#171717;text-align:center"><div><b>You’re offline</b><p style="color:#666">Brew needs a connection. It will load as soon as you’re back.</p></div>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
