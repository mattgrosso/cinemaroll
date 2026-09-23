import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { reactive } from 'vue'
import { enqueueWrite, listPendingWrites, removePendingWrite } from '@/utils/pendingWriteQueue.js'

// Found 2026-09-23 reproducing lie-fi: RateMovie hands addRating its
// reactive `ratings` array, IndexedDB's structured clone refuses a Proxy
// ("[object Array] could not be cloned"), enqueueWrite swallowed it and
// returned null, and the user saw "offline storage is unavailable" with
// their rating gone. Every earlier test queued plain objects.
describe('pendingWriteQueue with reactive input', () => {
  beforeEach(async () => {
    for (const record of await listPendingWrites()) await removePendingWrite(record.id)
  })

  it('queues an entry built from Vue reactive state', async () => {
    const ratings = reactive([{ id: 'placeholder-1', title: 'Zzyzx', love: 9, tags: reactive(['a']) }])
    const entry = {
      type: 'placeholder',
      dbEntry: { path: 'movieLog/zzyzx', value: { movie: reactive({ title: 'Zzyzx', genres: [] }), ratings } },
      ratings,
      status: 'unreconciled'
    }

    const record = await enqueueWrite(entry)

    expect(record).not.toBeNull()
    const stored = (await listPendingWrites()).find((r) => r.id === record.id)
    expect(stored.dbEntry.value.ratings[0].title).toBe('Zzyzx')
    expect(stored.dbEntry.value.ratings[0].tags).toEqual(['a'])
    expect(stored.status).toBe('unreconciled')
  })
})
