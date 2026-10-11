import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sentry, 2026-10-11: "permission_denied at /<me>/movieLog" from a launch
// with a stored login whose Firebase session had expired. The app signed out
// as designed, but the refused listeners (and the sign-out notice) were
// console.errors, which captureConsole files as Sentry events. Refused with
// nobody signed in is routine and a warning; refused while signed in is a
// real rules problem and stays an error.
vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/router/appRouter.js', () => ({ pushRoute: vi.fn() }))
vi.mock('@/assets/javascript/GetRating.js', () => ({ getRating: vi.fn(() => ({ calculatedTotal: 0 })) }))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }))

const onValueMock = vi.fn(() => vi.fn())
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: (...args) => onValueMock(...args),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn((path) => path),
  orderByChild: vi.fn(),
  orderByKey: vi.fn(),
  limitToFirst: vi.fn(),
  startAt: vi.fn(),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}))

const fakeAuth = { currentUser: null }
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => fakeAuth),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider () {}),
  OAuthProvider: vi.fn(function OAuthProvider () {}),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(() => { fakeAuth.currentUser = null; return Promise.resolve() }),
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))
vi.mock('@/utils/offlineStore.js', () => ({ loadSnapshot: vi.fn(() => Promise.resolve(null)), saveSnapshot: vi.fn() }))
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn(() => Promise.resolve(null))
}))

const { default: store } = await import('@/store/index.js')

const ME = 'matt-example-com'
const denied = new Error('permission_denied at /matt-example-com/movieLog: Client doesn\'t have permission to access the desired data.')

async function refuseLibraryListeners () {
  store.commit('setDbListenersAttachedFor', null)
  store.commit('setDatabaseTopKey', ME)
  await store.dispatch('initializeDB')
  const cancels = onValueMock.mock.calls
    .filter(([path]) => path === `${ME}/movieLog` || path === `${ME}/settings`)
    .map((call) => call[2])
  expect(cancels.length).toBeGreaterThanOrEqual(2)
  cancels.forEach((cancel) => cancel(denied))
}

describe('a refused library listener and the sign-in', () => {
  let errorSpy
  beforeEach(() => {
    vi.clearAllMocks()
    onValueMock.mockImplementation(() => vi.fn())
    fakeAuth.currentUser = null
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  const listenerErrors = () => errorSpy.mock.calls.filter(([msg]) => String(msg).includes('listener cancelled'))

  it('is a warning, not a Sentry error, when nobody is signed in', async () => {
    await refuseLibraryListeners()
    expect(listenerErrors()).toHaveLength(0)
    expect(store.state.dbReadDenied).toBe(true)
  })

  it('stays an error while someone is signed in', async () => {
    fakeAuth.currentUser = { email: 'matt@example.com' }
    await refuseLibraryListeners()
    expect(listenerErrors().map(([msg]) => msg)).toEqual(expect.arrayContaining([
      expect.stringContaining('movieLog listener cancelled'),
      expect.stringContaining('settings listener cancelled')
    ]))
  })

  it('signing out a stored login with no session is not a Sentry error', async () => {
    window.localStorage.setItem('databaseTopKey', ME)
    store.commit('setDatabaseTopKey', ME)
    await store.dispatch('verifyRestoredSession')
    expect(errorSpy.mock.calls.filter(([msg]) => String(msg).includes('no Firebase session'))).toHaveLength(0)
    expect(store.state.databaseTopKey).toBeFalsy()
  })
})
