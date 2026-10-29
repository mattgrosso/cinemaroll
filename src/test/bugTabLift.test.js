import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'

// Report 2026-10-29: on the right, the bug tab sat on the rating page's
// Cover Flow strip and its pin button. While the strip is pinned to the
// bottom edge, the page raises the tab above it through --bug-tab-lift
// (src/utils/bugTabLift.js); unpinned, or off the page, the tab goes home.

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))
vi.mock('@/assets/javascript/AddRating.js', () => ({ default: vi.fn() }))
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5, normalizedRating: 5 })),
  getAllRatings: vi.fn(() => null)
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }))

const film = { id: 555, title: 'Under Test', release_date: '2020-06-01', poster_path: '/u.jpg', backdrop_path: '/b.jpg' }

const lift = () => document.documentElement.style.getPropertyValue('--bug-tab-lift')

function mountRateMovie () {
  localStorage.clear()
  const $store = {
    state: { movieLog: {}, movieToRate: film, settings: {}, weights: [{ name: 'overall', weight: 2 }], databaseTopKey: 'test-user' },
    getters: { allMoviesAsArray: [] },
    commit: vi.fn(),
    dispatch: vi.fn()
  }
  return mount(RateMovie, {
    attachTo: document.body,
    global: { mocks: { $store, $route: { query: {} }, $router: { push: vi.fn() } } }
  })
}

describe('the bug tab on the rating page', () => {
  let footer
  afterEach(() => {
    footer?.remove()
    document.documentElement.style.removeProperty('--bug-tab-lift')
  })

  // jsdom does no layout, so the strip and footer get their heights by hand.
  function fakeHeights (w, strip, foot) {
    Object.defineProperty(w.find('.neighbors').element, 'offsetHeight', { configurable: true, value: strip })
    footer = document.createElement('footer')
    Object.defineProperty(footer, 'offsetHeight', { configurable: true, value: foot })
    document.body.appendChild(footer)
  }

  it('rises above the pinned strip, footer included, and comes back down when unpinned', async () => {
    const w = mountRateMovie()
    fakeHeights(w, 200, 30)
    w.vm.liftBugTab()
    expect(lift()).toBe('238px')

    await w.find('.hide-neighbors').trigger('click')
    expect(lift()).toBe('')

    await w.find('.hide-neighbors').trigger('click')
    expect(lift()).toBe('238px')
    w.unmount()
  })

  it('goes home when the rating page closes', () => {
    const w = mountRateMovie()
    fakeHeights(w, 200, 30)
    w.vm.liftBugTab()
    expect(lift()).toBe('238px')
    w.unmount()
    expect(lift()).toBe('')
  })
})
