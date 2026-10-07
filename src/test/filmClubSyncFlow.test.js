import { describe, it, expect, beforeEach } from 'vitest';
import { publishFeedV2 } from '@/assets/javascript/filmClubSyncPublisher.js';
import { refreshExternalFeed } from '@/utils/filmClubSyncClient.js';
import { pushId, firebaseKeyCompare, MAX_BATCHES } from '@/assets/javascript/filmClubSync.js';
import { profileFromFeed } from '@/assets/javascript/interchange.js';

// Publisher and reader against a fake Firebase REST database — the guide's
// "required compatibility checks before activation" (§7), end to end.
const DB = 'https://db.firebaseio.com';
const OWNER = 'brian';
const SECRET = 'feedsecret1234567890';
const FEED_URL = `${DB}/clubFeed/${OWNER}/${SECRET}.json`;
const movie = (id, rating = 7, title = `Film ${id}`) => ({ tmdbId: id, title, rating, posterPath: null, year: 2000 });
const feedOf = (movies, name = 'Brian') => ({ format: 'film-club/1', source: 'movielog', name, marker: 1, movieCount: movies.length, movies });

class FakeDb {
  constructor () { this.tree = {}; this.log = []; this.deny = null; this.onRead = null; this.clock = 1700000000000; }
  parts (path) { return String(path).split('/').filter(Boolean); }
  get (path) { let node = this.tree; for (const part of this.parts(path)) { if (node == null || typeof node !== 'object') return null; node = node[part]; } return node === undefined ? null : node; }
  set (path, value) {
    const parts = this.parts(path); let node = this.tree;
    for (const part of parts.slice(0, -1)) { if (node[part] == null || typeof node[part] !== 'object') node[part] = {}; node = node[part]; }
    const last = parts[parts.length - 1];
    if (value === null || value === undefined) delete node[last]; else node[last] = JSON.parse(JSON.stringify(value));
  }
  update (updates) { this.log.push({ update: Object.keys(updates) }); for (const [path, value] of Object.entries(updates)) this.set(path, value); }
  io () {
    const self = this;
    return {
      get: (path) => Promise.resolve(self.get(path)),
      firstIndexKeys: (path) => Promise.resolve(Object.keys(self.get(path) || {}).sort(firebaseKeyCompare).slice(0, 2)),
      update: (updates) => { self.update(updates); return Promise.resolve(); },
      newKey: () => { self.clock += 1; return pushId(self.clock, () => 7); },
      randomHex: () => 'e'.repeat(31) + ((self.log.length % 16).toString(16))
    };
  }
  // REST: /path.json?orderBy="$key"&startAt="k"&endAt="k"&limitToFirst=N
  fetch () {
    const self = this;
    return async (url) => {
      self.log.push({ fetch: url.replace(DB, '') });
      const u = new URL(url);
      const path = u.pathname.replace(/\.json$/, '');
      if (self.deny && path.startsWith(self.deny.path)) return { ok: false, status: self.deny.status, json: async () => null };
      let value = self.get(path);
      if (u.searchParams.get('orderBy') === '"$key"' && value && typeof value === 'object') {
        let keys = Object.keys(value).sort(firebaseKeyCompare);
        const startAt = u.searchParams.get('startAt'); const endAt = u.searchParams.get('endAt'); const limit = Number(u.searchParams.get('limitToFirst'));
        if (startAt) keys = keys.filter((k) => firebaseKeyCompare(k, JSON.parse(startAt)) >= 0);
        if (endAt) keys = keys.filter((k) => firebaseKeyCompare(k, JSON.parse(endAt)) <= 0);
        if (limit) keys = keys.slice(0, limit);
        value = Object.fromEntries(keys.map((k) => [k, value[k]]));
      }
      if (self.onRead) await self.onRead(path);
      return { ok: true, status: 200, json: async () => value };
    };
  }
  reads (kind) { return this.log.filter((e) => e.fetch && e.fetch.includes(`/${kind}`)).length; }
  resetLog () { this.log = []; }
}

let db;
const publish = (movies, extra = {}) => publishFeedV2({ owner: OWNER, secret: SECRET, feed: feedOf(movies, extra.name), databaseUrl: DB, io: db.io(), lastPublished: extra.lastPublished, now: 123 });
const refresh = (cache) => refreshExternalFeed({ feedUrl: FEED_URL, cache, fetchFn: db.fetch() });
const many = (n, rating = 7) => Array.from({ length: n }, (_, i) => movie(i + 1, rating));

beforeEach(() => { db = new FakeDb(); });

