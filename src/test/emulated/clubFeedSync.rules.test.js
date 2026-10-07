import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, get, set, update, query, orderByKey, limitToFirst } from 'firebase/database';

// Film Club v2 rules (Brian's guide §7): public reads only at the exact
// current secret, bounded; the owner writes; strangers neither.
let testEnv;
const OWNER_EMAIL = 'matt@example.com';
const OWNER_KEY = 'matt-example-com';
const SECRET = 'a'.repeat(32);
const HEX = 'b'.repeat(32);
const meta = { version: 2, epoch: HEX, revision: HEX, bodyRevision: HEX, sequence: 0, cursor: '', minCursor: '', movieCount: 1, profile: { name: 'Matt', source: 'cinemaroll' }, marker: 1, snapshotComplete: true, changeCount: 0 };
const movie = { tmdbId: 550, title: 'Fight Club', rating: 8.25 };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'movie-log-8c4d5',
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 }
  });
});
afterAll(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await set(ref(ctx.database(), `${OWNER_KEY}/settings/clubFeedKey`), SECRET);
    await set(ref(ctx.database(), `clubFeed/${OWNER_KEY}/${SECRET}`), { format: 'film-club/1', name: 'Matt', revision: HEX, movies: [movie] });
    await set(ref(ctx.database(), `clubFeedSync/${OWNER_KEY}/${SECRET}`), { meta, movies: { 550: movie }, changes: { k1: { epoch: HEX, revision: HEX, previousRevision: HEX, sequence: 1 } }, changeIndex: { k1: true } });
  });
});

const anon = () => testEnv.unauthenticatedContext().database();
const owner = () => testEnv.authenticatedContext('uid-matt', { email: OWNER_EMAIL, email_verified: true }).database();
const stranger = () => testEnv.authenticatedContext('uid-x', { email: 'x@example.com', email_verified: true }).database();

describe('clubFeedSync rules', () => {
  it('anyone with the current secret reads meta and the legacy revision; a stale secret reads nothing', async () => {
    await assertSucceeds(get(ref(anon(), `clubFeedSync/${OWNER_KEY}/${SECRET}/meta`)));
    await assertSucceeds(get(ref(anon(), `clubFeed/${OWNER_KEY}/${SECRET}/revision`)));
    await assertFails(get(ref(anon(), `clubFeedSync/${OWNER_KEY}/${'c'.repeat(32)}/meta`)));
    await assertFails(get(ref(anon(), `clubFeed/${OWNER_KEY}/${'c'.repeat(32)}`)));
    await assertFails(get(ref(anon(), `clubFeedSync/${OWNER_KEY}`)));
    await assertFails(get(ref(anon(), 'clubFeedSync')));
  });

  it('movies and changes are readable only in bounded key order', async () => {
    const movies = ref(anon(), `clubFeedSync/${OWNER_KEY}/${SECRET}/movies`);
    await assertSucceeds(get(query(movies, orderByKey(), limitToFirst(250))));
    await assertFails(get(query(movies, orderByKey(), limitToFirst(251))));
    await assertFails(get(movies));
    const changes = ref(anon(), `clubFeedSync/${OWNER_KEY}/${SECRET}/changes`);
    await assertSucceeds(get(query(changes, orderByKey(), limitToFirst(100))));
    await assertFails(get(query(changes, orderByKey(), limitToFirst(101))));
    await assertFails(get(changes));
  });

  it('the retention index is the owner\'s alone, two keys at a time', async () => {
    const path = `clubFeedSync/${OWNER_KEY}/${SECRET}/changeIndex`;
    await assertFails(get(query(ref(anon(), path), orderByKey(), limitToFirst(2))));
    await assertFails(get(query(ref(stranger(), path), orderByKey(), limitToFirst(2))));
    await assertSucceeds(get(query(ref(owner(), path), orderByKey(), limitToFirst(2))));
    await assertFails(get(query(ref(owner(), path), orderByKey(), limitToFirst(3))));
  });

  it('the owner publishes atomically across both roots; a stranger cannot touch either', async () => {
    const k2 = 'k2';
    const batch = { epoch: HEX, revision: 'd'.repeat(32), previousRevision: HEX, sequence: 1, deleted: { 550: true } };
    const updates = {
      [`clubFeed/${OWNER_KEY}/${SECRET}`]: { format: 'film-club/1', name: 'Matt', revision: 'd'.repeat(32), movies: [] },
      [`clubFeedSync/${OWNER_KEY}/${SECRET}/movies/550`]: null,
      [`clubFeedSync/${OWNER_KEY}/${SECRET}/changes/${k2}`]: batch,
      [`clubFeedSync/${OWNER_KEY}/${SECRET}/changeIndex/${k2}`]: true,
      [`clubFeedSync/${OWNER_KEY}/${SECRET}/meta`]: { ...meta, revision: 'd'.repeat(32), bodyRevision: 'd'.repeat(32), sequence: 1, cursor: k2, movieCount: 0, changeCount: 1 }
    };
    await assertSucceeds(update(ref(owner()), updates));
    await assertFails(update(ref(stranger()), updates));
    await assertFails(set(ref(anon(), `clubFeedSync/${OWNER_KEY}/${SECRET}/meta`), meta));
  });

  it('rejects a malformed meta, record or tombstone', async () => {
    await assertFails(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/meta`), { ...meta, version: 1 }));
    await assertFails(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/meta`), { ...meta, snapshotComplete: false }));
    await assertFails(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/movies/x`), movie));
    await assertFails(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/movies/551`), { ...movie, tmdbId: 551, rating: 11 }));
    await assertFails(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/changes/k9/deleted/550`), 'yes'));
    await assertSucceeds(set(ref(owner(), `clubFeedSync/${OWNER_KEY}/${SECRET}/movies/551`), { ...movie, tmdbId: 551 }));
  });
});
