let scheduled = false;
let pendingLoad;

function appBase() {
  const base = new URL(import.meta.env.BASE_URL, window.location.href);
  return base.origin === window.location.origin ? base : null;
}

export function register(config) {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || scheduled) return;
  const base = appBase();
  if (!base) return;
  scheduled = true;

  const start = () => {
    pendingLoad = null;
    navigator.serviceWorker.register(new URL("service-worker.js", base).href, {
      scope: base.pathname,
      updateViaCache: "none",
    }).then((registration) => {
      const watchInstallation = () => {
        const worker = registration.installing;
        if (!worker) return;
        const onStateChange = () => {
          if (worker.state !== "installed") return;
          if (navigator.serviceWorker.controller) config?.onUpdate?.(registration);
          else config?.onSuccess?.(registration);
        };
        worker.addEventListener("statechange", onStateChange);
        onStateChange();
      };
      registration.addEventListener("updatefound", watchInstallation);
      watchInstallation();
      if (registration.waiting) config?.onUpdate?.(registration);
    }).catch(() => {
      // The app still works normally when service worker registration is blocked.
    });
  };

  if (document.readyState === "complete") start();
  else {
    pendingLoad = start;
    window.addEventListener("load", start, { once: true });
  }
}

export async function unregister() {
  if (pendingLoad) window.removeEventListener("load", pendingLoad);
  pendingLoad = null;
  scheduled = false;
  if (!("serviceWorker" in navigator)) return;
  const base = appBase();
  if (!base) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration(base.href);
    // An ancestor scope can belong to another app on the same origin.
    if (registration?.scope === base.href) return await registration.unregister();
  } catch {
    // A missing or inaccessible registration needs no further cleanup.
  }
}
