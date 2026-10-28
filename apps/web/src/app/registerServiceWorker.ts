/**
 * Registers the service worker of the production build (`/sw.js`, written by
 * scripts/build.mjs): it keeps the app's shell so that Trail opens without a
 * network, and never touches `/api` (docs/architecture.md §14). Same origin,
 * as the CSP's `worker-src 'self'` allows. A browser without service workers,
 * or one that refuses this one, simply opens Trail from the network.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}
