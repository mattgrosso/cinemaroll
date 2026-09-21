// Shared machinery for applying a detected app update.
//
// Bug report (Matt, 2026-08-15): "why show that to them at all... just
// refresh the app automatically when the banner would be presented. The
// banner could still be a fallback." History matters here: an unconditional
// reload-on-update was removed in July for yanking the page out from under
// a long-running backfill — so automatic now means "only at a provably
// quiet moment", and the banner remains for the cases that never get one.

// Waits until no service worker install is in flight, so a reload lands on
// the NEW app instead of a mixed old/new state (the blank-screen bug the
// banner's Refresh already guards against). Capped; failures never block.
//
// Resolves 'settled' when nothing is installing or waiting any more, and
// 'stuck' when the deadline passes with a worker still installing/waiting —
// the caller uses that to skip a reload that would only land on the old app.
export async function waitForNewWorker (timeoutMs = 15000, { getRegistration = defaultGetRegistration, sleep = defaultSleep } = {}) {
  try {
    const registration = await getRegistration();
    if (!registration) return 'settled';
    await registration.update?.().catch?.(() => {});
    const deadline = Date.now() + timeoutMs;
    while ((registration.installing || registration.waiting) && Date.now() < deadline) {
      // A worker sitting in `waiting` has finished installing and only needs
      // permission to take over. The generated worker calls skipWaiting()
      // itself on install, but asking again costs nothing and covers a
      // worker whose own skipWaiting didn't stick.
      registration.waiting?.postMessage?.({ type: 'SKIP_WAITING' });
      await sleep(250);
    }
    return (registration.installing || registration.waiting) ? 'stuck' : 'settled';
  } catch {
    // Any surprise here must never eat the reload itself.
    return 'settled';
  }
}

const defaultGetRegistration = () => navigator.serviceWorker?.getRegistration?.();
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One reload per target bundle before escalating.
//
// Bug report (Matt, 2026-09-21): "something is wrong with the auto refresh
// on a new version... it's like it's stuck. I can push the button. It
// reloads the page, but it still tells me there's a new version, and then
// it tries to reload." A plain reload navigates through the service
// worker's precache, so if the new worker never takes over (an install that
// won't finish, an activation that failed), every reload serves the OLD
// index.html, the deploy check spots the newer bundle again, and round it
// goes. Remembering which target we already reloaded for turns the second
// attempt into a hard reload that doesn't depend on the worker at all.
const RELOAD_KEY = 'update-reload-attempted-for';
const RELOAD_MEMORY_MS = 24 * 60 * 60 * 1000;

function readAttempt (storage) {
  try {
    const raw = storage.getItem(RELOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.target || Date.now() - (parsed.at || 0) > RELOAD_MEMORY_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Called once the running bundle matches the deployed one: the update landed. */
export function markUpdateLanded (storage = window.localStorage) {
  try { storage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
}

export async function reloadForUpdate ({
  target = null,
  storage = window.localStorage,
  reload = () => window.location.reload(),
  hard = hardReload,
  wait = waitForNewWorker
} = {}) {
  const previous = readAttempt(storage);
  const repeat = Boolean(target) && previous?.target === target;
  try { storage.setItem(RELOAD_KEY, JSON.stringify({ target, at: Date.now() })); } catch { /* still reload */ }

  if (repeat) return hard();
  const outcome = await wait();
  if (outcome === 'stuck') return hard();
  reload();
}

/**
 * A reload that cannot land on the stale app.
 *
 * Drops the worker's precache (every cache but the poster cache — those
 * images are still good, and re-downloading a library's worth of them is
 * the one cost worth avoiding) and navigates to a never-before-seen URL,
 * so neither the precache nor the HTTP cache has anything to answer with.
 * The worker is deliberately NOT unregistered: the push subscription lives
 * on the registration, and unregistering would silently end notifications
 * for this phone.
 *
 * With the precache empty, workbox's precache handler falls through to the
 * network for whatever it can't find, so even a worker that never manages
 * to update serves the current deploy from here on.
 */
export async function hardReload ({
  cacheStorage = (typeof caches !== 'undefined' ? caches : null),
  keep = (name) => name === 'tmdb-images',
  replace = (url) => window.location.replace(url),
  href = () => window.location.href
} = {}) {
  try {
    if (cacheStorage) {
      const names = await cacheStorage.keys();
      await Promise.all(names.filter((name) => !keep(name)).map((name) => cacheStorage.delete(name).catch(() => {})));
    }
  } catch {
    // Couldn't clear — the fresh URL below still bypasses the HTTP cache.
  }
  const url = new URL(href());
  url.searchParams.set('fresh', String(Date.now()));
  replace(url.toString());
}

// The last-seen state of the service worker registration, for bug reports:
// which scripts are installing / waiting / active and whether this page is
// controlled at all. Recorded by App.vue's update check, read by
// bugReports.js — so a "the update is stuck" report carries what the worker
// was doing instead of leaving it to guesswork.
let lastWorkerState = null;

export function recordWorkerState (registration, { controller = navigator.serviceWorker?.controller } = {}) {
  const tail = (worker) => (worker?.scriptURL ? `${worker.state}:${worker.scriptURL.split('/').pop()}` : null);
  lastWorkerState = {
    at: new Date().toISOString(),
    controlled: Boolean(controller),
    installing: tail(registration?.installing),
    waiting: tail(registration?.waiting),
    active: tail(registration?.active)
  };
  return lastWorkerState;
}

export function getLastWorkerState () {
  return lastWorkerState;
}

export function getReloadAttempt (storage = window.localStorage) {
  return readAttempt(storage);
}

// Is RIGHT NOW a safe moment to reload out from under the user?
// Pure-ish and injectable for tests. Unsafe whenever:
//  - a text input is focused (they're typing),
//  - a modal has the body scroll-locked (mid-flow),
//  - they're on a game screen (an in-memory round would be lost).
export function isSafeMomentForReload ({
  activeElement = document.activeElement,
  bodyClassList = document.body.classList,
  routePath = ''
} = {}) {
  const tag = activeElement?.tagName || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return false;
  if (bodyClassList.contains('no-scroll')) return false;
  if (routePath.startsWith('/games/')) return false;
  return true;
}

// One auto-attempt per detected target bundle, ever — if the reload doesn't
// actually get us onto the new version (stuck worker, cache oddity), the
// banner takes over rather than reloading in a loop.
const ATTEMPT_KEY = 'auto-update-attempted-for';

export function shouldAutoAttempt (targetBundle, storage = window.sessionStorage) {
  try {
    if (storage.getItem(ATTEMPT_KEY) === targetBundle) return false;
    storage.setItem(ATTEMPT_KEY, targetBundle);
    return true;
  } catch {
    return true; // storage unavailable: still better to try once than never
  }
}
