import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import MovieDetail from '@/components/MovieDetail.vue'
import { getAllRatings } from '@/assets/javascript/GetRating.js'

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

// The Letterboxd extras arrive from Firebase and the Lambda after the page
// renders; the tests hand them in directly.
const letterboxdMocks = vi.hoisted(() => ({
  myLetterboxdReviews: vi.fn(async () => []),
  letterboxdFilm: vi.fn(async () => null)
}))
vi.mock('@/utils/letterboxdData.js', () => letterboxdMocks)

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
    letterboxdMocks.myLetterboxdReviews.mockClear()
    letterboxdMocks.letterboxdFilm.mockClear()
    pushSpy = vi.fn()
    mockStore = {
      state: {
        movieLog: {},
        settings: { tags: { 'viewing-tags': {} } },
        academyAwardWinners: {},
        isOnline: true
      },
      getters: { allMoviesAsArray: [], allMediaAsArray: [], databaseTopKey: 'tester' },
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
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
      }
    })

    // result/movie are normally loaded async in created(); set them directly.
    await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
  })

  // Report 2026-10-04: "I find myself wishing that the people section was
  // higher up." The film band is a grid of tiles; the crew stay rows. Then
  // 2026-10-06: "what I'm looking for is director, I'm looking for cast
  // members, and I have to scroll pretty far down to find them" — so those
  // two lead the page, before the actions, and leave the crew band.
  describe('credits band and film band tiles', () => {
    beforeEach(async () => {
      const full = makeResult({
        movie: {
          cast: [{ name: 'Actor One' }, { name: 'Actor Two' }],
          keywords: [{ name: 'heist' }, { name: 'los angeles' }],
          crew: [
            { name: 'Jane Director', job: 'Director' },
            { name: 'Joe Writer', job: 'Writer' },
            { name: 'Pat Lens', job: 'Director of Photography' }
          ]
        }
      })
      full.ratings = [{ calculatedTotal: 8.5, normalizedRating: 8, date: Date.now(), tags: [{ title: 'with Carrie' }] }]
      await wrapper.setData({ result: full, movie: full.movie })
    })

    // Second pass the same night: "put cast and directed by ... below the
    // Letterboxd, Wikipedia, Add rating sections".
    it('leads with the director and the cast, right under the action tiles', () => {
      const content = wrapper.find('.movie-content .container')
      const order = content.element.children ? Array.from(content.element.children).map(el => el.className.split(' ')[0]) : []
      expect(order.indexOf('fact-strip')).toBeLessThan(order.indexOf('details-actions'))
      expect(order.indexOf('details-actions') + 1).toBe(order.indexOf('credits-band'))
      expect(order.indexOf('credits-band')).toBeLessThan(order.indexOf('detail-band'))
      const directors = wrapper.find('.credits-band #directors')
      expect(directors.find('.credit-label').text()).toBe('Directed by')
      expect(directors.findAll('.credit-name').map(a => a.text())).toEqual(['Jane Director'])
      const cast = wrapper.find('.credits-band #cast')
      expect(cast.find('.credit-label').text()).toBe('Cast')
      const row = cast.findComponent({ name: 'NameRow' })
      expect(row.exists()).toBe(true)
      expect(row.props('people').map(p => p.name)).toEqual(['Actor One', 'Actor Two'])
      expect(row.props('expanded')).toBe(false)
      expect(row.props('lines')).toBe(2)
      // The film's web has a labelled button of its own, away from any chevron.
      expect(cast.find('.web-button').text()).toBe('Web')
      // Director and cast are no longer rows in the crew band.
      expect(wrapper.find('.detail-section-stub#directors').exists()).toBe(false)
      expect(wrapper.find('.detail-section-stub#cast').exists()).toBe(false)
    })

    it('a tap on a cast name searches for them; "+N more" opens the rest in place', async () => {
      const row = wrapper.find('.credits-band #cast').findComponent({ name: 'NameRow' })
      row.vm.$emit('pick', 'Actor Two')
      expect(pushSpy).toHaveBeenCalled()
      row.vm.$emit('more')
      await wrapper.vm.$nextTick()
      expect(row.props('expanded')).toBe(true)
      await wrapper.find('.credit-fewer').trigger('click')
      expect(row.props('expanded')).toBe(false)
    })

    it('the web button goes to the web, and does not fold anything', async () => {
      await wrapper.find('.web-button').trigger('click')
      expect(pushSpy).toHaveBeenCalledWith({ path: '/web', query: { movie: '42' } })
    })

    it('puts the film rows in the tile grid, tags beside keywords', () => {
      const tiles = wrapper.findAll('.detail-tiles').find(grid => grid.find('#genres').exists())
      expect(tiles).toBeDefined()
      const genres = tiles.find('#genres')
      expect(genres.exists()).toBe(true)
      expect(genres.attributes('tile')).toBeDefined()
      // Tags sit with Keywords in the film band (2026-10-06: "keywords and
      // tags ... kind of feel like they're related"), not up with the ratings.
      expect(wrapper.find('.detail-band--you #tags').exists()).toBe(false)
      const ids = tiles.findAll('.detail-section-stub').map(el => el.attributes('id'))
      expect(ids.indexOf('keywords')).toBeGreaterThan(-1)
      expect(ids.indexOf('tags')).toBe(ids.indexOf('keywords') + 1)
    })

    it('names the crew band and every crew row as tappable names', () => {
      expect(wrapper.findAll('.band-title').map(t => t.text())).toContain('The crew')
      // "Cinematography" pushed its content too far right (2026-10-06).
      expect(wrapper.find('#cinematographers').attributes('label')).toBe('Visuals')
      expect(wrapper.find('#writers').attributes('label')).toBe('Writers')
    })
  })

  // Report 2026-10-04: "the section about me is a bit messy and needs to be
  // cleaned up and tightened up." Second pass the same night: no "You"
  // heading, Best since down to a tile, and the club as lines in the same
  // panel as the viewings rather than pills.
  describe('You band', () => {
    it('puts each viewing on one line in a single panel, with no heading', async () => {
      getAllRatings.mockImplementation((entry) => entry?.ratings || null)
      try {
        const ratings = [
          { medium: 'Theater', date: new Date(2024, 0, 2).getTime(), calculatedTotal: 8.123 },
          { medium: 'Netflix', date: new Date(2025, 5, 6).getTime(), calculatedTotal: 7.5 }
        ]
        await wrapper.setData({ previousEntry: { ratings } })
        const band = wrapper.find('.detail-band--you')
        expect(band.find('.band-title').exists()).toBe(false)
        const panel = band.find('.you-panel')
        expect(panel.exists()).toBe(true)
        expect(panel.find('h4').exists()).toBe(false)
        const lines = panel.findAll('.accordion-button')
        expect(lines).toHaveLength(2)
        expect(lines[0].classes()).toContain('collapsed')
        expect(lines[0].find('.medium-and-date').text()).toContain('Theater')
        expect(lines[0].find('.viewing-score').text()).toBe('8.12')
        // Tapping a line still opens the criteria and Edit / Delete.
        expect(panel.text()).toContain('Edit Rating')
        expect(panel.text()).toContain('Delete Rating')
        // The club continues the same list, under a Club label.
        const club = panel.findComponent({ name: 'FriendsWhoSaw' })
        expect(club.exists()).toBe(true)
        expect(club.props('label')).toBe('Club')
        // Best since is not in the panel any more.
        expect(panel.find('.best-since-row').exists()).toBe(false)
      } finally {
        getAllRatings.mockImplementation(() => [])
      }
    })

    // 2026-10-06: "group all of the critiques of the movie in one place ...
    // critics, Letterboxd, the movie club and my stuff all in one
    // conversation". Letterboxd and Critics are the pair of tiles under
    // your lines and the club's; the club runs as one compact line.
    it('makes Letterboxd and Critics tiles, side by side, under the club', async () => {
      await wrapper.setData({ letterboxdFilmStats: { slug: 'heat-1995', rating: 4.32, ratingCount: 1307901, fans: 61000 } })
      const tiles = wrapper.find('.detail-band--you .detail-tiles')
      const letterboxd = tiles.find('#letterboxd')
      expect(letterboxd.exists()).toBe(true)
      expect(letterboxd.attributes('tile')).toBeDefined()
      const critics = tiles.find('#critics')
      expect(critics.exists()).toBe(true)
      expect(critics.attributes('tile')).toBeDefined()
      expect(wrapper.find('.detail-band--you .you-panel').findComponent({ name: 'FriendsWhoSaw' }).props('compact')).toBe(true)
    })

    it('stretches an odd tile out to the full width, so no grid ends on a gap', () => {
      // jsdom loads no CSS, so read the rule from the component's stylesheet.
      const source = readFileSync(resolve(__dirname, '../components/MovieDetail.vue'), 'utf8')
      const grid = source.slice(source.indexOf('  .detail-tiles {'))
      const block = grid.slice(0, grid.indexOf('\n  }\n'))
      expect(block).toMatch(/> :last-child:nth-child\(odd\) \{ grid-column: 1 \/ -1; \}/)
    })
  })

  describe('Letterboxd section', () => {
    it('renders nothing until there is something', async () => {
      await wrapper.setData({ letterboxdReviews: [], letterboxdFilmStats: null })
      expect(wrapper.find('.letterboxd-section').exists()).toBe(false)
      expect(wrapper.find('.letterboxd-film').exists()).toBe(false)
    })

    it('with no review of mine, the Letterboxd row is the crowd rating, linked to the film page', async () => {
      await wrapper.setData({ letterboxdFilmStats: { slug: 'heat-1995', rating: 4.32, ratingCount: 1307901, fans: 61000 } })
      expect(wrapper.vm.letterboxdSummary).toBe('★ 4.32 · 1.3M ratings · 61K fans')
      const link = wrapper.find('.letterboxd-film a')
      expect(link.text()).toBe('★ 4.32 · 1.3M ratings · 61K fans')
      expect(link.attributes('href')).toBe('https://letterboxd.com/film/heat-1995/')
      // The facts strip itself carries no crowd tile (Matt: "too prominent").
      expect(wrapper.find('.fact-strip').text()).not.toContain('★')
    })

    it('a film Letterboxd does not know renders no rating fact', async () => {
      await wrapper.setData({ letterboxdFilmStats: { missing: true, fetchedAt: 1 } })
      expect(wrapper.find('.letterboxd-film').exists()).toBe(false)
    })

    it('lists my reviews as dates and text — no stars of mine, paragraphs kept — with a one-line summary', async () => {
      await wrapper.setData({
        letterboxdReviews: [
          { id: 'review-1', rating: 2.5, watchedDate: '2026-09-27', rewatch: true, review: 'First paragraph.\n\nSecond paragraph.', url: 'https://letterboxd.com/mattgrosso/film/primetime-2026/' },
          { id: 'watch-2', rating: 3, watchedDate: '2025-01-01' }
        ]
      })
      const section = wrapper.find('.letterboxd-section')
      expect(section.exists()).toBe(true)
      expect(section.text()).not.toContain('★')
      const reviews = section.findAll('.letterboxd-review')
      expect(reviews).toHaveLength(1) // the plain watch has nothing to show
      expect(reviews[0].find('.letterboxd-review-date').text()).toBe(new Date(2026, 8, 27).toLocaleDateString())
      expect(reviews[0].find('.letterboxd-review-date').attributes('href')).toBe('https://letterboxd.com/mattgrosso/film/primetime-2026/')
      expect(reviews[0].find('.letterboxd-review-text').element.textContent).toBe('First paragraph.\n\nSecond paragraph.')
      expect(wrapper.vm.letterboxdSummary).toBe(`Your review, ${new Date(2026, 8, 27).toLocaleDateString()}`)
    })

    it('entries without text give no section at all; two reviews summarise as a count', async () => {
      await wrapper.setData({ letterboxdReviews: [{ id: 'watch-1', rating: 3, watchedDate: '2026-09-27' }] })
      expect(wrapper.find('.letterboxd-section').exists()).toBe(false)
      await wrapper.setData({ letterboxdReviews: [{ id: 'r1', review: 'A.', watchedDate: '2026-09-27' }, { id: 'r2', review: 'B.', watchedDate: '2024-01-01' }] })
      expect(wrapper.vm.letterboxdSummary).toContain('2 reviews')
    })

    it('loadLetterboxdExtras asks for both, by the account key and the TMDB id', async () => {
      wrapper.vm.loadLetterboxdExtras('949')
      expect(letterboxdMocks.myLetterboxdReviews).toHaveBeenCalledWith('tester', 949)
      expect(letterboxdMocks.letterboxdFilm).toHaveBeenCalledWith(949, { online: true })
    })
  })

  describe('folded-section summaries', () => {
    it('listSummary names the first few and counts the rest', () => {
      expect(wrapper.vm.listSummary(['A', 'B', 'C', 'D', 'E'], 3)).toBe('A, B, C +2')
      expect(wrapper.vm.listSummary(['A'], 3)).toBe('A')
      expect(wrapper.vm.listSummary([], 3)).toBe('')
    })

    it('box office and places summaries read as one line each', async () => {
      await wrapper.setData({ movie: { ...makeResult().movie, budget: 356000000, revenue: 2799439100, production_countries: [{ name: 'United States of America' }] } })
      expect(wrapper.vm.boxOfficeSummary).toBe('$356M budget · $2.8B box office')
      expect(wrapper.vm.placesSummary).toContain('United States of America')
    })
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
          stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
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
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
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
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
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

    // Bug report 2026-09-30: the tile's toggle is stacked (parenthetical
    // under the number) and the "your score" label under it is gone.
    expect(wrapper.findComponent({ name: 'ToggleableRating' }).props('stacked')).toBe(true)
    expect(wrapper.find('.fact-score').text().toLowerCase()).not.toContain('your score')
  })
})

