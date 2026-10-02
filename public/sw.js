// Offline app shell (Tech_Scope.md §2). The list itself lives in localStorage; this only keeps the app opening offline.
// Pages: network first, so a deploy shows up on the next online open; the cached shell when offline.
// Hashed /assets/*: cache first, they never change. Each fresh page load drops the ones the new shell no longer uses.
const CACHE = "ember-shell";

const assetPaths = (text) => text.match(/\/assets\/[\w.-]+/g) ?? [];

// Vite hashes every file under /assets/, so a path the new shell doesn't reach belongs to an older deploy. The shell
// reaches the fonts only through its CSS, so read the JS and CSS it names too. If any of them can't be read, delete
// nothing: a partial picture would evict files still in use.
async function dropStaleAssets(cache, html) {
  const keep = new Set();
  const todo = assetPaths(html);
  while (todo.length) {
    const path = todo.pop();
    if (keep.has(path)) continue;
    keep.add(path);
    if (!/\.(js|css)$/.test(path)) continue;
    const res = (await cache.match(path)) ?? (await fetch(path));
    if (!res.ok) return;
    todo.push(...assetPaths(await res.text()));
  }
  for (const req of await cache.keys()) {
    const path = new URL(req.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path)) await cache.delete(req);
  }
}

async function refreshShell(res) {
  const cache = await caches.open(CACHE);
  await cache.put("/", res.clone());
  try {
    await dropStaleAssets(cache, await res.text());
  } catch {
    // offline halfway, or the cache is unavailable: the next fresh load tries again
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only our own GETs. The API (phase 2) must always reach the network.
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) e.waitUntil(refreshShell(res.clone()));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
