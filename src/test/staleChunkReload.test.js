import { describe, it, expect, vi } from 'vitest'
import { isStaleChunkError, handleRouterChunkError, lazyScreen } from '@/utils/staleChunkReload.js'

function memoryStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v))
  }
}

describe('isStaleChunkError', () => {
  it('recognizes webpack ChunkLoadError by name', () => {
    const error = new Error('Loading chunk awards failed.')
    error.name = 'ChunkLoadError'
    expect(isStaleChunkError(error)).toBe(true)
  })

  it('recognizes chunk failures by message across browser wordings', () => {
    expect(isStaleChunkError(new Error('Loading chunk 42 failed. (missing: https://x/js/awards.abc.js)'))).toBe(true)
    expect(isStaleChunkError(new Error('Loading CSS chunk games failed'))).toBe(true)
    expect(isStaleChunkError(new Error('error loading dynamically imported module'))).toBe(true)
    expect(isStaleChunkError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunkError(new Error('Unable to preload CSS for /css/Login.0caee1b3.css'))).toBe(true)
    expect(isStaleChunkError(new Error('Failed to fetch dynamically imported module: https://x/js/Login.abc.js'))).toBe(true)
  })

  it('ignores ordinary errors and absent errors', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
  })
})

describe('handleRouterChunkError', () => {
  const chunkError = () => {
    const error = new Error('Loading chunk awards failed.')
    error.name = 'ChunkLoadError'
    return error
  }

  it('reloads once for a stale chunk on a route', () => {
    const reload = vi.fn()
    const storage = memoryStorage()

    const handled = handleRouterChunkError(chunkError(), { fullPath: '/awards?year=1997' }, storage, reload)

    expect(handled).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('never reload-loops: a second failure on the same route this session is left alone', () => {
    const reload = vi.fn()
    const storage = memoryStorage()

    handleRouterChunkError(chunkError(), { fullPath: '/awards' }, storage, reload)
    const second = handleRouterChunkError(chunkError(), { fullPath: '/awards' }, storage, reload)

    expect(second).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a different route gets its own single attempt', () => {
    const reload = vi.fn()
    const storage = memoryStorage()

    handleRouterChunkError(chunkError(), { fullPath: '/awards' }, storage, reload)
    handleRouterChunkError(chunkError(), { fullPath: '/watchlist' }, storage, reload)

    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('does not reload for non-chunk navigation errors', () => {
    const reload = vi.fn()

    const handled = handleRouterChunkError(new Error('Navigation cancelled'), { fullPath: '/x' }, memoryStorage(), reload)

    expect(handled).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('still reloads when storage is unavailable (reload beats a dead screen)', () => {
    const reload = vi.fn()
    const broken = {
      getItem () { throw new Error('denied') },
      setItem () { throw new Error('denied') }
    }

    expect(handleRouterChunkError(chunkError(), { fullPath: '/x' }, broken, reload)).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

// Bug report (Matt, 2026-09-30, one bar of signal): a screen file left to
// the network on a there-but-not-really connection neither loads nor fails,
// so the loading bar crept across and stopped. With a worker in charge, a
// screen that hasn't arrived by the deadline becomes a ChunkLoadError, which
// the handler above turns into one reload onto the version the phone has.
describe('lazyScreen', () => {
  it('turns a screen that never arrives into a stale-chunk error, with a worker in charge', async () => {
    vi.useFakeTimers()
    const load = lazyScreen(() => new Promise(() => {}), { deadlineMs: 8000, hasWorker: () => true })
    const result = load().catch((error) => error)
    await vi.advanceTimersByTimeAsync(8001)
    const error = await result
    expect(isStaleChunkError(error)).toBe(true)
    vi.useRealTimers()
  })

  it('hands back the screen when it arrives in time', async () => {
    const screen = { name: 'Home' }
    const load = lazyScreen(async () => screen, { hasWorker: () => true })
    expect(await load()).toBe(screen)
  })

  it('puts no deadline on a page with no worker (first visit: slow is just slow)', async () => {
    vi.useFakeTimers()
    let settled = false
    const load = lazyScreen(() => new Promise(() => {}), { deadlineMs: 8000, hasWorker: () => false })
    load().finally(() => { settled = true }).catch(() => {})
    await vi.advanceTimersByTimeAsync(60000)
    expect(settled).toBe(false)
    vi.useRealTimers()
  })
})
