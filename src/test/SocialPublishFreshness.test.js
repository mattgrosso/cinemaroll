import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Imports the REAL store so the actual write path is exercised. Matt,
// 2026-08-16: "I happen to know that Natalie watched a movie today and rated
// it, and yet the most recent movie I see is from yesterday. So how often do
// these values get updated?" — the answer was every six hours, from a watcher
// on Home, so a rating could sit unpublished all day.
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

  const storeModule = await import('@/store/index.js');
  store = storeModule.default;
  store.commit('setDatabaseTopKey', 'someone-example-com');
  store.state.isOnline = true;
  store.state.settingsLoaded = true;
  // allMediaAsArray returns [] until the library is marked loaded, and
  // publishSocialProfile refuses to publish an empty one.
  store.state.dbLoaded = true;
});

afterEach(() => {
  vi.useRealTimers();
});

function ratingWrite (key = 'movie-1') {
  return { path: `movieLog/${key}`, value: { movie: { id: 1, title: 'Heat' }, ratings: [] } };
}

// Asserted on the WRITE, not on a dispatch spy: Vuex binds context.dispatch at
// store creation, so spying on store.dispatch afterwards never sees an action
// calling another action. The published document is the thing that matters
// anyway.
function publishedProfilePaths () {
  return setMock.mock.calls
    .map(([path]) => path)
    .filter((path) => typeof path === 'string' && path.startsWith('social/profiles/'));
}

function seedLibrary () {
  store.commit('setMovieLogEntry', {
    key: 'movie-1',
    value: {
      movie: { id: 1, title: 'Heat', poster_path: '/h.jpg', release_date: '1995-12-15' },
      ratings: [{ calculatedTotal: 9, date: Date.now() }]
    }
  });
}

describe('publishing a profile after a rating', () => {
  it('publishes shortly after a new rating is written', async () => {
    seedLibrary();

    await store.dispatch('writeDatabaseEntryNow', ratingWrite());
    expect(publishedProfilePaths()).toHaveLength(0); // not instantly

    await vi.advanceTimersByTimeAsync(20000);

    expect(publishedProfilePaths()).toContain('social/profiles/someone-example-com');
  });

  it('also covers the general durable-write path', async () => {
    seedLibrary();

    await store.dispatch('writeDurably', { path: 'movieLog/movie-1/ratings', value: [] });
    await vi.advanceTimersByTimeAsync(20000);

    expect(publishedProfilePaths().length).toBeGreaterThan(0);
  });

  it('ignores writes that are not part of the library', async () => {
    seedLibrary();

    await store.dispatch('writeDurably', { path: 'settings/personalAwardName', value: 'The Groskers' });
    await vi.advanceTimersByTimeAsync(20000);

    expect(publishedProfilePaths()).toHaveLength(0);
  });

  // The point of the delay: rating ten movies in a sitting publishes the whole
  // profile once, not ten times. It is a full document, not a delta.
  it('coalesces a batch of ratings into a single publish', async () => {
    seedLibrary();

    store.dispatch('scheduleSocialPublish');
    store.dispatch('scheduleSocialPublish');
    store.dispatch('scheduleSocialPublish');
    await vi.advanceTimersByTimeAsync(20000);

    expect(publishedProfilePaths()).toHaveLength(1);
  });

  // It used to be six hours, from a watcher on Home.
  it('publishes well inside a minute, not the old six-hour window', async () => {
    seedLibrary();

    store.dispatch('scheduleSocialPublish');
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(publishedProfilePaths().length).toBeGreaterThan(0);
  });

  it('does nothing at all when sharing is switched off', async () => {
    seedLibrary();
    store.state.settings = { ...store.state.settings, social: { enabled: false } };

    store.dispatch('scheduleSocialPublish');
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(publishedProfilePaths()).toHaveLength(0);
  });
});

// 2026-08-30: Seth rated Tenet and closed the app. The friend-log push reached
// Matt's phone instantly; the profile snapshot the Film Club reads was never
// rewritten, because a backgrounded PWA does not run setTimeout. His club
// showed no such film for the six hours until Home's backstop came round.
//
// The coalescing window is fine. Being unable to survive the app going away is
// not — and "the app goes away" is the normal end of a rating session.
describe('a pending publish surviving the app going away', () => {
  it('publishes immediately, without waiting out the debounce', async () => {
    seedLibrary();

    await store.dispatch('publishSocialProfileNow');

    expect(publishedProfilePaths()).toContain('social/profiles/someone-example-com');
  });

  // The write path already armed a timer; publishing now must cancel it rather
  // than leave a second full-document write queued behind it.
  it('cancels the pending debounce instead of publishing twice', async () => {
    seedLibrary();

    await store.dispatch('writeDatabaseEntryNow', ratingWrite());
    await store.dispatch('publishSocialProfileNow');
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(publishedProfilePaths()).toHaveLength(1);
  });

  it('flushes a pending publish when the app is about to be suspended', async () => {
    seedLibrary();

    await store.dispatch('writeDatabaseEntryNow', ratingWrite());
    expect(publishedProfilePaths()).toHaveLength(0);

    await store.dispatch('flushSocialPublish');

    expect(publishedProfilePaths()).toContain('social/profiles/someone-example-com');
  });

  // Backgrounding the app is constant. Publishing a ~100KB document every time
  // someone switches tabs would be a worse bug than the one being fixed.
  it('writes nothing on a flush when no publish is pending', async () => {
    seedLibrary();

    await store.dispatch('flushSocialPublish');
    await vi.advanceTimersByTimeAsync(60 * 1000);

    expect(publishedProfilePaths()).toHaveLength(0);
  });

  // Home's backstop reads this stamp and skips for six hours if it looks
  // recent. An immediate publish that forgot to stamp would leave the backstop
  // republishing the same document seconds later.
  it('stamps the publish so Home does not immediately repeat it', async () => {
    seedLibrary();
    localStorage.removeItem('cinemaRoll.social.lastPublish');

    await store.dispatch('publishSocialProfileNow');

    expect(Number(localStorage.getItem('cinemaRoll.social.lastPublish'))).toBeGreaterThan(0);
  });

  // The stamp is a claim that a publish happened. Making it while sharing is
  // off would suppress Home's backstop on behalf of a write that never went.
  it('neither publishes nor stamps when sharing is switched off', async () => {
    seedLibrary();
    store.state.settings = { ...store.state.settings, social: { enabled: false } };
    localStorage.removeItem('cinemaRoll.social.lastPublish');

    await store.dispatch('publishSocialProfileNow');

    expect(publishedProfilePaths()).toHaveLength(0);
    expect(localStorage.getItem('cinemaRoll.social.lastPublish')).toBeNull();
  });
});
