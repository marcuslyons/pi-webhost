// pi-webhost service worker — network-first with offline fallback
const CACHE_NAME = "pi-webhost-v1";
const APP_SHELL = ["/", "/index.html"];

// Install: pre-cache the app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: network-first, skip API/WS requests
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don't cache API or WebSocket upgrade requests
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then(
          (cached) =>
            cached ||
            new Response(
              `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>pi-webhost — Offline</title>
  <style>
    body { background: #09090b; color: #a1a1aa; font-family: system-ui; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .container { text-align: center; padding: 2rem; }
    h1 { color: #a78bfa; font-size: 3rem; margin-bottom: 0.5rem; }
    p { font-size: 1.1rem; max-width: 28rem; margin: 0.5rem auto; }
    button { margin-top: 1.5rem; padding: 0.5rem 1.5rem; background: #a78bfa; color: white; border: none; border-radius: 0.5rem; font-size: 1rem; cursor: pointer; }
    button:hover { background: #8b5cf6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>π</h1>
    <p>pi-webhost is offline. The server may be unreachable.</p>
    <p>Check your network connection or restart the server.</p>
    <button onclick="location.reload()">Retry</button>
  </div>
</body>
</html>`,
              { status: 503, headers: { "Content-Type": "text/html" } }
            )
        )
      )
  );
});
