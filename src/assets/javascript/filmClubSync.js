// Film Club incremental sync, v2 — the pure half (Brian's Movie Log guide,
// 2026-10-06). Beside the legacy `clubFeed/OWNER/SECRET` body lives a sync
// tree at `clubFeedSync/OWNER/SECRET`: a certified snapshot of public movies
// keyed by TMDB id, a journal of change batches, and compact metadata. A
// reader downloads the snapshot once (paged), then only the batches since
// its cursor; an unchanged refresh reads two small values.
//
// Everything here is pure and I/O-free: the client store and the end-of-day
// Lambda hand in what they read and write out what this returns. The Lambda
// twin (aws-lambda/filmClubSync.js, CommonJS) is GENERATED from this file by
// scripts/sync-lambda-twins.mjs; filmClubSync.test.js fails if it is stale.
import { contentRevision } from './feedRevision.js';

export const SYNC_VERSION = 2;
export const MOVIES_PAGE = 250;
export const CHANGES_PAGE = 100;
export const MAX_BATCHES = 500;
export const MAX_MOVIES = 50000;
export const HEX32 = /^[0-9a-f]{32}$/;

// ---------------------------------------------------------------------------
// Keys and tokens
// ---------------------------------------------------------------------------

const PUSH_CHARS = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
let lastPushTime = 0;
let lastRand = [];

/**
 * A Firebase push id — time-ordered, 20 chars — without the SDK, so the
 * Lambda can mint journal keys that sort with the client's. Same algorithm
 * as the SDK's; `randomByte` is injectable for tests.
 */
export function pushId (now = Date.now(), randomByte = () => Math.floor(Math.random() * 64)) {
  let time = now;
  const chars = [];
  for (let i = 7; i >= 0; i -= 1) { chars[i] = PUSH_CHARS.charAt(time % 64); time = Math.floor(time / 64); }
  if (now === lastPushTime) {
    let i = 11;
    while (i >= 0 && lastRand[i] === 63) { lastRand[i] = 0; i -= 1; }
    if (i >= 0) lastRand[i] += 1;
  } else {
    lastRand = Array.from({ length: 12 }, () => randomByte() % 64);
  }
  lastPushTime = now;
  return chars.join('') + lastRand.map((n) => PUSH_CHARS.charAt(n)).join('');
}

/** 32 lowercase hex from 16 random bytes. */
export function hexToken (bytes) {
  return Array.from(bytes).map((b) => (b & 255).toString(16).padStart(2, '0')).join('');
}

const INT32 = /^(0|-?[1-9][0-9]*)$/;
const asInt32 = (key) => {
  if (!INT32.test(key)) return null;
  const n = Number(key);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
};

