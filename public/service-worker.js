const LEGACY_CACHE_PREFIX = "face-recognition-cache-";

// Let updates activate after existing app windows close, so camera and
// microphone sessions are never interrupted by a forced worker update.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.allSettled(
        names.filter((name) => name.startsWith(LEGACY_CACHE_PREFIX))
          .map((name) => caches.delete(name))
      ))
      .catch(() => {
        // Storage restrictions must not prevent this network-only worker from activating.
      })
  );
});

// Requests use the browser's normal networking; there is no offline app shell.
