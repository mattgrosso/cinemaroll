import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Sentry, 2026-10-09: "TypeError: Load failed" from an iPhone, logged by the
// locations lookup that runs after a rating. The backfill covers a missed
// lookup, so a request nothing answered must be a warning (captureConsole
// turns every console.error into a Sentry event); Wikidata refusing stays
// an error.

const mockStore = vi.hoisted(() => ({
  state: { isOnline: true, movieLog: {}, settings: {} },
  getters: { databaseTopKey: 'tester', weight: () => 1 },
  commit: vi.fn(),
  dispatch: vi.fn(() => Promise.resolve())
}))
vi.mock('@/store/index', () => ({ default: mockStore }))
const locations = vi.hoisted(() => ({ fetchLocationsForIds: vi.fn() }))
vi.mock('@/assets/javascript/movieLocations.js', () => locations)

import { storeLocationsForRating } from '@/assets/javascript/AddRating.js'

const dbEntry = () => ({ path: 'tester/movieLog/550', value: { movie: { id: 550, title: 'Fight Club' } } })

describe('the locations lookup after a rating', () => {
  let warn
  let error

  beforeEach(() => {
    vi.clearAllMocks()
    locations.fetchLocationsForIds.mockReset()
    mockStore.state.isOnline = true
    mockStore.state.movieLog = { 550: dbEntry().value }
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('only warns when the request never got an answer', async () => {
    locations.fetchLocationsForIds.mockRejectedValue(new TypeError('Load failed'))
    await storeLocationsForRating(dbEntry())
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('only warns when the request timed out', async () => {
    locations.fetchLocationsForIds.mockRejectedValue(Object.assign(new Error('signal timed out'), { name: 'TimeoutError' }))
    await storeLocationsForRating(dbEntry())
    expect(error).not.toHaveBeenCalled()
  })

  it('retries once, then only warns, when Wikidata says slow down', async () => {
    locations.fetchLocationsForIds.mockRejectedValue(Object.assign(new Error('Wikidata query failed: 429'), { status: 429 }))
    await storeLocationsForRating(dbEntry(), { retryDelayMs: 0 })
    expect(locations.fetchLocationsForIds).toHaveBeenCalledTimes(2)
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('stores what the retry found after a 503', async () => {
    locations.fetchLocationsForIds
      .mockRejectedValueOnce(Object.assign(new Error('Wikidata query failed: 503'), { status: 503 }))
      .mockResolvedValueOnce({ 550: [{ label: 'Wilmington' }] })
    await storeLocationsForRating(dbEntry(), { retryDelayMs: 0 })
    expect(warn).not.toHaveBeenCalled()
    expect(mockStore.dispatch).toHaveBeenCalledWith('writeDatabaseEntryNow', {
      path: 'movieLog/550/movie/locations',
      value: [{ label: 'Wilmington' }]
    })
  })

  it('still reports Wikidata answering with an error', async () => {
    locations.fetchLocationsForIds.mockRejectedValue(new Error('Wikidata query failed: 500'))
    await storeLocationsForRating(dbEntry())
    expect(error).toHaveBeenCalledTimes(1)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stores what it found when the lookup works', async () => {
    locations.fetchLocationsForIds.mockResolvedValue({ 550: [{ label: 'Wilmington' }] })
    await storeLocationsForRating(dbEntry())
    expect(mockStore.dispatch).toHaveBeenCalledWith('writeDatabaseEntryNow', {
      path: 'movieLog/550/movie/locations',
      value: [{ label: 'Wilmington' }]
    })
  })
})
