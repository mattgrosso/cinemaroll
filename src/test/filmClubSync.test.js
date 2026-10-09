import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  pushId, hexToken, firebaseKeyCompare, parseFeedUrl, syncRootFor, childUrl, moviesPageParams, changesPageParams,
  validateMeta, moviesMapFromFeed, moviesMapFromSnapshot, diffMovies, buildRebuild, buildAppend, headIsExtendable,
  planRefresh, mergeMoviesPage, applyBatches, certifies, feedFromSync, SyncGapError, MAX_BATCHES, MOVIES_PAGE
} from '@/assets/javascript/filmClubSync.js';
import { toCommonJs, TWINS } from '../../scripts/sync-lambda-twins.mjs';
import { profileFromFeed } from '@/assets/javascript/interchange.js';

const require = createRequire(import.meta.url);
const DB = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const EPOCH = 'a'.repeat(32);
const movie = (id, title, rating) => ({ tmdbId: id, title, rating, posterPath: null, year: 1995 });
const feedOf = (movies, name = 'Matt') => ({ format: 'film-club/1', source: 'cinemaroll', name, marker: 1, movieCount: movies.length, movies });

// Brian's Movie Log sync guide (2026-10-06): the certified snapshot, the
// journal, atomic publishes, bounded reads, certification before caching.
describe('filmClubSync — keys and URLs', () => {
  it('mints time-ordered push ids and sorts keys the way Firebase does', () => {
    const a = pushId(1000, () => 0);
    const b = pushId(2000, () => 0);
    expect(a).toHaveLength(20);
    expect(firebaseKeyCompare(a, b)).toBeLessThan(0);
    expect(['b', '10', 'a', '9', '-1'].sort(firebaseKeyCompare)).toEqual(['-1', '9', '10', 'a', 'b']);
    expect(hexToken(new Uint8Array(16))).toBe('0'.repeat(32));
  });

  it('derives the sync root and bounded page URLs from a feed capability URL, query kept', () => {
    const feed = `${DB}/clubFeed/matt/abc.json`;
    expect(parseFeedUrl(feed)).toEqual({ host: DB, prefix: '', owner: 'matt', secret: 'abc', query: '' });
    expect(syncRootFor(feed)).toBe(`${DB}/clubFeedSync/matt/abc.json`);
    expect(syncRootFor('https://x.europe-west1.firebasedatabase.app/clubFeed/o/s.json?ns=x')).toBe('https://x.europe-west1.firebasedatabase.app/clubFeedSync/o/s.json?ns=x');
    expect(syncRootFor('https://example.com/feed.json')).toBeNull();
    expect(childUrl(`${DB}/clubFeedSync/matt/abc.json`, 'meta')).toBe(`${DB}/clubFeedSync/matt/abc/meta.json`);
    expect(childUrl(`${DB}/clubFeedSync/matt/abc.json?ns=x`, 'movies', moviesPageParams(null)))
      .toBe(`${DB}/clubFeedSync/matt/abc/movies.json?ns=x&orderBy=%22%24key%22&limitToFirst=250`);
    expect(moviesPageParams('250')).toBe('orderBy=%22%24key%22&startAt=%22250%22&limitToFirst=250');
    expect(changesPageParams('k1', 'k9')).toBe('orderBy=%22%24key%22&startAt=%22k1%22&endAt=%22k9%22&limitToFirst=100');
  });
});

