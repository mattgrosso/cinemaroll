// One TMDB /search/movie per title, remembered on the device.
//
// The Showtimes screen (2026-09-28: "I'd rather see movie posters than
// names") gets poster art from most theaters' own feeds; the chains, read
// via CinemaClock, give only a title and a year. This fills those gaps -
// and, since "it would be nice if the year of the movie was always listed"
// and almost no feed carries one, the release year too.
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

const NONE = Object.freeze({ poster: null, year: null });

/** -> { poster, year } from TMDB, both null on a miss. */
export async function lookupFilm (title, year = null) {
  const q = posterQuery(title, year);
  if (!q.query) return NONE;
  const key = cacheKey(q);
  if (memory.has(key)) return memory.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const store = readStore();
  const cached = store[key];
  // Rows written before the year was kept ('year' in cached) are looked up
  // again once, so the caption gets its year without waiting a month.
  if (cached && 'year' in cached && Number(cached.at) > Date.now() - TTL_MS) {
    const hit = { poster: cached.url || null, year: Number.isInteger(cached.year) ? cached.year : null };
    memory.set(key, hit);
    return hit;
  }

  const params = new URLSearchParams({ api_key: process.env.VUE_APP_TMDB_API_KEY, query: q.query, include_adult: 'false' });
  if (q.year) params.set('year', String(q.year));
  const lookup = (async () => {
    try {
      const response = await fetchWithTimeout(`https://api.themoviedb.org/3/search/movie?${params}`);
      if (!response.ok) throw new Error(`TMDB search/movie returned ${response.status}`);
      const data = await response.json();
      const results = data?.results || [];
      const best = results.find((r) => r.poster_path) || results[0] || null;
      const released = (best && /^(\d{4})/.exec(best.release_date || '') || [])[1];
      return {
        poster: best && best.poster_path ? `${POSTER_BASE}${best.poster_path}` : null,
        year: released ? Number(released) : null
      };
    } catch (error) {
      ErrorLogService.error('Error fetching TMDB film:', error);
      return NONE;
    }
  })().then((hit) => {
    memory.set(key, hit);
    inFlight.delete(key);
    const next = readStore();
    next[key] = { url: hit.poster, year: hit.year, at: Date.now() };
    writeStore(next);
    return hit;
  });
  inFlight.set(key, lookup);
  return lookup;
}

export async function lookupPoster (title, year = null) {
  return (await lookupFilm(title, year)).poster;
}

// "it would be nice if the year of the movie was always listed" - but
// "sometimes it's in the title I think so let's not duplicate". A title
// that already carries any four-digit year ("Halloween (1978)", "Sabrina –
// 1954", "Street Fighter (2026)") is left alone.
export function titleWithYear (title, year) {
  const base = String(title || '').trim();
  if (!Number.isInteger(year) || !base) return base;
  if (/\b(?:18|19|20)\d{2}\b/.test(base)) return base;
  return `${base} (${year})`;
}
