import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import MovieDetail from '@/components/MovieDetail.vue'

// created() fires loadMovieData() which uses axios; resolve it benignly.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const r = (media?.ratings && media.ratings[0]) || {}
    return {
      ...r,
      calculatedTotal: r.calculatedTotal != null ? r.calculatedTotal : 5,
      normalizedRating: r.normalizedRating != null ? r.normalizedRating : 5
    }
  }),
  getAllRatings: vi.fn(() => [])
}))

vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const warmImageCacheMock = vi.fn()
vi.mock('@/assets/javascript/offlinePosterCache.js', async () => {
  const actual = await vi.importActual('@/assets/javascript/offlinePosterCache.js')
  return {
    ...actual,
    warmImageCache: (...args) => warmImageCacheMock(...args)
  }
})

function makeResult (overrides = {}) {
  return {
    dbKey: 'abc123',
    movie: {
      id: 42,
      title: 'Test Movie',
      release_date: '2019-05-20',
      runtime: 142,
      poster_path: '/poster.jpg',
      backdrop_path: '/backdrop.jpg',
      genres: [{ name: 'Drama' }, { name: 'Thriller' }],
      crew: [
        { name: 'Jane Director', job: 'Director' },
        { name: 'Joe Writer', job: 'Writer' },
        { name: 'Co Director', job: 'Co-Director' }
      ],
      ...overrides.movie
    },
    ratings: [{ calculatedTotal: 8.5, normalizedRating: 8, date: Date.now() }],
    ...overrides
  }
}

