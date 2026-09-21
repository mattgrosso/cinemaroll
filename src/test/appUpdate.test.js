import { describe, it, expect, vi } from 'vitest'
import { isSafeMomentForReload, shouldAutoAttempt, reloadForUpdate, hardReload, waitForNewWorker, markUpdateLanded } from '@/utils/appUpdate.js'

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

  it('attempts once per target bundle, then defers to the banner', () => {
    const storage = memoryStorage()
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(true)
    expect(shouldAutoAttempt('app.abc.js', storage)).toBe(false) // no reload loop
    expect(shouldAutoAttempt('app.def.js', storage)).toBe(true) // a NEWER deploy gets its own attempt
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
  const harness = ({ outcome = 'settled' } = {}) => ({
    storage: memoryStorage(),
    reload: vi.fn(),
    hard: vi.fn(),
    wait: vi.fn(async () => outcome)
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

  it('without a known target it never escalates (nothing to compare)', async () => {
    const h = harness()
    await reloadForUpdate({ ...h })
    await reloadForUpdate({ ...h })
    expect(h.reload).toHaveBeenCalledTimes(2)
    expect(h.hard).not.toHaveBeenCalled()
  })
})

describe('waitForNewWorker', () => {
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