describe('Film Club v2 end to end', () => {
  it('1. first connection pages the snapshot (300 movies → 2 pages) and the result is the whole feed', async () => {
    const pub = await publish(many(300));
    expect(pub.mode).toBe('rebuild');
    const r = await refresh(null);
    expect(r.status).toBe('updated');
    expect(Object.keys(r.cache.movies)).toHaveLength(300);
    expect(db.reads('movies')).toBe(2);
    expect(r.feed.movieCount).toBe(300);
    expect(profileFromFeed(r.feed).counts.titles).toBe(300);
    expect(profileFromFeed(r.feed).revision).toBe(r.cache.meta.bodyRevision);
  });

  it('1b. survives an empty feed', async () => {
    await publish([]);
    const r = await refresh(null);
    expect(r.status).toBe('updated');
    expect(r.cache.movies).toEqual({});
    expect(r.feed.movies).toEqual([]);
  });

  it('2. an unchanged refresh reads only meta and the legacy revision', async () => {
    await publish(many(5));
    const first = await refresh(null);
    db.resetLog();
    const again = await refresh(first.cache);
    expect(again.status).toBe('unchanged');
    expect(db.log.map((e) => e.fetch)).toEqual([`/clubFeedSync/${OWNER}/${SECRET}/meta.json`, `/clubFeed/${OWNER}/${SECRET}/revision.json`]);
  });

  it('3. a rating edit, an addition, a deletion and a profile change arrive by delta, never a snapshot page', async () => {
    const first = await publish(many(5));
    const cache = (await refresh(null)).cache;
    const second = await publish([movie(1, 9.5), movie(2), movie(3), movie(4), movie(6)], { lastPublished: first });
    expect(second.mode).toBe('append');
    expect(second.batch.deleted).toEqual({ 5: true });
    expect(Object.keys(second.batch.upserts)).toEqual(['1', '6']);
    const third = await publish([movie(1, 9.5), movie(2), movie(3), movie(4), movie(6)], { name: 'Brian G', lastPublished: second });
    expect(third.mode).toBe('append');
    expect(third.batch.upserts).toBeUndefined();
    db.resetLog();
    const r = await refresh(cache);
    expect(r.status).toBe('updated');
    expect(db.reads('movies')).toBe(0);
    expect(db.reads('changes')).toBe(1);
    expect(r.cache.movies['1'].rating).toBe(9.5);
    expect(r.cache.movies['5']).toBeUndefined();
    expect(r.cache.movies['6'].title).toBe('Film 6');
    expect(r.feed.name).toBe('Brian G');
    // An identical republish writes nothing.
    db.resetLog();
    const same = await publish([movie(1, 9.5), movie(2), movie(3), movie(4), movie(6)], { name: 'Brian G', lastPublished: third });
    expect(same.mode).toBe('unchanged');
    expect(db.log.filter((e) => e.update)).toHaveLength(0);
  });

  it('4. more than 100 batches paginate the journal; 5. more than 500 prune one while a current reader stays incremental', async () => {
    let last = await publish(many(3));
    const cache = (await refresh(null)).cache;
    for (let i = 1; i <= 150; i += 1) last = await publish([movie(1, 1 + (i % 9)), movie(2), movie(3)], { lastPublished: last });
    db.resetLog();
    const r = await refresh(cache);
    expect(r.status).toBe('updated');
    expect(db.reads('changes')).toBe(2);
    expect(db.reads('movies')).toBe(0);
    expect(r.cache.meta.sequence).toBe(150);

    // Up to the cap and past it: the oldest batch goes, minCursor moves,
    // a reader at the head keeps reading deltas.
    for (let i = 151; i <= MAX_BATCHES; i += 1) last = await publish([movie(1, 1 + (i % 9)), movie(2), movie(3)], { lastPublished: last });
    const atHead = await refresh(r.cache);
    expect(atHead.cache.meta.changeCount).toBe(MAX_BATCHES);
    expect(atHead.cache.meta.minCursor).toBe('');
    const journalBefore = Object.keys(db.get(`clubFeedSync/${OWNER}/${SECRET}/changes`)).sort(firebaseKeyCompare);
    last = await publish([movie(1, 0.5), movie(2), movie(3)], { lastPublished: last });
    expect(last.meta.changeCount).toBe(MAX_BATCHES);
    expect(last.meta.minCursor).toBe(journalBefore[0]);
    expect(db.get(`clubFeedSync/${OWNER}/${SECRET}/changes/${journalBefore[0]}`)).toBeNull();
    expect(db.get(`clubFeedSync/${OWNER}/${SECRET}/changeIndex/${journalBefore[0]}`)).toBeNull();
    db.resetLog();
    const stillIncremental = await refresh(atHead.cache);
    expect(stillIncremental.status).toBe('updated');
    expect(db.reads('movies')).toBe(0);

    // A reader whose cursor is exactly minCursor is still valid; one behind it bootstraps.
    const atMin = { ...atHead.cache, meta: { ...atHead.cache.meta } };
    const exactly = { ...atMin, meta: { ...atMin.meta, cursor: last.meta.minCursor, sequence: 1, revision: db.get(`clubFeedSync/${OWNER}/${SECRET}/changes/${journalBefore[1]}`).previousRevision }, movies: { 1: movie(1, 2), 2: movie(2), 3: movie(3) } };
    db.resetLog();
    const fromMin = await refresh(exactly);
    expect(fromMin.status).toBe('updated');
    expect(db.reads('movies')).toBe(0);
    db.resetLog();
    const behind = await refresh({ ...cache, meta: { ...cache.meta, cursor: '', sequence: 0 } });
    expect(behind.status).toBe('updated');
    expect(db.reads('movies')).toBeGreaterThan(0);
  });

  it('6. a publication mid-bootstrap never certifies a mixed snapshot', async () => {
    let last = await publish(many(300));
    let fired = false;
    db.onRead = async (path) => {
      if (!fired && path.endsWith('/movies')) { fired = true; last = await publish([...many(299), movie(300, 2), movie(301)], { lastPublished: last }); }
    };
    const r = await refresh(null);
    expect(r.status).toBe('updated');
    expect(Object.keys(r.cache.movies)).toHaveLength(301);
    expect(r.cache.movies['300'].rating).toBe(2);
    expect(r.cache.meta.revision).toBe(last.meta.revision);
  });

  it('7. a missing batch is detected and the reader bootstraps instead', async () => {
    let last = await publish(many(3));
    const cache = (await refresh(null)).cache;
    for (let i = 1; i <= 3; i += 1) last = await publish([movie(1, i), movie(2), movie(3)], { lastPublished: last });
    const keys = Object.keys(db.get(`clubFeedSync/${OWNER}/${SECRET}/changes`)).sort(firebaseKeyCompare);
    db.set(`clubFeedSync/${OWNER}/${SECRET}/changes/${keys[1]}`, null);
    db.resetLog();
    const r = await refresh(cache);
    expect(r.status).toBe('updated');
    expect(db.reads('movies')).toBe(1);
    expect(r.cache.movies['1'].rating).toBe(3);
  });

  it('8. a v1-only old publisher invalidates v2 certification and stays readable; the next v2 publish rebuilds', async () => {
    const first = await publish(many(3));
    const cache = (await refresh(null)).cache;
    // An old client writes just the legacy body with a new revision.
    db.set(`clubFeed/${OWNER}/${SECRET}`, { ...feedOf(many(4)), revision: 'd'.repeat(32) });
    const r = await refresh(cache);
    expect(r.status).toBe('v1');
    expect(r.cache.meta).toBeNull();
    expect(r.cache.establishedV2).toBe(true);
    const next = await publish(many(4), { lastPublished: first });
    expect(next.mode).toBe('rebuild');
    expect(next.meta.epoch).not.toBe(first.meta.epoch);
    const back = await refresh(r.cache);
    expect(back.status).toBe('updated');
    expect(Object.keys(back.cache.movies)).toHaveLength(4);
  });

  it('9. a peer without v2 rules falls back to v1; an explicit denial of an established capability is a revocation, not a downgrade', async () => {
    db.set(`clubFeed/${OWNER}/${SECRET}`, { ...feedOf(many(2)), revision: 'd'.repeat(32) });
    db.deny = { path: `/clubFeedSync/`, status: 404 };
    const fresh = await refresh(null);
    expect(fresh.status).toBe('v1');
    expect(fresh.cache.establishedV2).toBe(false);
    db.deny = null;
    await publish(many(2));
    const established = (await refresh(null)).cache;
    expect(established.establishedV2).toBe(true);
    db.deny = { path: `/clubFeedSync/`, status: 403 };
    expect((await refresh(established)).status).toBe('revoked');
    // Without a denial, a transient failure is just a v1 refresh.
    db.deny = { path: `/clubFeedSync/`, status: 500 };
    expect((await refresh(established)).status).toBe('v1');
  });

  it('10. the publisher never extends a head whose snapshot count disagrees — it rebuilds', async () => {
    const first = await publish(many(3));
    db.set(`clubFeedSync/${OWNER}/${SECRET}/movies/2`, null); // another client's deletion, meta not updated
    const next = await publish(many(3), { lastPublished: null });
    expect(next.mode).toBe('rebuild');
    expect(next.meta.epoch).not.toBe(first.meta.epoch);
  });
});
