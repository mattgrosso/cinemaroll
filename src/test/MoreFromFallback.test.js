// "I just typed Spiderman and I click the first one, and I'm not getting any
// more from suggestions at the bottom at all" (Matt, 2026-08-18).
//
// Tapping a typeahead row builds a TYPED chip, so the section stopped asking
// TMDB for the words "spiderman" and started asking it for an id. Verified
// against the live API: /search/keyword?query=spiderman returns five
// keywords, /search/company leads with "Spiderland", /search/person leads
// with an extra credited on nothing — and every one of those ids has zero
// films behind it. Resolving to a real id with nothing attached is
// indistinguishable, by the time it reaches the section, from a filter that
// genuinely has no unrated matches.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import axios from 'axios'
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

const ratedLibrary = () => ([
  {
    movie: {
      id: 1,
      title: 'Sicario',
      release_date: '2015-09-18',
      genres: [{ id: 53, name: 'Thriller' }],
      cast: [{ name: 'Emily Blunt' }],
      crew: [{ name: 'Denis Villeneuve', job: 'Director' }],
      // Ids present, as AddRating stores them — the catalog reads these.
      production_companies: [{ id: 1632, name: 'Lionsgate' }],
      keywords: [{ id: 10391, name: 'mexico' }]
    },
    ratings: [{ calculatedTotal: 8.5, date: '2023-03-01' }],
    dbKey: 'movie-1'
  }
])

const candidate = (id, title) => ({
  id,
  title,
  release_date: '2018-06-01',
  poster_path: `/${id}.jpg`,
  genre_ids: [28],
  vote_average: 7.4,
  vote_count: 4000,
  popularity: 55
})