describe('MovieDetail', () => {
  let wrapper
  let mockStore
  let pushSpy

  beforeEach(async () => {
    warmImageCacheMock.mockClear()
    pushSpy = vi.fn()
    mockStore = {
      state: {
        movieLog: {},
        settings: { tags: { 'viewing-tags': {} } },
        academyAwardWinners: {}
      },
      getters: { allMoviesAsArray: [], allMediaAsArray: [] },
      commit: vi.fn(),
      dispatch: vi.fn()
    }

    wrapper = shallowMount(MovieDetail, {
      global: {
        mocks: {
          $store: mockStore,
          $route: { params: { tmdbId: '42' }, query: {} },
          $router: { push: pushSpy }
        },
        stubs: { ToggleableRating: true, Modal: true }
      }
    })

    // result/movie are normally loaded async in created(); set them directly.
    await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
  })

  describe('pure formatters', () => {
    it('getYear returns the release year, or Unknown when missing', () => {
      expect(wrapper.vm.getYear({ movie: { release_date: '2019-05-20' } })).toBe(2019)
      expect(wrapper.vm.getYear({ movie: {} })).toBe('Unknown')
    })

    it('prettifyRuntime handles hours+minutes, minutes-only, and unknown', () => {
      expect(wrapper.vm.prettifyRuntime({ movie: { runtime: 142 } })).toBe('2h 22m')
      expect(wrapper.vm.prettifyRuntime({ movie: { runtime: 45 } })).toBe('45m')
      expect(wrapper.vm.prettifyRuntime({ movie: {} })).toBe('Runtime unknown')
    })

    it('formattedDate returns a localized date or empty string', () => {
      expect(wrapper.vm.formattedDate(null)).toBe('')
      expect(wrapper.vm.formattedDate('2020-01-01')).not.toBe('')
    })

    it('formatTimeDifference bins by days, weeks, months, years', () => {
      const day = 24 * 60 * 60 * 1000
      const base = new Date('2020-01-01').getTime()
      expect(wrapper.vm.formatTimeDifference(base, base + day)).toBe('1 day')
      expect(wrapper.vm.formatTimeDifference(base, base + 3 * day)).toBe('3 days')
      expect(wrapper.vm.formatTimeDifference(base, base + 14 * day)).toBe('2 weeks')
      expect(wrapper.vm.formatTimeDifference(base, base + 90 * day)).toBe('3 months')
      // NOTE: the months branch runs all the way to 730 days, so 400 days is
      // reported as months, not years. (Characterizes current behavior — the
      // '1 year' string is effectively unreachable since 730/365 rounds to 2.)
      expect(wrapper.vm.formatTimeDifference(base, base + 400 * day)).toBe('13 months')
      expect(wrapper.vm.formatTimeDifference(base, base + 800 * day)).toBe('2 years')
    })
  })

  describe('Box Office', () => {
    it('shows Budget and Box Office when both are present, formatted as USD currency', async () => {
      await wrapper.setData({ movie: { ...makeResult().movie, budget: 160000000, revenue: 2797800564 } })

      expect(wrapper.vm.hasBoxOfficeInfo).toBe(true)
      const section = wrapper.find('.box-office')
      expect(section.exists()).toBe(true)
      expect(section.text()).toContain('Budget: $160,000,000')
      expect(section.text()).toContain('Box Office: $2,797,800,564')
    })

    it('shows only Budget when revenue is unknown (0)', async () => {
      await wrapper.setData({ movie: { ...makeResult().movie, budget: 5000000, revenue: 0 } })

      const section = wrapper.find('.box-office')
      expect(section.exists()).toBe(true)
      expect(section.text()).toContain('Budget: $5,000,000')
      expect(section.text()).not.toContain('Box Office:')
    })

    it('shows only Box Office when budget is unknown (0)', async () => {
      await wrapper.setData({ movie: { ...makeResult().movie, budget: 0, revenue: 900000 } })

      const section = wrapper.find('.box-office')
      expect(section.exists()).toBe(true)
      expect(section.text()).not.toContain('Budget:')
      expect(section.text()).toContain('Box Office: $900,000')
    })

    it('hides the whole section for a movie with neither figure - e.g. rated before this feature existed', async () => {
      await wrapper.setData({ movie: { ...makeResult().movie, budget: 0, revenue: 0 } })

      expect(wrapper.vm.hasBoxOfficeInfo).toBe(false)
      expect(wrapper.find('.box-office').exists()).toBe(false)
    })

    it('hides the section when budget/revenue are entirely absent from an older, locally-stored movie', async () => {
      // makeResult()'s base movie shape has no budget/revenue keys at all,
      // characterizing a movie rated before this feature existed.
      await wrapper.setData({ movie: makeResult().movie })

      expect(wrapper.find('.box-office').exists()).toBe(false)
    })
  })

  describe('crew + structure', () => {
    it('getCrewMember strict matches the exact job; loose matches substrings', () => {
      // 'strict' → only exact "Director"
      expect(wrapper.vm.getCrewMember('Director', 'strict')).toEqual(['Jane Director'])
      // loose → "Director" and "Co-Director" both include "Director"
      expect(wrapper.vm.getCrewMember('Director')).toEqual(['Jane Director', 'Co Director'])
    })

    // Report -P1wcbGwHZCGW4YBOtRV, 2026-09-20: "Why don't I see writer on my
    // movie view?" — from The Pelican Brief, whose only writing credits are
    // "Screenplay" and "Novel". The section matched on the word "Writer",
    // which 754 of 1,368 movies in the library do not carry, so it rendered
    // for none of them.
    it('lists Screenplay/Story/Novel credits as writers, not just plain "Writer"', async () => {
      await wrapper.setData({
        result: makeResult({
          movie: {
            crew: [
              { name: 'Jane Director', job: 'Director' },
              { name: 'Alan J. Pakula', job: 'Screenplay' },
              { name: 'John Grisham', job: 'Novel' }
            ]
          }
        })
      })

      const section = wrapper.find('.writers')
      expect(section.exists()).toBe(true)
      expect(section.text()).toContain('Writers')
      expect(section.text()).toContain('Alan J. Pakula')
      expect(section.text()).toContain('John Grisham')
    })

    it('counts a writer credited twice on one film as one writer', async () => {
      await wrapper.setData({
        result: makeResult({
          movie: {
            crew: [
              { name: 'Michael Crichton', job: 'Novel' },
              { name: 'Michael Crichton', job: 'Screenplay' }
            ]
          }
        })
      })

      expect(wrapper.vm.writers).toEqual(['Michael Crichton'])
      // Singular heading: one person, however many credits.
      expect(wrapper.find('.writers').text()).not.toContain('Writers')
    })

    it('does not read a substring job like "Sound Story Editor" as writing', async () => {
      await wrapper.setData({
        result: makeResult({
          movie: { crew: [{ name: 'Sam Sound', job: 'Sound Story Editor' }] }
        })
      })

      expect(wrapper.vm.writers).toEqual([])
      expect(wrapper.find('.writers').exists()).toBe(false)
    })

    it('topStructure spreads the movie and attaches flatKeywords', () => {
      const top = wrapper.vm.topStructure(makeResult())
      expect(top.title).toBe('Test Movie')
      expect(Array.isArray(top.flatKeywords)).toBe(true)
    })

    it('ratingForMedia / normalizedRatingForMedia read from getRating', () => {
      const result = makeResult()
      expect(wrapper.vm.ratingForMedia(result)).toBe(8.5)
      expect(wrapper.vm.normalizedRatingForMedia(result)).toBe(8)
    })
  })

  // Bug report: "I've seen inconsistencies in how [the badge counts] show
  // up... can you verify that it's giving us correct values." These wire up
  // the shared entityCounts.js module (see its own direct tests) to real
  // component state — guarding that the wiring itself (which entries feed
  // in, which setting gates shorts) is correct, not the counting math.
  describe('badge counts (entityCounts.js wiring)', () => {
    function mountWithLibrary (library, { includeShorts } = {}) {
      const store = {
        state: {
          movieLog: {},
          settings: { tags: { 'viewing-tags': {} }, includeShorts },
          academyAwardWinners: {}
        },
        getters: { allMoviesAsArray: [], allMediaAsArray: library },
        commit: vi.fn(),
        dispatch: vi.fn()
      }
      const w = shallowMount(MovieDetail, {
        global: {
          mocks: { $store: store, $route: { params: { tmdbId: '42' }, query: {} }, $router: { push: vi.fn() } },
          stubs: { ToggleableRating: true, Modal: true }
        }
      })
      return w
    }

    it('credits every co-director, not just whichever TMDB lists first', () => {
      const w = mountWithLibrary([
        makeResult({ dbKey: 'a', movie: {
          crew: [
            { name: 'Daniel Kwan', job: 'Director' },
            { name: 'Daniel Scheinert', job: 'Director' }
          ]
        } })
      ])
      expect(w.vm.countDirector('Daniel Kwan')).toBe(1)
      expect(w.vm.countDirector('Daniel Scheinert')).toBe(1)
    })

    it('credits a composer regardless of their position in the crew array', () => {
      const padding = Array.from({ length: 12 }, (_, i) => ({ name: `Grip ${i}`, job: 'Grip' }))
      const w = mountWithLibrary([
        makeResult({ dbKey: 'a', movie: { crew: [...padding, { name: 'Hans Zimmer', job: 'Original Music Composer' }] } })
      ])
      expect(w.vm.countCastCrew('Hans Zimmer')).toBe(1)
    })

    it('excludes a short film from counts when includeShorts is off (the default)', () => {
      const w = mountWithLibrary([
        makeResult({ dbKey: 'a', movie: { runtime: 30, genres: [{ name: 'Drama' }] } }),
        makeResult({ dbKey: 'b', movie: { runtime: 100, genres: [{ name: 'Drama' }] } })
      ], { includeShorts: false })
      expect(w.vm.countGenre('Drama')).toBe(1)
    })

    it('includes short films when includeShorts is on', () => {
      const w = mountWithLibrary([
        makeResult({ dbKey: 'a', movie: { runtime: 30, genres: [{ name: 'Drama' }] } }),
        makeResult({ dbKey: 'b', movie: { runtime: 100, genres: [{ name: 'Drama' }] } })
      ], { includeShorts: true })
      expect(w.vm.countGenre('Drama')).toBe(2)
    })
  })

  describe('poster / backdrop selection', () => {
    it('getBackdropPath / getPosterPath prefer a custom path', async () => {
      expect(wrapper.vm.getBackdropPath()).toBe('/backdrop.jpg')
      expect(wrapper.vm.getPosterPath(wrapper.vm.result)).toBe('/poster.jpg')

      await wrapper.setData({
        result: makeResult({ customBackdropPath: '/custom-bd.jpg', customPosterPath: '/custom-p.jpg' })
      })
      expect(wrapper.vm.getBackdropPath()).toBe('/custom-bd.jpg')
      expect(wrapper.vm.getPosterPath(wrapper.vm.result)).toBe('/custom-p.jpg')
    })

    it('isSelectedBackdrop marks the movie default when no custom is set', () => {
      expect(wrapper.vm.isSelectedBackdrop('/backdrop.jpg')).toBe(true)
      expect(wrapper.vm.isSelectedBackdrop('/other.jpg')).toBe(false)
    })

    it('selectPoster persists the choice and warms the offline image cache for it', async () => {
      await wrapper.vm.selectPoster('/new-poster.jpg')

      expect(mockStore.dispatch).toHaveBeenCalledWith('writeDurably', expect.objectContaining({
        path: expect.stringMatching(/\/customPosterPath$/),
        value: '/new-poster.jpg'
      }))
      expect(warmImageCacheMock).toHaveBeenCalledWith(['https://image.tmdb.org/t/p/w342/new-poster.jpg'])
    })

    it('selectBackdrop persists the choice and warms the offline image cache for it', async () => {
      await wrapper.vm.selectBackdrop('/new-backdrop.jpg')

      expect(mockStore.dispatch).toHaveBeenCalledWith('writeDurably', expect.objectContaining({
        path: expect.stringMatching(/\/customBackdropPath$/),
        value: '/new-backdrop.jpg'
      }))
      expect(warmImageCacheMock).toHaveBeenCalledWith(['https://image.tmdb.org/t/p/w500/new-backdrop.jpg'])
    })
  })

  describe('navigation (documented banner behavior)', () => {
    // Bug report 2026-09-21: "When a friend logs a movie that isn't in my
    // library, tapping the notification should take me to my film club."
    // The push lands on /movie/<id>; an unrated id used to fall back home.
    it('a movie that is not in the library lands on the film club, not home', async () => {
      mockStore.state.dbLoaded = true
      mockStore.getters.allMediaAsArray = [makeResult()]

      await wrapper.vm.loadMovieData('99')

      expect(pushSpy).toHaveBeenCalledWith('/film-club')
      expect(pushSpy).not.toHaveBeenCalledWith('/')
    })

    it('goBack features this movie in the banner and routes home', () => {
      wrapper.vm.goBack()
      expect(mockStore.commit).toHaveBeenCalledWith('setHomePageNavigationIntent', 'close')
      expect(mockStore.commit).toHaveBeenCalledWith('setBannerRequest', { type: 'movie', movieId: 42 })
      expect(pushSpy).toHaveBeenCalledWith('/')
    })

    it('searchFor promotes the clicked type group and samples from results for the banner', () => {
      wrapper.vm.searchFor('Denis Villeneuve', 'director')
      expect(mockStore.commit).toHaveBeenCalledWith('setHomePagePromoteGroup', 'director')
      // A click carries its own type since 2026-08-29 — the search box's
      // free text is now a plain search, so a link can't rely on it being
      // re-read as a person. See MovieDetailSearchLinks.test.js.
      expect(mockStore.commit).toHaveBeenCalledWith('setHomePageSearchChips', [
        expect.objectContaining({ type: 'person', value: 'Denis Villeneuve' })
      ])
      expect(mockStore.commit).toHaveBeenCalledWith('setHomePageSearchValue', '')
      expect(mockStore.commit).toHaveBeenCalledWith('setBannerRequest', { type: 'fromResults' })
      expect(pushSpy).toHaveBeenCalledWith('/')
    })

    it('groupKeyForClickType maps known types and falls back to null', () => {
      expect(wrapper.vm.groupKeyForClickType('keyword')).toBe('keyword-genre')
      expect(wrapper.vm.groupKeyForClickType('genre')).toBe('keyword-genre')
      expect(wrapper.vm.groupKeyForClickType('composer')).toBe('music')
      expect(wrapper.vm.groupKeyForClickType('photo')).toBe('cinematographer')
      expect(wrapper.vm.groupKeyForClickType('year')).toBeNull()
      expect(wrapper.vm.groupKeyForClickType(undefined)).toBeNull()
    })
  })
})

