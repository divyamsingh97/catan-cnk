/** Registers the service worker (for PWA install + offline app shell). */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Only register in production builds; the dev server doesn't serve sw.js.
  if (import.meta.env.DEV) return;
  // Skip inside the native (Capacitor) shell: assets are bundled locally and a
  // cached app shell would only get in the way of the native WebView.
  if ("Capacitor" in window) return;
  window.addEventListener("load", () => {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(url, { scope: import.meta.env.BASE_URL }).catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  });
}
