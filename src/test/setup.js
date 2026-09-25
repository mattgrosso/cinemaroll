// Test setup file for Vitest
// This file is run before all tests

// Global test configuration
import { vi } from 'vitest'

// Node 22+ defines a `localStorage` global of its own (undefined unless the
// process starts with --localstorage-file), and vitest's jsdom environment
// won't overwrite a global that already exists — so every test touching
// localStorage saw `undefined`. Went unnoticed until the machine moved to
// Node 26 and 316 tests went red at once (2026-09-25). In-memory stand-in.
class MemoryStorage {
  #map = new Map()
  get length () { return this.#map.size }
  key (i) { return [...this.#map.keys()][i] ?? null }
  getItem (k) { return this.#map.has(String(k)) ? this.#map.get(String(k)) : null }
  setItem (k, v) { this.#map.set(String(k), String(v)) }
  removeItem (k) { this.#map.delete(String(k)) }
  clear () { this.#map.clear() }
}

for (const name of ['localStorage', 'sessionStorage']) {
  if (typeof globalThis[name] === 'undefined') {
    Object.defineProperty(globalThis, name, { value: new MemoryStorage(), configurable: true, writable: true })
  }
}

// The store calls getAuth() at module load (the Realtime Database SDK only
// picks up an auth token if Auth was instantiated before it — see the comment
// in store/index.js). Under vitest that resolves to Firebase Auth's *Node*
// build, which throws on initialisation, taking down every test file that
// imports the store even indirectly.
//
// Mocking it here rather than in each of those files keeps it in one place.
// Any test file that declares its own vi.mock('firebase/auth', ...) factory
// still overrides this one.
//
// onAuthStateChanged MUST invoke its callback: store/index.js exposes an
// `authReady` promise that only settles from inside it, and initializeDB
// awaits that promise. A no-op stub would hang every database test forever.
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(function GoogleAuthProvider () {}),
  OAuthProvider: vi.fn(function OAuthProvider () { this.addScope = vi.fn() }),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(() => Promise.resolve()),
  sendEmailVerification: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  onAuthStateChanged: vi.fn((auth, callback) => {
    callback(null)
    return vi.fn()
  })
}))

// Mock window.scroll / scrollTo for JSDOM compatibility (jsdom doesn't implement them)
Object.defineProperty(window, 'scroll', {
  value: vi.fn(),
  writable: true
})
Object.defineProperty(window, 'scrollTo', {
  value: vi.fn(),
  writable: true
})
Object.defineProperty(window, 'scrollBy', {
  value: vi.fn(),
  writable: true
})

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Suppress console logs during tests unless explicitly needed
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}

// Global test utilities
global.testUtils = {
  // Helper to restore console for debugging specific tests
  enableConsole: () => {
    global.console.log = console.log
    global.console.warn = console.warn
    global.console.error = console.error
    global.console.info = console.info
  }
}