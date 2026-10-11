import { describe, it, expect, vi, beforeEach } from 'vitest'

// Sentry, 2026-10-11: "permission_denied at /social/requests/<me>" on a
// launch with a stored login but an expired Firebase session. The Film Club
// listeners attached without a token, and the "already listening" marker
// was never cleared — so signing out and back in to the same account in one
// tab left Film Club requests and friends unheard until a reload.
vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/router/appRouter.js', () => ({ pushRoute: vi.fn() }))
vi.mock('@/assets/javascript/GetRating.js', () => ({ getRating: vi.fn(() => ({ calculatedTotal: 0 })) }))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }))

const stopMock = vi.fn()
const onValueMock = vi.fn(() => stopMock)
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: (...args) => onValueMock(...args),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn(),
  orderByChild: vi.fn(),
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
const requestListens = () => onValueMock.mock.calls.filter(([path]) => path === `social/requests/${ME}`)

function signIn () {
  fakeAuth.currentUser = { email: 'matt@example.com' }
  store.commit('setDatabaseTopKey', ME)
}

describe('Film Club listeners and the sign-in', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    onValueMock.mockImplementation(() => stopMock)
    fakeAuth.currentUser = null
    store.commit('setSocialAttachedFor', null)
    store.commit('setDatabaseTopKey', null)
  })

  it('attaches nothing on a stored login whose session has expired', async () => {
    store.commit('setDatabaseTopKey', ME)
    await store.dispatch('attachSocialListeners')
    expect(requestListens()).toHaveLength(0)
    // And a later sign-in still gets its listeners.
    fakeAuth.currentUser = { email: 'matt@example.com' }
    await store.dispatch('attachSocialListeners')
    expect(requestListens()).toHaveLength(1)
  })

  it('signing out and back in to the same account in one tab listens again', async () => {
    signIn()
    await store.dispatch('attachSocialListeners')
    expect(requestListens()).toHaveLength(1)

    await store.dispatch('logout')
    expect(stopMock).toHaveBeenCalledTimes(2)

    signIn()
    await store.dispatch('attachSocialListeners')
    expect(requestListens()).toHaveLength(2)
  })

  it('a refused listener lets the next screen try again', async () => {
    signIn()
    await store.dispatch('attachSocialListeners')
    const [, , onCancel] = requestListens()[0]
    vi.spyOn(console, 'error').mockImplementation(() => {})
    onCancel(new Error('permission_denied'))

    await store.dispatch('attachSocialListeners')
    expect(requestListens()).toHaveLength(2)
  })
})
