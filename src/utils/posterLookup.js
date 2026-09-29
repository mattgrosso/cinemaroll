// One TMDB /search/movie per title, remembered on the device.
//
// The Showtimes screen (2026-09-28: "I'd rather see movie posters than
// names") gets poster art from most theaters' own feeds; the chains, read
// via CinemaClock, give only a title and a year. This fills those gaps.
// Results - hits AND misses - live in localStorage for a month so a board
// of a hundred films costs one round of lookups per device, not one per
// visit. Same shape as personLookup: module cache + shared in-flight
// promise; a miss resolves to null and never retries in-session.
import ErrorLogService from '../services/ErrorLogService.js';
import { fetchWithTimeout } from './networkHealth.js';

const STORAGE_KEY = 'showtimesPosters';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

const memory = new Map();
const inFlight = new Map();

// "HALLOWEEN (1978) in 35mm" -> { query: 'halloween', year: 1978 }. The
// bracketed year is the strongest hint a repertory title carries; format
// notes and event suffixes only confuse the search.
export function posterQuery (title, year = null) {
  const raw = String(title || '');
  const bracketYear = (/\((\d{4})\)/.exec(raw) || [])[1];
  const query = raw
    .replace(/\((?:[^()]*)\)/g, ' ')
    .replace(/\b(?:in|on)\s+(?:35|70|16)\s*mm\b/gi, ' ')
    .replace(/\b(?:new\s+)?(?:4k\s+)?restoration\b/gi, ' ')
    .replace(/\s*[-–:]\s*(?:new restoration|encore|advance screening)\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–:]+$/, '')
    .trim();
  return { query, year: Number(bracketYear) || (Number.isInteger(year) ? year : null) };
}

const cacheKey = ({ query, year }) => `${query.toLowerCase()}|${year || ''}`;

function readStore () {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore (store) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch { /* private mode or full */ }
}

export async function lookupPoster (title, year = null) {
  const q = posterQuery(title, year);
  if (!q.query) return null;
  const key = cacheKey(q);
  if (memory.has(key)) return memory.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const store = readStore();
  const cached = store[key];
  if (cached && Number(cached.at) > Date.now() - TTL_MS) {
    memory.set(key, cached.url || null);
    return cached.url || null;
  }

  const params = new URLSearchParams({ api_key: process.env.VUE_APP_TMDB_API_KEY, query: q.query, include_adult: 'false' });
  if (q.year) params.set('year', String(q.year));
  const lookup = (async () => {
    try {
      const response = await fetchWithTimeout(`https://api.themoviedb.org/3/search/movie?${params}`);
      if (!response.ok) throw new Error(`TMDB search/movie returned ${response.status}`);
      const data = await response.json();
      const hit = (data?.results || []).find((r) => r.poster_path) || null;
      return hit ? `${POSTER_BASE}${hit.poster_path}` : null;
    } catch (error) {
      ErrorLogService.error('Error fetching TMDB poster:', error);
      return null;
    }
  })().then((url) => {
    memory.set(key, url);
    inFlight.delete(key);
    const next = readStore();
    next[key] = { url, at: Date.now() };
    writeStore(next);
    return url;
  });
  inFlight.set(key, lookup);
  return lookup;
}
