// Box Office History lookups, client-side: static JSON behind CloudFront with
// CORS open, so the page fetches it directly. Two small requests per film
// (TMDB id → archive id, then the film), cached on the device for a month —
// the archive's data changes a few times a year. Never throws: a film page
// must not break over box office history.
import { ARCHIVE_API } from '../assets/javascript/boxOfficeHistory.js';
import { loadSnapshot, saveSnapshot } from './offlineStore.js';

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// This year's weekend calendar grows every week (the archive refreshes on
// Wednesdays), so a month-old copy hides every weekend since (2026-10-21).
const CURRENT_YEAR_TTL_MS = 24 * 60 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 10000;
const pending = new Map();

const readCache = (key, now, maxAge = null) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const cached = JSON.parse(raw);
    const ttl = maxAge ?? (cached.value ? FOUND_TTL_MS : MISSING_TTL_MS);
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
    console.warn('Box Office History lookup failed:', error?.message);
    return null;
  }
};

const cached = (key, now, load, maxAge = null) => {
  const hit = readCache(key, now, maxAge);
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
  return cached(`boxOfficeHistory:film:${id}`, now, async () => {
    const hit = await getJson(`lookup/tmdb/${id}.json`);
    if (!hit?.id) return null;
    return getJson(`movies/${encodeURIComponent(hit.id)}.json`);
  });
}

/**
 * The archive's weekends of one year (calendar/<year>.json), or null. This
 * year's file is kept a day, since new weekends land weekly; past years a month.
 */
export function fetchArchiveCalendar (year, { now = Date.now() } = {}) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 1970 || y > 2100) return Promise.resolve(null);
  const maxAge = y >= new Date(now).getFullYear() ? CURRENT_YEAR_TTL_MS : null;
  return cached(`boxOfficeHistory:calendar:${y}`, now, () => getJson(`calendar/${y}.json`), maxAge);
}

// The whole-library index (index/tmdb.json, ~300 KB gzipped, 800 KB as JSON):
// too big for localStorage, so it lives in the offline IndexedDB store, kept
// a month like the film lookups. A stale copy is still used when the archive
// can't be reached: old box office beats none.
const INDEX_SNAPSHOT = ['boxOfficeHistory', 'tmdbIndex'];
const INDEX_TTL_MS = FOUND_TTL_MS;
const INDEX_TIMEOUT_MS = 20000;
let indexRequest = null;

const fetchIndexFile = async () => {
  if (typeof fetch !== 'function') return null;
  try {
    const response = await fetch(`${ARCHIVE_API}/index/tmdb.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(INDEX_TIMEOUT_MS) });
    if (!response.ok || !/json/i.test(response.headers.get('content-type') || '')) return null;
    const index = await response.json();
    return index && typeof index === 'object' && Object.keys(index).length ? index : null;
  } catch (error) {
    console.warn('Box Office History index fetch failed:', error?.message);
    return null;
  }
};

/**
 * Box Office History's whole-library index, keyed by TMDB id (see
 * assets/javascript/boxOfficeIndex.js), or null when it has never been
 * fetched and can't be now. Never throws; one request at a time.
 */
export function fetchArchiveIndex ({ now = Date.now(), load = loadSnapshot, save = saveSnapshot, download = fetchIndexFile } = {}) {
  if (indexRequest) return indexRequest;
  indexRequest = (async () => {
    const stored = await load(...INDEX_SNAPSHOT);
    if (stored?.index && now - (stored.at || 0) <= INDEX_TTL_MS) return stored.index;
    const fresh = await download();
    if (fresh) {
      await save(...INDEX_SNAPSHOT, { at: now, index: fresh });
      return fresh;
    }
    return stored?.index || null;
  })().finally(() => { indexRequest = null; });
  return indexRequest;
}
