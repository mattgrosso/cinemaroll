import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Audit, 2026-10-06: personal awards were 479 KB of the settings node the
// listener downloads on every launch. They moved to their own node with a
// stamp; in memory they are still settings.personalAwards for every reader.
vi.mock('axios');
vi.mock('@sentry/vue');
vi.mock('@/assets/javascript/GetRating.js', () => ({ getRating: vi.fn(() => ({ calculatedTotal: 7 })) }));
const calls = vi.hoisted(() => []);
const dbValues = vi.hoisted(() => ({}));
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn((path, value) => { calls.push(['set', path, value]); return Promise.resolve(); }),
  update: vi.fn((path, value) => { calls.push(['update', path, value]); return Promise.resolve(); }),
  query: vi.fn((t) => t),
  orderByChild: vi.fn(), orderByKey: vi.fn(), startAt: vi.fn(), limitToFirst: vi.fn(), push: vi.fn(() => ({ key: 'k' })),
  get: vi.fn((path) => { calls.push(['get', path]); return Promise.resolve({ val: () => (path in dbValues ? dbValues[path] : null) }); })
}));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(), GoogleAuthProvider: vi.fn(), OAuthProvider: vi.fn(), signInWithPopup: vi.fn(), signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), sendPasswordResetEmail: vi.fn(), sendEmailVerification: vi.fn(() => Promise.resolve()), signOut: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn(); })
}));
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])), removePendingWrite: vi.fn(), updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn((entry) => Promise.resolve({ id: 'queued-id', ...entry }))
}));
const snapshots = vi.hoisted(() => ({}));
vi.mock('@/utils/offlineStore.js', () => ({
  loadSnapshot: vi.fn((key, kind) => Promise.resolve(snapshots[`${key}/${kind}`] ?? null)),
  saveSnapshot: vi.fn((key, kind, data) => { snapshots[`${key}/${kind}`] = data; return Promise.resolve(); })
}));

const KEY = 'someone-example-com';
const awards = { 2024: { categories: { 'best-picture': { winner: 550 } } } };
let store;
beforeEach(async () => {
  vi.resetModules();
  calls.length = 0;
  for (const k of Object.keys(dbValues)) delete dbValues[k];
  for (const k of Object.keys(snapshots)) delete snapshots[k];
  store = (await import('@/store/index.js')).default;
  store.commit('setDatabaseTopKey', KEY);
  store.state.isOnline = true;
  store.state.settingsLoaded = true;
  store.state.dbLoaded = true;
});
afterEach(() => { vi.useRealTimers(); });

describe('personal awards out of the settings node', () => {
  it('ensure: offline copy first; the stamp alone when unchanged; the node only when it moved', async () => {
    snapshots[`${KEY}/personalAwards`] = { data: awards, updatedAt: 100 };
    dbValues[`${KEY}/personalAwardsMeta/updatedAt`] = 100;
    await store.dispatch('ensurePersonalAwards');
    expect(store.state.settings.personalAwards).toEqual(awards);
    expect(calls.filter(([k]) => k === 'get').map(([, p]) => p)).toEqual([`${KEY}/personalAwardsMeta/updatedAt`]);

    calls.length = 0;
    dbValues[`${KEY}/personalAwardsMeta/updatedAt`] = 200;
    dbValues[`${KEY}/personalAwards`] = { ...awards, 2025: { categories: {} } };
    await store.dispatch('ensurePersonalAwards');
    expect(Object.keys(store.state.settings.personalAwards)).toEqual(['2024', '2025']);
    expect(calls.filter(([k]) => k === 'get').map(([, p]) => p)).toEqual([`${KEY}/personalAwardsMeta/updatedAt`, `${KEY}/personalAwards`]);
    expect(snapshots[`${KEY}/personalAwards`].updatedAt).toBe(200);
  });

  it('a settings snapshot without awards keeps the awards already loaded', async () => {
    store.commit('setPersonalAwards', { data: awards, updatedAt: 1 });
    store.commit('setSettings', { tags: {} });
    expect(store.state.settings.personalAwards).toEqual(awards);
    expect(store.state.settings.tags).toEqual({});
  });

  it('save writes the year under personalAwards/ and bumps the stamp; readers see it at once', async () => {
    store.commit('setPersonalAwards', { data: {}, updatedAt: 1 });
    await store.dispatch('savePersonalAwards', { path: '2024', value: awards[2024] });
    expect(store.state.settings.personalAwards[2024]).toEqual(awards[2024]);
    const sets = calls.filter(([k]) => k === 'set').map(([, p]) => p);
    expect(sets).toEqual([`${KEY}/personalAwards/2024`, `${KEY}/personalAwardsMeta/updatedAt`]);
    expect(store.state.personalAwardsStamp).toBeGreaterThan(1);
  });

  it('migration: moves settings/personalAwards to the new node atomically, then deletes the settings copy without blanking the awards', async () => {
    store.commit('setSettings', { personalAwards: awards, tags: {} });
    await store.dispatch('migratePersonalAwards', awards);
    const upd = calls.find(([k]) => k === 'update');
    expect(upd[1]).toBeUndefined();
    expect(upd[2][`${KEY}/personalAwards`]).toEqual(awards);
    expect(typeof upd[2][`${KEY}/personalAwardsMeta/updatedAt`]).toBe('number');
    expect(calls.filter(([k]) => k === 'set').map(([, p, v]) => [p, v])).toEqual([[`${KEY}/settings/personalAwards`, null]]);
    expect(store.state.settings.personalAwards).toEqual(awards);
    // Another device already migrated: only the settings copy goes.
    calls.length = 0;
    dbValues[`${KEY}/personalAwardsMeta/updatedAt`] = 5;
    dbValues[`${KEY}/personalAwards`] = awards;
    await store.dispatch('migratePersonalAwards', awards);
    expect(calls.find(([k]) => k === 'update')).toBeUndefined();
    expect(calls.filter(([k]) => k === 'set')).toHaveLength(1);
  });
});

// Report 2026-10-09 ("I can't see Seth's or Natalie's" awards): a launch
// publishes the Film Club profile as soon as the library and settings are in,
// and the awards load on their own, a moment later. A publish that won the
// race went out with no awards and wiped them from every friend's view.
describe('publishing waits for the awards', () => {
  const won = { 2024: { categories: { bestPicture: { winner: { movieId: 550 } } } } };
  function seed () {
    store.commit('setSettings', { social: { enabled: true, shareRatings: true } });
    store.commit('setMovieLogEntry', {
      key: 'fight-club',
      value: { movie: { id: 550, title: 'Fight Club', release_date: '1999-10-15' }, ratings: [{ date: '2024-06-15' }] }
    });
  }
  const published = () => calls.filter(([k, p]) => k === 'set' && p === `social/profiles/${KEY}`).map(([, , v]) => v);

  it('a publish before the awards have loaded fetches them first and includes them', async () => {
    seed();
    dbValues[`${KEY}/personalAwardsMeta/updatedAt`] = 100;
    dbValues[`${KEY}/personalAwards`] = won;
    await store.dispatch('publishSocialProfile');
    const [profile] = published();
    expect(profile.ratings[550].a).toEqual([{ year: 2024, category: 'bestPicture', label: 'Best Picture', result: 'won' }]);
  });

  it('skips the publish when the awards cannot be read and nothing is cached', async () => {
    seed();
    const firebase = await import('firebase/database');
    firebase.get.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    await store.dispatch('publishSocialProfile');
    expect(published()).toHaveLength(0);
  });
});
