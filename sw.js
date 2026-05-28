// Pulse service worker — minimal, enables PWA installability
// Network-first: the app requires Firebase + Vercel API, so no aggressive caching

const CACHE = "pulse-v1";
const SHELL = ["/", "/index.html", "/style.css", "/app.js", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  // Remove old cache versions
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Always network for: API calls, Firebase, external CDNs
  if (
    url.includes("/api/") ||
    url.includes("firestore.googleapis.com") ||
    url.includes("firebaseapp.com") ||
    url.includes("googleapis.com") ||
    url.includes("gstatic.com") ||
    !url.startsWith(self.location.origin)
  ) {
    return; // let browser handle it normally
  }

  // Network-first for everything else — fall back to cache if offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache fresh responses for the shell files
        if (res.ok && SHELL.some((s) => url.endsWith(s))) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
