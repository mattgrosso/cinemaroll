// The CinemaScore lookup, client-side: their search endpoint answers any
// origin, the payload is a few dozen bytes, and the grade never changes once
// published. Cached on the device for a month (a week for "no grade", since
// a new release can be polled after its first look here). Never throws: a
// film page must not break over CinemaScore.
import { cinemaScoreSearchUrl, pickCinemaScore } from '../assets/javascript/cinemaScore.js';

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const storageKey = (tmdbId) => `cinemaScore:${tmdbId}`;
const pending = new Map();

const readCache = (tmdbId, now) => {
  try {
    const raw = localStorage.getItem(storageKey(tmdbId));
    if (!raw) return undefined;
    const cached = JSON.parse(raw);
    const ttl = cached.score ? FOUND_TTL_MS : MISSING_TTL_MS;
    if (now - (cached.at || 0) > ttl) return undefined;
    return cached.score || null;
  } catch {
    return undefined;
  }
};

const writeCache = (tmdbId, score, now) => {
  try {
    localStorage.setItem(storageKey(tmdbId), JSON.stringify({ at: now, score: score || null }));
  } catch {
    // Storage full or blocked: the next visit asks again.
  }
};

/**
 * The film's CinemaScore — { grade, year, title } — or null when it has none
 * (or the lookup failed; the two look the same to the page, by design).
 */
export function fetchCinemaScore ({ tmdbId, title, year }, { now = Date.now() } = {}) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0 || !title) return Promise.resolve(null);
  const cached = readCache(id, now);
  if (cached !== undefined) return Promise.resolve(cached);
  if (pending.has(id)) return pending.get(id);

  const request = (async () => {
    if (typeof fetch !== 'function') return null;
    try {
      const response = await fetch(cinemaScoreSearchUrl(title), { headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      const score = pickCinemaScore(await response.json(), { title, year });
      writeCache(id, score, now);
      return score;
    } catch (error) {
      console.warn('CinemaScore lookup failed:', error?.message);
      return null;
    } finally {
      pending.delete(id);
    }
  })();
  pending.set(id, request);
  return request;
}
