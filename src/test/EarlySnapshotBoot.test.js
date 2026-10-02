import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bug report (Matt, 2026-09-05): tapping a push notification "shows me
// Cinema Roll and then immediately flashes to the loading screen and then
// shows it again." iOS reloads the installed app on that tap; the reloaded
// page then sat on the spinner for the auth restore PLUS the IndexedDB
// snapshot read, back to back. The snapshot is this device's own copy and
// needs no token, so initializeDB now starts reading it BEFORE it awaits
// authReady. This file keeps auth permanently unsettled to prove the
// library still paints from the snapshot — against the old code, dbLoaded
// stays false forever here.

vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 0 }))
}))

const onValueMock = vi.fn()
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: (...args) => onValueMock(...args),
  set: vi.fn(),
  query: vi.fn((target, ...clauses) => ({ __query: target, clauses })),
  orderByChild: (field) => ({ orderByChild: field }),
  startAt: (value) => ({ startAt: value }),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}))
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({}))
}))
// Deliberately NEVER invokes its callback: authReady stays pending for the
// whole test, the way it does for the first few hundred milliseconds of a
// real launch while Firebase reads its persisted session.
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
  onAuthStateChanged: vi.fn(() => vi.fn())
}))

vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn((entry) => Promise.resolve({ id: 'queued-id', ...entry }))
}))

const loadSnapshotMock = vi.fn()
vi.mock('@/utils/offlineStore.js', () => ({
  loadSnapshot: (...args) => loadSnapshotMock(...args),
  saveSnapshot: vi.fn()
}))

const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

let store

beforeEach(async () => {
  vi.resetModules()
  onValueMock.mockReset()
  loadSnapshotMock.mockReset()
  const storeModule = await import('@/store/index.js')
  store = storeModule.default
  store.commit('setDevMode', true)
  store.commit('setAcademyAwardWinners', { bestPicture: [] })
  store.commit('setAllAcademyAwards', [{ id: 'skip' }])
})

describe('initializeDB reads the local snapshot before auth settles', () => {
  it('paints the cached library while Firebase is still restoring the session', async () => {
    loadSnapshotMock.mockImplementation((topKey, kind) => Promise.resolve(
      kind === 'movieLog' ? { 'movie-1': { movie: { id: 1, title: 'Cached Movie' } } } : null
    ))

    store.dispatch('initializeDB')
    await flushMicrotasks()

    expect(loadSnapshotMock).toHaveBeenCalledWith('testing-database', 'movieLog')
    expect(store.state.movieLog).toEqual({ 'movie-1': { movie: { id: 1, title: 'Cached Movie' } } })
    expect(store.state.dbLoaded).toBe(true)
    // No token yet, so no listener yet — the live data still waits for auth.
    expect(onValueMock).not.toHaveBeenCalled()
  })

  it('reads the snapshot once even when initializeDB is dispatched again mid-wait', async () => {
    loadSnapshotMock.mockImplementation(() => Promise.resolve(null))

    store.dispatch('initializeDB')
    store.dispatch('initializeDB')
    await flushMicrotasks()

    expect(loadSnapshotMock.mock.calls.filter(([, kind]) => kind === 'movieLog')).toHaveLength(1)
  })
})
