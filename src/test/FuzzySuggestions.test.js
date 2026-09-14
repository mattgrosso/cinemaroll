import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import Home from '@/components/Home.vue'

vi.mock('axios', () => ({
  default: { get: vi.fn() }
}))

vi.mock('lodash/debounce', () => ({
  default: vi.fn((fn) => fn)
}))

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8.25, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}))

// A small rated library covering each fuzzy-matchable field: title, director,
// cast, keyword, genre, company.
const makeMovies = () => ([
  {
    movie: {
      id: 1,
      title: "Schindler's List",
      release_date: '1993-12-15',
      genres: [{ name: 'Drama' }],
      cast: [{ name: 'Liam Neeson' }],
      crew: [{ name: 'Steven Spielberg', job: 'Director' }],
      production_companies: [{ name: 'Amblin Entertainment' }],
      keywords: [{ name: 'holocaust' }]
    },
    ratings: [{ calculatedTotal: 9.5, date: '2023-01-01' }],
    dbKey: 'movie-1'
  },
  {
    movie: {
      id: 2,
      title: 'Arrival',
      release_date: '2016-11-11',
      genres: [{ name: 'Science Fiction' }],
      cast: [{ name: 'Amy Adams' }],
      crew: [{ name: 'Denis Villeneuve', job: 'Director' }],
      production_companies: [{ name: 'FilmNation Entertainment' }],
      keywords: [{ name: 'aliens' }]
    },
    ratings: [{ calculatedTotal: 9.0, date: '2023-02-01' }],
    dbKey: 'movie-2'
  }
])

