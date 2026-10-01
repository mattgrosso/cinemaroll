import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Report 2026-10-01: "Cannot sign into Movie Hat", from a new user on an
// iPhone. Every failure read "Couldn't sign in to Movie Hat.", "Find my hats"
// was offered before the sign-in it depends on, and a good sign-in into no
// hats ended at a bare "No hats found". Nothing in the report said which.

vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/router', () => ({ default: { push: vi.fn() } }))
vi.mock('@/assets/javascript/GetRating.js', () => ({ getRating: vi.fn(() => ({ calculatedTotal: 0 })) }))
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
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider () {}),
  OAuthProvider: vi.fn(function OAuthProvider () {}),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))
vi.mock('@/utils/offlineStore.js', () => ({ loadSnapshot: vi.fn(() => Promise.resolve(null)), saveSnapshot: vi.fn() }))
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn(() => Promise.resolve(null))
}))

const connectMock = vi.fn()
vi.mock('@/assets/javascript/movieHatAuth.js', () => ({
  connectMovieHat: (...args) => connectMock(...args),
  connectMovieHatWithToken: vi.fn(),
  disconnectMovieHat: vi.fn(() => Promise.resolve()),
  watchMovieHatAuth: vi.fn(() => () => {}),
  movieHatSession: vi.fn(() => Promise.resolve({ token: null, email: null, reason: 'not-connected' }))
}))
const fetchMyHatsMock = vi.fn()
vi.mock('@/assets/javascript/movieHat.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchMyHats: (...args) => fetchMyHatsMock(...args),
  fetchAllHats: vi.fn(() => Promise.reject(new Error('closed')))
}))

const { movieHatSignInMessage, isSignInDismissal } = await import('@/assets/javascript/movieHatSignIn.js')
const { default: store } = await import('@/store/index.js')

const authError = (code) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

describe('movieHatSignInMessage', () => {
  it('names a blocked popup and how to unblock it on an iPhone', () => {
    expect(movieHatSignInMessage(authError('auth/popup-blocked'))).toMatch(/blocked the Google sign-in window.*Block Pop-ups/)
  })

  it('names a network failure', () => {
    expect(movieHatSignInMessage(authError('auth/network-request-failed'))).toMatch(/connection/)
  })

  it('still names an unknown code rather than a bare "couldn\'t"', () => {
    expect(movieHatSignInMessage(authError('auth/something-new'))).toBe("Couldn't sign in to Movie Hat (something-new).")
  })

  it('treats closing the chooser as a choice', () => {
    expect(isSignInDismissal(authError('auth/popup-closed-by-user'))).toBe(true)
    expect(isSignInDismissal(authError('auth/cancelled-popup-request'))).toBe(true)
    expect(isSignInDismissal(authError('auth/popup-blocked'))).toBe(false)
  })
})

describe('connectMovieHat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.commit('setMovieHatUser', null)
    store.commit('setMovieHatLastFailure', null)
  })

  it('keeps the failure for the bug report and re-throws it', async () => {
    connectMock.mockRejectedValueOnce(authError('auth/popup-blocked'))
    await expect(store.dispatch('connectMovieHat')).rejects.toMatchObject({ code: 'auth/popup-blocked' })
    expect(store.state.movieHatLastFailure).toMatchObject({ where: 'sign-in', code: 'auth/popup-blocked' })
  })

  it('records nothing when the chooser is simply closed', async () => {
    connectMock.mockRejectedValueOnce(authError('auth/popup-closed-by-user'))
    await expect(store.dispatch('connectMovieHat')).rejects.toBeTruthy()
    expect(store.state.movieHatLastFailure).toBeNull()
  })

  it('marks a lookup failure after a good sign-in as a lookup, not a failed sign-in', async () => {
    connectMock.mockResolvedValueOnce({ email: 'new@example.com' })
    fetchMyHatsMock.mockRejectedValueOnce(new Error('Movie Hat responded 500'))
    await expect(store.dispatch('connectMovieHat')).rejects.toMatchObject({ movieHatStage: 'lookup' })
    expect(store.state.movieHatEmail).toBe('new@example.com')
    expect(store.state.movieHatLastFailure).toMatchObject({ where: 'lookup' })
  })

  it('a good sign-in into no hats finds none, without an error', async () => {
    connectMock.mockResolvedValueOnce({ email: 'new@example.com' })
    fetchMyHatsMock.mockResolvedValueOnce([])
    await store.dispatch('connectMovieHat')
    expect(store.state.availableMovieHats).toEqual([])
    expect(store.state.movieHatLastFailure).toBeNull()
  })
})

describe('the Settings Movie Hat section', () => {
  // Home is far too heavy to mount for one settings pane, so this reads the
  // template. It guards the two things the report tripped over.
  const source = readFileSync(resolve(__dirname, '../components/Home.vue'), 'utf8')

  it('offers Find my hats only once Movie Hat is connected', () => {
    expect(source).toMatch(/<button v-if="movieHatEmail"[^>]*@click="findMovieHats"/)
  })

  it('explains that hats are by invitation when a connected account has none', () => {
    expect(source).toMatch(/isn't in any hats yet/)
    expect(source).toMatch(/shared by invitation/)
  })

  it('shows the real reason a sign-in failed', () => {
    expect(source).toMatch(/this\.hatConnectError = movieHatSignInMessage\(error\)/)
  })
})