const mountHome = () => {
  const movies = ratedLibrary()
  const store = {
    state: reactive({
      dbLoaded: true,
      isOnline: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: { normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} } },
      movieHatMovieIds: {},
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
      allMediaAsArray: movies,
      allMoviesAsArray: movies,
      allMediaSortedByRating: movies
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  return mount(Home, {
    global: {
      mocks: { $store: store, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true
      }
    }
  })
}

/**
 * Route axios by endpoint. `keywordSearch` is what /search/keyword returns
 * (the resolution step) and `titleSearch` is what /search/movie returns (the
 * text fallback), so a test can make the structured answer fail in either of
 * the two ways the live API actually fails.
 */
const respondWith = ({ keywordSearch = [], discover = [], titleSearch = [] }) => {
  axios.get.mockImplementation((url) => {
    if (url.includes('/search/keyword')) return Promise.resolve({ data: { results: keywordSearch } })
    if (url.includes('/search/movie')) return Promise.resolve({ data: { results: titleSearch } })
    if (url.includes('/discover/movie')) return Promise.resolve({ data: { results: discover, total_pages: 1 } })
    return Promise.resolve({ data: { results: [] } })
  })
}

const keywordChip = (value) => ({ id: `k-${value}`, type: 'keyword', value, display: value })

// Each test uses its own term. resolveTmdbId memoizes name -> id for the life
// of the page (it is a stable fact and worth not re-asking), so reusing one
// term across tests would have the first test's resolution answer the rest.

describe('More from, when a typed chip resolves to nothing useful', () => {
  let wrapper

  beforeEach(() => {
    vi.clearAllMocks()
    wrapper = mountHome()
  })

  it('asks the question as text when TMDB knows no keyword by that name', async () => {
    // The live shape: /search/keyword?query=spiderman offers "spider-man"
    // and "spider man", neither of which is the term we asked about.
    respondWith({
      keywordSearch: [{ id: 381075, name: 'spider-man' }, { id: 373794, name: 'spider man' }],
      titleSearch: [candidate(557, 'Spider-Man'), candidate(315635, 'Spider-Man: Homecoming')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('spiderman')])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([557, 315635])
  })

  it('asks the question as text when the id resolves but carries no films', async () => {
    // The other half of the report: the exact keyword exists, so nothing is
    // "unresolved" — it simply has no film attached to it.
    respondWith({
      keywordSearch: [{ id: 381074, name: 'spider-verse' }],
      discover: [],
      titleSearch: [candidate(557, 'Spider-Man')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('spider-verse')])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([557])
  })

  it('leaves a working structured answer alone', async () => {
    respondWith({
      keywordSearch: [{ id: 381074, name: 'wall crawler' }],
      discover: [candidate(99861, 'Age of Ultron')],
      titleSearch: [candidate(557, 'Spider-Man')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('wall crawler')])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([99861])
    // No wasted request: the fallback is for an empty answer, not every answer.
    expect(axios.get.mock.calls.filter(([url]) => url.includes('/search/movie'))).toHaveLength(0)
  })

  it('does not turn half of a two-chip question into a text search', async () => {
    // Quietly answering "spiderman" when the screen says "spiderman + 1994"
    // would be a lie about what is below the heading.
    respondWith({
      keywordSearch: [{ id: 381075, name: 'spider-man' }],
      titleSearch: [candidate(557, 'Spider-Man')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([
      keywordChip('web slinger'),
      { id: 'y-1994', type: 'year', value: '1994', display: '1994' }
    ])

    expect(wrapper.vm.unratedMovies).toEqual([])
  })

  it('still shows nothing when the term is unknown every way of asking', async () => {
    respondWith({ keywordSearch: [], discover: [], titleSearch: [] })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('qzxwvkj')])

    expect(wrapper.vm.unratedMovies).toEqual([])
  })

  it('answers a library keyword from the catalog, with no /search round trip', async () => {
    // Phase 1 of the redesign: "mexico" is stored on Sicario WITH its TMDB
    // id, so resolution is a lookup, not a request. The /search endpoint
    // returning garbage (the Spiderland shape) must not even be consulted.
    respondWith({
      keywordSearch: [{ id: 999999, name: 'mexico city' }], // would be wrong if used
      discover: [candidate(338766, 'Hell or High Water')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('mexico')])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([338766])
    expect(axios.get.mock.calls.filter(([url]) => url.includes('/search/keyword'))).toHaveLength(0)

    const discoverCall = axios.get.mock.calls.find(([url]) => url.includes('/discover/movie'))
    expect(discoverCall[1].params.with_keywords).toBe('10391') // the stored id, exactly
  })

  it('answers a library studio from the catalog the same way', async () => {
    respondWith({ discover: [candidate(273481, 'Sicario: Day of the Soldado')] })

    await wrapper.vm.fetchUnratedMoviesForFilters([
      { id: 'c-1', type: 'company', value: 'Lionsgate', display: 'Lionsgate' }
    ])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([273481])
    expect(axios.get.mock.calls.filter(([url]) => url.includes('/search/company'))).toHaveLength(0)

    const discoverCall = axios.get.mock.calls.find(([url]) => url.includes('/discover/movie'))
    expect(discoverCall[1].params.with_companies).toBe('1632')
  })

  it('excludes what is already rated, however the candidates were found', async () => {
    // Sicario is in the library above; a fallback must not suggest it back.
    respondWith({
      keywordSearch: [{ id: 381075, name: 'spider-man' }],
      titleSearch: [candidate(1, 'Sicario'), candidate(557, 'Spider-Man')]
    })

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('arachnid')])

    expect(wrapper.vm.unratedMovies.map((movie) => movie.id)).toEqual([557])
  })
})

// Sentry 2026-11-08: one bar of signal, Insights -> Home, and the More from
// fetch ran out axios's 8s timeout. Every console.error is a Sentry event
// (CaptureConsole), so a flaky network must warn; a server refusal still errors.
describe('More from, when TMDB does not answer', () => {
  let wrapper

  beforeEach(() => {
    vi.clearAllMocks()
    wrapper = mountHome()
  })

  const failWith = (error) => axios.get.mockImplementation(() => Promise.reject(error))
  const loggedUnrated = (spy) => spy.mock.calls.some(([msg]) => String(msg).includes('unrated movies'))

  it('warns, never errors, on a timeout', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failWith(Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' }))

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('slow signal')])

    expect(loggedUnrated(error)).toBe(false)
    expect(loggedUnrated(warn)).toBe(true)
    expect(wrapper.vm.unratedMovies).toEqual([])
    error.mockRestore(); warn.mockRestore()
  })

  it('still errors when TMDB answers with a failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    failWith(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } }))

    await wrapper.vm.fetchUnratedMoviesForFilters([keywordChip('real refusal')])

    expect(loggedUnrated(error)).toBe(true)
    error.mockRestore(); warn.mockRestore()
  })
})
