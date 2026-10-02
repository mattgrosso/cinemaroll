import { describe, it, expect, vi, beforeEach } from 'vitest'

// Imports the REAL store module (same pattern as OfflineDataFallback.test.js /
// flushPendingWrites.test.js) so the actual auth actions run, not a re-implementation.
vi.mock('axios')
vi.mock('@sentry/vue')

const routerPushMock = vi.fn()
vi.mock('@/router/appRouter.js', () => ({ pushRoute: (...args) => routerPushMock(...args) }))
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 0 }))
}))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }))
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn(),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}))

const signInWithPopupMock = vi.fn()
const signInWithEmailAndPasswordMock = vi.fn()
const createUserWithEmailAndPasswordMock = vi.fn()
const sendPasswordResetEmailMock = vi.fn(() => Promise.resolve())
const signOutMock = vi.fn(() => Promise.resolve())
const oAuthProviderMock = vi.fn(function OAuthProvider (id) {
  this.providerId = id
  this.scopes = []
  this.addScope = (scope) => this.scopes.push(scope)
})
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider () {}),
  OAuthProvider: function (...args) { return oAuthProviderMock.call(this, ...args) },
  signInWithPopup: (...args) => signInWithPopupMock(...args),
  signInWithEmailAndPassword: (...args) => signInWithEmailAndPasswordMock(...args),
  createUserWithEmailAndPassword: (...args) => createUserWithEmailAndPasswordMock(...args),
  sendPasswordResetEmail: (...args) => sendPasswordResetEmailMock(...args),
  sendEmailVerification: vi.fn(() => Promise.resolve()),
  signOut: (...args) => signOutMock(...args),
  // Must invoke its callback: store/index.js's `authReady` promise only
  // settles from in here, and initializeDB awaits it.
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))
vi.mock('@/utils/offlineStore.js', () => ({
  loadSnapshot: vi.fn(() => Promise.resolve(null)),
  saveSnapshot: vi.fn()
}))
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn(() => Promise.resolve(null))
}))

const { default: store } = await import('@/store/index.js')

describe('auth actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    store.commit('setUserEmail', null)
    store.commit('setDatabaseTopKey', null)
  })

  describe('completeLogin (the shared tail of every sign-in method)', () => {
    it('derives and persists the database key from the email', () => {
      store.dispatch('completeLogin', { email: 'someone@example.com' })

      expect(store.state.userEmail).toBe('someone@example.com')
      expect(store.state.databaseTopKey).toBe('someone-example-com')
      expect(window.localStorage.getItem('databaseTopKey')).toBe('someone-example-com')
      expect(routerPushMock).toHaveBeenCalledWith('/')
    })

    it('commits the key rather than dispatching it', () => {
      // Regression guard: this used to `dispatch('setDatabaseTopKey')`, but that
      // only ever existed as a MUTATION — so it was a silent no-op and the key
      // stayed null until the router guard happened to re-read localStorage.
      store.dispatch('completeLogin', { email: 'someone@example.com' })
      expect(store.state.databaseTopKey).not.toBeNull()
    })

    it('stores the raw email so "Signed in as ..." survives a reload', () => {
      store.dispatch('completeLogin', { email: 'someone@example.com' })
      expect(window.localStorage.getItem('userEmail')).toBe('someone@example.com')
    })

    it('throws rather than keying an account off a missing email', () => {
      // Dropping a user into an empty, wrongly-keyed database silently would be
      // far worse than refusing to sign them in.
      expect(() => store.dispatch('completeLogin', { email: null })).toThrow()
      expect(store.state.databaseTopKey).toBeNull()
      expect(window.localStorage.getItem('databaseTopKey')).toBeNull()
    })
  })

  describe('providers', () => {
    it('signs in with email and password and completes the login', async () => {
      signInWithEmailAndPasswordMock.mockResolvedValueOnce({ user: { email: 'new@example.com' } })

      await store.dispatch('loginWithEmail', { email: 'new@example.com', password: 'hunter22' })

      expect(signInWithEmailAndPasswordMock).toHaveBeenCalledWith({}, 'new@example.com', 'hunter22')
      expect(store.state.databaseTopKey).toBe('new-example-com')
    })

    it('creates an account and completes the login', async () => {
      createUserWithEmailAndPasswordMock.mockResolvedValueOnce({ user: { email: 'fresh@example.com' } })

      await store.dispatch('signUpWithEmail', { email: 'fresh@example.com', password: 'hunter22' })

      expect(createUserWithEmailAndPasswordMock).toHaveBeenCalledWith({}, 'fresh@example.com', 'hunter22')
      expect(store.state.databaseTopKey).toBe('fresh-example-com')
    })

    it('requests the email scope for Apple, without which no address comes back', async () => {
      signInWithPopupMock.mockResolvedValueOnce({ user: { email: 'relay@privaterelay.appleid.com' } })

      await store.dispatch('loginWithApple')

      const provider = signInWithPopupMock.mock.calls[0][1]
      expect(provider.providerId).toBe('apple.com')
      expect(provider.scopes).toContain('email')
      expect(store.state.databaseTopKey).toBe('relay-privaterelay-appleid-com')
    })

    it('lets a failed sign-in reject so the form can show the reason', async () => {
      const failure = Object.assign(new Error('nope'), { code: 'auth/wrong-password' })
      signInWithEmailAndPasswordMock.mockRejectedValueOnce(failure)

      await expect(
        store.dispatch('loginWithEmail', { email: 'a@b.com', password: 'wrong' })
      ).rejects.toMatchObject({ code: 'auth/wrong-password' })
    })

    it('keeps `login` working as an alias for Google', async () => {
      signInWithPopupMock.mockResolvedValueOnce({ user: { email: 'g@example.com' } })

      await store.dispatch('login')

      expect(signInWithPopupMock).toHaveBeenCalled()
      expect(store.state.databaseTopKey).toBe('g-example-com')
    })

    it('sends a password reset', async () => {
      await store.dispatch('sendPasswordReset', 'forgot@example.com')
      expect(sendPasswordResetEmailMock).toHaveBeenCalledWith({}, 'forgot@example.com')
    })
  })

  describe('logout', () => {
    it('clears the stored key, the in-memory identity, and returns to /login', async () => {
      store.dispatch('completeLogin', { email: 'someone@example.com' })
      routerPushMock.mockClear()

      await store.dispatch('logout')

      expect(signOutMock).toHaveBeenCalled()
      expect(window.localStorage.getItem('databaseTopKey')).toBeNull()
      expect(window.localStorage.getItem('userEmail')).toBeNull()
      expect(store.state.userEmail).toBeNull()
      expect(store.state.databaseTopKey).toBeNull()
      expect(routerPushMock).toHaveBeenCalledWith('/login')
    })

    it('does not leave the previous account\'s library in memory', async () => {
      store.commit('setMovieLog', { someKey: { movie: { id: 1 } } })

      await store.dispatch('logout')

      expect(Object.keys(store.state.movieLog)).toHaveLength(0)
    })
  })
})
