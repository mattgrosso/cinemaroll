import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { enqueueWrite, listPendingWrites, removePendingWrite, updatePendingWrite, OPEN_TIMEOUT_MS } from '@/utils/pendingWriteQueue.js'

describe('pendingWriteQueue', () => {
  beforeEach(() => {
    indexedDB = new IDBFactory() // eslint-disable-line no-global-assign
  })

  it('returns an empty array when nothing has been queued', async () => {
    expect(await listPendingWrites()).toEqual([])
  })

  it('round-trips a queued write', async () => {
    const record = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/abc', value: { movie: { id: 1 } } } })

    expect(record.id).toBeTruthy()
    expect(record.createdAt).toBeTypeOf('number')
    expect(record.attempts).toBe(0)
    expect(record.lastError).toBeNull()

    const all = await listPendingWrites()
    expect(all).toHaveLength(1)
    expect(all[0].dbEntry.path).toBe('movieLog/abc')
  })

  it('lists entries oldest-first regardless of insertion/key order', async () => {
    const first = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/a', value: {} } })
    // Force a distinguishable createdAt without relying on real timing.
    await updatePendingWrite(first.id, { createdAt: 100 })
    const second = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/b', value: {} } })
    await updatePendingWrite(second.id, { createdAt: 50 })

    const all = await listPendingWrites()
    expect(all.map((entry) => entry.dbEntry.path)).toEqual(['movieLog/b', 'movieLog/a'])
  })

  it('dedupes repeated writes to the same path (type "write") by overwriting the existing entry in place', async () => {
    const first = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/abc', value: { version: 1 } } })
    const second = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/abc', value: { version: 2 } } })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBe(first.createdAt)

    const all = await listPendingWrites()
    expect(all).toHaveLength(1)
    expect(all[0].dbEntry.value.version).toBe(2)
  })

  it('does not dedupe placeholder entries by path - each is its own independent queue entry', async () => {
    await enqueueWrite({ type: 'placeholder', dbEntry: { path: 'movieLog/x', value: {} }, status: 'unreconciled' })
    await enqueueWrite({ type: 'placeholder', dbEntry: { path: 'movieLog/x', value: {} }, status: 'unreconciled' })

    const all = await listPendingWrites()
    expect(all).toHaveLength(2)
  })

  it('removes an entry by id', async () => {
    const record = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/abc', value: {} } })
    await removePendingWrite(record.id)

    expect(await listPendingWrites()).toEqual([])
  })

  it('merges a patch into an existing entry via updatePendingWrite', async () => {
    const record = await enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/abc', value: {} } })
    const updated = await updatePendingWrite(record.id, { attempts: 2, lastError: 'boom' })

    expect(updated.attempts).toBe(2)
    expect(updated.lastError).toBe('boom')
    expect(updated.dbEntry.path).toBe('movieLog/abc') // untouched fields preserved

    const all = await listPendingWrites()
    expect(all[0].attempts).toBe(2)
  })

  it('updatePendingWrite resolves null for a non-existent id', async () => {
    expect(await updatePendingWrite('does-not-exist', { attempts: 1 })).toBeNull()
  })

  it('resolves gracefully instead of throwing when IndexedDB is unavailable', async () => {
    const realIndexedDB = indexedDB
    indexedDB = undefined // eslint-disable-line no-global-assign

    await expect(enqueueWrite({ type: 'write', dbEntry: { path: 'movieLog/x', value: {} } })).resolves.toBeNull()
    await expect(listPendingWrites()).resolves.toEqual([])
    await expect(removePendingWrite('x')).resolves.toBeUndefined()
    await expect(updatePendingWrite('x', {})).resolves.toBeNull()

    indexedDB = realIndexedDB // eslint-disable-line no-global-assign
  })
})

// Sentry, 2026-10-11 (Safari on a Mac): "pendingWriteQueue: could not enqueue
// write settings/dailyAwardsYear Error: IndexedDB open timed out after 6000ms".
// WebKit can leave the first open of a launch unanswered; a second open goes
// straight through (offlineStore.js already retries for that reason).
describe('pendingWriteQueue when the first IndexedDB open hangs', () => {
  let openSpy
  let errorSpy
  let warnSpy

  beforeEach(() => {
    indexedDB = new IDBFactory() // eslint-disable-line no-global-assign
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy.mockClear()
    warnSpy.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    openSpy?.mockRestore()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  // First open: a request whose callbacks never fire.
  const hangFirstOpen = () => {
    const realOpen = indexedDB.open.bind(indexedDB)
    let calls = 0
    openSpy = vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
      calls += 1
      return calls === 1 ? {} : realOpen(...args)
    })
  }
  const hangEveryOpen = () => {
    openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}))
  }

  it('queues the write on a second open', async () => {
    hangFirstOpen()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const result = enqueueWrite({ type: 'write', dbEntry: { path: 'settings/dailyAwardsYear', value: 1999 } })
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    const record = await result
    vi.useRealTimers()

    expect(record?.dbEntry.path).toBe('settings/dailyAwardsYear')
    expect(errorSpy).not.toHaveBeenCalled()
    expect(await listPendingWrites()).toHaveLength(1)
  })

  it('lists, updates and removes through a hung first open too', async () => {
    const record = await enqueueWrite({ type: 'write', dbEntry: { path: 'settings/x', value: 1 } })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    hangFirstOpen()
    const pending = listPendingWrites()
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    expect(await pending).toHaveLength(1)
    openSpy.mockRestore()

    hangFirstOpen()
    const updated = updatePendingWrite(record.id, { attempts: 2 })
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    expect((await updated)?.attempts).toBe(2)
    openSpy.mockRestore()

    hangFirstOpen()
    const removed = removePendingWrite(record.id)
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1)
    await removed
    openSpy.mockRestore()

    vi.useRealTimers()
    expect(await listPendingWrites()).toEqual([])
  })

  it('gives up instead of hanging when IndexedDB never answers', async () => {
    hangEveryOpen()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const queued = enqueueWrite({ type: 'write', dbEntry: { path: 'settings/x', value: 1 } })
    const listed = listPendingWrites()
    const updated = updatePendingWrite('nope', { attempts: 1 })
    const removed = removePendingWrite('nope')
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 2 + 1)
    expect(await queued).toBeNull()
    expect(await listed).toEqual([])
    expect(await updated).toBeNull()
    await removed
  })

  it('a stall is a warning when the caller is also writing to the server', async () => {
    hangEveryOpen()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const queued = enqueueWrite({ type: 'write', dbEntry: { path: 'settings/x', value: 1 } }, { online: true })
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 2 + 1)
    expect(await queued).toBeNull()
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith('pendingWriteQueue: could not enqueue', 'write', 'settings/x', expect.any(Error))
  })

  it('a stall stays an error offline, where the queue is the only copy', async () => {
    hangEveryOpen()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const queued = enqueueWrite({ type: 'write', dbEntry: { path: 'settings/x', value: 1 } }, { online: false })
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS * 2 + 1)
    expect(await queued).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith('pendingWriteQueue: could not enqueue', 'write', 'settings/x', expect.any(Error))
  })

  it('a refused open stays an error even online', async () => {
    openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const request = {}
      setTimeout(() => { request.error = new Error('UnknownError'); request.onerror?.() }, 0)
      return request
    })
    const queued = await enqueueWrite({ type: 'write', dbEntry: { path: 'settings/x', value: 1 } }, { online: true })
    expect(queued).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
    expect(openSpy).toHaveBeenCalledTimes(1)
  })
})
