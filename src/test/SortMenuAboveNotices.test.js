import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import Home from '@/components/Home.vue'

vi.mock('axios', () => ({ default: { get: vi.fn() } }))
vi.mock('lodash/uniq', () => ({ default: vi.fn((arr) => [...new Set(arr)]) }))
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8, normalizedRating: 8 }))
}))

// Bug report, 2026-11-02: "The notification box is standing on top of the
// sort list, and it should go the other way around." Back on Home with
// "kill bill" still typed, the restore filled the box but not searchValue,
// so searchPending stayed true: the rainbow wrapper sat at opacity 0.7, an
// opacity stacking context that trapped the sort menu's z-index, and the
// notice card below painted over the open menu.

function factory () {
  const movies = [
    { movie: { id: 1, title: 'Kill Bill: Vol. 1', flatKeywords: [], poster_path: '/p.jpg' }, ratings: [{ calculatedTotal: 9, date: Date.now() }], dbKey: 'k1' }
  ]
  const mockStore = {
    state: reactive({
      dbLoaded: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: null,
      academyAwardWinners: {},
      settings: { normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} } },
      bannerUrl: null, bannerRequest: null, filteredResults: [],
      homePageScrollPosition: 0,
      homePageSearchChips: [{ type: 'general', value: 'kill bill', id: 'temp-1', temp: true }],
      homePageSearchValue: 'kill bill',
      homePageNumberOfResults: 25, homePageNavigationIntent: null,
      homePageSortValue: null, homePageSortOrder: null, homePagePromoteGroup: null
    }),
    getters: { allMediaAsArray: movies, allMoviesAsArray: movies, allMediaSortedByRating: movies },
    commit: vi.fn(),
    dispatch: vi.fn()
  }
  return mount(Home, {
    global: {
      mocks: { $store: mockStore, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: true, NoResults: true, StickinessModal: true,
        TweakModal: true, InsetBrowserModal: true, PersonalAwardsModal: true,
        RatingCurveSettings: true
      }
    }
  })
}

describe('the sort menu opens above the notice card', () => {
  it('a restored search is not left "pending" (no fade on the rainbow)', async () => {
    const wrapper = factory()
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.inputValue).toBe('kill bill')
    expect(wrapper.vm.searchPending).toBe(false)
    expect(wrapper.find('.results-searching').exists()).toBe(false)
  })

  it('the rainbow wrapper is raised onto its own layer above the notices', () => {
    // jsdom does no stacking, so this reads the stylesheet: the bar wrapper
    // must be positioned with a z-index, which is what keeps its menu over
    // the later notice card even when something makes it a stacking context.
    const source = readFileSync(resolve(__dirname, '../components/Home.vue'), 'utf8')
    expect(source).toMatch(/class="results results-bar"/)
    const rule = source.match(/\.results\.results-bar\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    expect(rule[1]).toMatch(/position:\s*relative/)
    expect(rule[1]).toMatch(/z-index:\s*[1-9]/)
  })
})
