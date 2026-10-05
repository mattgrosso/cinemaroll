import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The real store's refreshAppBadge with the "Showtimes waiting" switch (Matt,
// 2026-10-05: films on the Showtimes screen not yet dismissed or snoozed
// should count on the icon badge, off by default).
vi.mock('axios');
vi.mock('@sentry/vue');

const BOARD = {
  theaters: [{ key: 'alamo', listings: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c', coveredBy: 'x' }] }]
};
const getMock = vi.fn((path) => Promise.resolve({
  exists: () => path.endsWith('/theaters/board'),
  val: () => (path.endsWith('/theaters/board') ? BOARD : null)
}));
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn((target) => target),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  get: (...args) => getMock(...args)
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
const setAppBadge = vi.fn(() => Promise.resolve());
const clearAppBadge = vi.fn(() => Promise.resolve());

beforeEach(async () => {
  vi.resetModules();
  getMock.mockClear();
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  navigator.setAppBadge = setAppBadge;
  navigator.clearAppBadge = clearAppBadge;
  store = (await import('@/store/index.js')).default;
  store.commit('setDatabaseTopKey', 'someone-example-com');
  store.state.isOnline = true;
  store.state.settingsLoaded = true;
  store.state.dbLoaded = true;
});

afterEach(() => {
  delete navigator.setAppBadge;
  delete navigator.clearAppBadge;
});

describe('refreshAppBadge and Showtimes', () => {
  it('leaves the films out, and never reads the board, while the switch is off', async () => {
    store.commit('setPushPrefs', { showtimes: false });
    await store.dispatch('refreshAppBadge');
    expect(getMock).not.toHaveBeenCalled();
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).toHaveBeenCalled();
  });

  it('loads the board and counts the films still waiting when on', async () => {
    store.commit('setPushPrefs', { showtimes: true });
    await store.dispatch('refreshAppBadge');
    expect(getMock).toHaveBeenCalledWith('someone-example-com/theaters/board');
    // a and b; c is covered by a better theater.
    expect(setAppBadge).toHaveBeenLastCalledWith(2);
  });

  it('drops a film once it is dismissed or snoozed, without re-reading a fresh board', async () => {
    store.commit('setPushPrefs', { showtimes: true });
    await store.dispatch('refreshAppBadge');
    getMock.mockClear();
    await store.dispatch('dismissListing', { theaterKey: 'alamo', slug: 'a' });
    await store.dispatch('refreshAppBadge');
    expect(setAppBadge).toHaveBeenLastCalledWith(1);
    await store.dispatch('remindListing', { theaterKey: 'alamo', slug: 'b', reminder: { remindAt: Date.now() + 1e9 } });
    await store.dispatch('refreshAppBadge');
    expect(clearAppBadge).toHaveBeenCalled();
    expect(getMock).not.toHaveBeenCalled();
  });
});
