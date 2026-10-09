import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import LetterboxdScrapingService from '@/services/LetterboxdScrapingService.js'

// Sentry, 2026-10-09: "No working proxy found" on a movie page. The free
// CORS proxies the fallback scraper relies on were all down, every caller
// tried all three again, and the failure came back as made-up films that
// were then cached for a day as the member's own.
describe('LetterboxdScrapingService when every proxy fails', () => {
  let fetchMock

  beforeEach(() => {
    localStorage.clear()
    fetchMock = vi.fn(async () => ({ ok: false, headers: { get: () => '' } }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('answers nothing, and caches no stand-in films', async () => {
    expect(await LetterboxdScrapingService.getUserData('someone')).toBeNull()
    expect(localStorage.getItem(LetterboxdScrapingService.getCacheKey('someone'))).toBeNull()
  })

  it('says so quietly: a warning, never a console.error (Sentry captures those)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await LetterboxdScrapingService.getUserData('someone')
    expect(error).not.toHaveBeenCalled()
  })

  it('remembers the failure for a day instead of trying the proxies again', async () => {
    await LetterboxdScrapingService.getUserData('someone')
    const calls = fetchMock.mock.calls.length
    expect(calls).toBe(3)
    expect(await LetterboxdScrapingService.getUserData('someone')).toBeNull()
    expect(fetchMock.mock.calls.length).toBe(calls)
  })

  it('tries again after a day, or when asked to refresh', async () => {
    await LetterboxdScrapingService.getUserData('someone')
    await LetterboxdScrapingService.getUserData('someone', true)
    expect(fetchMock.mock.calls.length).toBe(6)
    localStorage.setItem(LetterboxdScrapingService.getFailureKey('someone'), String(Date.now() - 25 * 60 * 60 * 1000))
    await LetterboxdScrapingService.getUserData('someone')
    expect(fetchMock.mock.calls.length).toBe(9)
  })
})
