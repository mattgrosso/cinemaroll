import { describe, it, expect, vi } from 'vitest'
import { isSafeMomentForReload, shouldAutoAttempt, reloadForUpdate, hardReload, waitForNewWorker, markUpdateLanded, newAppIsReachable, isFreshMoment, runUpdateCheck, checkWorkerOnce, getUpdateTiming } from '@/utils/appUpdate.js'

// Auto-update ships reloads only at provably quiet moments (bug report:
// "the user shouldn't have to take an action" — but the July lesson stands:
// never yank the page out from under the user).

describe('isSafeMomentForReload', () => {
  const classList = (...names) => ({ contains: (n) => names.includes(n) })

  it('is safe on an ordinary browse screen', () => {
    expect(isSafeMomentForReload({ activeElement: document.body, bodyClassList: classList(), routePath: '/' })).toBe(true)
    expect(isSafeMomentForReload({ activeElement: null, bodyClassList: classList(), routePath: '/awards' })).toBe(true)
  })

  it('never while a text input is focused (the user is typing)', () => {
    const input = document.createElement('input')
    expect(isSafeMomentForReload({ activeElement: input, bodyClassList: classList(), routePath: '/' })).toBe(false)
    const textarea = document.createElement('textarea')
    expect(isSafeMomentForReload({ activeElement: textarea, bodyClassList: classList(), routePath: '/' })).toBe(false)
  })

  it('never while a modal has the body scroll-locked', () => {
    expect(isSafeMomentForReload({ activeElement: document.body, bodyClassList: classList('no-scroll'), routePath: '/' })).toBe(false)
  })

  it('never mid-game (an in-memory round would be lost)', () => {
    expect(isSafeMomentForReload({ activeElement: document.body, bodyClassList: classList(), routePath: '/games/poster-zoom' })).toBe(false)
  })
})

describe('shouldAutoAttempt', () => {
  const memoryStorage = () => {
    const map = new Map()
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)) }
  }

  // Bug report (Matt, 2026-09-30): one try per version meant a first try
  // that didn't land left the notice sitting there for good.
  it('attempts twice per target bundle, then defers to the banner', () => {
    const storage = memoryStorage()
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(true)
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(true) // a second try
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(false) // no reload loop
    expect(shouldAutoAttempt('app.def.js', storage)).toBe(true) // a NEWER deploy gets its own attempts
  })

  it('reads the old one-string format as one attempt already made', () => {
    const storage = memoryStorage()
    storage.setItem('auto-update-attempted-for', 'app.abc.js')
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(true)
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(true)
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(false)
  })

  it('still attempts when storage is unavailable', () => {
    const broken = { getItem () { throw new Error('denied') }, setItem () { throw new Error('denied') } }
    expect(shouldAutoAttempt('app.abc.js', broken)).toBe(true)
  })
})

// Bug report (Matt, 2026-09-21): "it reloads the page, but it still tells
// me there's a new version, and then it tries to reload" — a plain reload
// goes through a service worker that never took the update, so the second
// attempt for the same target has to stop trusting the worker.
describe('reloadForUpdate', () => {
  const memoryStorage = () => {
    const map = new Map()
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    }
  }
  const harness = ({ outcome = 'settled', reachable = true } = {}) => ({
    storage: memoryStorage(),
    reload: vi.fn(),
    hard: vi.fn(),
    wait: vi.fn(async () => outcome),
    canFetchNewApp: vi.fn(async () => reachable)
  })

  it('the first attempt for an update is an ordinary reload', async () => {
    const h = harness()
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.hard).not.toHaveBeenCalled()
  })

  it('a second attempt for the SAME update goes hard instead of looping', async () => {
    const h = harness()
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.hard).toHaveBeenCalledTimes(1)
  })

  // 2026-09-29 refresh loop: with no known target, every attempt used to
  // look like the first, so the escalation never kicked in.
  it('a repeat attempt with no known target still counts as a repeat', async () => {
    const h = harness()
    await reloadForUpdate({ target: null, ...h })
    await reloadForUpdate({ target: null, ...h })
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.hard).toHaveBeenCalledTimes(1)
  })

  it('a NEWER deploy starts over with an ordinary reload', async () => {
    const h = harness()
    await reloadForUpdate({ target: 'js/app.one.js', ...h })
    await reloadForUpdate({ target: 'js/app.two.js', ...h })
    expect(h.reload).toHaveBeenCalledTimes(2)
    expect(h.hard).not.toHaveBeenCalled()
  })

  it('once the update has landed, the next one is ordinary again', async () => {
    const h = harness()
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    markUpdateLanded(h.storage)
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    expect(h.reload).toHaveBeenCalledTimes(2)
    expect(h.hard).not.toHaveBeenCalled()
  })

  it('a worker still installing when the wait runs out means a hard reload right away', async () => {
    const h = harness({ outcome: 'stuck' })
    await reloadForUpdate({ target: 'js/app.new.js', ...h })
    expect(h.reload).not.toHaveBeenCalled()
    expect(h.hard).toHaveBeenCalledTimes(1)
  })
})

