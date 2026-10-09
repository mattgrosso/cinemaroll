import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'

// Sentry, 2026-10-09: "[ErrorLog] Failed to fetch keywords [object Object]".
// Keywords are optional, so an expected failure (no connection, endpoint busy)
// must not be a console.error - captureConsole turns those into Sentry events -
// and a real failure must say what went wrong in the message itself.
const postToAi = vi.fn()
vi.mock('@/utils/aiRequest.js', async (importOriginal) => ({
  ...(await importOriginal()),
  postToAi: (...args) => postToAi(...args)
}))

const errorLog = { error: vi.fn(), warn: vi.fn() }
vi.mock('@/services/ErrorLogService.js', () => ({ default: errorLog }))

const { default: RateMovie } = await import('@/components/RateMovie.vue')

function mountWith (movieToRate = { id: 555, title: 'Jaws', release_date: '1975-06-20' }) {
  return shallowMount(RateMovie, {
    global: {
      mocks: {
        $store: {
          state: {
            movieLog: {},
            movieToRate,
            settings: { tags: {} },
            weights: [{ name: 'overall', weight: 2 }],
            databaseTopKey: 'test-user'
          },
          getters: { allMoviesAsArray: [] },
          commit: vi.fn(),
          dispatch: vi.fn()
        },
        $route: { query: {} },
        $router: { push: vi.fn() }
      },
      stubs: { Modal: true, ToggleableRating: true, StickinessInline: true }
    }
  })
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('RateMovie keyword failures', () => {
  beforeEach(() => {
    postToAi.mockReset()
    errorLog.error.mockReset()
    errorLog.warn.mockReset()
  })

  it('keeps the keywords it is given', async () => {
    postToAi.mockResolvedValue({ data: { keywords: ['shark', 'beach'] } })
    const wrapper = mountWith()
    await flush()
    expect(wrapper.vm.chatGPTKeywords).toEqual(['shark', 'beach'])
  })

  it('a dropped connection is a warning naming the reason, not an error', async () => {
    postToAi.mockRejectedValue({ isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' })
    const wrapper = mountWith()
    await flush()
    expect(errorLog.error).not.toHaveBeenCalled()
    expect(errorLog.warn).toHaveBeenCalledWith('Keywords unavailable: no answer (ERR_NETWORK)')
    expect(wrapper.vm.chatGPTKeywords).toEqual([])
  })

  it('a busy endpoint (429) is a warning too', async () => {
    postToAi.mockRejectedValue({ response: { status: 429, data: { error: 'Too many requests, slow down' } } })
    mountWith()
    await flush()
    expect(errorLog.error).not.toHaveBeenCalled()
    expect(errorLog.warn).toHaveBeenCalledWith('Keywords unavailable: status 429: Too many requests, slow down')
  })

  it('a server failure is an error whose message says what happened', async () => {
    postToAi.mockRejectedValue({ response: { status: 500, data: { error: 'AI request failed', detail: 'Unexpected end of JSON input' } } })
    mountWith()
    await flush()
    expect(errorLog.error).toHaveBeenCalledWith('Failed to fetch keywords: status 500: Unexpected end of JSON input')
    expect(errorLog.error.mock.calls[0][0]).not.toContain('[object Object]')
  })

  // Sentry, 2026-10-09: "Request failed with status code 400" - a reload on
  // the Rate screen left no film in memory and the ask went out with no title.
  it('does not ask for keywords when there is no film to ask about', async () => {
    mountWith({})
    await flush()
    expect(postToAi).not.toHaveBeenCalled()
    expect(errorLog.error).not.toHaveBeenCalled()
  })
})