/** Firebase's key order: 32-bit integer keys first, ascending; then strings. */
export function firebaseKeyCompare (a, b) {
  const ia = asInt32(String(a));
  const ib = asInt32(String(b));
  if (ia !== null && ib !== null) return ia - ib;
  if (ia !== null) return -1;
  if (ib !== null) return 1;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

const FEED_URL = /^(https:\/\/[^/?#]+)(\/.*)\/clubFeed\/([^/?#]+)\/([^/?#]+)\.json(\?[^#]*)?$/;

/** `https://DB/clubFeed/O/S.json[?q]` → its parts, or null when not a Firebase feed URL. */
export function parseFeedUrl (feedUrl) {
  const m = FEED_URL.exec(String(feedUrl || '').replace(/^(https:\/\/[^/?#]+)\/clubFeed\//, '$1//clubFeed/'));
  if (!m) return null;
  const prefix = m[2] === '/' ? '' : m[2];
  return { host: m[1], prefix, owner: m[3], secret: m[4], query: m[5] || '' };
}

/** The sync root URL (`.json`) for a feed URL, or null. */
export function syncRootFor (feedUrl) {
  const p = parseFeedUrl(feedUrl);
  return p ? `${p.host}${p.prefix}/clubFeedSync/${p.owner}/${p.secret}.json${p.query}` : null;
}

/** A child of a `.json` root URL: (`…/S.json?q`, 'meta') → `…/S/meta.json?q`; extra params appended. */
export function childUrl (rootUrl, child, params = '') {
  const m = /^([^?#]+)\.json(\?[^#]*)?$/.exec(String(rootUrl || ''));
  if (!m) return null;
  const query = [m[2] ? m[2].slice(1) : '', params].filter(Boolean).join('&');
  return `${m[1]}/${child}.json${query ? `?${query}` : ''}`;
}

const q = (v) => encodeURIComponent(`"${v}"`);
export const moviesPageParams = (afterKey) => `orderBy=${q('$key')}${afterKey ? `&startAt=${q(afterKey)}` : ''}&limitToFirst=${MOVIES_PAGE}`;
export const changesPageParams = (fromKey, toKey) => `orderBy=${q('$key')}&startAt=${q(fromKey)}&endAt=${q(toKey)}&limitToFirst=${CHANGES_PAGE}`;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const isHex = (s) => typeof s === 'string' && HEX32.test(s);

/** Is this a v2 `meta` a reader may trust? */
export function validateMeta (meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.version !== SYNC_VERSION) return false;
  if (!isHex(meta.epoch) || !isHex(meta.revision) || !isHex(meta.bodyRevision)) return false;
  if (!isInt(meta.sequence, 0, Number.MAX_SAFE_INTEGER)) return false;
  if (typeof meta.cursor !== 'string' || typeof meta.minCursor !== 'string') return false;
  if (!isInt(meta.movieCount, 0, MAX_MOVIES)) return false;
  if (!meta.profile || typeof meta.profile.name !== 'string' || meta.profile.name.length < 1 || meta.profile.name.length > 119) return false;
  if (typeof meta.profile.source !== 'string' || meta.profile.source.length < 1 || meta.profile.source.length > 40) return false;
  if (!Number.isFinite(meta.marker)) return false;
  if (meta.snapshotComplete !== true) return false;
  if (!isInt(meta.changeCount, 0, MAX_BATCHES)) return false;
  return true;
}

const validKey = (key) => /^[1-9][0-9]*$/.test(String(key));

/** A public movie record as the feed carries it, or null. */
export function validMovie (movie, key) {
  if (!movie || typeof movie !== 'object') return false;
  if (!Number.isInteger(movie.tmdbId) || movie.tmdbId <= 0) return false;
  if (key != null && String(movie.tmdbId) !== String(key)) return false;
  if (typeof movie.title !== 'string') return false;
  if (!Number.isFinite(movie.rating) || movie.rating < 0 || movie.rating > 10) return false;
  if (movie.starRating != null && (!Number.isFinite(movie.starRating) || movie.starRating < 0 || movie.starRating > 5)) return false;
  return true;
}

/** The legacy body's movies as a map keyed by TMDB id (the snapshot shape). */
export function moviesMapFromFeed (feed) {
  const map = {};
  (feed?.movies || []).forEach((movie) => {
    if (validMovie(movie)) map[String(movie.tmdbId)] = movie;
  });
  return map;
}

/** A snapshot read back — Firebase may serialize dense numeric keys as an array with null holes. */
export function moviesMapFromSnapshot (raw) {
  const map = {};
  if (!raw) return map;
  if (Array.isArray(raw)) {
    raw.forEach((movie, index) => { if (movie && validMovie(movie, index)) map[String(index)] = movie; });
    return map;
  }
  Object.entries(raw).forEach(([key, movie]) => { if (validKey(key) && validMovie(movie, key)) map[key] = movie; });
  return map;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Whole-record replacements and tombstones that take `prev` to `next`. */
export function diffMovies (prev, next) {
  const upserts = {};
  const deleted = {};
  Object.entries(next).forEach(([key, movie]) => { if (!same(prev[key], movie)) upserts[key] = movie; });
  Object.keys(prev).forEach((key) => { if (!next[key]) deleted[key] = true; });
  return { upserts, deleted, changed: Object.keys(upserts).length + Object.keys(deleted).length };
}

/** The legacy body with its revision and the sync root advertised. */
export function feedWithSync (feed, { revision, syncUrl }) {
  return { ...feed, revision, syncUrl };
}

// The header also carries the publisher's ceremony name (Matt, 2026-10-08:
// Knox's awards showed as "Knox's awards", not the Ollies) — optional, so a
// head without it is as valid as ever.
const ceremonyOf = (profile) => (typeof profile?.awardsName === 'string' ? profile.awardsName.trim().slice(0, 80) : '');

const profileOf = (feed) => {
  const profile = { name: String(feed.name || 'A friend').slice(0, 119) || 'A friend', source: String(feed.source || 'cinemaroll').slice(0, 40) };
  if (ceremonyOf(feed)) profile.awardsName = ceremonyOf(feed);
  return profile;
};

// ---------------------------------------------------------------------------
// Publishing — multi-path updates relative to the database root
// ---------------------------------------------------------------------------

/**
 * A fresh epoch: the whole sync root replaced by `{ meta, movies }` (which
 * also clears any journal) and the legacy body written in the same update.
 */
export function buildRebuild ({ owner, secret, feed, epoch, now = Date.now(), databaseUrl }) {
  const movies = moviesMapFromFeed(feed);
  const revision = contentRevision(feed);
  const syncUrl = `${databaseUrl}/clubFeedSync/${owner}/${secret}.json`;
  const meta = {
    version: SYNC_VERSION,
    epoch,
    revision,
    bodyRevision: revision,
    sequence: 0,
    cursor: '',
    minCursor: '',
    movieCount: Object.keys(movies).length,
    profile: profileOf(feed),
    marker: now,
    snapshotComplete: true,
    changeCount: 0
  };
  const legacy = feedWithSync({ ...feed, marker: now, movieCount: meta.movieCount }, { revision, syncUrl });
  return {
    updates: {
      [`clubFeed/${owner}/${secret}`]: legacy,
      [`clubFeedSync/${owner}/${secret}`]: { meta, movies }
    },
    meta,
    movies,
    legacy
  };
}

/**
 * One journal batch on top of a certified head, or null when nothing in
 * the body moved. `prevMovies` is the snapshot the head certifies (read
 * back, or the publisher's own copy when its revision matches the head).
 * With a full journal, `oldestKey` (from changeIndex, first key) is pruned
 * in the same update.
 */
export function buildAppend ({ owner, secret, feed, prevMeta, prevMovies, newKey, oldestKey = null, now = Date.now(), databaseUrl }) {
  const movies = moviesMapFromFeed(feed);
  const revision = contentRevision(feed);
  // Nothing to say only when the body AND the header agree. A head written
  // by an older publisher can lag the body (2026-10-08: the body carried
  // `awardsName` for a day before the header learned it), and the body's
  // revision never moves for that — so the profile is compared on its own.
  if (revision === prevMeta.bodyRevision && same(profileOf(feed), prevMeta.profile)) return null;
  const diff = diffMovies(prevMovies, movies);
  const syncUrl = `${databaseUrl}/clubFeedSync/${owner}/${secret}.json`;
  const root = `clubFeedSync/${owner}/${secret}`;
  const updates = {};
  const batch = { epoch: prevMeta.epoch, revision, previousRevision: prevMeta.revision, sequence: prevMeta.sequence + 1 };
  if (Object.keys(diff.upserts).length) batch.upserts = diff.upserts;
  if (Object.keys(diff.deleted).length) batch.deleted = diff.deleted;
  Object.entries(diff.upserts).forEach(([key, movie]) => { updates[`${root}/movies/${key}`] = movie; });
  Object.keys(diff.deleted).forEach((key) => { updates[`${root}/movies/${key}`] = null; });

  let { changeCount, minCursor } = prevMeta;
  if (changeCount >= MAX_BATCHES) {
    if (!oldestKey) throw new Error('journal full: the oldest key is needed to prune');
    updates[`${root}/changes/${oldestKey}`] = null;
    updates[`${root}/changeIndex/${oldestKey}`] = null;
    minCursor = oldestKey;
    changeCount = MAX_BATCHES;
  } else {
    changeCount += 1;
  }
  const meta = {
    ...prevMeta,
    revision,
    bodyRevision: revision,
    sequence: batch.sequence,
    cursor: newKey,
    minCursor,
    movieCount: Object.keys(movies).length,
    profile: profileOf(feed),
    marker: now,
    snapshotComplete: true,
    changeCount
  };
  const legacy = feedWithSync({ ...feed, marker: now, movieCount: meta.movieCount }, { revision, syncUrl });
  updates[`${root}/changes/${newKey}`] = batch;
  updates[`${root}/changeIndex/${newKey}`] = true;
  updates[`${root}/meta`] = meta;
  updates[`clubFeed/${owner}/${secret}`] = legacy;
  return { updates, meta, batch, movies, legacy, diff };
}

/** May this head be extended, or must the publisher rebuild? */
export function headIsExtendable ({ meta, legacyRevision, prevMovies }) {
  if (!validateMeta(meta)) return false;
  if (!isHex(legacyRevision) || meta.bodyRevision !== legacyRevision) return false;
  if (prevMovies && Object.keys(prevMovies).length !== meta.movieCount) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * What a refresh must do, from the two small head reads and the cache.
 *   v1         — the head cannot be trusted; use the legacy body
 *   unchanged  — the cache already certifies this head
 *   delta      — apply the journal from the cached cursor to the head
 *   bootstrap  — page the whole snapshot
 */
export function planRefresh ({ cache, meta, legacyRevision }) {
  if (!validateMeta(meta)) return { mode: 'v1', reason: meta == null ? 'no-meta' : 'invalid-meta' };
  if (!isHex(legacyRevision) || legacyRevision !== meta.bodyRevision) return { mode: 'v1', reason: 'body-mismatch' };
  const c = cache;
  if (c && c.meta && validateMeta(c.meta) && c.movies) {
    if (c.meta.epoch === meta.epoch && c.meta.revision === meta.revision && c.meta.cursor === meta.cursor &&
        c.meta.sequence === meta.sequence && c.meta.movieCount === meta.movieCount && c.meta.marker === meta.marker &&
        c.meta.bodyRevision === meta.bodyRevision && same(c.meta.profile, meta.profile) &&
        Object.keys(c.movies).length === meta.movieCount) {
      return { mode: 'unchanged' };
    }
    if (c.meta.epoch !== meta.epoch) return { mode: 'bootstrap', reason: 'epoch' };
    if (meta.minCursor && firebaseKeyCompare(c.meta.cursor, meta.minCursor) < 0) return { mode: 'bootstrap', reason: 'pruned' };
    if (c.meta.sequence > meta.sequence) return { mode: 'bootstrap', reason: 'behind' };
    return { mode: 'delta' };
  }
  return { mode: 'bootstrap', reason: 'no-cache' };
}

/** Fold a snapshot page in: the inclusive boundary dropped, the new last key returned. */
export function mergeMoviesPage (map, page, boundaryKey = null) {
  const entries = Object.entries(moviesMapFromSnapshot(page)).sort(([a], [b]) => firebaseKeyCompare(a, b));
  const next = { ...map };
  let lastKey = boundaryKey;
  let added = 0;
  for (const [key, movie] of entries) {
    if (boundaryKey !== null && key === boundaryKey) continue;
    next[key] = movie;
    lastKey = key;
    added += 1;
  }
  const rawCount = Array.isArray(page) ? page.filter(Boolean).length : Object.keys(page || {}).length;
  return { map: next, lastKey, added, rawCount, done: rawCount < MOVIES_PAGE };
}

export class SyncGapError extends Error {}

/**
 * Apply journal batches (`[{ key, batch }]`, any order) on top of a cached
 * head. Every batch must chain: same epoch, previousRevision equal to the
 * last applied, sequence one greater, valid records and true tombstones.
 */
export function applyBatches (movies, batches, { epoch, revision, sequence, cursor }) {
  const sorted = [...batches].sort((a, b) => firebaseKeyCompare(a.key, b.key));
  let map = { ...movies };
  let head = { revision, sequence, cursor };
  for (const { key, batch } of sorted) {
    if (!batch || typeof batch !== 'object') throw new SyncGapError(`malformed batch ${key}`);
    if (batch.epoch !== epoch) throw new SyncGapError(`epoch changed at ${key}`);
    if (batch.previousRevision !== head.revision) throw new SyncGapError(`branch at ${key}`);
    if (batch.sequence !== head.sequence + 1) throw new SyncGapError(`gap at ${key}`);
    if (!isHex(batch.revision)) throw new SyncGapError(`bad revision at ${key}`);
    const upserts = batch.upserts || {};
    const deleted = batch.deleted || {};
    for (const [id, movie] of Object.entries(upserts)) {
      if (!validKey(id) || !validMovie(movie, id)) throw new SyncGapError(`bad record ${id} at ${key}`);
      if (deleted[id]) throw new SyncGapError(`${id} both upserted and deleted at ${key}`);
    }
    for (const [id, tomb] of Object.entries(deleted)) {
      if (!validKey(id) || tomb !== true) throw new SyncGapError(`bad tombstone ${id} at ${key}`);
    }
    Object.entries(upserts).forEach(([id, movie]) => { map[id] = movie; });
    Object.keys(deleted).forEach((id) => { delete map[id]; });
    head = { revision: batch.revision, sequence: batch.sequence, cursor: key };
  }
  return { movies: map, ...head };
}

/** Does this result match the head exactly? Only then is it cached. */
export function certifies (meta, { movies, revision, sequence, cursor }) {
  return validateMeta(meta) && revision === meta.revision && sequence === meta.sequence &&
    cursor === meta.cursor && Object.keys(movies).length === meta.movieCount;
}

/** A legacy-shaped body from a certified snapshot, for the existing profile builder. */
export function feedFromSync (meta, movies) {
  return {
    format: 'film-club/1',
    source: meta.profile.source,
    name: meta.profile.name,
    ...(ceremonyOf(meta.profile) ? { awardsName: ceremonyOf(meta.profile) } : {}),
    marker: meta.marker,
    movieCount: meta.movieCount,
    revision: meta.bodyRevision,
    movies: Object.keys(movies).sort(firebaseKeyCompare).map((key) => movies[key])
  };
}
