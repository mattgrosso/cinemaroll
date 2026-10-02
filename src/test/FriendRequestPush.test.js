import { describe, it, expect, vi, beforeEach } from 'vitest'

// "I get a notification when somebody accepts my friend request. I feel like
// I should get a notification so I know that they're in my film club now"
// (Matt, 2026-10-01). Sending a request and accepting one each announce to
// the push Lambda, which checks the friend graph before sending — so the
// announcement must come AFTER the writes it describes.
vi.mock('axios')
vi.mock('@sentry/vue')
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 0 }))
}))

const calls = []
const setMock = vi.fn((path, value) => { calls.push(['set', path, value]); return Promise.resolve() })
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: (...args) => setMock(...args),
  query: vi.fn(),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}))
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }))
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
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))
vi.mock('@/utils/push.js', () => ({
  announceFriendRequest: (args) => { calls.push(['announce', args]) },
  refreshSubscriptionIfGranted: vi.fn()
}))

let store

beforeEach(async () => {
  calls.length = 0
  vi.resetModules()
  store = (await import('@/store/index.js')).default
  store.commit('setDatabaseTopKey', 'matt-example-com')
})

describe('friend request pushes', () => {
  it('accepting announces to the requester, after both writes', async () => {
    await store.dispatch('acceptFriendRequest', 'seth-example-com')
    const announceAt = calls.findIndex(([kind]) => kind === 'announce')
    expect(calls[announceAt][1]).toEqual({ toKey: 'seth-example-com', kind: 'accepted' })
    expect(calls.slice(0, announceAt).map(([, path]) => path)).toEqual([
      'social/friends/matt-example-com/seth-example-com',
      'social/requests/matt-example-com/seth-example-com'
    ])
  })

  it('sending announces to the recipient, after the request is in their inbox', async () => {
    await store.dispatch('sendFriendRequest', 'seth-example-com')
    const announceAt = calls.findIndex(([kind]) => kind === 'announce')
    expect(calls[announceAt][1]).toEqual({ toKey: 'seth-example-com', kind: 'request' })
    expect(calls.slice(0, announceAt).map(([, path]) => path)).toContain('social/requests/seth-example-com/matt-example-com')
  })

  it('declining says nothing', async () => {
    await store.dispatch('declineFriendRequest', 'seth-example-com')
    expect(calls.some(([kind]) => kind === 'announce')).toBe(false)
  })
})