describe('filmClubSync — publishing', () => {
  const base = feedOf([movie(550, 'Fight Club', 8.25), movie(680, 'Pulp Fiction', 9)]);

  it('a rebuild writes the legacy body and the whole sync root atomically, journal cleared', () => {
    const { updates, meta, legacy } = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
    expect(Object.keys(updates)).toEqual(['clubFeed/matt/abc', 'clubFeedSync/matt/abc']);
    expect(validateMeta(meta)).toBe(true);
    expect(meta).toMatchObject({ version: 2, epoch: EPOCH, sequence: 0, cursor: '', minCursor: '', movieCount: 2, snapshotComplete: true, changeCount: 0, marker: 5, profile: { name: 'Matt', source: 'cinemaroll' } });
    expect(meta.bodyRevision).toBe(meta.revision);
    expect(legacy.revision).toBe(meta.bodyRevision);
    expect(legacy.syncUrl).toBe(`${DB}/clubFeedSync/matt/abc.json`);
    expect(legacy.format).toBe('film-club/1');
    expect(updates['clubFeedSync/matt/abc'].movies['550'].title).toBe('Fight Club');
    expect(updates['clubFeedSync/matt/abc'].changes).toBeUndefined();
  });

  it('an append is one batch: replacements, tombstones, index key, meta and legacy body together — or nothing when the body did not move', () => {
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
    expect(buildAppend({ owner: 'matt', secret: 'abc', feed: base, prevMeta: head.meta, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB })).toBeNull();

    const next = feedOf([movie(550, 'Fight Club', 8.75), movie(949, 'Heat', 9.5)]);
    const out = buildAppend({ owner: 'matt', secret: 'abc', feed: next, prevMeta: head.meta, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB });
    expect(out.batch).toEqual({ epoch: EPOCH, revision: out.meta.revision, previousRevision: head.meta.revision, sequence: 1, upserts: { 550: next.movies[0], 949: next.movies[1] }, deleted: { 680: true } });
    expect(out.updates['clubFeedSync/matt/abc/movies/680']).toBeNull();
    expect(out.updates['clubFeedSync/matt/abc/movies/949'].title).toBe('Heat');
    expect(out.updates['clubFeedSync/matt/abc/changes/k1']).toBe(out.batch);
    expect(out.updates['clubFeedSync/matt/abc/changeIndex/k1']).toBe(true);
    expect(out.updates['clubFeedSync/matt/abc/meta']).toMatchObject({ cursor: 'k1', sequence: 1, changeCount: 1, movieCount: 2, minCursor: '' });
    expect(out.updates['clubFeed/matt/abc'].revision).toBe(out.meta.bodyRevision);
    expect(validateMeta(out.meta)).toBe(true);
  });

  it('a profile-only change still appends a batch with no upserts or deletions', () => {
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
    const out = buildAppend({ owner: 'matt', secret: 'abc', feed: feedOf(base.movies, 'Matthew'), prevMeta: head.meta, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB });
    expect(out.batch.upserts).toBeUndefined();
    expect(out.batch.deleted).toBeUndefined();
    expect(out.meta.profile.name).toBe('Matthew');
  });

  // 2026-10-08: Matt's live header had no awardsName while the body did — the
  // header was written before it learned the field, and the body's revision
  // (which already covered the name) never moved again to carry it over.
  it('a header lagging the body on the profile alone is brought up to date, with an empty batch', () => {
    const named = { ...base, awardsName: 'The Groskers' };
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: named, epoch: EPOCH, now: 5, databaseUrl: DB });
    const stale = { ...head.meta, profile: { name: 'Matt', source: 'cinemaroll' } };
    const out = buildAppend({ owner: 'matt', secret: 'abc', feed: named, prevMeta: stale, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB });
    expect(out).not.toBeNull();
    expect(out.meta.profile).toEqual({ name: 'Matt', source: 'cinemaroll', awardsName: 'The Groskers' });
    expect(out.meta.revision).toBe(stale.revision);
    expect(out.batch).toMatchObject({ sequence: 1, previousRevision: stale.revision, revision: stale.revision });
    expect(out.batch.upserts).toBeUndefined();
    expect(out.batch.deleted).toBeUndefined();
    // And a reader holding the stale head takes that batch as an ordinary delta.
    const applied = applyBatches(head.movies, [{ key: 'k1', batch: out.batch }], { epoch: EPOCH, revision: stale.revision, sequence: 0, cursor: '' });
    expect(certifies(out.meta, applied)).toBe(true);
    // While an identical republish still says nothing.
    expect(buildAppend({ owner: 'matt', secret: 'abc', feed: named, prevMeta: out.meta, prevMovies: out.movies, newKey: 'k2', now: 7, databaseUrl: DB })).toBeNull();
  });

  it('with a full journal, the oldest batch is pruned in the same update and minCursor moves', () => {
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
    const full = { ...head.meta, changeCount: MAX_BATCHES, cursor: 'k500' };
    expect(() => buildAppend({ owner: 'matt', secret: 'abc', feed: feedOf([movie(550, 'Fight Club', 1)]), prevMeta: full, prevMovies: head.movies, newKey: 'k501', databaseUrl: DB })).toThrow(/oldest/);
    const out = buildAppend({ owner: 'matt', secret: 'abc', feed: feedOf([movie(550, 'Fight Club', 1)]), prevMeta: full, prevMovies: head.movies, newKey: 'k501', oldestKey: 'k1', databaseUrl: DB });
    expect(out.updates['clubFeedSync/matt/abc/changes/k1']).toBeNull();
    expect(out.updates['clubFeedSync/matt/abc/changeIndex/k1']).toBeNull();
    expect(out.meta.minCursor).toBe('k1');
    expect(out.meta.changeCount).toBe(MAX_BATCHES);
  });

  it('a head is extendable only when valid, bound to the legacy revision, and the snapshot count agrees', () => {
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
    expect(headIsExtendable({ meta: head.meta, legacyRevision: head.meta.bodyRevision, prevMovies: head.movies })).toBe(true);
    expect(headIsExtendable({ meta: head.meta, legacyRevision: 'f'.repeat(32), prevMovies: head.movies })).toBe(false);
    expect(headIsExtendable({ meta: head.meta, legacyRevision: head.meta.bodyRevision, prevMovies: {} })).toBe(false);
    expect(headIsExtendable({ meta: null, legacyRevision: head.meta.bodyRevision })).toBe(false);
  });
});

