// Self-heal for the mixed-version window around a deploy.
//
// Every route in this app is a lazy webpack chunk. When a new service worker
// activates (skipWaiting + clientsClaim) it purges the old precache — so a
// page still running the OLD app bundle can no longer load any chunk it
// hasn't already fetched: the old chunk files are gone from cache and from
// the server. Navigation then fails and the router renders nothing below the
// header ("the site is pretty broken"). A reload gets the new index.html and
// a self-consistent set of chunks, so that's the recovery — guarded to fire
// once per route per session so a genuinely-missing chunk can't reload-loop.

export function isStaleChunkError (error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  // Webpack: "Loading chunk N failed" / "Loading CSS chunk N failed".
  // Safari/Firefox dynamic-import wording differs, hence the alternates.
  // Vite (since the 2026-09-14 move) fails a screen whose stylesheet is gone
  // with "Unable to preload CSS for /css/X.css" (Sentry, 2026-10-08: Login,
  // Chrome on Windows), and Chrome words a missing module "Failed to fetch
  // dynamically imported module".
  return /Loading (CSS )?chunk .* failed|(error loading|failed to fetch) dynamically imported module|Importing a module script failed|Unable to preload CSS/i
    .test(error.message || '');
}

export function handleRouterChunkError (
  error,
  to,
  storage = window.sessionStorage,
  reload = () => window.location.reload()
) {
  if (!isStaleChunkError(error)) return false;

  const key = `stale-chunk-reload:${(to && to.fullPath) || ''}`;
  let alreadyTried = false;
  try {
    alreadyTried = Boolean(storage.getItem(key));
    if (!alreadyTried) storage.setItem(key, '1');
  } catch {
    // Storage unavailable (private mode quirks): still reload, just without
    // loop protection — a reload is strictly better than a dead screen.
  }
  if (alreadyTried) return false;

  reload();
  return true;
}

// A screen file that never arrives. Bug report (Matt, 2026-09-30, one bar
// of signal): a request that's left to the network on a there-but-not-really
// connection neither loads nor fails, so the error above never comes and the
// loading bar just sits there. With a service worker in charge every screen
// of the running version is on the phone and opens in well under a second;
// one that hasn't in SCREEN_LOAD_DEADLINE_MS is being fetched from the
// network, which means this page is an older version than the worker's. The
// deadline turns that into the same ChunkLoadError, and the handler above
// reloads onto the version the phone does have. Without a worker (first
// visit, dev server) a slow screen is just slow: no deadline.
export const SCREEN_LOAD_DEADLINE_MS = 8000;

export function lazyScreen (loader, {
  deadlineMs = SCREEN_LOAD_DEADLINE_MS,
  hasWorker = () => Boolean(typeof navigator !== 'undefined' && navigator.serviceWorker?.controller)
} = {}) {
  return () => {
    if (!hasWorker()) return loader();
    let timer = null;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Loading chunk timed out');
        error.name = 'ChunkLoadError';
        reject(error);
      }, deadlineMs);
    });
    return Promise.race([loader(), deadline]).finally(() => clearTimeout(timer));
  };
}
