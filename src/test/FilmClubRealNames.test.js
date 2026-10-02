import { describe, it, expect, vi, beforeEach } from 'vitest'

// Bug report, 2026-08-20: "It would be nice if we could use someone's real
// name when we mention them in film club."
//
// Two separate causes, both exercised here against the REAL store rather than
// a copy of its logic:
//   1. Your OWN name was never captured — the sign-in provider hands back
//      "Matt Grosso" and the store kept only the email, so everything you
//      published said "mattgrosso".
//   2. A FRIEND's name fell straight from their (lazily-fetched, ~100KB)
//      profile to their raw database key, skipping the directory row that is
//      already in memory and carries the same name.
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
  query: vi.fn((target) => target),
  orderByChild: (field) => ({ orderByChild: field }),
  startAt: (value) => ({ startAt: value }),
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
  signOut: vi.fn(() => Promise.resolve()),
  // Must invoke its callback — store/index.js's `authReady` only settles here.
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn() })
}))

let store

beforeEach(async () => {
  window.localStorage.clear()
  vi.resetModules()
  const storeModule = await import('@/store/index.js')
  store = storeModule.default
})

describe('my own name in Film Club', () => {
  it('uses the name the provider knows, not the email handle', () => {
    store.commit('setUserEmail', 'mattgrosso@gmail.com')
    expect(store.getters.socialSettings.displayName).toBe('mattgrosso')

    store.commit('setUserRealName', 'Matt Grosso')

    expect(store.getters.socialSettings.displayName).toBe('Matt Grosso')
  })

  it('survives a reload, so a mention is never briefly wrong while auth settles', async () => {
    store.commit('setUserRealName', 'Matt Grosso')
    expect(window.localStorage.getItem('userRealName')).toBe('Matt Grosso')

    // A fresh boot with no Firebase session yet (onAuthStateChanged is mocked
    // to hand back null) still knows the name from the previous run.
    vi.resetModules()
    const rebooted = (await import('@/store/index.js')).default
    rebooted.commit('setUserEmail', 'mattgrosso@gmail.com')

    expect(rebooted.getters.socialSettings.displayName).toBe('Matt Grosso')
  })

  it('a display name you typed yourself still wins', () => {
    store.commit('setUserEmail', 'mattgrosso@gmail.com')
    store.commit('setUserRealName', 'Matt Grosso')
    store.commit('setSettings', { social: { displayName: 'MG' } })

    expect(store.getters.socialSettings.displayName).toBe('MG')
  })

  it('signing out takes the name with it rather than leaving it for the next account', async () => {
    store.commit('setUserEmail', 'mattgrosso@gmail.com')
    store.commit('setUserRealName', 'Matt Grosso')

    await store.dispatch('logout')

    expect(store.state.userRealName).toBeNull()
    expect(window.localStorage.getItem('userRealName')).toBeNull()
  })
})

describe("a friend's name in Film Club", () => {
  const ME = 'natalie-owner-example-com'
  const FRIEND = 'mattgrosso-gmail-com'

  const befriend = () => {
    store.commit('setDatabaseTopKey', ME)
    store.commit('setSocialEdges', { [ME]: { [FRIEND]: true }, [FRIEND]: { [ME]: true } })
  }

  it('names a friend from the directory while their profile is still loading', () => {
    befriend()
    store.commit('setSocialDirectory', { [FRIEND]: { name: 'Matt Grosso' } })

    // No profile fetched yet — this is the window the report was about.
    expect(store.state.socialFriendProfiles?.[FRIEND]).toBeFalsy()
    expect(store.getters.filmClubFriends.map((f) => f.name)).toEqual(['Matt Grosso'])
  })

  it('prefers the profile once it lands', () => {
    befriend()
    store.commit('setSocialDirectory', { [FRIEND]: { name: 'Stale Directory Name' } })
    store.commit('setSocialFriendProfile', { key: FRIEND, profile: { name: 'Matt Grosso', rated: [] } })

    expect(store.getters.filmClubFriends.map((f) => f.name)).toEqual(['Matt Grosso'])
  })

  it('falls back to the key only when they have published neither', () => {
    befriend()

    expect(store.getters.filmClubFriends.map((f) => f.name)).toEqual([FRIEND])
  })
})
