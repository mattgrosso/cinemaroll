import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  installNetworkHealth, resetNetworkHealth, markStalled, markReachable,
  isStallError, reportNetworkOutcome, fetchWithTimeout, PROBE_INTERVAL_MS, REQUEST_TIMEOUT_MS
} from '@/utils/networkHealth.js'

// A store shaped like the real one's isOnline/networkStalled slice, with the
// real mutation semantics copied in so the test exercises the same coupling.
function makeStore () {
  const store = {
    state: { isOnline: true, networkStalled: false },
    dispatched: [],
    commit (type, value) {
      if (type === 'setNetworkStalled') {
        store.state.networkStalled = value
        store.state.isOnline = value ? false : navigator.onLine
      } else if (type === 'setIsOnline') {
        store.state.isOnline = value
        if (value) store.state.networkStalled = false
      }
    },
    dispatch (type) { store.dispatched.push(type) }
  }
  return store
}

function makeAxios () {
  const handlers = {}
  return {
    defaults: {},
    interceptors: { response: { use: (ok, bad) => { handlers.ok = ok; handlers.bad = bad } } },
    handlers
  }
}

// Bug report (Matt, 2026-09-23): "my phone thought I had a connection, but
// basically did not... I would tell it to do something and it would just sit
// there." Reproduced with a blackhole proxy: navigator.onLine true, nothing
// answers, every isOnline branch took the online path with no timeout.
describe('networkHealth (lie-fi detection)', () => {
  let store, axios
  beforeEach(() => {
    vi.useFakeTimers()
    store = makeStore()
    axios = makeAxios()
  })
  afterEach(() => {
    resetNetworkHealth()
    vi.useRealTimers()
  })

  it('gives every axios request a timeout, so a dead connection fails instead of hanging', () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    expect(axios.defaults.timeout).toBe(REQUEST_TIMEOUT_MS)
  })

  it('a timed-out request flips the app offline even though the browser says online', async () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    expect(store.state.isOnline).toBe(true)
    await expect(axios.handlers.bad({ code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' })).rejects.toBeTruthy()
    expect(store.state.networkStalled).toBe(true)
    expect(store.state.isOnline).toBe(false)
  })

  it('a server that answers, however badly, is not a stall', async () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    await expect(axios.handlers.bad({ response: { status: 500 }, message: 'Request failed with status code 500' })).rejects.toBeTruthy()
    expect(store.state.networkStalled).toBe(false)
    expect(store.state.isOnline).toBe(true)
  })

  it('classifies the shapes a dead connection produces', () => {
    expect(isStallError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true)
    expect(isStallError({ name: 'TimeoutError', message: 'signal timed out' })).toBe(true)
    expect(isStallError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isStallError(new TypeError('Load failed'))).toBe(true)
    expect(isStallError({ response: { status: 404 }, message: 'Request failed with status code 404' })).toBe(false)
    expect(isStallError(null)).toBe(false)
  })

  it('the probe brings the app back online and flushes the queue the moment something answers', async () => {
    let answers = false
    installNetworkHealth({ store, axios, probe: async () => answers })
    markStalled()
    expect(store.state.isOnline).toBe(false)

    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS + 10)
    expect(store.state.isOnline).toBe(false) // still dead

    answers = true
    await vi.advanceTimersByTimeAsync(PROBE_INTERVAL_MS + 10)
    expect(store.state.networkStalled).toBe(false)
    expect(store.state.isOnline).toBe(true)
    expect(store.dispatched).toContain('flushPendingWrites')
  })

  it('any successful request clears the stall too', async () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    markStalled()
    expect(store.state.isOnline).toBe(false)
    axios.handlers.ok({ status: 200 })
    expect(store.state.isOnline).toBe(true)
    expect(store.state.networkStalled).toBe(false)
  })

  it('the browser\'s own online event resets the detector', () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    markStalled()
    store.commit('setIsOnline', true)
    expect(store.state.networkStalled).toBe(false)
    expect(store.state.isOnline).toBe(true)
  })

  it('does nothing before it is installed', () => {
    expect(() => markStalled()).not.toThrow()
    expect(() => markReachable()).not.toThrow()
    expect(() => reportNetworkOutcome(new Error('timed out'))).not.toThrow()
  })

  it('fetchWithTimeout reports a hang as a stall and a reply as reachable', async () => {
    installNetworkHealth({ store, axios, probe: async () => false })
    const hang = vi.fn(() => Promise.reject(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })))
    vi.stubGlobal('fetch', hang)
    await expect(fetchWithTimeout('https://example.test/x')).rejects.toBeTruthy()
    expect(store.state.isOnline).toBe(false)
    expect(hang.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)

    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true })))
    await fetchWithTimeout('https://example.test/x')
    expect(store.state.isOnline).toBe(true)
    vi.unstubAllGlobals()
  })
})
