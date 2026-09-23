// Lie-fi detection: the phone says it has a connection, but nothing answers.
//
// Bug report (Matt, 2026-09-23, from a low-signal area): "I would tell it to
// do something and it would just sit there... my phone thought I had a
// connection, but basically did not." Reproduced with a blackhole proxy
// (every connection accepted, no byte ever returned): navigator.onLine stays
// true, so every `isOnline` branch in the app takes the online path, and
// every TMDB call sat on its spinner forever because nothing had a timeout.
// The offline paths (rate from memory, queue the write, the offline banner)
// were all there - they just never engaged.
//
// This module makes "online" mean "the internet is actually answering":
//   1. Every axios request gets a timeout, so a dead connection fails in
//      REQUEST_TIMEOUT_MS instead of never.
//   2. A timed-out or network-failed request marks the connection STALLED,
//      which flips store.state.isOnline to false - the same flag every
//      offline branch and the banner already key off.
//   3. While stalled, a small probe (a no-store fetch of our own index.html,
//      which the service worker never serves from cache because of the query
//      string) runs every PROBE_INTERVAL_MS; the first one that answers marks
//      the connection reachable again and kicks the pending-write queue.
//   4. Any request that succeeds also clears the stall, and the browser's own
//      'online' event resets the detector (see the setIsOnline mutation).
//
// Firebase's own hung writes report in here too (performDatabaseWrite):
// a database write that can't complete is the strongest lie-fi signal the
// app has.

export const REQUEST_TIMEOUT_MS = 8000;
export const PROBE_INTERVAL_MS = 15000;
export const PROBE_TIMEOUT_MS = 5000;

let installedStore = null;
let probeTimer = null;
let probeFn = null;

const defaultProbe = () => {
  const base = (typeof process !== 'undefined' && process.env && process.env.BASE_URL) || '/';
  return fetch(`${base}index.html?probe=${Date.now()}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
  }).then((response) => response.ok);
};

/** Errors that mean "nothing answered", as opposed to a server saying no. */
export function isStallError (error) {
  if (!error) return false;
  const code = error.code || '';
  const name = error.name || '';
  if (['ECONNABORTED', 'ERR_NETWORK', 'ETIMEDOUT'].includes(code)) return true;
  if (['TimeoutError', 'AbortError'].includes(name)) return true;
  if (error.response) return false; // the server answered, however badly
  return /timed? ?out|network error|failed to fetch|load failed/i.test(error.message || '');
}

function stopProbing () {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
}

async function probeOnce () {
  probeTimer = null;
  if (!installedStore || !installedStore.state.networkStalled) return;
  let reachable = false;
  try {
    reachable = await (probeFn || defaultProbe)();
  } catch {
    reachable = false;
  }
  if (!installedStore.state.networkStalled) return;
  if (reachable) {
    markReachable();
  } else {
    probeTimer = setTimeout(probeOnce, PROBE_INTERVAL_MS);
  }
}

export function markStalled () {
  if (!installedStore || installedStore.state.networkStalled) return;
  installedStore.commit('setNetworkStalled', true);
  stopProbing();
  probeTimer = setTimeout(probeOnce, PROBE_INTERVAL_MS);
}

export function markReachable () {
  if (!installedStore) return;
  stopProbing();
  if (!installedStore.state.networkStalled) return;
  installedStore.commit('setNetworkStalled', false);
  // Whatever queued up while the connection was dead goes now, not on the
  // next unrelated trigger.
  installedStore.dispatch('flushPendingWrites');
}

/** Report the outcome of any network attempt made outside axios. */
export function reportNetworkOutcome (error) {
  if (!error) {
    markReachable();
  } else if (isStallError(error)) {
    markStalled();
  }
}

/** fetch() with the same timeout and stall reporting as the axios calls. */
export async function fetchWithTimeout (url, options = {}, ms = REQUEST_TIMEOUT_MS) {
  try {
    const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(ms) });
    markReachable();
    return response;
  } catch (error) {
    reportNetworkOutcome(error);
    throw error;
  }
}

/**
 * Wire the detector to the store and to axios. Called once from main.js;
 * `probe` is injectable for tests.
 */
export function installNetworkHealth ({ store, axios, probe = null }) {
  installedStore = store;
  probeFn = probe;
  stopProbing();
  if (axios) {
    axios.defaults.timeout = REQUEST_TIMEOUT_MS;
    axios.interceptors.response.use(
      (response) => { markReachable(); return response; },
      (error) => { reportNetworkOutcome(error); return Promise.reject(error); }
    );
  }
}

/** Test hook: forget the installed store and stop any probe loop. */
export function resetNetworkHealth () {
  stopProbing();
  installedStore = null;
  probeFn = null;
}