const mountHome = (settings = {}) => {
  const mockMovies = makeMovies()
  const mockStore = {
    state: reactive({
      dbLoaded: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: {
        normalizationTweak: 0.25,
        tieBreakTweak: 1,
        includeShorts: false,
        tags: { 'viewing-tags': {} },
        ...settings
      },
      filteredResults: [],
      homePageScrollPosition: 0,
      homePageSearchChips: [],
      homePageSearchValue: '',
      homePageNumberOfResults: 25,
      homePageNavigationIntent: null,
      homePageSortValue: null,
      homePageSortOrder: null,
      homePagePromoteGroup: null
    }),
    getters: {
      allMediaAsArray: mockMovies,
      allMoviesAsArray: mockMovies,
      allMediaSortedByRating: [...mockMovies].sort((a, b) => b.ratings[0].calculatedTotal - a.ratings[0].calculatedTotal)
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  const wrapper = mount(Home, {
    global: {
      mocks: { $store: mockStore, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: {
          template: '<div data-testid="db-grid-result">{{ result.movie.title }}</div>',
          props: ['result', 'keywordCounts', 'allCounts', 'index', 'resultsAreFiltered', 'sortValue', 'activeQuickLinkList']
        },
        NoResults: {
          template: '<div data-testid="no-results">Search TMDB</div>',
          props: ['value', 'suggestionsMode']
        },
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true
      }
    }
  })

  return { wrapper, mockStore }
}

describe('Fuzzy "Did you mean?" suggestions', () => {
  let wrapper

  beforeEach(async () => {
    ({ wrapper } = mountHome())
  })

  describe('the searchable index', () => {
    it('includes typed terms from every fuzzy-matchable field', () => {
      const terms = wrapper.vm.searchableTerms
      const byValue = (v) => terms.find(t => t.value === v)

      expect(byValue("Schindler's List")?.expectedType).toBe(null) // title -> general
      expect(byValue('Steven Spielberg')?.expectedType).toBe('director')
      expect(byValue('Liam Neeson')?.expectedType).toBe('cast/crew')
      expect(byValue('holocaust')?.expectedType).toBe('keyword')
      expect(byValue('Drama')?.expectedType).toBe('genre')
      expect(byValue('Amblin Entertainment')?.expectedType).toBe('studios')
    })
  })

  describe('zero-results gating', () => {
    it('returns no suggestions when local results exist (does not run on the hot path)', async () => {
      // A real, matching search -> there are results, so no fuzzy work.
      wrapper.vm.searchValue = 'arrival'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.paginatedSortedResults.length).toBeGreaterThan(0)
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([])
    })

    it('returns no suggestions for terms shorter than 3 characters', async () => {
      wrapper.vm.searchValue = 'sp'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([])
    })

    it('offers suggestions only when a non-trivial search yields zero results', async () => {
      wrapper.vm.searchValue = 'villenueve' // misspelled, matches nothing exactly
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.paginatedSortedResults.length).toBe(0)
      expect(wrapper.vm.didYouMeanSuggestions.length).toBeGreaterThan(0)
    })

    it('does NOT suggest for a year chip that matches nothing (the "2010" repro)', async () => {
      // Typing a year shows results via the temp general filter, then on blur it
      // converts to a `year` chip (input cleared). The year chip matches no rated
      // movies, so results go to 0 — but the suggestions tool must stay quiet.
      wrapper.vm.searchValue = ''
      wrapper.vm.activeFilters = [{ id: 'year-1', type: 'year', value: '2010', display: '2010' }]
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.paginatedSortedResults.length).toBe(0) // no 2010 movies in the library
      expect(wrapper.vm.effectiveSearchTerm).toBe('2010') // chip value is present...
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([]) // ...but no fuzzy suggestions
    })

    it('drives suggestions from raw input only, never a chip value (regression guard)', async () => {
      // True guard: a chip whose value FUZZY-matches a library term but exact-matches
      // nothing. Under the old `searchValue || effectiveSearchTerm` gate this fed the
      // chip value ("villenueve") into Fuse and surfaced "Denis Villeneuve" — exactly
      // the wrong-suggestions bug. With the input empty, suggestions must be silent.
      wrapper.vm.searchValue = ''
      wrapper.vm.activeFilters = [{ id: 'g1', type: 'general', value: 'villenueve', display: 'villenueve' }]
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.paginatedSortedResults.length).toBe(0) // exact 'villenueve' matches nothing
      expect(wrapper.vm.effectiveSearchTerm).toBe('villenueve') // fuzzy-matchable chip value...
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([]) // ...but still no suggestions
    })
  })

  describe('correction quality', () => {
    it('corrects a misspelled director name to the right typed suggestion', async () => {
      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick()
      const top = wrapper.vm.didYouMeanSuggestions[0]
      expect(top.value).toBe('Denis Villeneuve')
      expect(top.expectedType).toBe('director')
    })

    it('corrects a misspelled title', async () => {
      wrapper.vm.searchValue = 'shindlers list'
      await wrapper.vm.$nextTick()
      const titleSuggestion = wrapper.vm.didYouMeanSuggestions.find(s => s.value === "Schindler's List")
      expect(titleSuggestion).toBeTruthy()
      expect(titleSuggestion.expectedType).toBe(null)
    })

    it('does not suggest garbage for a term with no near match', async () => {
      wrapper.vm.searchValue = 'qzxwvkj'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([])
    })

    it('caps suggestions at 5', async () => {
      wrapper.vm.searchValue = 'aaaaa'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions.length).toBeLessThanOrEqual(5)
    })
  })

  describe('didYouMeanLineSuggestions (fit-as-many-as-fit-on-one-line UI)', () => {
    it('renders one link per fitting suggestion under a single "Did you mean?:" label, not a row of chips', async () => {
      // jsdom never lays out elements (offsetWidth is always 0), so stub a
      // real width before the watcher fires - the fit-counting math itself
      // is unit-tested in isolation in searchFiltering.test.js; this just
      // proves the component wiring renders whatever it computes correctly.
      Object.defineProperty(wrapper.vm.$refs.searchInput, 'offsetWidth', { value: 2000, configurable: true })

      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick() // let didYouMeanSuggestions recompute and the watcher fire
      await wrapper.vm.$nextTick() // let the watcher's own nested nextTick callback update fitCount
      await wrapper.vm.$nextTick() // let the DOM patch reflect that updated fitCount

      const container = wrapper.find('.did-you-mean-inline')
      expect(container.exists()).toBe(true)
      expect(container.text()).toContain('Did you mean?:')

      const links = wrapper.findAll('.did-you-mean-link')
      expect(links).toHaveLength(wrapper.vm.didYouMeanSuggestions.length)
      expect(links.map((l) => l.text())).toEqual(wrapper.vm.didYouMeanSuggestions.map((s) => s.value))
      expect(wrapper.find('.did-you-mean-chip').exists()).toBe(false)
    })

    it('renders nothing when there are no suggestions', async () => {
      wrapper.vm.searchValue = 'qzxwvkj'
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.didYouMeanLineSuggestions).toEqual([])
      expect(wrapper.find('.did-you-mean-inline').exists()).toBe(false)
    })

    it('auto-updates the fit count (via the didYouMeanSuggestions watcher) when the search term changes, without manually calling updateDidYouMeanFitCount', async () => {
      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick() // let the watcher's own nextTick callback resolve too

      // jsdom reports 0 width, so the wired-up call still resolves to the
      // "unmeasurable width" fallback (1) rather than staying at its stale
      // pre-search value - proves the watcher actually fired.
      expect(wrapper.vm.didYouMeanFitCount).toBe(1)
    })

    it('applying a suggestion still commits the correct chip (tap-to-commit unaffected by the multi-term UI)', async () => {
      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick()
      const suggestion = wrapper.vm.didYouMeanSuggestions[0]

      wrapper.vm.applyDidYouMeanSuggestion(suggestion)
      await wrapper.vm.$nextTick()

      const chip = wrapper.vm.activeFilters.find((f) => f.value === suggestion.value)
      expect(chip).toBeTruthy()
    })
  })

  describe('tap-to-commit', () => {
    it('builds a correctly-typed chip from a tapped director suggestion', async () => {
      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick()
      const suggestion = wrapper.vm.didYouMeanSuggestions.find(s => s.expectedType === 'director')

      wrapper.vm.applyDidYouMeanSuggestion(suggestion)
      await wrapper.vm.$nextTick()

      const chip = wrapper.vm.activeFilters.find(f => f.value === 'Denis Villeneuve')
      expect(chip).toBeTruthy()
      // createFilterByType maps director -> person
      expect(chip.type).toBe('person')
    })

    it('commits a tapped title suggestion as a general chip', async () => {
      wrapper.vm.searchValue = 'shindlers list'
      await wrapper.vm.$nextTick()
      const suggestion = wrapper.vm.didYouMeanSuggestions.find(s => s.value === "Schindler's List")

      wrapper.vm.applyDidYouMeanSuggestion(suggestion)
      await wrapper.vm.$nextTick()

      const chip = wrapper.vm.activeFilters.find(f => f.value === "Schindler's List")
      expect(chip).toBeTruthy()
      expect(chip.type).toBe('general')
    })
  })

  describe('new-rating flow is preserved', () => {
    it('still renders the NoResults / "Search TMDB" path for a misspelled new title', async () => {
      // Even when we offer fuzzy suggestions, the new-rating fallback must remain
      // so the user can still rate a brand-new movie.
      wrapper.vm.searchValue = 'villenueve'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions.length).toBeGreaterThan(0)
      expect(wrapper.find('[data-testid="no-results"]').exists()).toBe(true)
    })

    it('renders the NoResults path for a genuinely-new title with no near matches', async () => {
      wrapper.vm.searchValue = 'interstellar'
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-testid="no-results"]').exists()).toBe(true)
    })
  })

  describe('does not auto-chip a typo while suggestions are showing', () => {
    it('convertSearchToChip is a no-op when fuzzy suggestions exist', async () => {
      // Reproduces the bug where blurring the input auto-converted the raw typo
      // into a dead chip. With suggestions present, convertSearchToChip must bail.
      wrapper.vm.searchValue = 'villenueve'
      wrapper.vm.inputValue = 'villenueve'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions.length).toBeGreaterThan(0)

      wrapper.vm.convertSearchToChip()
      await wrapper.vm.$nextTick()

      // No chip was created from the raw typo.
      expect(wrapper.vm.activeFilters.some(f => f.value === 'villenueve')).toBe(false)
    })

    it('still auto-chips a normal term that has results (suggestions empty)', async () => {
      // Guard must not break the ordinary blur-to-chip behavior.
      wrapper.vm.inputValue = 'arrival'
      wrapper.vm.searchValue = 'arrival'
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.didYouMeanSuggestions).toEqual([])

      wrapper.vm.convertSearchToChip()
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.activeFilters.some(f => f.value === 'arrival')).toBe(true)
    })
  })
})
