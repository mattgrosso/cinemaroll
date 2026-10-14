// Box Office Archive lookups, client-side: static JSON behind CloudFront with
// CORS open, so the page fetches it directly. Two small requests per film
// (TMDB id → archive id, then the film), cached on the device for a month —
// the archive's data changes a few times a year. Never throws: a film page
// must not break over box office history.
import { ARCHIVE_API } from '../assets/javascript/boxOfficeArchive.js';

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 10000;
const pending = new Map();

const readCache = (key, now) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const cached = JSON.parse(raw);
    const ttl = cached.value ? FOUND_TTL_MS : MISSING_TTL_MS;
    if (now - (cached.at || 0) > ttl) return undefined;
    return cached.value || null;
  } catch {
    return undefined;
  }
};

const writeCache = (key, value, now) => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: now, value: value || null }));
  } catch {
    // Storage full or blocked: the next visit asks again.
  }
};

// The JSON at a path, null for 404 or any failure. The SPA fallback answers
// 200 with HTML for a missing file, which the content type gives away.
const getJson = async (path) => {
  if (typeof fetch !== 'function') return null;
  try {
    // Its own timeout (data-writes.md): a slow outside service must not flip
    // the app offline.
    const response = await fetch(`${ARCHIVE_API}/${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS) });
    if (!response.ok) return null;
    if (!/json/i.test(response.headers.get('content-type') || '')) return null;
    return await response.json();
  } catch (error) {
    console.warn('Box Office Archive lookup failed:', error?.message);
    return null;
  }
};

const cached = (key, now, load) => {
  const hit = readCache(key, now);
  if (hit !== undefined) return Promise.resolve(hit);
  if (pending.has(key)) return pending.get(key);
  const request = (async () => {
    try {
      const value = await load();
      writeCache(key, value, now);
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, request);
  return request;
};

/**
 * The archive's record of a film by TMDB id — the movies/<id>.json object —
 * or null when the archive doesn't know it (most films before 1980, and
 * anything the Wikidata bridge hasn't matched).
 */
export function fetchArchiveFilm (tmdbId, { now = Date.now() } = {}) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
  return cached(`boxOfficeArchive:film:${id}`, now, async () => {
    const hit = await getJson(`lookup/tmdb/${id}.json`);
    if (!hit?.id) return null;
    return getJson(`movies/${encodeURIComponent(hit.id)}.json`);
  });
}

/** The archive's weekends of one year (calendar/<year>.json), or null. */
export function fetchArchiveCalendar (year, { now = Date.now() } = {}) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return Promise.resolve(null);
  return cached(`boxOfficeArchive:calendar:${y}`, now, () => getJson(`calendar/${y}.json`));
}
