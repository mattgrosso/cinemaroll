// Reading a friend's feed, v2 (Brian's guide §5–§6): two small head reads,
// then nothing, a journal delta, or a paged bootstrap — and a result is
// cached only when it certifies the head exactly. Anything the head cannot
// vouch for falls back to the legacy body, which the caller fetches.
//
// `fetchFn` is injectable; the tests run a fake Firebase REST server.
import {
  syncRootFor, childUrl, moviesPageParams, changesPageParams, planRefresh, mergeMoviesPage, applyBatches,
  certifies, feedFromSync, firebaseKeyCompare, SyncGapError, MOVIES_PAGE, CHANGES_PAGE
} from '../assets/javascript/filmClubSync.js';
import { fetchWithTimeout } from './networkHealth.js';

const REVOKED = new Set([401, 403, 404, 410]);
const MAX_ATTEMPTS = 3;
const MAX_PAGES = 400; // 50,000 movies / 250 per page

class RevokedError extends Error {}
class UnreachableError extends Error {}

// No answer at all (a dropped connection, a timeout) or a server error says
// nothing about the feed. Only a real answer may count as "no meta"
// (Sentry, 2026-10-08: a phone on bad signal reported Brian's feed as
// downgraded and threw away its certified copy).
const isUnreachable = (error) => !error?.status || error.status >= 500;

