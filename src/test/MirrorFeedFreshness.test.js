import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Imports the REAL store so the actual write path is exercised. Bug report,
// 2026-10-05: Matt rated The Fall, and the Magic Mirror kept showing it as
// "Now Showing". The mirror hides a Movie Hat pick once its TMDB id appears in
// this feed's ratedIds — but the feed was only republished from a six-hourly
// watcher on Home, so a fresh rating never reached it.
vi.mock('axios');
vi.mock('@sentry/vue');
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 }))
}));

const setMock = vi.fn(() => Promise.resolve());
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: (...args) => setMock(...args),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn((target) => target),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  OAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn(); })
}));
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn((entry) => Promise.resolve({ id: 'queued-id', ...entry }))
}));
vi.mock('@/utils/offlineStore.js', () => ({
  loadSnapshot: vi.fn(() => Promise.resolve(null)),
  saveSnapshot: vi.fn()
}));

let store;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  setMock.mockClear();
  localStorage.removeItem('cinemaRoll.mirrorFeed.lastPublish');

  const storeModule = await import('@/store/index.js');
  store = storeModule.default;
  store.commit('setDatabaseTopKey', 'someone-example-com');
  store.state.isOnline = true;
  store.state.settingsLoaded = true;
  store.state.dbLoaded = true;
  store.state.settings = { ...store.state.settings, mirrorFeedKey: 'feedsecret0123456789' };
  store.commit('setMovieLogEntry', {
    key: 'movie-1',
    value: {
      movie: { id: 14784, title: 'The Fall', poster_path: '/f.jpg' },
      ratings: [{ calculatedTotal: 9, date: Date.now() }]
    }
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function mirrorWrites () {
  return setMock.mock.calls.filter(([path]) => typeof path === 'string' && path.startsWith('mirrorFeed/'));
}

describe('publishing the Magic Mirror feed after a rating', () => {
  it('republishes within seconds of a new rating, with the film in ratedIds', async () => {
    await store.dispatch('writeDatabaseEntryNow', {
      path: 'movieLog/movie-1',
      value: { movie: { id: 14784, title: 'The Fall' }, ratings: [] }
    });
    expect(mirrorWrites()).toHaveLength(0); // debounced, not instant

    await vi.advanceTimersByTimeAsync(5000);

    expect(mirrorWrites()).toHaveLength(1);
    const [path, feed] = mirrorWrites()[0];
    expect(path).toBe('mirrorFeed/someone-example-com/feedsecret0123456789');
    expect(feed.ratedIds).toContain(14784);
  });

  it('also covers the general durable-write path', async () => {
    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/ratings', value: [] });
    await vi.advanceTimersByTimeAsync(5000);

    expect(mirrorWrites()).toHaveLength(1);
  });

  it('coalesces a run of edits into one publish', async () => {
    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/ratings', value: [] });
    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/tweak', value: 0.01 });
    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/stickiness', value: 3 });
    await vi.advanceTimersByTimeAsync(5000);

    expect(mirrorWrites()).toHaveLength(1);
  });

  it('ignores writes that are not part of the library', async () => {
    await store.dispatch('writeDurably', { path: 'settings/includeShorts', value: true });
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(mirrorWrites()).toHaveLength(0);
  });

  it('does nothing for someone who never turned the mirror feed on', async () => {
    store.state.settings = { ...store.state.settings, mirrorFeedKey: null };

    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/ratings', value: [] });
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(mirrorWrites()).toHaveLength(0);
  });

  // A backgrounded PWA doesn't run setTimeout, and closing the app is the
  // normal end of a rating session.
  it('flushes a pending publish when the app is about to be suspended', async () => {
    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/ratings', value: [] });
    await store.dispatch('flushMirrorPublish');

    expect(mirrorWrites()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(mirrorWrites()).toHaveLength(1); // the timer was cancelled, not doubled
  });

  it('writes nothing on a flush when nothing is pending', async () => {
    await store.dispatch('flushMirrorPublish');

    expect(mirrorWrites()).toHaveLength(0);
  });

  // Home's six-hour backstop trusts this stamp.
  it('stamps the publish so Home does not immediately repeat it', async () => {
    await store.dispatch('publishMirrorFeed');

    expect(Number(localStorage.getItem('cinemaRoll.mirrorFeed.lastPublish'))).toBeGreaterThan(0);
  });
});
