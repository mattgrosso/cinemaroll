import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

// The component reads per-viewing scores through GetRating, which imports the
// real store singleton. Mocked here so these stay tests of the component
// rather than of the rating curve — yearInReviewStats.test.js covers the maths.
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getAllRatings: (entry) => entry?.ratings || null,
  getRating: (entry) => entry?.ratings?.[entry.ratings.length - 1] || {}
}))

const YearInReview = (await import('@/components/YearInReview.vue')).default

// Timestamps, not date-only ISO strings: `new Date('YYYY-01-01')` parses as
// UTC and rolls into the previous year under a negative offset.
function dateAtLocalNoon (year, month, day) {
  return new Date(year, month, day, 12, 0, 0).getTime()
}

function entry (id, { year = 2023, month = 5, day = 10, runtime = 100, cast = [], crew = [], genres = [], calculatedTotal = 7, releaseYear = year, extraRatings = [] } = {}) {
  return {
    dbKey: `k${id}`,
    movie: {
      id,
      title: `Movie ${id}`,
      runtime,
      cast,
      crew,
      genres,
      poster_path: '/p.jpg',
      release_date: `${releaseYear}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    },
    ratings: [{ calculatedTotal, date: dateAtLocalNoon(year, month, day) }, ...extraRatings]
  }
}

function factory (entries, { includeShorts = true, push = vi.fn() } = {}) {
  return mount(YearInReview, {
    global: {
      mocks: {
        $store: {
          getters: { allMediaAsArray: entries },
          state: { settings: { includeShorts } }
        },
        $router: { push }
      }
    }
  })
}

describe('YearInReview', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('availableYears derives distinct years from rating dates, newest first', () => {
    const entries = [entry(1, { year: 2022 }), entry(2, { year: 2024 }), entry(3, { year: 2023 })]
    const wrapper = factory(entries)
    expect(wrapper.vm.availableYears).toEqual([2024, 2023, 2022])
  })

  // The current year is very often empty in January; landing on a blank page
  // is worse than landing on the last year with something in it.
  it('opens on the most recent year that has anything in it', () => {
    const wrapper = factory([entry(1, { year: 2022 })])
    expect(wrapper.vm.selectedYear).toBe(2022)
  })

  it('viewings only includes ratings dated in selectedYear', async () => {
    const entries = [entry(1, { year: 2023 }), entry(2, { year: 2022 })]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.viewings.map((v) => v.movie.id)).toEqual([1])
  })

  // A film watched twice in a year is two viewings. The old page counted
  // films in the headline and viewings in the chart, so they disagreed.
  it('counts a film watched twice in the year as two viewings', async () => {
    const entries = [entry(1, {
      year: 2023,
      month: 1,
      extraRatings: [{ calculatedTotal: 8, date: dateAtLocalNoon(2023, 8, 4) }]
    })]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.viewings).toHaveLength(2)
  })

  // One rule app-wide since 2026-09-29 (shorts.js): 40 minutes or under,
  // Home's cutoff. A feature-length film TMDB happens to tag "Short" is not
  // a short — this screen used to disagree with Home about that.
  it('excludes shorts (runtime <= 40, the Home rule) when includeShorts is false', async () => {
    const entries = [
      entry(1, { year: 2023, runtime: 100 }),
      entry(2, { year: 2023, runtime: 30 }),
      entry(3, { year: 2023, runtime: 100, genres: [{ name: 'Short' }] })
    ]
    const wrapper = factory(entries, { includeShorts: false })
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.viewings.map((v) => v.movie.id)).toEqual([1, 3])
  })

  it('includeShorts true keeps everything', async () => {
    const entries = [entry(1, { year: 2023, runtime: 30 })]
    const wrapper = factory(entries, { includeShorts: true })
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.viewings.map((v) => v.movie.id)).toEqual([1])
  })

  it('totalMinutes sums runtime across the year and timeSpent reads in days and hours', async () => {
    const entries = [entry(1, { year: 2023, runtime: 90 }), entry(2, { year: 2023, runtime: 1500 })]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.totalMinutes).toBe(1590)
    expect(wrapper.vm.timeSpent).toBe('1 day and 2 hours')
  })

  it('percentOfYear measures a finished year against all 365 days of it', async () => {
    const wakingMinutesInYear = 16 * 60 * 365
    const entries = [entry(1, { year: 2023, runtime: wakingMinutesInYear / 2 })]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.percentOfYear).toBe('50.0')
  })

  // Against a full year's denominator, a January would read as a rounding
  // error rather than as the month it actually was.
  it('percentOfYear measures a year in progress against the days so far', async () => {
    const thisYear = new Date().getFullYear()
    const dayOfYear = Math.ceil((Date.now() - new Date(thisYear, 0, 1)) / 86400000)
    const entries = [entry(1, { year: thisYear, month: 0, day: 2, runtime: 16 * 60 * dayOfYear })]

    const wrapper = factory(entries)
    wrapper.vm.selectedYear = thisYear
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.percentOfYear).toBe('100.0')
  })

  it('topActors counts cast appearances (top 10 billed only) and sorts descending', async () => {
    const entries = [
      entry(1, { year: 2023, cast: [{ name: 'A' }, { name: 'B' }] }),
      entry(2, { year: 2023, cast: [{ name: 'A' }] })
    ]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.topActors[0]).toMatchObject({ name: 'A', count: 2 })
    expect(wrapper.vm.topActors[1]).toMatchObject({ name: 'B', count: 1 })
  })

  it('topDirectors only counts crew with job === Director', async () => {
    const entries = [
      entry(1, { year: 2023, crew: [{ job: 'Director', name: 'D1' }, { job: 'Editor', name: 'E1' }] }),
      entry(2, { year: 2023, crew: [{ job: 'Director', name: 'D1' }] })
    ]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.topDirectors).toEqual([{ name: 'D1', count: 2 }])
  })

  // In a thin year every director has exactly one film, which padded the
  // list out with names that mean nothing.
  it('leaves out directors you only saw once', async () => {
    const entries = [entry(1, { year: 2023, crew: [{ job: 'Director', name: 'Only Once' }] })]
    const wrapper = factory(entries)
    wrapper.vm.selectedYear = 2023
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.topDirectors).toEqual([])
  })

  describe('extremeCards', () => {
    it('labels the best, worst, longest, shortest and oldest of the year', async () => {
      const entries = [
        entry(1, { year: 2023, calculatedTotal: 9, runtime: 90, releaseYear: 2001 }),
        entry(2, { year: 2023, calculatedTotal: 2, runtime: 210, releaseYear: 1966 }),
        entry(3, { year: 2023, calculatedTotal: 6, runtime: 45, releaseYear: 2020 })
      ]
      const wrapper = factory(entries)
      wrapper.vm.selectedYear = 2023
      await wrapper.vm.$nextTick()

      const byLabel = Object.fromEntries(
        wrapper.vm.extremeCards.map((card) => [card.label, card.viewing.movie.id])
      )
      expect(byLabel['Loved most']).toBe(1)
      expect(byLabel['Loved least']).toBe(2)
      expect(byLabel.Shortest).toBe(3)
    })

    // One film in a year is simultaneously the best, worst, longest,
    // shortest and oldest thing in it — five cards of the same poster.
    it('does not render the same film as five different cards', async () => {
      const wrapper = factory([entry(1, { year: 2023 })])
      wrapper.vm.selectedYear = 2023
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.extremeCards).toHaveLength(1)
    })
  })

  describe('comparison', () => {
    it('compares a finished year against the whole of the year before', async () => {
      const entries = [
        entry(1, { year: 2023 }), entry(2, { year: 2023 }),
        entry(3, { year: 2022 })
      ]
      const wrapper = factory(entries)
      wrapper.vm.selectedYear = 2023
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.comparison.countDelta).toBe(1)
      expect(wrapper.vm.comparison.partial).toBe(false)
    })

    // Otherwise an August 2026 always reads as a collapse next to a whole
    // 2025, and every delta on the current year is negative for no reason
    // but the date.
    it('compares a year in progress against the same span of the year before', async () => {
      const thisYear = new Date().getFullYear()
      const entries = [
        entry(1, { year: thisYear, month: 0, day: 2 }),
        entry(2, { year: thisYear - 1, month: 0, day: 2 }),
        // December of last year is past the point this year has reached.
        entry(3, { year: thisYear - 1, month: 11, day: 20 })
      ]
      const wrapper = factory(entries)
      wrapper.vm.selectedYear = thisYear
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.comparison.before.count).toBe(1)
      expect(wrapper.vm.comparison.countDelta).toBe(0)
      expect(wrapper.vm.comparison.partial).toBe(true)
    })
  })

  describe('methods', () => {
    it('goToMovie pushes to the movie detail route', () => {
      const push = vi.fn()
      const wrapper = factory([], { push })
      wrapper.vm.goToMovie({ id: 42 })
      expect(push).toHaveBeenCalledWith('/movie/42')
    })

    // There was no way off this screen at all: `returnHome` was defined and
    // never called from anywhere (found in the 2026-08-16 navigation pass).
    it('has a back link, which it previously did not', () => {
      const wrapper = factory([], { push: vi.fn() })

      expect(wrapper.findComponent({ name: 'BackLink' }).exists()).toBe(true)
      expect(wrapper.vm.returnHome).toBeUndefined()
    })

    it('renders a year pill per available year, not a hidden select', () => {
      const entries = [entry(1, { year: 2023 }), entry(2, { year: 2022 })]
      const wrapper = factory(entries)

      expect(wrapper.findAll('.yir-year-pill')).toHaveLength(2)
      expect(wrapper.find('select').exists()).toBe(false)
    })
  })

  describe('actor headshots', () => {
    it('fetches TMDB person details and caches them by name', async () => {
      const entries = [entry(1, { year: 2023, cast: [{ name: 'Famous Person' }] })]
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ results: [{ id: 99, profile_path: '/p.jpg' }] })
      })
      const wrapper = factory(entries)
      await flushPromises()

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('search/person'))
      expect(wrapper.vm.actorDetails['Famous Person']).toEqual({ id: 99, profile_path: '/p.jpg' })
      expect(wrapper.vm.topActors[0]).toMatchObject({ name: 'Famous Person', profile_path: '/p.jpg' })
    })

    // The library arrives asynchronously. Fired from mounted(), the fetch
    // asked for the top actors of an empty list and never retried, so every
    // headshot on the real page rendered as a placeholder icon.
    it('fetches once the library arrives, not only on mount', async () => {
      // A reactive store mock, so filling it in after mount actually
      // invalidates the computed chain the way the real store does.
      const store = reactive({
        getters: { allMediaAsArray: [] },
        state: { settings: {} }
      })
      const wrapper = mount(YearInReview, {
        global: { mocks: { $store: store, $router: { push: vi.fn() } } }
      })
      await flushPromises()
      expect(global.fetch).not.toHaveBeenCalled()

      // Deliberately in the year the component already sits on, so nothing
      // about selectedYear changes when the data lands. That is the real
      // sequence: watching selectedYear instead of the names looks like it
      // works, right up until the year doesn't need to change.
      const openYear = wrapper.vm.selectedYear
      store.getters.allMediaAsArray = [
        entry(1, { year: openYear, month: 0, day: 2, cast: [{ name: 'Late Arrival' }] })
      ]
      await flushPromises()

      expect(wrapper.vm.selectedYear).toBe(openYear)
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('Late Arrival')))
    })

    it('silently no-ops on a failed fetch rather than throwing', async () => {
      const entries = [entry(1, { year: 2023, cast: [{ name: 'Someone' }] })]
      global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
      const wrapper = factory(entries)
      await flushPromises()

      expect(wrapper.vm.actorDetails).toEqual({})
    })

    it('re-fetches when the year changes to a different cast', async () => {
      const entries = [
        entry(1, { year: 2023, cast: [{ name: 'A' }] }),
        entry(2, { year: 2022, cast: [{ name: 'B' }] })
      ]
      const wrapper = factory(entries)
      await flushPromises()
      global.fetch.mockClear()

      wrapper.vm.selectedYear = 2022
      await flushPromises()

      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent('B')))
    })
  })
})