describe('MovieDetail — Best in <span>', () => {
  // Bug report 2026-09-30 (second try): "on the date that this movie was
  // released, it was the best movie that had come out for six weeks". The
  // time span leads; the older film is named as the one that ended the run.
  function mountWith (library) {
    const store = {
      state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {} },
      getters: { allMoviesAsArray: [], allMediaAsArray: library, allMediaSortedByRating: [], customLists: [] },
      commit: vi.fn(),
      dispatch: vi.fn()
    }
    return shallowMount(MovieDetail, {
      global: {
        mocks: { $store: store, $route: { params: { tmdbId: '42' }, query: {} }, $router: { push: vi.fn() } },
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
      }
    })
  }
  const film = (id, title, release_date, calculatedTotal) => makeResult({
    dbKey: `k${id}`,
    movie: { id, title, release_date },
    ratings: [{ calculatedTotal, normalizedRating: calculatedTotal, date: Date.now() }]
  })

  it('leads with the span and names the last film released that rates higher', async () => {
    const current = film(42, 'Test Movie', '2019-05-20', 8.5)
    const library = [
      current,
      film(1, 'Older Better', '2019-04-08', 9.0), // six weeks earlier, higher
      film(2, 'Newer Worse', '2019-05-01', 7.0), // in the run, lower
      film(3, 'Tied', '2019-05-10', 8.5), // a tie doesn't end the run
      film(4, 'Much Older Better', '2010-01-01', 9.5)
    ]
    const wrapper = mountWith(library)
    await wrapper.setData({ result: current, movie: current.movie })

    // Folded, and low on the page (2026-10-04: "it doesn't need to be this
    // prominently featured", then "I don't like the asymmetry. Let's move
    // the best since message lower"): a plain row just above Artwork, out
    // of the You band's tiles so Letterboxd and Tags pair up.
    expect(wrapper.find('.detail-band--you #best-since').exists()).toBe(false)
    const tile = wrapper.find('.detail-band--last #best-since')
    expect(tile.exists()).toBe(true)
    expect(tile.attributes('tile')).toBeUndefined()
    const lastBand = wrapper.findAll('.detail-band--last > *').map(el => el.attributes('id'))
    expect(lastBand).toEqual(['best-since', 'artwork'])
    expect(tile.attributes('summary')).toBe('Older Better, 6 weeks')
    expect(wrapper.find('.you-panel .best-since-row').exists()).toBe(false)

    const row = tile.find('.best-since-row')
    // Fourth tweak (2026-09-30): no "Best in 6 weeks" label, just the sentence.
    expect(row.find('.best-since-label').exists()).toBe(false)
    const text = row.find('.best-since-text').text().replace(/\s+/g, ' ')
    // Third wording (2026-09-30): "the best movie to be released since E.T.
    // six years prior" — the film that ended the run leads, the span closes.
    expect(text).toContain('The best movie released since Older Better, 6 weeks prior.')
    expect(row.find('.best-since-text strong').text()).toBe('Older Better')
    expect(text).not.toContain('Nothing released')
    expect(text).not.toContain('Best since')
    expect(text).not.toContain('Best in')
    expect(text).toBe('The best movie released since Older Better, 6 weeks prior.')
  })

  it('shows nothing when no earlier film rates higher', async () => {
    const current = film(42, 'Test Movie', '2019-05-20', 8.5)
    const wrapper = mountWith([current, film(2, 'Worse', '2019-05-01', 7.0)])
    await wrapper.setData({ result: current, movie: current.movie })
    expect(wrapper.find('.best-since-row').exists()).toBe(false)
    expect(wrapper.find('#best-since').exists()).toBe(false)
  })
})