// Bug report (Matt, 2026-09-30, one bar of signal at his therapist's): the
// new worker couldn't finish downloading in 15s on that connection, so the
// update went hard - threw away the app on the phone and reloaded from the
// internet - and he got a half-loaded page and a loading bar that never
// finished. A hard reload now needs the new app to be downloadable first.
describe('reloadForUpdate on a connection that can\'t carry the new app', () => {
  const memoryStorage = () => {
    const map = new Map()
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k)
    }
  }

  it('a stuck install keeps the working app instead of wiping it', async () => {
    const h = { storage: memoryStorage(), reload: vi.fn(), hard: vi.fn(), wait: vi.fn(async () => 'stuck'), canFetchNewApp: vi.fn(async () => false) }
    expect(await reloadForUpdate({ target: 'js/app.new.js', ...h })).toBe('deferred')
    expect(h.canFetchNewApp).toHaveBeenCalledWith('js/app.new.js')
    expect(h.hard).not.toHaveBeenCalled()
    expect(h.reload).not.toHaveBeenCalled()
  })

  it('a repeat attempt keeps the working app too, and goes hard once the connection can carry it', async () => {
    let reachable = false
    const h = { storage: memoryStorage(), reload: vi.fn(), hard: vi.fn(), wait: vi.fn(async () => 'settled'), canFetchNewApp: vi.fn(async () => reachable) }
    expect(await reloadForUpdate({ target: 'js/app.new.js', ...h })).toBe('reloaded')
    expect(await reloadForUpdate({ target: 'js/app.new.js', ...h })).toBe('deferred')
    expect(h.hard).not.toHaveBeenCalled()
    reachable = true
    expect(await reloadForUpdate({ target: 'js/app.new.js', ...h })).toBe('hard')
    expect(h.hard).toHaveBeenCalledTimes(1)
  })

  it('a probe that throws counts as unreachable', async () => {
    const h = { storage: memoryStorage(), reload: vi.fn(), hard: vi.fn(), wait: vi.fn(async () => 'stuck'), canFetchNewApp: vi.fn(async () => { throw new Error('boom') }) }
    expect(await reloadForUpdate({ target: 'js/app.new.js', ...h })).toBe('deferred')
    expect(h.hard).not.toHaveBeenCalled()
  })
})

describe('newAppIsReachable', () => {
  const ok = (body = '') => ({ ok: true, text: async () => body, arrayBuffer: async () => new ArrayBuffer(8) })

  it('downloads the target bundle itself', async () => {
    const fetchImpl = vi.fn(async () => ok())
    expect(await newAppIsReachable('js/app.new.js', { fetchImpl })).toBe(true)
    expect(fetchImpl.mock.calls[0][0]).toBe('/js/app.new.js')
  })

  it('with no known target, reads the bundle name off the deployed page first', async () => {
    const fetchImpl = vi.fn(async (url) => ok(url.includes('index.html') ? '<script src="/js/app.abc123.js">' : ''))
    expect(await newAppIsReachable(null, { fetchImpl })).toBe(true)
    expect(fetchImpl.mock.calls[1][0]).toBe('/js/app.abc123.js')
  })

  it('a download that does not finish in time is unreachable', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const result = newAppIsReachable('js/app.new.js', { fetchImpl, timeoutMs: 10000 })
    await vi.advanceTimersByTimeAsync(10001)
    expect(await result).toBe(false)
    vi.useRealTimers()
  })

  it('a server error is unreachable', async () => {
    expect(await newAppIsReachable('js/app.new.js', { fetchImpl: async () => ({ ok: false }) })).toBe(false)
  })
})