describe('filmClubSync — reading', () => {
  const base = feedOf([movie(550, 'Fight Club', 8.25), movie(680, 'Pulp Fiction', 9)]);
  const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: base, epoch: EPOCH, now: 5, databaseUrl: DB });
  const cache = { meta: head.meta, movies: head.movies };

  it('plans: v1 when the head cannot be trusted, unchanged when the cache certifies it, delta or bootstrap otherwise', () => {
    expect(planRefresh({ cache: null, meta: null, legacyRevision: head.meta.bodyRevision }).mode).toBe('v1');
    expect(planRefresh({ cache, meta: head.meta, legacyRevision: 'f'.repeat(32) }).mode).toBe('v1');
    expect(planRefresh({ cache, meta: { ...head.meta, snapshotComplete: false }, legacyRevision: head.meta.bodyRevision }).mode).toBe('v1');
    expect(planRefresh({ cache, meta: head.meta, legacyRevision: head.meta.bodyRevision }).mode).toBe('unchanged');
    expect(planRefresh({ cache: null, meta: head.meta, legacyRevision: head.meta.bodyRevision })).toEqual({ mode: 'bootstrap', reason: 'no-cache' });
    const moved = { ...head.meta, revision: 'b'.repeat(32), bodyRevision: 'b'.repeat(32), sequence: 1, cursor: 'k1', changeCount: 1 };
    expect(planRefresh({ cache, meta: moved, legacyRevision: 'b'.repeat(32) }).mode).toBe('delta');
    expect(planRefresh({ cache, meta: { ...moved, epoch: 'c'.repeat(32) }, legacyRevision: 'b'.repeat(32) })).toEqual({ mode: 'bootstrap', reason: 'epoch' });
    // Pruned past the cache: bootstrap. Exactly at minCursor: still a delta.
    const cached = { meta: { ...moved, cursor: 'k5' }, movies: head.movies };
    expect(planRefresh({ cache: cached, meta: { ...moved, cursor: 'k9', minCursor: 'k6' }, legacyRevision: 'b'.repeat(32) })).toEqual({ mode: 'bootstrap', reason: 'pruned' });
    expect(planRefresh({ cache: cached, meta: { ...moved, cursor: 'k9', minCursor: 'k5' }, legacyRevision: 'b'.repeat(32) }).mode).toBe('delta');
  });

  it('merges snapshot pages dropping the inclusive boundary, in Firebase key order, and accepts the array form', () => {
    const page1 = { 550: movie(550, 'A', 1), 680: movie(680, 'B', 2) };
    const r1 = mergeMoviesPage({}, page1, null);
    expect(Object.keys(r1.map)).toEqual(['550', '680']);
    expect(r1.lastKey).toBe('680');
    expect(r1.done).toBe(true);
    const r2 = mergeMoviesPage(r1.map, { 680: movie(680, 'B', 2), 949: movie(949, 'C', 3) }, '680');
    expect(r2.added).toBe(1);
    expect(Object.keys(r2.map)).toEqual(['550', '680', '949']);
    const arr = []; arr[3] = movie(3, 'Three', 5); arr[7] = movie(7, 'Seven', 6);
    expect(Object.keys(moviesMapFromSnapshot(arr))).toEqual(['3', '7']);
    expect(moviesMapFromSnapshot({ 5: movie(6, 'wrong key', 1), x: movie(1, 'bad key', 1) })).toEqual({});
    expect(mergeMoviesPage({}, Object.fromEntries(Array.from({ length: MOVIES_PAGE }, (_, i) => [String(i + 1), movie(i + 1, 't', 1)]))).done).toBe(false);
  });

  it('applies a chained journal and certifies the result; any gap, branch or bad record bootstraps', () => {
    const next = feedOf([movie(550, 'Fight Club', 8.75), movie(949, 'Heat', 9.5)]);
    const a1 = buildAppend({ owner: 'matt', secret: 'abc', feed: next, prevMeta: head.meta, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB });
    const later = feedOf([movie(550, 'Fight Club', 8.75)]);
    const a2 = buildAppend({ owner: 'matt', secret: 'abc', feed: later, prevMeta: a1.meta, prevMovies: a1.movies, newKey: 'k2', now: 7, databaseUrl: DB });
    const result = applyBatches(head.movies, [{ key: 'k2', batch: a2.batch }, { key: 'k1', batch: a1.batch }], head.meta);
    expect(Object.keys(result.movies)).toEqual(['550']);
    expect(result.movies['550'].rating).toBe(8.75);
    expect(certifies(a2.meta, result)).toBe(true);
    expect(certifies(a1.meta, result)).toBe(false);
    expect(() => applyBatches(head.movies, [{ key: 'k2', batch: a2.batch }], head.meta)).toThrow(SyncGapError);
    expect(() => applyBatches(head.movies, [{ key: 'k1', batch: { ...a1.batch, epoch: 'c'.repeat(32) } }], head.meta)).toThrow(/epoch/);
    expect(() => applyBatches(head.movies, [{ key: 'k1', batch: { ...a1.batch, deleted: { 680: 'yes' } } }], head.meta)).toThrow(/tombstone/);
    expect(() => applyBatches(head.movies, [{ key: 'k1', batch: { ...a1.batch, upserts: { 949: movie(950, 'wrong', 1) } } }], head.meta)).toThrow(/bad record/);
    const feed = feedFromSync(a2.meta, result.movies);
    expect(feed).toMatchObject({ format: 'film-club/1', name: 'Matt', movieCount: 1, revision: a2.meta.bodyRevision });
    expect(feed.movies.map((m) => m.tmdbId)).toEqual([550]);
  });

  it('diffs whole records and tolerates an invalid record in a legacy body', () => {
    expect(diffMovies({ 1: movie(1, 'a', 1) }, { 1: movie(1, 'a', 1) }).changed).toBe(0);
    expect(diffMovies({ 1: movie(1, 'a', 1) }, { 1: movie(1, 'a', 2), 2: movie(2, 'b', 1) })).toMatchObject({ changed: 2, deleted: {} });
    expect(Object.keys(moviesMapFromFeed(feedOf([movie(1, 'ok', 5), { tmdbId: 'x', title: 'bad', rating: 1 }])))).toEqual(['1']);
  });
});

