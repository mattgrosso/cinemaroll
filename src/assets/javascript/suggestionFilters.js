// What every suggestion row on the Watchlist leaves out.
//
// Bug report, 2026-10-08: "The same rules about shorts and... extra features,
// and the other stuff that we may apply to the filmography search bar, we
// should apply to all suggestions on the watchlist page." The filmography box
// HIDES those behind a link, because a filmography is meant to be complete.
// A suggestion row is a recommendation, so here they're simply dropped.
//
// Shorts follow the app's one rule (shorts.js) and the "include short films"
// setting. TMDB's list endpoints (credits, recommendations) carry no runtime,
// so runtimes are looked up once per film and kept — for the session in
// memory, and on the device (deviceCache.js) so a relaunch doesn't ask TMDB
// for the same hundred runtimes again (Sentry N+1, 2026-10-08). A film's
// runtime doesn't change; the age limit only keeps the store from growing.

import { isShort } from './shorts.js';
import { fetchRuntimes } from './personFilmography.js';
import { deviceCache } from '../../utils/deviceCache.js';

const runtimes = new Map();
const storedRuntimes = deviceCache('cinemaRoll.runtimes', {
  maxAgeMs: 180 * 24 * 60 * 60 * 1000,
  maxEntries: 3000
});

/** A film's looked-up runtime, or undefined if it hasn't been. */
export function knownRuntime (id) {
  if (runtimes.has(id)) return runtimes.get(id);
  const stored = storedRuntimes.get(id);
  if (stored !== undefined) runtimes.set(id, stored);
  return stored;
}

/** For tests: forget every runtime looked up so far. */
export function clearRuntimeCache () {
  runtimes.clear();
  storedRuntimes.clear();
}

/**
 * Look up the runtimes not already known. A failed lookup isn't remembered,
 * so the next visit tries again; until then the film counts as not a short.
 */
export async function loadRuntimes (ids, fetchOne, { concurrency = 8 } = {}) {
  const missing = [...new Set(ids || [])].filter((id) => id != null && !runtimes.has(id) && knownRuntime(id) === undefined);
  if (!missing.length) return;
  const fetched = await fetchRuntimes(missing, fetchOne, { concurrency });
  fetched.forEach((runtime, id) => runtimes.set(id, runtime));
  // Only real numbers go to the device: a missing runtime is retried next
  // launch rather than stored as null, which the shorts rule would read as
  // short (null <= 40).
  storedRuntimes.setMany([...fetched].filter(([, runtime]) => Number.isFinite(runtime)));
}

/**
 * Is this suggestion a short? Takes either shape the screen handles: a
 * library entry ({ movie: { runtime } }) or a TMDB result ({ id, runtime? }).
 */
export function isSuggestedShort (media) {
  if (media?.movie) return isShort(media.movie);
  return isShort({ runtime: media?.runtime ?? knownRuntime(media?.id) });
}

/**
 * Anything TMDB flags as a video — music videos, featurettes, making-ofs.
 * (Appearances as "Self" are a cast-credit question, so they're filtered
 * where the credits are read: personFilmography's isAppearance.)
 */
export function isVideoExtra (media) {
  return Boolean(media?.video);
}

/**
 * Did the request ask for shorts? Then "Ask for something" keeps them even
 * with the setting off — asking for shorts and getting none would be silly.
 */
export function asksForShorts (text) {
  return /\bshorts\b|\bshort (film|movie)s?\b/i.test(String(text || ''));
}
