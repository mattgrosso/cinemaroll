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
    // Capped: on one bar of signal update() sits on the worker script's
    // download for minutes, and this wait is meant to be 15 seconds.
    await Promise.race([
      checkWorkerOnce(registration),
      sleep(Math.min(5000, timeoutMs))
    ]);
    const deadline = Date.now() + timeoutMs;
    while ((registration.installing || registration.waiting) && Date.now() < deadline) {
      // A worker sitting in `waiting` has finished installing and only needs
      // permission to take over. The generated worker calls skipWaiting()
      // itself on install, but asking again costs nothing and covers a
      // worker whose own skipWaiting didn't stick.
      registration.waiting?.postMessage?.({ type: 'SKIP_WAITING' });
      // Wake the moment the new worker moves on, not on the next tick.
      await untilWorkerChanges(registration, sleep(250));
    }
    return (registration.installing || registration.waiting) ? 'stuck' : 'settled';
  } catch {
    // Any surprise here must never eat the reload itself.
    return 'settled';
  }
}

// One "is there a new worker?" check per registration at a time.
//
// Bug report (Matt, 2026-10-01): "The auto refresh is still taking like five
// seconds." The update check asks the worker to look for a new version
// while it compares bundles, and the bundle comparison usually wins - so the
// refresh started straight away and asked the worker AGAIN. The phone queues
// that second check behind the first one's install, and the 5-second cap
// above was all that ended the wait. Now the refresh joins the check already
// under way, and skips asking at all when a new worker is already installing
// or a check has only just finished.
const workerChecks = new WeakMap();
const CHECK_FRESH_MS = 30000;

export function checkWorkerOnce (registration, { now = Date.now } = {}) {
  if (!registration?.update) return Promise.resolve();
  const known = workerChecks.get(registration) || {};
  if (known.promise && now() - known.startedAt < CHECK_FRESH_MS) return known.promise;
  if (registration.installing || registration.waiting) return Promise.resolve();
  if (known.finishedAt && now() - known.finishedAt < CHECK_FRESH_MS) return Promise.resolve();
  const entry = { startedAt: now() };
  entry.promise = Promise.resolve()
    .then(() => registration.update())
    .catch(() => {})
    .finally(() => {
      if (workerChecks.get(registration) === entry) {
        workerChecks.set(registration, { finishedAt: now() });
      }
    });
  workerChecks.set(registration, entry);
  return entry.promise;
}

