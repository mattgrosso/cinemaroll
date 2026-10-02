import { describe, it, expect, vi, beforeEach } from 'vitest'

// Imports the REAL store so the actual socialFriendKeys getter is exercised,
// not a copy of its filter. Firebase/axios/router/Sentry are mocked so
// importing store/index.js has no real side effects.
vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 0 }))
}))

const onValueMock = vi.fn()
const queryMock = vi.fn((target, ...clauses) => ({ __query: target, clauses }))
const getMock = vi.fn(() => Promise.resolve({ val: () => null }))
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: (...args) => onValueMock(...args),
  set: vi.fn(),
  query: (...args) => queryMock(...args),
  orderByChild: (field) => ({ orderByChild: field }),
  startAt: (value) => ({ startAt: value }),
  get: (...args) => getMock(...args)
}))
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({}))
}))
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
  // Must invoke its callback: store/index.js's `authReady` promise only
  // settles from in here, and initializeDB awaits it.
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))


let store

beforeEach(async () => {
  vi.resetModules()
  const storeModule = await import('@/store/index.js')
  store = storeModule.default
  // socialUserKey reads state.databaseTopKey directly — deliberately, so the
  // social graph is always keyed by the real account and never the dev-mode
  // sandbox — so set that rather than flipping dev mode.
  store.commit('setDatabaseTopKey', 'natalie-owner-example-com')
})

// Matt, 2026-08-16: "Can we make it so that the testing account is friends
// with me, but that I just don't see them in my friend's list? So, like, they
// can see me, but I can't see them. That way you could test things."
//
// The database edges have to be mutual — the rules only permit reading a
// profile when each side lists the other — so the asymmetry lives here.
describe('socialFriendKeys hides QA accounts', () => {
  const ME = 'natalie-owner-example-com'
  const TESTER = 'cinemaroll-tester-example-com'
  const FRIEND = 'natalierosegrosso-gmail-com'

  function edges (map) {
    store.commit('setSocialEdges', map)
    return store.getters.socialFriendKeys
  }

  it('drops the tester from my friends even with both edges present', () => {
    const keys = edges({
      [ME]: { [FRIEND]: true, [TESTER]: true },
      [FRIEND]: { [ME]: true },
      [TESTER]: { [ME]: true }
    })

    expect(keys).toEqual([FRIEND])
  })

  it('still requires reciprocation for everyone else', () => {
    const keys = edges({
      [ME]: { [FRIEND]: true },
      [FRIEND]: {}
    })

    expect(keys).toEqual([])
  })

  // The half that has to keep working: signed in AS the tester, a real
  // person is an ordinary friend. The filter reads the friend's key, not
  // the viewer's.
  it('leaves real people visible when the tester is the one looking', () => {
    store.commit('setDatabaseTopKey', TESTER)

    const keys = edges({
      [TESTER]: { 'mattgrosso-gmail-com': true },
      'mattgrosso-gmail-com': { [TESTER]: true }
    })

    expect(keys).toEqual(['mattgrosso-gmail-com'])
  })
})