describe('the Lambda twin', () => {
  it('is generated from the ESM source and up to date', () => {
    for (const [from, to] of TWINS) {
      expect(readFileSync(to, 'utf8')).toBe(toCommonJs(readFileSync(from, 'utf8')));
    }
    const twin = require('../../aws-lambda/filmClubSync.js');
    const feed = feedOf([movie(550, 'Fight Club', 8.25)]);
    expect(twin.buildRebuild({ owner: 'm', secret: 's', feed, epoch: EPOCH, now: 1, databaseUrl: DB }).meta.revision)
      .toBe(buildRebuild({ owner: 'm', secret: 's', feed, epoch: EPOCH, now: 1, databaseUrl: DB }).meta.revision);
  });
});

// Matt, 2026-10-08: Knox's awards on Cinema Roll read "Knox's awards", not
// the Ollies. The v2 header is where a ceremony's name travels now, both ways.
describe('filmClubSync — the ceremony name in the header', () => {
  const named = { ...feedOf([movie(550, 'Fight Club', 8.25)]), awardsName: 'The Groskers' };

  it('a publisher puts its ceremony name in meta.profile, and a feed without one is unchanged', () => {
    const { meta } = buildRebuild({ owner: 'matt', secret: 'abc', feed: named, epoch: EPOCH, now: 5, databaseUrl: DB });
    expect(meta.profile).toEqual({ name: 'Matt', source: 'cinemaroll', awardsName: 'The Groskers' });
    expect(validateMeta(meta)).toBe(true);
    const plain = buildRebuild({ owner: 'matt', secret: 'abc', feed: feedOf([movie(550, 'Fight Club', 8.25)]), epoch: EPOCH, now: 5, databaseUrl: DB });
    expect(plain.meta.profile).toEqual({ name: 'Matt', source: 'cinemaroll' });
  });

  it('renaming the ceremony moves the revision, so the header actually republishes', () => {
    const head = buildRebuild({ owner: 'matt', secret: 'abc', feed: feedOf(named.movies), epoch: EPOCH, now: 5, databaseUrl: DB });
    const out = buildAppend({ owner: 'matt', secret: 'abc', feed: named, prevMeta: head.meta, prevMovies: head.movies, newKey: 'k1', now: 6, databaseUrl: DB });
    expect(out).not.toBeNull();
    expect(out.batch.upserts).toBeUndefined();
    expect(out.meta.profile.awardsName).toBe('The Groskers');
  });

  it('a reader keeps a friend\'s ceremony name from the header (Movie Log, the Ollies)', () => {
    const { meta, movies } = buildRebuild({ owner: 'knox', secret: 'abc', feed: feedOf(named.movies, 'Knox'), epoch: EPOCH, now: 5, databaseUrl: DB });
    const header = { ...meta, profile: { name: 'Knox', source: 'movielog', awardsName: 'The Ollies' } };
    expect(validateMeta(header)).toBe(true);
    const feed = feedFromSync(header, movies);
    expect(feed.awardsName).toBe('The Ollies');
    expect(profileFromFeed(feed, { fallbackName: 'Knox' }).awardsName).toBe('The Ollies');
    expect(feedFromSync(meta, movies).awardsName).toBeUndefined();
  });
});
