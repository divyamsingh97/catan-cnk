/** Registers the service worker (for PWA install + offline app shell). */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Only register in production builds; the dev server doesn't serve sw.js.
  if (import.meta.env.DEV) return;
  // Skip inside the native (Capacitor) shell: assets are bundled locally and a
  // cached app shell would only get in the way of the native WebView.
  if ("Capacitor" in window) return;

  // Auto-update: when a new service worker takes control, reload the page once
  // so users always get the latest build without manually clearing the cache.
  // Only reload if a controller already existed at load time (i.e. this is a
  // genuine update, not the very first install).
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing || !hadControllerAtLoad) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      // `updateViaCache: "none"` forces the browser to revalidate sw.js on
      // every check instead of serving it from the HTTP cache.
      .register(url, { scope: import.meta.env.BASE_URL, updateViaCache: "none" })
      .then((reg) => {
        // Check for a new version now and then periodically while the app is open.
        reg.update().catch(() => {});
        setInterval(() => reg.update().catch(() => {}), 60 * 1000);
      })
      .catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
  });
}