describe('MovieDetail geography sections', () => {
  let wrapper

  const mountWith = async (movieFields) => {
    const w = shallowMount(MovieDetail, {
      global: {
        mocks: {
          $store: {
            state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {} },
            getters: { allMoviesAsArray: [], allMediaAsArray: [] },
            commit: vi.fn(),
            dispatch: vi.fn()
          },
          $route: { params: { tmdbId: '42' }, query: {} },
          $router: { push: vi.fn() }
        },
        stubs: { ToggleableRating: true, Modal: true }
      }
    })
    const result = makeResult({ movie: movieFields })
    await w.setData({ result, movie: result.movie })
    return w
  }

  describe('Country of Origin (production countries)', () => {
    it('lists production country names', async () => {
      wrapper = await mountWith({ production_countries: [{ name: 'France' }, { name: 'Ireland' }] })
      expect(wrapper.vm.productionCountries).toEqual(['France', 'Ireland'])
    })

    it('is headed "Country of Origin", not "Made In" — which read as a synonym for Filmed In', async () => {
      // Matt, 2026-09-08: "I'm not sure I understand the difference between
      // made in and filmed in." Production country is whose industry made the
      // film; Filmed In is where the cameras were. The heading says which.
      wrapper = await mountWith({ production_countries: [{ name: 'France' }] })
      const heading = wrapper.find('.production-countries h4')
      expect(heading.text()).toBe('Country of Origin')
      expect(wrapper.text()).not.toContain('Made In')
    })

    it('pluralises the heading for a co-production', async () => {
      wrapper = await mountWith({ production_countries: [{ name: 'France' }, { name: 'Ireland' }] })
      expect(wrapper.find('.production-countries h4').text()).toBe('Countries of Origin')
    })

    it('is empty for an entry predating the field, so the section does not render', async () => {
      // Older library entries simply lack it — the same graceful degradation
      // every other optional section on this page uses.
      wrapper = await mountWith({})
      expect(wrapper.vm.productionCountries).toEqual([])
    })

    it('drops malformed entries rather than rendering blanks', async () => {
      wrapper = await mountWith({ production_countries: [{ name: 'France' }, {}, null] })
      expect(wrapper.vm.productionCountries).toEqual(['France'])
    })
  })
})


