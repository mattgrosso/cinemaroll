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

  // Bug report 2026-10-06: a badge on the icon and nothing on Home saying
  // where it came from. Home's and the Watchlist's Showtimes cards read
  // showtimesBadgeCount, so it has to be the badge's own number.
  it('gives the cards the same number as the badge, and zero while the switch is off', async () => {
    store.commit('setPushPrefs', { showtimes: true });
    await store.dispatch('refreshAppBadge');
    expect(store.getters.showtimesBadgeCount).toBe(2);
    expect(setAppBadge).toHaveBeenLastCalledWith(store.getters.showtimesBadgeCount);

    await store.dispatch('dismissListing', { theaterKey: 'alamo', slug: 'a' });
    await store.dispatch('refreshAppBadge');
    expect(store.getters.showtimesBadgeCount).toBe(1);
    expect(setAppBadge).toHaveBeenLastCalledWith(1);

    store.commit('setPushPrefs', { showtimes: false });
    expect(store.getters.showtimesBadgeCount).toBe(0);
  });
});

// Bug report 2026-10-09: an update reloaded the Showtimes screen while Matt
// was dismissing films. Dismissals and reminders are the user's choices, so
// they're queued on the phone before the network write - a reload, a kill or
// a dead connection can't lose one.
describe('Showtimes choices are saved on the phone first', () => {
  it('queues a dismissal at its leaf path and shows it at once', async () => {
    const { enqueueWrite } = await import('@/utils/pendingWriteQueue.js')
    enqueueWrite.mockClear()
    await store.dispatch('dismissListing', { theaterKey: 'alamo', slug: 'a' })
    expect(enqueueWrite).toHaveBeenCalledWith({ type: 'write', dbEntry: { path: 'theaters/dismissed/alamo/a', value: expect.any(Number) } })
    expect(store.state.theaterDismissed.alamo.a).toEqual(expect.any(Number))

    await store.dispatch('dismissListing', { theaterKey: 'alamo', slug: 'a', restore: true })
    expect(enqueueWrite).toHaveBeenLastCalledWith({ type: 'write', dbEntry: { path: 'theaters/dismissed/alamo/a', value: null } })
    expect('a' in store.state.theaterDismissed.alamo).toBe(false)
  })

  it('queues a reminder and its cancellation the same way', async () => {
    const { enqueueWrite } = await import('@/utils/pendingWriteQueue.js')
    enqueueWrite.mockClear()
    const reminder = { remindAt: 123 }
    await store.dispatch('remindListing', { theaterKey: 'alamo', slug: 'b', reminder })
    expect(enqueueWrite).toHaveBeenCalledWith({ type: 'write', dbEntry: { path: 'theaters/reminders/alamo/b', value: reminder } })
    expect(store.state.theaterReminders.alamo.b).toEqual(reminder)
    await store.dispatch('remindListing', { theaterKey: 'alamo', slug: 'b', reminder: null })
    expect('b' in store.state.theaterReminders.alamo).toBe(false)
  })

  it('a dismissal still waiting in the queue survives the board reloading from the server', async () => {
    const { listPendingWrites } = await import('@/utils/pendingWriteQueue.js')
    listPendingWrites.mockResolvedValueOnce([{ id: 1, type: 'write', dbEntry: { path: 'theaters/dismissed/alamo/b', value: 5 } }])
    await store.dispatch('loadTheaterBoard')
    expect(store.state.theaterDismissed.alamo.b).toBe(5)
  })
})

// Bug report 2026-10-10: "The showtimes at Udvar Hazy just constantly give me
// the same movies over and over again." Loading a board used to DELETE every
// dismissal whose film wasn't on it, so one empty or failed Udvar-Hazy read
// wiped them all and the films came back. Only the push sweep forgets now,
// after two weeks off the board (staleTheaterEntries).
describe('loading a board never deletes dismissals or reminders', () => {
  it('keeps the server copy of a dismissal whose film is missing from this board', async () => {
    const { update } = await import('firebase/database')
    update.mockClear()
    getMock.mockImplementation((path) => Promise.resolve({
      exists: () => true,
      val: () => (path.endsWith('/theaters/board') ? BOARD
        : path.endsWith('/theaters/dismissed') ? { 'imax-udvar-hazy': { 7: 1 }, alamo: { a: 2 } }
          : { 'imax-udvar-hazy': { 8: { remindAt: 1 } } })
    }))
    try {
      await store.dispatch('loadTheaterBoard')
    } finally {
      getMock.mockImplementation((path) => Promise.resolve({
        exists: () => path.endsWith('/theaters/board'),
        val: () => (path.endsWith('/theaters/board') ? BOARD : null)
      }))
    }
    expect(update).not.toHaveBeenCalled()
    // What's on screen is still just what's on this board.
    expect(store.state.theaterDismissed).toEqual({ alamo: { a: 2 } })
    expect(store.state.theaterReminders).toEqual({})
  })
})