const readJson = async (fetchFn, url) => {
  const res = await fetchFn(url, { cache: 'no-store' });
  if (!res.ok) {
    const error = new Error(`${res.status} for ${url}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
};

// A 401/403/404/410 on meta is a revocation for a capability that has
// certified v2 before; for one that never has, it is simply a peer without
// v2 (rules not yet upgraded) and the head is "no meta".
//
// The legacy body's `awardsName` is read alongside (Matt, 2026-10-09): Movie
// Log publishes its users' ceremony names there but not in meta.profile, and
// its revision is not known to move on a rename, so the name is compared on
// every refresh. It is a nicety — any failure reading it is simply no name.
async function readHead (fetchFn, syncUrl, feedUrl, established) {
  const metaUrl = childUrl(syncUrl, 'meta');
  const revisionUrl = childUrl(feedUrl, 'revision');
  const [meta, legacyRevision, legacyAwardsName] = await Promise.all([
    readJson(fetchFn, metaUrl).catch((error) => {
      if (isUnreachable(error)) throw new UnreachableError(error.message);
      if (REVOKED.has(error.status) && established) throw new RevokedError(error.message);
      return null;
    }),
    readJson(fetchFn, revisionUrl).catch((error) => { if (isUnreachable(error)) throw new UnreachableError(error.message); return null; }),
    readJson(fetchFn, childUrl(feedUrl, 'awardsName')).then(ceremonyName, () => null)
  ]);
  return { meta, legacyRevision, legacyAwardsName };
}

const ceremonyName = (value) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null);

/**
 * The feed a certified cache stands for. meta.profile's ceremony name wins;
 * the legacy body's fills in when the header has none.
 */
export function feedFromSyncCache (cache) {
  const feed = feedFromSync(cache.meta, cache.movies);
  if (!feed.awardsName && cache.legacyAwardsName) feed.awardsName = cache.legacyAwardsName;
  return feed;
}

async function bootstrap (fetchFn, syncUrl) {
  let map = {};
  let lastKey = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const raw = await readJson(fetchFn, childUrl(syncUrl, 'movies', moviesPageParams(lastKey)));
    const merged = mergeMoviesPage(map, raw, lastKey);
    // A peer that ignores the page size or does not advance is rejected.
    if (merged.rawCount > MOVIES_PAGE) throw new SyncGapError('page size ignored');
    if (!merged.done && merged.added === 0) throw new SyncGapError('page did not advance');
    map = merged.map;
    lastKey = merged.lastKey;
    if (merged.done) return map;
  }
  throw new SyncGapError('too many pages');
}

async function readJournal (fetchFn, syncUrl, fromKey, toKey) {
  const batches = [];
  let start = fromKey;
  let dropBoundary = true;
  for (let page = 0; page < 20; page += 1) {
    const raw = await readJson(fetchFn, childUrl(syncUrl, 'changes', changesPageParams(start, toKey))) || {};
    const keys = Object.keys(raw).sort(firebaseKeyCompare);
    if (keys.length > CHANGES_PAGE) throw new SyncGapError('page size ignored');
    let added = 0;
    for (const key of keys) {
      if (dropBoundary && key === start) continue;
      batches.push({ key, batch: raw[key] });
      added += 1;
    }
    if (keys.length < CHANGES_PAGE) return batches;
    if (!added) throw new SyncGapError('journal page did not advance');
    start = keys[keys.length - 1];
    dropBoundary = true;
  }
  throw new SyncGapError('too many journal pages');
}

/**
 * One refresh of a friend's feed.
 *   { status: 'unchanged' }                      the cache certifies the head
 *   { status: 'updated', cache, feed }           a new certified snapshot
 *   { status: 'v1', cache }                      use the legacy body (cache's cursor invalidated)
 *   { status: 'revoked' }                        an established capability was explicitly denied
 *   { status: 'unreachable', reason }            no answer; keep whatever is cached, fetch nothing else
 * `cache` is `{ feedUrl, syncUrl, meta, movies, establishedV2 }` or null.
 */
export async function refreshExternalFeed ({ feedUrl, cache = null, fetchFn = fetchWithTimeout }) {
  const syncUrl = syncRootFor(feedUrl);
  const established = Boolean(cache?.establishedV2 && cache?.feedUrl === feedUrl);
  const invalidated = { feedUrl, syncUrl, meta: null, movies: null, establishedV2: established };
  if (!syncUrl) return { status: 'v1', cache: null, reason: 'not-a-firebase-feed' };
  const usable = cache && cache.feedUrl === feedUrl && cache.syncUrl === syncUrl && cache.meta && cache.movies ? cache : null;

  let head;
  try {
    head = await readHead(fetchFn, syncUrl, feedUrl, established);
  } catch (error) {
    if (error instanceof RevokedError && established) return { status: 'revoked' };
    if (error instanceof UnreachableError) return { status: 'unreachable', reason: error.message };
    return { status: 'v1', cache: invalidated, reason: `head-unreadable:${error.status || error.message}` };
  }

  let plan = planRefresh({ cache: usable, meta: head.meta, legacyRevision: head.legacyRevision });
  if (plan.mode === 'v1') return { status: 'v1', cache: invalidated, reason: plan.reason };
  if (plan.mode === 'unchanged') {
    // Same movies, but a renamed ceremony is still news (an older cache, which
    // never recorded a name, takes one the first time it is seen).
    if ((usable.legacyAwardsName ?? null) === head.legacyAwardsName) return { status: 'unchanged' };
    const next = { ...usable, legacyAwardsName: head.legacyAwardsName };
    return { status: 'updated', cache: next, feed: feedFromSyncCache(next) };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const target = head.meta;
    let result;
    try {
      if (plan.mode === 'delta') {
        const batches = await readJournal(fetchFn, syncUrl, usable.meta.cursor, target.cursor);
        result = applyBatches(usable.movies, batches, usable.meta);
      } else {
        const movies = await bootstrap(fetchFn, syncUrl);
        result = { movies, revision: target.revision, sequence: target.sequence, cursor: target.cursor };
      }
    } catch (error) {
      if (error instanceof RevokedError || (REVOKED.has(error.status) && established)) return { status: 'revoked' };
      if (!(error instanceof SyncGapError) && isUnreachable(error)) return { status: 'unreachable', reason: error.message };
      if (!(error instanceof SyncGapError)) return { status: 'v1', cache: invalidated, reason: `read-failed:${error.status || error.message}` };
      plan = { mode: 'bootstrap', reason: 'gap' };
      continue;
    }
    // Certify against the head as it is NOW: a publication mid-read must never
    // produce a mixed snapshot.
    try {
      head = await readHead(fetchFn, syncUrl, feedUrl, established);
    } catch (error) {
      if (error instanceof RevokedError && established) return { status: 'revoked' };
      if (error instanceof UnreachableError) return { status: 'unreachable', reason: error.message };
      return { status: 'v1', cache: invalidated, reason: `head-unreadable:${error.status || error.message}` };
    }
    const check = planRefresh({ cache: usable, meta: head.meta, legacyRevision: head.legacyRevision });
    if (check.mode === 'v1') return { status: 'v1', cache: invalidated, reason: check.reason };
    if (head.meta.revision === target.revision && head.meta.cursor === target.cursor && certifies(head.meta, result)) {
      const next = { feedUrl, syncUrl, meta: head.meta, movies: result.movies, establishedV2: true, legacyAwardsName: head.legacyAwardsName };
      return { status: 'updated', cache: next, feed: feedFromSyncCache(next) };
    }
    // The head moved under us (or the stable head is inconsistent): try again from it.
    if (head.meta.revision === target.revision && head.meta.cursor === target.cursor) break;
    plan = check.mode === 'unchanged' ? { mode: 'bootstrap', reason: 'recheck' } : check;
  }
  return { status: 'v1', cache: invalidated, reason: 'could-not-certify' };
}