describe('MovieDetail — rank rides only with the precise score', () => {
  // Tapping the score cycles precise -> normalized -> stars. A rank beside
  // a star rating or a normalized score answers a question nobody asked.
  it('hands the rank to the score control instead of rendering its own link', async () => {
    const store = {
      state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {} },
      // Ranked list containing this movie, so overallRank is a real value
      // and the assertions below can't pass trivially on null.
      getters: {
        allMoviesAsArray: [],
        allMediaAsArray: [makeResult()],
        allMediaSortedByRating: [{ dbKey: 'other' }, makeResult()],
        customLists: []
      },
      commit: vi.fn(),
      dispatch: vi.fn()
    }
    const wrapper = shallowMount(MovieDetail, {
      global: {
        mocks: { $store: store, $route: { params: { tmdbId: '42' }, query: {} }, $router: { push: vi.fn() } },
        stubs: { ToggleableRating: true, Modal: true }
      }
    })
    await wrapper.setData({ result: makeResult(), movie: makeResult().movie })

    expect(wrapper.vm.overallRank).toBe(2)                        // there IS a rank to show
    expect(wrapper.findComponent({ name: 'ToggleableRating' }).props('rankLabel')).toBe('2nd')

    // The rank used to be a button here that jumped to Home. It caught taps
    // meant for the score toggle it sits inside, so it is gone -- rank now
    // renders inside ToggleableRating as inert text (bug report 2026-08-25).
    // Whether it hides for the star and normalized views is that component's
    // business now, and ToggleableRating.test.js asserts it.
    expect(wrapper.find('.overall-rank-link').exists()).toBe(false)
    expect(wrapper.find('.rating-with-rank button').exists()).toBe(false)
  })
})
