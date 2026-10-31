const CACHE_PREFIX = "face-recognition-cache-";
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const APP_BASE = new URL("./", self.location.href);
const INDEX_URL = new URL("index.html", APP_BASE).href;
const ASSET_PATH = new URL("assets/", APP_BASE).pathname;
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.(?:js|mjs|css|wasm|svg|png|jpe?g|webp|gif|ico|woff2?|ttf)$/i;
const APP_SHELL = ["./", "index.html", "manifest.json", "favicon.ico", "logo192.png", "logo512.png"].map(
  (path) => new URL(path, APP_BASE).href
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await cacheShellAssets(cache);
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME
            )
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    request.headers.has("range") ||
    url.origin !== APP_BASE.origin ||
    !url.pathname.startsWith(APP_BASE.pathname)
  ) {
    return;
  }

  if (request.mode === "navigate" || APP_SHELL.includes(url.href)) {
    event.respondWith(networkFirst(request));
  } else if (
    url.pathname.startsWith(ASSET_PATH) && HASHED_ASSET.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheShellAssets(cache) {
  // The first page's scripts load before this worker takes control.
  const shell = await cache.match(INDEX_URL);
  if (!shell) return;
  const html = await shell.text();
  const assets = new Set();
  for (const tag of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const path = tag[0].match(/\s(?:src|href)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!path) continue;
    const url = new URL(path, APP_BASE);
    if (
      url.origin === APP_BASE.origin &&
      url.pathname.startsWith(ASSET_PATH) && HASHED_ASSET.test(url.pathname)
    ) {
      assets.add(url.href);
    }
  }
  await Promise.all([...assets].map((url) => cache.add(url).catch(() => {
    // An unavailable optional asset must not prevent online use of the app.
  })));
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Browser storage restrictions must not prevent online use.
    return undefined;
  }
}

async function storeResponse(cache, request, response) {
  if (cache && response.status === 200) {
    try {
      await cache.put(request, response.clone());
    } catch {
      // A full or unavailable cache must not hide a successful network response.
    }
  }
}

async function cachedResponse(cache, request) {
  try {
    return await cache?.match(
      request.mode === "navigate" ? INDEX_URL : request
    );
  } catch {
    return undefined;
  }
}

async function networkFirst(request) {
  const cache = await openCache();
  try {
    // Revalidate HTML on every visit, even when the worker itself is unchanged.
    const response = await fetch(request, { cache: "no-cache" });
    if (response.status >= 500) {
      return (await cachedResponse(cache, request)) || response;
    }
    if (request.mode !== "navigate") {
      await storeResponse(cache, request, response);
    } else if (response.headers.get("content-type")?.includes("text/html")) {
      await storeResponse(cache, INDEX_URL, response);
    }
    return response;
  } catch {
    return (
      (await cachedResponse(cache, request)) ||
      new Response("This page is not available offline yet.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await openCache();
  const cached = await cachedResponse(cache, request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  await storeResponse(cache, request, response);
  return response;
}
