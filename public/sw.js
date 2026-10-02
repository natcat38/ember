// Offline app shell (Tech_Scope.md §2). The list itself lives in localStorage; this only keeps the app opening offline.
// Pages: network first, so a deploy shows up on the next online open; the cached shell when offline.
// Hashed /assets/*: cache first, they never change. Each fresh page load drops the ones the new shell no longer uses.
// Other static files (manifest, icons): the cached copy now, refreshed in the background for the next open.
const CACHE = "ember-shell";

const assetPaths = (text) => text.match(/\/assets\/[\w.-]+/g) ?? [];

// The shell reaches the fonts only through its CSS, so read the JS and CSS it names too. Whatever isn't cached yet is
// fetched and cached on the way (install uses this to precache, so an offline open right after the first visit has
// everything). Returns every path the shell reaches; throws if one can't be read.
async function walkShell(cache, html) {
  const keep = new Set();
  const todo = assetPaths(html);
  while (todo.length) {
    const path = todo.pop();
    if (keep.has(path)) continue;
    keep.add(path);
    if (!/\.(js|css)$/.test(path)) continue;
    let res = await cache.match(path);
    if (!res) {
      res = await fetch(path);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      await cache.put(path, res.clone());
    }
    todo.push(...assetPaths(await res.text()));
  }
  return keep;
}

// Vite hashes every file under /assets/, so a path the new shell doesn't reach belongs to an older deploy. If the walk
// fails, delete nothing: a partial picture would evict files still in use.
async function dropStaleAssets(cache, html) {
  const keep = await walkShell(cache, html);
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
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch("/");
      if (!res.ok) throw new Error(`/: ${res.status}`);
      await cache.put("/", res.clone());
      // best effort: the shell alone is enough to install; the next fresh load fills in what is missing
      await walkShell(cache, await res.text()).catch(() => {});
    })(),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Web push (ADR-0002, UX_Flows.md §5): tap to open, with no action buttons on any platform. The server sends
// { text, url } encrypted (worker/push.ts). iOS and Chrome drop a subscription that receives a push and shows nothing,
// so a notification is always shown, even for a payload that cannot be read.
const OPEN_EMBER = "Open Ember to see where today stands.";

// Only our own pages: the URL comes out of a payload, and a click must never leave the app.
const ownUrl = (raw) => {
  if (typeof raw !== "string" || !raw) return location.origin + "/";
  try {
    const url = new URL(raw, location.origin);
    return url.origin === location.origin ? url.href : location.origin + "/";
  } catch {
    return location.origin + "/";
  }
};

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = JSON.parse(e.data ? e.data.text() : "") ?? {};
  } catch {
    // a payload that is not our JSON: show the generic line, open the app
  }
  const text = typeof data.text === "string" && data.text ? data.text : OPEN_EMBER;
  e.waitUntil(self.registration.showNotification("Ember", { body: text, icon: "/icon-192.png", data: { url: ownUrl(data.url) } }));
});

// Focus an open Ember window and send it to the notification's page, or open one.
async function openEmber(url) {
  const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
  const win = wins.find((w) => new URL(w.url).origin === location.origin);
  if (win) {
    try {
      return await (await win.focus()).navigate(url);
    } catch {
      // this browser cannot navigate a window it does not control: open a new one
    }
  }
  return clients.openWindow(url);
}

// The link carries `via=push`, so the app can tell a notification tap from Telegram's buttons, which build the same link,
// and show "Not now? Snooze" (UX_Flows.md §5; src/push.ts arrivalFrom).
const tapUrl = (raw) => {
  const url = new URL(ownUrl(raw));
  url.searchParams.set("via", "push");
  return url.href;
};

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(openEmber(tapUrl(e.notification.data && e.notification.data.url)));
});

// Network first, but on a weak signal the OS can take a minute to give up: after NAV_WAIT the cached shell opens and
// the fetch carries on, refreshing the cache for the next visit. The event stays alive until that refresh is done.
const NAV_WAIT = 3000;
async function navigate(e) {
  let settled;
  e.waitUntil(new Promise((r) => (settled = r)));
  const net = fetch(e.request).then(
    (res) => {
      if (res.ok) refreshShell(res.clone()).finally(settled);
      else settled();
      return res;
    },
    (err) => {
      settled();
      throw err;
    },
  );
  net.catch(() => {});
  let timer;
  const late = new Promise((r) => (timer = setTimeout(r, NAV_WAIT, null)));
  try {
    const res = await Promise.race([net, late]);
    if (res) return res;
  } catch {
    // offline: fall through to the cached shell
  } finally {
    clearTimeout(timer);
  }
  return (await caches.match("/")) ?? net;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // Only our own GETs. The API (phase 2) must always reach the network.
  if (req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(navigate(e));
    return;
  }

  // Hashed files never change: cache first. The rest may change under the same name: serve the cached copy and
  // refresh it behind the scenes.
  const hashed = url.pathname.startsWith("/assets/");
  const load = () =>
    fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    });
  e.respondWith(
    caches.match(req).then((hit) => {
      if (!hit) return load();
      if (!hashed) e.waitUntil(load().catch(() => {}));
      return hit;
    }),
  );
});