// Resolves when the installing/waiting worker changes state (or a new one
// turns up), or when `fallback` resolves - whichever comes first.
function untilWorkerChanges (registration, fallback) {
  const targets = [registration, registration.installing, registration.waiting]
    .filter((target) => typeof target?.addEventListener === 'function');
  if (!targets.length) return fallback;
  const eventFor = (target) => (target === registration ? 'updatefound' : 'statechange');
  let wake;
  const changed = new Promise((resolve) => { wake = resolve; });
  targets.forEach((target) => target.addEventListener(eventFor(target), wake));
  return Promise.race([changed, fallback]).finally(() => {
    targets.forEach((target) => target.removeEventListener?.(eventFor(target), wake));
  });
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
export function markUpdateLanded (storage = window.localStorage, { now = Date.now } = {}) {
  try { storage.removeItem(RELOAD_KEY); } catch { /* storage unavailable */ }
  const timing = getUpdateTiming(storage);
  if (timing && timing.landedMs == null) writeTiming(storage, { ...timing, landedMs: now() - timing.at });
}

// How long the last update took, step by step, for bug reports (2026-10-01,
// "still taking like five seconds" - next time there are numbers): when it
// was spotted after opening, how long the wait for the new worker took and
// how it ended, which kind of reload followed, and - written by the NEW
// version once it's running - how long until it landed.
const TIMING_KEY = 'update-timing';

function writeTiming (storage, record) {
  try { storage.setItem(TIMING_KEY, JSON.stringify(record)); } catch { /* storage unavailable */ }
}

export function getUpdateTiming (storage = window.localStorage) {
  try { return JSON.parse(storage.getItem(TIMING_KEY)) || null; } catch { return null; }
}

// Resolves 'reloaded', 'hard', or 'deferred' - the last when a hard reload
// was called for but the connection couldn't carry the new app, so the
// running (cached) app stays put and the banner stays up.
// One update attempt at a time on this page. Bug report (Matt, 2026-09-30):
// the notice still offered "Refresh" while the automatic update was already
// under way, and a tap then counted as a SECOND attempt for the same version
// - which means the slow hard reload. A call while one is running now joins
// it instead.
let attemptInFlight = null;

export function reloadForUpdate (options = {}) {
  if (attemptInFlight) return attemptInFlight;
  attemptInFlight = runReloadForUpdate(options).finally(() => { attemptInFlight = null; });
  return attemptInFlight;
}

async function runReloadForUpdate ({
  target = null,
  storage = window.localStorage,
  reload = () => window.location.reload(),
  hard = hardReload,
  wait = waitForNewWorker,
  canFetchNewApp = newAppIsReachable,
  sinceVisibleMs = null,
  now = Date.now
} = {}) {
  // No known target still counts (2026-09-29 loop): a null target used to
  // go unremembered, so every attempt looked like the first.
  const key = target || 'unknown';
  const previous = readAttempt(storage);
  const repeat = previous?.target === key;
  try { storage.setItem(RELOAD_KEY, JSON.stringify({ target: key, at: Date.now() })); } catch { /* still reload */ }

  // A hard reload throws away the copy of the app on this phone and loads
  // the new one from the internet. Bug report (Matt, 2026-09-30, one bar of
  // signal at his therapist's): the new worker couldn't finish downloading
  // in 15 seconds - of course not, on that connection - so this went hard,
  // and he was left with a half-loaded page and a loading bar for as long
  // as he stayed. Only go hard when the new app can actually be fetched,
  // right now, in a few seconds; otherwise keep the working app and let the
  // worker finish in its own time.
  const goHard = async () => {
    let reachable = false;
    try { reachable = await canFetchNewApp(target); } catch { reachable = false; }
    if (!reachable) return 'deferred';
    await hard();
    return 'hard';
  };

  const at = now();
  const timing = { target: key, at, sinceVisibleMs, waitMs: null, wait: null, result: null };
  const finish = (result) => {
    writeTiming(storage, { ...timing, result });
    return result;
  };

  if (repeat) return finish(await goHard());
  const outcome = await wait();
  timing.waitMs = now() - at;
  timing.wait = outcome;
  if (outcome === 'stuck') return finish(await goHard());
  finish('reloaded');
  reload();
  return 'reloaded';
}

export const NEW_APP_FETCH_TIMEOUT_MS = 10000;

/**
 * Can this connection carry the new app right now? Downloads the new
 * bundle itself (the one big file a hard reload needs first) against a
 * deadline. A success also leaves it in the HTTP cache for the reload.
 */
export async function newAppIsReachable (target, {
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = NEW_APP_FETCH_TIMEOUT_MS
} = {}) {
  const base = (typeof process !== 'undefined' && process.env && process.env.BASE_URL) || '/';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    let bundle = target;
    if (!bundle) {
      const page = await fetchImpl(`${base}index.html?updateCheck=${Date.now()}`, { cache: 'no-store', signal: controller?.signal });
      if (!page.ok) return false;
      bundle = ((await page.text()).match(/js\/app\.[a-z0-9]+\.js/) || [])[0];
      if (!bundle) return false;
    }
    const response = await fetchImpl(`${base}${bundle}`, { signal: controller?.signal });
    if (!response.ok) return false;
    await response.arrayBuffer();
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
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

// Two auto-attempts per detected target bundle per session, then the banner
// takes over rather than reloading in a loop. Bug report (Matt, 2026-09-30):
// with only one, a first try that didn't land (a slow connection deferred
// it, a check that came in late) left the notice sitting there for good.
// The second try for the same version is a repeat as far as reloadForUpdate
// is concerned, so it's the one that stops trusting the worker.
const ATTEMPT_KEY = 'auto-update-attempted-for';
export const AUTO_ATTEMPTS_PER_UPDATE = 2;

export function shouldAutoAttempt (targetBundle, storage = window.sessionStorage) {
  try {
    let previous = null;
    try { previous = JSON.parse(storage.getItem(ATTEMPT_KEY)); } catch { previous = null; }
    const count = previous?.target === targetBundle ? previous.count || 0 : 0;
    if (count >= AUTO_ATTEMPTS_PER_UPDATE) return false;
    storage.setItem(ATTEMPT_KEY, JSON.stringify({ target: targetBundle, count: count + 1 }));
    return true;
  } catch {
    return true; // storage unavailable: still better to try once than never
  }
}

// Apply right away, or wait for a quiet stretch? Bug report (Matt,
// 2026-09-30): "that message used to flash for just an instant and then it
// would always automatically refresh". It used to count as "right away" only
// within 5 seconds of opening, so an update check that took longer than that
// (one took 14 seconds) fell through to waiting for 25 untouched seconds.
// Now: right away as long as nothing has been touched since the app came to
// the front, however long the check took.
export const QUIET_MS = 8000;

export function isFreshMoment ({ now = Date.now(), becameVisibleAt = 0, lastTouchAt = 0 } = {}) {
  if (now - becameVisibleAt < 5000) return true;
  return lastTouchAt <= becameVisibleAt;
}

/**
 * The update check. Asking the service worker to look for a new version
 * and comparing the deployed bundle run side by side; the worker's half is
 * capped. They used to run one after the other, with no cap, so a slow
 * worker download held up noticing the update at all.
 */
export async function runUpdateCheck ({
  refreshWorker,
  checkBundle,
  workerTimeoutMs = 5000,
  sleep = defaultSleep
}) {
  const worker = Promise.race([
    Promise.resolve().then(refreshWorker).catch(() => {}),
    sleep(workerTimeoutMs)
  ]);
  await Promise.all([worker, Promise.resolve().then(checkBundle).catch(() => {})]);
}
