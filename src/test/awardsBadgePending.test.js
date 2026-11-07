import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withoutPendingAwards } from '@/assets/javascript/appBadge.js';

// Report (Matt, 2026-11-07): "I just had a 52 on the red dot again." The
// badge log showed the app itself setting 52 award years at launch: the
// settings had arrived, the personal awards (their own node) had not, so
// every eligible year looked unnamed. Awards not yet loaded must count as
// none, and the push digest must wait for them.
vi.mock('axios');
vi.mock('@sentry/vue');

const YEARS = Array.from({ length: 52 }, (_, i) => 1970 + i);
vi.mock('@/assets/javascript/pushDigest.js', async (importOriginal) => ({
  ...(await importOriginal()),
  buildPushDigest: vi.fn(() => ({
    stickiness: { count: 0, dueTimes: [] },
    tiebreak: {},
    awards: { years: YEARS, eligibleAt: 0 }
  }))
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
  get: vi.fn(() => Promise.resolve({ exists: () => false, val: () => null }))
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
  setMock.mockClear();
  setAppBadge.mockClear();
  clearAppBadge.mockClear();
  navigator.setAppBadge = setAppBadge;
  navigator.clearAppBadge = clearAppBadge;
  store = (await import('@/store/index.js')).default;
  store.commit('setDatabaseTopKey', 'someone-example-com');
  store.state.isOnline = true;
  store.state.settingsLoaded = true;
  store.state.dbLoaded = true;
  store.state.pushSubscribed = true;
});

afterEach(() => {
  delete navigator.setAppBadge;
  delete navigator.clearAppBadge;
});

describe('award years on the icon badge before the awards have loaded', () => {
  it('counts no award years while the awards are still loading', async () => {
    expect(store.state.personalAwardsPending).toBe(true);
    await store.dispatch('refreshAppBadge');
    expect(setAppBadge).not.toHaveBeenCalledWith(52);
    expect(clearAppBadge).toHaveBeenCalled();
    expect(store.state.lastBadge.awardsPending).toBe(true);
    expect(store.state.lastBadge.awards).toBe(0);
  });

  it('counts them once the awards are known', async () => {
    store.commit('setPersonalAwardsPending', false);
    await store.dispatch('refreshAppBadge');
    expect(setAppBadge).toHaveBeenCalledWith(52);
  });

  it('does not publish the push digest until the awards are known', async () => {
    const digestWrites = () => setMock.mock.calls.filter(([path]) => String(path).endsWith('/push/digest'));
    await store.dispatch('publishPushDigest');
    expect(digestWrites()).toHaveLength(0);
    store.commit('setPersonalAwardsPending', false);
    await store.dispatch('publishPushDigest');
    expect(digestWrites()).toHaveLength(1);
  });
});

describe('withoutPendingAwards', () => {
  it('empties the award years only while pending', () => {
    const digest = { awards: { years: [2001, 2002], eligibleAt: 5 }, tiebreak: { due: true } };
    expect(withoutPendingAwards(digest, true)).toEqual({ awards: { years: [], eligibleAt: 5 }, tiebreak: { due: true } });
    expect(withoutPendingAwards(digest, false)).toBe(digest);
  });
});
