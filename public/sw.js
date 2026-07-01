// Minimal offline-first service worker for the app shell.
// Network-first for navigation (so updates show up), cache-first for assets.
const CACHE = "catan-cnk-v3";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  void event;
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never cache Firebase/Google network calls.
  if (
    url.hostname.includes("googleapis.com") ||
    url.hostname.includes("firebaseio.com") ||
    url.hostname.includes("google.com") ||
    url.hostname.includes("gstatic.com")
  ) {
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r ?? caches.match("index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ??
        fetch(req).then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
    )
  );
});