describe('waitForNewWorker', () => {
  it('does not wait on an update check that never answers', async () => {
    const registration = { installing: null, waiting: null, update: () => new Promise(() => {}) }
    const sleep = vi.fn(async () => {})
    expect(await waitForNewWorker(15000, { getRegistration: async () => registration, sleep })).toBe('settled')
  })

  it('reports stuck when a worker is still installing at the deadline, nudging any waiting one', async () => {
    const waiting = { postMessage: vi.fn() }
    const registration = { installing: {}, waiting, update: vi.fn(async () => {}) }
    const outcome = await waitForNewWorker(1, { getRegistration: async () => registration, sleep: async () => {} })
    expect(outcome).toBe('stuck')
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('settles once nothing is installing or waiting', async () => {
    const registration = { installing: {}, waiting: null, update: vi.fn(async () => {}) }
    const sleep = vi.fn(async () => { registration.installing = null })
    expect(await waitForNewWorker(5000, { getRegistration: async () => registration, sleep })).toBe('settled')
  })

  it('settles when there is no registration at all', async () => {
    expect(await waitForNewWorker(1, { getRegistration: async () => null })).toBe('settled')
  })
})

describe('hardReload', () => {
  it('drops every cache but the posters and navigates to a never-seen URL', async () => {
    const deleted = []
    const cacheStorage = {
      keys: async () => ['cinema-roll-precache-v2-https://www.cinemaroll.org/', 'tmdb-images', 'workbox-runtime'],
      delete: async (name) => { deleted.push(name); return true }
    }
    const replace = vi.fn()
    await hardReload({ cacheStorage, replace, href: () => 'https://www.cinemaroll.org/#/watchlist' })
    expect(deleted).toEqual(['cinema-roll-precache-v2-https://www.cinemaroll.org/', 'workbox-runtime'])
    const url = new URL(replace.mock.calls[0][0])
    expect(url.searchParams.get('fresh')).toMatch(/^\d+$/)
    expect(url.hash).toBe('#/watchlist')
  })

  it('still navigates when the cache API is unavailable', async () => {
    const replace = vi.fn()
    await hardReload({ cacheStorage: null, replace, href: () => 'https://www.cinemaroll.org/' })
    expect(replace).toHaveBeenCalledTimes(1)
  })
})

// Bug report (Matt, 2026-09-30): "that message used to flash for just an
// instant and then it would always automatically refresh... now I feel like
// sometimes I'm sitting there waiting."
describe('isFreshMoment', () => {
  it('is fresh just after opening, whatever the timing', () => {
    expect(isFreshMoment({ now: 3000, becameVisibleAt: 0, lastTouchAt: 2000 })).toBe(true)
  })

  it('stays fresh past 5 seconds when nothing has been touched since opening (a slow check)', () => {
    expect(isFreshMoment({ now: 14000, becameVisibleAt: 0, lastTouchAt: 0 })).toBe(true)
  })

  it('is not fresh once the user has touched the app since opening', () => {
    expect(isFreshMoment({ now: 14000, becameVisibleAt: 0, lastTouchAt: 9000 })).toBe(false)
  })
})

describe('runUpdateCheck', () => {
  it('compares the deployed bundle without waiting for the worker check', async () => {
    let checked = false
    const refreshWorker = () => new Promise(() => {}) // a worker download that never finishes
    const checkBundle = vi.fn(async () => { checked = true })
    const done = runUpdateCheck({ refreshWorker, checkBundle, sleep: () => new Promise((resolve) => setTimeout(resolve, 20)) })
    await Promise.resolve(); await Promise.resolve()
    expect(checked).toBe(true)
    await done // and the whole check still finishes, capped
  })

  it('a failing worker check never stops the bundle comparison', async () => {
    const checkBundle = vi.fn(async () => {})
    await runUpdateCheck({ refreshWorker: async () => { throw new Error('boom') }, checkBundle })
    expect(checkBundle).toHaveBeenCalledTimes(1)
  })
})

describe('reloadForUpdate while an attempt is already running', () => {
  it('a tap during the automatic update joins it instead of forcing a hard reload', async () => {
    const map = new Map()
    const storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }
    let finishWait
    const h = {
      storage,
      reload: vi.fn(),
      hard: vi.fn(),
      wait: vi.fn(() => new Promise((resolve) => { finishWait = resolve })),
      canFetchNewApp: vi.fn(async () => true)
    }
    const automatic = reloadForUpdate({ target: 'js/app.new.js', ...h })
    const tapped = reloadForUpdate({ target: 'js/app.new.js', ...h })
    finishWait('settled')
    expect(await automatic).toBe('reloaded')
    expect(await tapped).toBe('reloaded')
    expect(h.reload).toHaveBeenCalledTimes(1)
    expect(h.hard).not.toHaveBeenCalled()
  })
})

// Bug report (Matt, 2026-10-01): "The auto refresh is still taking like five
// seconds. I feel like it used to take like maybe one second at most." The
// update check asked the worker for a new version; the bundle comparison won
// the race, the refresh started, and asked the worker AGAIN. On the phone that
// second ask queues behind the first one's install and doesn't answer - only
// the 5-second cap ended the wait.
describe('the refresh after an update check', () => {
  const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  function phoneWhoseSecondCheckHangs () {
    const registration = { installing: null, waiting: null, calls: 0 }
    registration.update = vi.fn(() => {
      registration.calls += 1
      if (registration.calls > 1) return new Promise(() => {}) // queued behind the first, never answers
      registration.installing = {}
      return new Promise((resolve) => setTimeout(() => {
        registration.installing = null // the new worker installed and took over
        resolve()
      }, 100))
    })
    return registration
  }

  it('joins the check already under way instead of waiting out a second one', async () => {
    vi.useFakeTimers()
    try {
      const registration = phoneWhoseSecondCheckHangs()
      checkWorkerOnce(registration) // App.vue's update check
      let outcome = null
      const waiting = waitForNewWorker(15000, { getRegistration: async () => registration, sleep: realSleep })
      waiting.then((result) => { outcome = result; return result }).catch(() => {})
      await vi.advanceTimersByTimeAsync(600)
      expect(outcome).toBe('settled') // well under a second, not five
      expect(registration.update).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not ask again right after a check has finished', async () => {
    const registration = { installing: null, waiting: null, update: vi.fn(async () => {}) }
    await checkWorkerOnce(registration)
    await checkWorkerOnce(registration)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('does not ask while a new worker is already installing', async () => {
    const registration = { installing: {}, waiting: null, update: vi.fn(async () => {}) }
    await checkWorkerOnce(registration)
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('asks again once the last check is old news', async () => {
    let clock = 0
    const now = () => clock
    const registration = { installing: null, waiting: null, update: vi.fn(async () => {}) }
    await checkWorkerOnce(registration, { now })
    clock = 60000
    await checkWorkerOnce(registration, { now })
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('wakes as soon as the new worker changes state instead of on the next tick', async () => {
    const listeners = {}
    const installing = {
      addEventListener: (type, fn) => { listeners[type] = fn },
      removeEventListener: vi.fn()
    }
    const registration = { installing, waiting: null, update: vi.fn(async () => {}) }
    const neverTicks = (ms) => (ms === 250 ? new Promise(() => {}) : Promise.resolve())
    const done = waitForNewWorker(15000, { getRegistration: async () => registration, sleep: neverTicks })
    await new Promise((resolve) => setTimeout(resolve, 0))
    registration.installing = null
    listeners.statechange()
    expect(await done).toBe('settled')
    expect(installing.removeEventListener).toHaveBeenCalledWith('statechange', listeners.statechange)
  })
})

describe('update timing for bug reports', () => {
  function memoryStorage () {
    const map = new Map()
    return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }
  }

  it('records how long each step took, and when the new version landed', async () => {
    const storage = memoryStorage()
    let clock = 1000
    const now = () => clock
    await reloadForUpdate({
      target: 'js/app.new.js',
      storage,
      now,
      sinceVisibleMs: 1200,
      reload: vi.fn(),
      hard: vi.fn(),
      wait: async () => { clock += 300; return 'settled' }
    })
    expect(getUpdateTiming(storage)).toMatchObject({ target: 'js/app.new.js', sinceVisibleMs: 1200, waitMs: 300, wait: 'settled', result: 'reloaded' })
    markUpdateLanded(storage, { now: () => 2500 })
    expect(getUpdateTiming(storage).landedMs).toBe(1500)
    markUpdateLanded(storage, { now: () => 9999 }) // later checks don't overwrite it
    expect(getUpdateTiming(storage).landedMs).toBe(1500)
  })
})
