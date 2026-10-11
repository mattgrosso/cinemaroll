import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Sentry N+1, reopened 2026-10-11: opening Film Club (or the Watchlist) after
// a break re-read every Movie Hat at once — the index, then one read per hat —
// because a complete answer only stood for ten minutes. It now stands for six
// hours; a draw (force) and an incomplete read still re-read sooner.
vi.mock('axios');
vi.mock('@sentry/vue');
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn((target) => target),
  orderByChild: vi.fn(),
  orderByKey: vi.fn(),
  limitToFirst: vi.fn(),
  startAt: vi.fn(),
  push: vi.fn(() => ({ key: 'k' })),
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
  saveSnapshot: vi.fn(() => Promise.resolve())
}));
// The read itself is the network: the index plus one request per hat.
const readHatContents = vi.fn();
vi.mock('@/assets/javascript/movieHat.js', async (importOriginal) => ({
  ...(await importOriginal()),
  readHatContents: (...args) => readHatContents(...args)
}));

const HOUR = 60 * 60 * 1000;
const START = new Date('2026-10-11T12:00:00Z').getTime();
let store;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(START);
  readHatContents.mockReset();
  readHatContents.mockResolvedValue({ ids: { 603: true }, complete: true, accessError: null, cache: {} });
  vi.resetModules();
  store = (await import('@/store/index.js')).default;
  store.commit('setDatabaseTopKey', 'matt-example-com');
  store.commit('setSettings', { movieHat: { hats: [{ title: 'Friday', dbKey: 'h1' }, { title: 'Horror', dbKey: 'h2' }] } });
  await store.dispatch('ensureMovieHatContents');
  expect(readHatContents).toHaveBeenCalledTimes(1);
});
afterEach(() => vi.useRealTimers());

describe('ensureMovieHatContents freshness', () => {
  it('an hour after a complete read, opening a screen reads nothing', async () => {
    vi.setSystemTime(START + HOUR);
    await store.dispatch('ensureMovieHatContents');
    expect(readHatContents).toHaveBeenCalledTimes(1);
  });

  it('seven hours later the hats are read again', async () => {
    vi.setSystemTime(START + 7 * HOUR);
    await store.dispatch('ensureMovieHatContents');
    expect(readHatContents).toHaveBeenCalledTimes(2);
  });

  it('a draw still forces a fresh read at once', async () => {
    vi.setSystemTime(START + 60 * 1000);
    await store.dispatch('ensureMovieHatContents', { force: true });
    expect(readHatContents).toHaveBeenCalledTimes(2);
  });

  it('an incomplete read is still retried after a minute', async () => {
    readHatContents.mockResolvedValueOnce({ ids: {}, complete: false, accessError: null, cache: {} });
    await store.dispatch('ensureMovieHatContents', { force: true });
    vi.setSystemTime(START + 2 * 60 * 1000);
    await store.dispatch('ensureMovieHatContents');
    expect(readHatContents).toHaveBeenCalledTimes(3);
  });
});
