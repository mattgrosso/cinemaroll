import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { saveSnapshot, loadSnapshot, OPEN_TIMEOUT_MS } from '@/utils/offlineStore.js'

describe('offlineStore', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory() // eslint-disable-line no-global-assign
  })

  it('returns null for a snapshot that was never saved', async () => {
    const result = await loadSnapshot('some-user', 'movieLog')
    expect(result).toBeNull()
  })

  it('round-trips a saved snapshot', async () => {
    const data = { 'movie-1': { movie: { id: 1, title: 'Test Movie' } } }

    await saveSnapshot('some-user', 'movieLog', data)
    const result = await loadSnapshot('some-user', 'movieLog')

    expect(result).toEqual(data)
  })

  it('keeps movieLog and settings snapshots separate for the same user', async () => {
    await saveSnapshot('some-user', 'movieLog', { a: 1 })
    await saveSnapshot('some-user', 'settings', { b: 2 })

    expect(await loadSnapshot('some-user', 'movieLog')).toEqual({ a: 1 })
    expect(await loadSnapshot('some-user', 'settings')).toEqual({ b: 2 })
  })

  it('keeps snapshots separate per databaseTopKey', async () => {
    await saveSnapshot('user-a', 'movieLog', { owner: 'a' })
    await saveSnapshot('user-b', 'movieLog', { owner: 'b' })

    expect(await loadSnapshot('user-a', 'movieLog')).toEqual({ owner: 'a' })
    expect(await loadSnapshot('user-b', 'movieLog')).toEqual({ owner: 'b' })
  })

  it('overwrites a previous snapshot for the same key', async () => {
    await saveSnapshot('some-user', 'movieLog', { version: 1 })
    await saveSnapshot('some-user', 'movieLog', { version: 2 })

    expect(await loadSnapshot('some-user', 'movieLog')).toEqual({ version: 2 })
  })

  it('resolves to null instead of throwing when IndexedDB is unavailable', async () => {
    const realIndexedDB = indexedDB
    indexedDB = undefined // eslint-disable-line no-global-assign

    await expect(saveSnapshot('some-user', 'movieLog', { a: 1 })).resolves.toBeUndefined()
    await expect(loadSnapshot('some-user', 'movieLog')).resolves.toBeNull()

    indexedDB = realIndexedDB // eslint-disable-line no-global-assign
  })
})

// Bug report (Matt, 2026-09-30, one bar of signal): the saved copy is the
// only way the library appears when the live connection never answers, so
// an IndexedDB open that never settles is a spinner forever. WebKit has been
// known to leave the first open of a launch hanging.
describe('offlineStore when IndexedDB does not answer', () => {
  it('tries the open once more when the first one hangs', async () => {
    await saveSnapshot('some-user', 'movieLog', { a: 1 })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const realOpen = indexedDB.open.bind(indexedDB)
    let calls = 0
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      calls += 1
      return calls === 1 ? {} : realOpen(...args) // first open: no callbacks, ever
    })
    const result = loadSnapshot('some-user', 'movieLog')
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    expect(await result).toEqual({ a: 1 })
    vi.useRealTimers()
    spy.mockRestore()
  })

  it('gives up with null instead of hanging when IndexedDB never answers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const spy = vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}))
    const result = loadSnapshot('some-user', 'movieLog')
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 2 + 1)
    expect(await result).toBeNull()
    vi.useRealTimers()
    spy.mockRestore()
  })
})
