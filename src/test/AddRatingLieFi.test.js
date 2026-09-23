import { describe, it, expect, vi, beforeEach } from 'vitest'

// The lie-fi fallback in addRating (2026-09-23): a brand-new movie picked
// from TMDB search results, whose TMDB detail fetch then never answers.
// Until this it threw, RateMovie said "check your connection and try
// again", and the rating the user had just typed was gone.

const mockStore = vi.hoisted(() => ({
  state: { isOnline: true, movieLog: {}, settings: {} },
  getters: { databaseTopKey: 'tester', weight: () => 1 },
  commit: vi.fn(),
  dispatch: vi.fn(() => Promise.resolve())
}))
vi.mock('@/store/index', () => ({ default: mockStore }))
vi.mock('axios', () => ({
  default: { get: vi.fn(() => Promise.reject(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }))) }
}))
const queue = vi.hoisted(() => ({
  enqueueWrite: vi.fn(async (entry) => ({ id: 'q1', ...entry })),
  removePendingWrite: vi.fn(async () => {}),
  updatePendingWrite: vi.fn(async () => {})
}))
vi.mock('@/utils/pendingWriteQueue.js', () => queue)
vi.mock('@/assets/javascript/offlinePosterCache.js', () => ({ warmImageCache: vi.fn(), posterUrl: () => null, backdropUrl: () => null }))
vi.mock('@/assets/javascript/movieLocations.js', () => ({ fetchLocationsForIds: vi.fn(async () => ({})) }))

import addRating from '@/assets/javascript/AddRating.js'
import { isPlaceholderId } from '@/utils/placeholderId.js'

const searchResultRating = () => ({
  id: 550,
  title: 'Fight Club',
  release_date: '1999-10-15',
  poster_path: '/fight.jpg',
  backdrop_path: '/fight-bg.jpg',
  love: 9, overall: 9, story: 8, direction: 9, imagery: 8, performance: 9, soundtrack: 7, stickiness: 4,
  date: '2026-09-23'
})

describe('addRating when TMDB never answers (lie-fi)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.state.movieLog = {}
    mockStore.state.isOnline = true
  })

  it('saves the rating as a placeholder instead of throwing it away', async () => {
    const dbEntry = await addRating([searchResultRating()])

    expect(dbEntry).toBeTruthy()
    const { movie, ratings } = dbEntry.value
    expect(movie.isPendingReconciliation).toBe(true)
    expect(isPlaceholderId(movie.id)).toBe(true)
    expect(ratings[0].id).toBe(movie.id)
    // What the search result already knew survives, so the card is not a
    // grey box with the wrong year.
    expect(movie.title).toBe('Fight Club')
    expect(movie.poster_path).toBe('/fight.jpg')
    expect(movie.release_date).toBe('1999-10-15')
    // And the real id rides along for reconciliation.
    expect(movie.pendingTmdbId).toBe(550)
  })

  it('queues it durably as a placeholder, like an offline rating', async () => {
    await addRating([searchResultRating()])

    expect(queue.enqueueWrite).toHaveBeenCalledTimes(1)
    const entry = queue.enqueueWrite.mock.calls[0][0]
    expect(entry.type).toBe('placeholder')
    expect(entry.status).toBe('unreconciled')
    expect(entry.title).toBe('Fight Club')
    // The optimistic local commit still happens, so it shows up at once.
    expect(mockStore.commit).toHaveBeenCalledWith('setMovieLogEntry', expect.objectContaining({ key: expect.any(String) }))
  })

  it('still throws for a movie already in the library, whose stored data would have been used instead', async () => {
    // (addMovieRating falls back to local data for an existing entry, so
    // this only guards the fallback's own precondition.)
    const rating = { ...searchResultRating(), title: '' }
    await expect(addRating([rating])).rejects.toBeTruthy()
    expect(queue.enqueueWrite).not.toHaveBeenCalled()
  })
})
