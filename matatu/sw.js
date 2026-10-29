// Service worker: saves the app so it opens offline. All paths are relative to this file,
// so it works at the Live Server root now and under /matatu/ when published.
//
// To ship an update, change VERSION. The new worker saves fresh copies and deletes the old caches.
const VERSION = "matatu-v5";
const SHELL = VERSION + "-shell";
const TILES = VERSION + "-tiles";
const MAX_TILES = 150; // map tiles are saved only as they are viewed; the oldest are dropped past this

const SHELL_FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "search.js",
  "map.js",
  "geo.js",
  "routenames.js",
  "corrections.js",
  "manifest.webmanifest",
  "aliases.json",
  "corrections.json",
  "stage-labels.json",
  "data/stages.json",
  "data/routes.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "vendor/leaflet/leaflet.js",
  "vendor/leaflet/leaflet.css",
  "vendor/leaflet/images/layers.png",
  "vendor/leaflet/images/layers-2x.png",
  "vendor/leaflet/images/marker-icon.png",
  "vendor/leaflet/images/marker-icon-2x.png",
  "vendor/leaflet/images/marker-shadow.png",
];

// Data that can change: show the saved copy now, refresh it in the background for next time.
const DATA_FILES = ["data/stages.json", "data/routes.json", "aliases.json", "stage-labels.json", "corrections.json"];

// A blank 1x1 PNG, shown instead of a tile that is neither saved nor reachable (keeps the console quiet).
const BLANK_TILE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !n.startsWith(VERSION + "-")).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles(cache) {
  const keys = await cache.keys(); // oldest first
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(key);
}

async function tile(request) {
  const cache = await caches.open(TILES);
  const saved = await cache.match(request);
  if (saved) return saved;
  try {
    const res = await fetch(request);
    if (res.ok || res.type === "opaque") {
      await cache.put(request, res.clone());
      await trimTiles(cache);
    }
    return res;
  } catch (err) {
    const bytes = Uint8Array.from(atob(BLANK_TILE), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { "Content-Type": "image/png" } });
  }
}

async function refreshing(request) {
  const cache = await caches.open(SHELL);
  const saved = await cache.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => saved);
  return saved || fetching;
}

async function shell(request) {
  const saved = await caches.match(request, { ignoreSearch: true });
  if (saved) return saved;
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode === "navigate") return (await caches.match("index.html")) || Response.error();
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(tile(request));
  } else if (url.origin === self.location.origin) {
    const path = url.pathname.slice(new URL("./", self.location).pathname.length);
    event.respondWith(DATA_FILES.includes(path) ? refreshing(request) : shell(request));
  }
});
