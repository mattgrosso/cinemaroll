import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import Insights from '@/components/Insights.vue'

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const r = (media?.ratings && media.ratings[media.ratings.length - 1]) || {}
    return {
      ...r,
      calculatedTotal: r.calculatedTotal != null ? r.calculatedTotal : 0
    }
  }),
  // The all-time calendar coverage grid reads every rating, not just the
  // most recent one. A partial mock of this module fails loudly rather than
  // returning undefined, so it has to keep pace with what Insights imports.
  getAllRatings: vi.fn((media) => media?.ratings || null)
}))

// Ratings record `date` as a real Date-derived value, not a bare "YYYY-MM-DD"
// string — using a local-time timestamp here (not a date-only ISO string)
// sidesteps `new Date('YYYY-MM-DD')`'s UTC-midnight parsing, which shifts a
// day backward in negative-UTC-offset timezones (confirmed in this repo's
// test environment: America/New_York) and would otherwise misassign ratings
// across month/year boundaries in these fixtures.
function localDate (year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime()
}

function entry (overrides = {}) {
  return {
    dbKey: overrides.dbKey || 'key',
    ratings: overrides.ratings || [{ calculatedTotal: 5, date: localDate(2026, 1, 15) }],
    movie: {
      id: 1,
      title: 'Movie',
      release_date: localDate(2010, 5, 15),
      runtime: 100,
      genres: [],
      cast: [],
      crew: [],
      keywords: [],
      ...overrides.movie
    }
  }
}

// `mediaEntries` MUST be supplied here, at construction, rather than mutated
// on the mock store after mounting. Insights.vue's template reads several
// computeds unconditionally during the initial (synchronous) shallowMount
// render, and since this mock $store is a plain object (not a real reactive
// Vuex store), any computed touched during that first render permanently
// caches whatever `getters.allMediaAsArray` held AT THAT MOMENT — the same
// "Vue computed with no reactive dependency never re-evaluates" trap fixed
// in store/index.js's devMode getter (see that commit). Mutating the array
// post-mount silently no-ops for any computed already rendered once.
function mountInsights ({ state = {}, mediaEntries = [] } = {}) {
  const pushSpy = vi.fn()
  const commitSpy = vi.fn()
  const dispatchSpy = vi.fn(() => Promise.resolve())
  const mockStore = {
    state: {
      currentLog: 'movieLog',
      settings: {},
      ...state
    },
    getters: { allMediaAsArray: mediaEntries },
    commit: commitSpy,
    dispatch: dispatchSpy
  }

  const wrapper = shallowMount(Insights, {
    global: {
      mocks: {
        $store: mockStore,
        $route: { query: {} },
        $router: { push: pushSpy }
      }
    }
  })

  return { wrapper, pushSpy, commitSpy, dispatchSpy, mockStore }
}

describe('Insights', () => {
  describe('date-window computeds (fixed system time)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 21)) // Jul 21 2026
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('thisMonth/lastMonth/thisYear/lastYear read off the pinned wall clock', () => {
      const { wrapper } = mountInsights()
      expect(wrapper.vm.thisMonth).toBe('July')
      expect(wrapper.vm.lastMonth).toBe('June')
      expect(wrapper.vm.thisYear).toBe(2026)
      expect(wrapper.vm.lastYear).toBe(2025)
    })

    it('moviesWatchedThisWeek/LastWeek only count ratings within their 7-day windows', () => {
      const mediaEntries = [
        entry({ dbKey: 'today', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 21) }] }),
        entry({ dbKey: 'thisWeek', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 17) }] }),
        entry({ dbKey: 'lastWeek', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 10) }] }),
        entry({ dbKey: 'longAgo', ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 1) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedThisWeek).toBe(2) // today + thisWeek
      expect(wrapper.vm.moviesWatchedLastWeek).toBe(1) // lastWeek
    })

    it('moviesWatchedThisMonth/LastMonth bucket by calendar month, not a rolling window', () => {
      const mediaEntries = [
        entry({ dbKey: 'a', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 1) }] }),
        entry({ dbKey: 'b', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 21) }] }),
        entry({ dbKey: 'c', ratings: [{ calculatedTotal: 5, date: localDate(2026, 6, 15) }] }),
        entry({ dbKey: 'd', ratings: [{ calculatedTotal: 5, date: localDate(2025, 7, 15) }] }) // same month, different year
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedThisMonth).toBe(2)
      expect(wrapper.vm.moviesWatchedLastMonth).toBe(1)
    })

    it('moviesWatchedThisYear/LastYear bucket by calendar year', () => {
      const mediaEntries = [
        entry({ dbKey: 'a', ratings: [{ calculatedTotal: 5, date: localDate(2026, 2, 1) }] }),
        entry({ dbKey: 'b', ratings: [{ calculatedTotal: 5, date: localDate(2026, 11, 1) }] }),
        entry({ dbKey: 'c', ratings: [{ calculatedTotal: 5, date: localDate(2025, 3, 1) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedThisYear).toBe(2)
      expect(wrapper.vm.moviesWatchedLastYear).toBe(1)
    })

    it('moviesWatchedLastYearToDate only counts last year up through the same month/day as today', () => {
      const mediaEntries = [
        entry({ dbKey: 'before-cutoff', ratings: [{ calculatedTotal: 5, date: localDate(2025, 7, 20) }] }),
        entry({ dbKey: 'on-cutoff', ratings: [{ calculatedTotal: 5, date: localDate(2025, 7, 21) }] }),
        entry({ dbKey: 'after-cutoff', ratings: [{ calculatedTotal: 5, date: localDate(2025, 7, 22) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedLastYearToDate).toBe(2) // before + on cutoff, not after
    })
  })

  describe('estimatedMoviesThisYear (characterization)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 21)) // day 202 of 2026 (not a leap year)
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('produces a stable estimate for a fixed viewing history — locks in current behavior', () => {
      const mediaEntries = [
        entry({ dbKey: 'a', ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 5) }] }),
        entry({ dbKey: 'b', ratings: [{ calculatedTotal: 5, date: localDate(2026, 3, 10) }] }),
        entry({ dbKey: 'c', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 18) }] }),
        entry({ dbKey: 'd', ratings: [{ calculatedTotal: 5, date: localDate(2026, 7, 20) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      // This is a characterization test: the exact number below is whatever
      // the current formula produces for this fixture, captured as a
      // regression guard — not independently re-derived by hand. If this
      // starts failing after a legitimate formula change, recompute and
      // update rather than assuming the new number is wrong.
      expect(wrapper.vm.estimatedMoviesThisYear).toBe(15)
    })

    it('does not throw when nothing has been watched yet this year (division by small dayOfYear)', () => {
      const { wrapper } = mountInsights()
      expect(Number.isNaN(wrapper.vm.estimatedMoviesThisYear)).toBe(false)
      expect(wrapper.vm.estimatedMoviesThisYear).toBe(0)
    })
  })

  describe('seasonalProjectedAdditional (follow-up ask: "look at what I was doing last year... build in some guards against people with very small libraries")', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 21)) // Jul 21 2026, same as the describe block above
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function datedEntries (prefix, dates) {
      return dates.map(([y, m, d], i) => entry({ dbKey: `${prefix}-${i}`, ratings: [{ calculatedTotal: 5, date: localDate(y, m, d) }] }))
    }

    it('is null when last year\'s FULL-YEAR total is too small to trust a "shape" (MIN_LAST_YEAR_TOTAL)', () => {
      // 11 movies, all last year — under the 12-movie floor.
      const mediaEntries = datedEntries('ly', Array.from({ length: 11 }, (_, i) => [2025, 1, i + 1]))
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedLastYear).toBe(11)
      expect(wrapper.vm.seasonalProjectedAdditional).toBeNull()
    })

    it('is null when last year\'s TO-DATE count is too small, even with a large full-year total (MIN_LAST_YEAR_TO_DATE)', () => {
      // Only 3 movies by Jul 21 2025 (to-date), but 20 for the full year —
      // the rest all land after the cutoff.
      const mediaEntries = datedEntries('ly', [
        [2025, 1, 1], [2025, 1, 2], [2025, 1, 3],
        ...Array.from({ length: 17 }, (_, i) => [2025, 9, i + 1])
      ])
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedLastYear).toBe(20)
      expect(wrapper.vm.moviesWatchedLastYearToDate).toBe(3)
      expect(wrapper.vm.seasonalProjectedAdditional).toBeNull()
    })

    it('computes a real projection once both guards pass, scaling this year\'s count by the inverse of last year\'s to-date fraction', () => {
      // Last year: 10 by Jul 21 (to-date), 10 more after -> total 20,
      // fraction watched-by-now = 0.5. This year: exactly 10 watched so
      // far. Projected full-year total = 10 / 0.5 = 20, so the ADDITIONAL
      // implied by this signal alone is 20 - 10 = 10 — a clean, exactly
      // hand-checkable case (not just a characterization lock-in).
      const mediaEntries = [
        ...datedEntries('ly-early', Array.from({ length: 10 }, (_, i) => [2025, 1, i + 1])),
        ...datedEntries('ly-late', Array.from({ length: 10 }, (_, i) => [2025, 9, i + 1])),
        ...datedEntries('ty', Array.from({ length: 10 }, (_, i) => [2026, 2, i + 1]))
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedLastYear).toBe(20)
      expect(wrapper.vm.moviesWatchedLastYearToDate).toBe(10)
      expect(wrapper.vm.moviesWatchedThisYear).toBe(10)
      expect(wrapper.vm.seasonalProjectedAdditional).toBe(10)
    })

    it('floors an extremely lopsided fraction at MIN_FRACTION rather than letting it scale up unboundedly', () => {
      // Last year: 4 by Jul 21 (to-date — clears MIN_LAST_YEAR_TO_DATE on
      // its own), but 40 for the full year — a real fraction of 4/40 =
      // 0.1 would imply a 10x scale-up. MIN_FRACTION (0.15) caps it well
      // short of that, independent of the absolute-count guards above.
      const mediaEntries = [
        ...datedEntries('ly-early', [[2025, 1, 1], [2025, 1, 2], [2025, 1, 3], [2025, 1, 4]]),
        ...datedEntries('ly-late', Array.from({ length: 36 }, (_, i) => [2025, 9, (i % 28) + 1])),
        ...datedEntries('ty', Array.from({ length: 6 }, (_, i) => [2026, 2, i + 1]))
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.moviesWatchedLastYear).toBe(40)
      expect(wrapper.vm.moviesWatchedLastYearToDate).toBe(4)
      // Uncapped, 6 / (4/40) - 6 = 54. Capped at the 0.15 floor:
      // 6 / 0.15 - 6 = 34.
      expect(wrapper.vm.seasonalProjectedAdditional).toBeCloseTo(34, 5)
    })

    it('estimatedMoviesThisYear blends the seasonal signal in when it qualifies, and falls back to the unchanged 3-way blend when it does not', () => {
      const thisYearDates = Array.from({ length: 10 }, (_, i) => [2026, 2, i + 1])
      const qualifyingLastYear = [
        ...Array.from({ length: 10 }, (_, i) => [2025, 1, i + 1]),
        ...Array.from({ length: 10 }, (_, i) => [2025, 9, i + 1])
      ]

      const withSeasonal = mountInsights({
        mediaEntries: [...datedEntries('ly', qualifyingLastYear), ...datedEntries('ty', thisYearDates)]
      }).wrapper
      const withoutSeasonal = mountInsights({
        mediaEntries: datedEntries('ty', thisYearDates)
      }).wrapper

      expect(withSeasonal.vm.seasonalProjectedAdditional).not.toBeNull()
      expect(withoutSeasonal.vm.seasonalProjectedAdditional).toBeNull()
      // Same "this year" viewing in both cases, but the version with a
      // qualifying prior year produces a DIFFERENT (not just coincidentally
      // equal) final estimate — proof the signal actually reaches the
      // blended output, not just its own isolated computed.
      expect(withSeasonal.vm.estimatedMoviesThisYear).not.toBe(withoutSeasonal.vm.estimatedMoviesThisYear)
    })
  })

  describe('rating stats (highest/lowest/average)', () => {
    it('computes max/min/mean over rated movies only', () => {
      const mediaEntries = [
        entry({ dbKey: 'a', ratings: [{ calculatedTotal: 4, date: localDate(2026, 1, 1) }] }),
        entry({ dbKey: 'b', ratings: [{ calculatedTotal: 9, date: localDate(2026, 1, 1) }] }),
        entry({ dbKey: 'c', ratings: [{ calculatedTotal: 6.5, date: localDate(2026, 1, 1) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      expect(wrapper.vm.highestRating).toBe('9.00')
      expect(wrapper.vm.lowestRating).toBe('4.00')
      expect(wrapper.vm.averageRating).toBe('6.50')
    })

    it('characterizes the empty-library edge case (no unrated-safe guard today)', () => {
      const { wrapper } = mountInsights()

      // Documents current (not necessarily desirable) behavior: Math.max()/
      // Math.min() over an empty array are +/-Infinity, and 0/0 is NaN.
      expect(wrapper.vm.highestRating).toBe('-Infinity')
      expect(wrapper.vm.lowestRating).toBe('Infinity')
      expect(wrapper.vm.averageRating).toBe('NaN')
    })
  })

  describe('ratingsCountData histogram', () => {
    it('buckets ratings into 0.5-point-wide labeled buckets', () => {
      const mediaEntries = [
        entry({ dbKey: 'a', ratings: [{ calculatedTotal: 7.1, date: localDate(2026, 1, 1) }] }),
        entry({ dbKey: 'b', ratings: [{ calculatedTotal: 7.4, date: localDate(2026, 1, 1) }] }),
        entry({ dbKey: 'c', ratings: [{ calculatedTotal: 8.0, date: localDate(2026, 1, 1) }] })
      ]
      const { wrapper } = mountInsights({ mediaEntries })

      const data = wrapper.vm.ratingsCountData
      const total = data.datasets[0].data.reduce((a, b) => a + b, 0)
      expect(total).toBe(3)
      // 7.1 and 7.4 both round to the nearest 0.5 -> 7.0 and 7.5 respectively;
      // whichever labels they land on should sum with the 8.0 bucket to 3.
      expect(data.labels).toContain('8')
    })
  })

  describe('getAxisValue + calculate*Scale heuristics', () => {
    it('dispatches simple axes without touching the scale calculators', () => {
      const { wrapper } = mountInsights()
      const result = entry({ movie: { runtime: 120, release_date: localDate(2015, 6, 1), genres: [{ name: 'Drama' }], cast: [1, 2, 3], title: 'Abc' } })

      expect(wrapper.vm.getAxisValue(result, 'runtime')).toBe(120)
      expect(wrapper.vm.getAxisValue(result, 'releaseYear')).toBe(2015)
      expect(wrapper.vm.getAxisValue(result, 'releaseMonth')).toBe(6)
      expect(wrapper.vm.getAxisValue(result, 'genreCount')).toBe(1)
      expect(wrapper.vm.getAxisValue(result, 'castSize')).toBe(3)
      expect(wrapper.vm.getAxisValue(result, 'titleLength')).toBe(3)
    })

    it('returns null for an unknown axis key', () => {
      const { wrapper } = mountInsights()
      const result = entry()
      expect(wrapper.vm.getAxisValue(result, 'notARealAxis')).toBeNull()
    })

    it('dispatches *Scale axes to their matching calculate*Scale method', () => {
      const { wrapper } = mountInsights()
      const result = entry({ movie: { genres: [{ name: 'Documentary' }], flatKeywords: [] } })
      const spy = vi.spyOn(wrapper.vm, 'calculateCerebralScale')

      wrapper.vm.getAxisValue(result, 'cerebralScale')
      expect(spy).toHaveBeenCalledWith(result.movie)
    })

    it('calculateCerebralScale scores cerebral genres positive and instinctual genres negative', () => {
      const { wrapper } = mountInsights()
      const documentary = { genres: [{ name: 'Documentary' }], flatKeywords: [], runtime: 100, title: '' }
      const action = { genres: [{ name: 'Action' }], flatKeywords: [], runtime: 100, title: '' }

      expect(wrapper.vm.calculateCerebralScale(documentary)).toBeGreaterThan(0)
      expect(wrapper.vm.calculateCerebralScale(action)).toBeLessThan(0)
    })

    it('every calculate*Scale result is clamped to [-10, 10]', () => {
      const { wrapper } = mountInsights()
      // Stack every cerebral+instinctual genre/keyword this function knows about
      // to try to blow past the clamp in both directions.
      const maxedOut = {
        genres: [{ name: 'Documentary' }, { name: 'Drama' }, { name: 'History' }, { name: 'War' }, { name: 'Biography' }],
        flatKeywords: ['philosophy', 'politics', 'paranoia', 'dystopia', 'investigation', 'memory', 'psychology', 'conspiracy'],
        runtime: 400,
        title: 'x'.repeat(50)
      }
      const score = wrapper.vm.calculateCerebralScale(maxedOut)
      expect(score).toBeLessThanOrEqual(10)
      expect(score).toBeGreaterThanOrEqual(-10)
    })
  })

  describe('navigation and Firebase-write methods', () => {
    // The back link works out where it's going and hands the target over;
    // Insights' only remaining job on the way out is restoring the header.
    it('leaving restores the header and follows the link\'s target', () => {
      const { wrapper, commitSpy, pushSpy } = mountInsights()

      wrapper.vm.leave({ path: '/', label: 'Home', useBack: false })

      expect(commitSpy).toHaveBeenCalledWith('setShowHeader', true)
      expect(pushSpy).toHaveBeenCalledWith('/')
    })

    it('leaving prefers real history when there is somewhere to go back to', () => {
      const { wrapper, commitSpy } = mountInsights()
      const back = vi.fn()
      wrapper.vm.$router.back = back

      wrapper.vm.leave({ path: '/film-club', label: 'Film Club', useBack: true })

      expect(commitSpy).toHaveBeenCalledWith('setShowHeader', true)
      expect(back).toHaveBeenCalled()
    })

    it('goToYearInReview navigates to /year-in-review', () => {
      const { wrapper, pushSpy } = mountInsights()
      wrapper.vm.goToYearInReview()
      expect(pushSpy).toHaveBeenCalledWith('/year-in-review')
    })

    it('updateSearchValue navigates Home with the search term as a query param', () => {
      const { wrapper, pushSpy } = mountInsights()
      wrapper.vm.updateSearchValue('Denis Villeneuve')
      expect(pushSpy).toHaveBeenCalledWith({ name: 'Home', query: { search: encodeURIComponent('Denis Villeneuve') } })
    })
  })
})

// The 2026-08-16 reorganization: Matt couldn't tell what Activity meant next
// to Overview ("it kinda seems like a lot of this is activity"), and the
// rating summary numbers sat on Ratings where they read as a duplicate of
// Overview. Everything time-based is on Activity now; the headline figures
// are on Overview.
describe('Insights — what lives on which tab', () => {
  function tabLabels (wrapper) {
    return wrapper.findAll('.glance-label').map((label) => label.text())
  }

  async function showTab (wrapper, key) {
    await wrapper.setData({ activeTab: key })
    return wrapper
  }

  it('puts the library and rating headline figures on Overview', async () => {
    const { wrapper } = mountInsights({ mediaEntries: [entry()] })
    await showTab(wrapper, 'overview')

    expect(tabLabels(wrapper)).toEqual(['Movies', 'Viewings', 'Highest', 'Average', 'Lowest'])
  })

  it('keeps every time-based figure off Overview', async () => {
    const { wrapper } = mountInsights({ mediaEntries: [entry()] })
    await showTab(wrapper, 'overview')
    const labels = tabLabels(wrapper).join(' ')

    expect(labels).not.toMatch(/week/i)
    expect(labels).not.toMatch(/so far/i)
    expect(wrapper.find('.pace-box').exists()).toBe(false)
  })

  it('gives Activity the pace box and the period counts', async () => {
    const { wrapper } = mountInsights({ mediaEntries: [entry()] })
    await showTab(wrapper, 'activity')

    expect(wrapper.find('.pace-box').exists()).toBe(true)
    expect(wrapper.find('.pace-box').text()).toMatch(/on track for/)
    expect(tabLabels(wrapper).length).toBe(5) // week, this month, last month, and last year's pair
    expect(tabLabels(wrapper)[0]).toBe('This Week')
  })

  // Matt, 2026-09-25: "make those all tappable so I could click on the
  // month one and see a month by month breakdown going backwards."
  describe('tappable activity counts', () => {
    it('opens the month-by-month history from the month tile, and closes it on a second tap', async () => {
      const now = new Date()
      const { wrapper } = mountInsights({
        mediaEntries: [entry({ ratings: [{ calculatedTotal: 5, date: new Date(now.getFullYear(), now.getMonth(), 1).toISOString() }] })]
      })
      await showTab(wrapper, 'activity')
      expect(wrapper.find('.breakdown-box').exists()).toBe(false)

      const monthTile = wrapper.findAll('.glance-item')[1]
      await monthTile.trigger('click')
      expect(wrapper.find('.breakdown-title').text()).toBe('Month by Month')
      expect(wrapper.find('.breakdown-row .breakdown-count').text()).toBe('1')

      await monthTile.trigger('click')
      expect(wrapper.find('.breakdown-box').exists()).toBe(false)
    })

    it('opens week-by-week from This Week and year-by-year from the pace box', async () => {
      const { wrapper } = mountInsights({ mediaEntries: [entry()] })
      await showTab(wrapper, 'activity')

      await wrapper.findAll('.glance-item')[0].trigger('click')
      expect(wrapper.find('.breakdown-title').text()).toBe('Week by Week')

      await wrapper.find('.pace-box').trigger('click')
      expect(wrapper.find('.breakdown-title').text()).toBe('Year by Year')
      expect(wrapper.find('.breakdown-list').classes()).toContain('with-todate')
    })
  })

  describe('all-time calendar coverage', () => {
    it('lays every calendar date out on Activity and counts the ones you have', async () => {
      const { wrapper } = mountInsights({
        mediaEntries: [entry({ ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 15) }] })]
      })
      await showTab(wrapper, 'activity')

      expect(wrapper.findAll('.coverage-row')).toHaveLength(12)
      expect(wrapper.findAll('.coverage-cell')).toHaveLength(366)
      expect(wrapper.find('.coverage-caption').text()).toMatch(/a film on 1 of 366 dates/)
    })

    // The gaps are the whole point — Matt wanted to see "if there's any
    // specific dates that I have yet to watch a movie on".
    it('marks the dates you have never watched anything on', async () => {
      const { wrapper } = mountInsights({
        mediaEntries: [entry({ ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 15) }] })]
      })
      await showTab(wrapper, 'activity')

      // 366 dates, one of them watched, and Feb 29 called out separately.
      expect(wrapper.findAll('.coverage-none')).toHaveLength(364)
      expect(wrapper.findAll('.coverage-rare')).toHaveLength(1)
      expect(wrapper.find('.coverage-gaps').text()).toMatch(/Still to claim/)
    })

    // Bug report 2026-08-25: "the graph says there are three dates that I've
    // never watched on, but it only tells me about two of them. What is that
    // last date? Is it possible it's February 29?" It was — Feb 29 is held
    // out of the named gaps on purpose (an empty one says much less than an
    // empty Mar 3), but it was still counted in the total and then swallowed
    // by an unhelpful "and 1 more".
    it('names Feb 29 instead of hiding it inside "and 1 more"', async () => {
      const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
      const skip = new Set(['2-29', '3-3', '11-12'])
      const mediaEntries = []
      DAYS_IN_MONTH.forEach((length, index) => {
        const month = index + 1
        for (let day = 1; day <= length; day++) {
          if (skip.has(`${month}-${day}`)) continue
          mediaEntries.push(entry({
            dbKey: `d-${month}-${day}`,
            // 2024 so Feb 29 is a real date in the fixture year.
            ratings: [{ calculatedTotal: 5, date: localDate(2024, month, day) }]
          }))
        }
      })

      const { wrapper } = mountInsights({ mediaEntries })
      await showTab(wrapper, 'activity')

      expect(wrapper.find('.coverage-caption').text()).toMatch(/a film on 363 of 366 dates/)
      expect(wrapper.find('.coverage-caption').text()).toMatch(/the 3 you never have/)

      const gaps = wrapper.find('.coverage-gaps').text()
      expect(gaps).toContain('Mar 3')
      expect(gaps).toContain('Nov 12')
      // The whole point: the third date is named, and set apart with the
      // reason it's different rather than left as a riddle.
      expect(gaps).toContain('Feb 29')
      expect(gaps).toMatch(/every fourth year/)
      expect(gaps).not.toMatch(/1 more/)
    })

    // The "and N more" tail still has to work — it's only the rare date that
    // was being miscounted into it.
    it('still counts ordinary gaps beyond the named handful', async () => {
      const mediaEntries = [entry({ ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 15) }] })]
      const { wrapper } = mountInsights({ mediaEntries })
      await showTab(wrapper, 'activity')

      // 366 dates, 1 watched, 365 missing = 364 ordinary + Feb 29. Six are
      // named, so 358 ordinary gaps remain — Feb 29 is NOT among them.
      expect(wrapper.find('.coverage-gaps').text()).toMatch(/and 358 more/)
    })

    it('collapses the same date across years into one cell', async () => {
      const { wrapper } = mountInsights({
        mediaEntries: [
          entry({ dbKey: 'a', ratings: [{ calculatedTotal: 5, date: localDate(2024, 1, 15) }] }),
          entry({ dbKey: 'b', ratings: [{ calculatedTotal: 5, date: localDate(2026, 1, 15) }] })
        ]
      })
      await showTab(wrapper, 'activity')

      expect(wrapper.find('.coverage-caption').text()).toMatch(/a film on 1 of 366 dates/)
      expect(wrapper.find('.coverage-caption').text()).toMatch(/2 years of watching/)
    })

    // 366 hollow squares is a bleak welcome.
    it('stays hidden until there is something to show', async () => {
      const { wrapper } = mountInsights({ mediaEntries: [] })
      await showTab(wrapper, 'activity')

      expect(wrapper.find('.coverage-box').exists()).toBe(false)
    })
  })

  it('no longer repeats the rating figures on Ratings', async () => {
    const { wrapper } = mountInsights({ mediaEntries: [entry()] })
    await showTab(wrapper, 'ratings')

    expect(wrapper.text()).not.toMatch(/Highest Rating/)
    expect(wrapper.find('.glance-label').exists()).toBe(false)
  })

  // Colour that means something: each tab owns one, and the panels inside it
  // inherit it through a custom property.
  it('carries the active tab colour on the root, and marks the active tab', async () => {
    const { wrapper } = mountInsights({ mediaEntries: [entry()] })

    await showTab(wrapper, 'activity')
    expect(wrapper.classes()).toContain('insights-accent-activity')
    const active = wrapper.findAll('.insights-tab').filter((tab) => tab.classes('active'))
    expect(active).toHaveLength(1)
    expect(active[0].classes()).toContain('insights-tab-activity')

    await showTab(wrapper, 'people')
    expect(wrapper.classes()).toContain('insights-accent-people')
    expect(wrapper.classes()).not.toContain('insights-accent-activity')
  })

  it('reads the scatter plot out loud when the axes are related', async () => {
    const rising = Array.from({ length: 12 }, (_, i) => entry({
      dbKey: `k${i}`,
      ratings: [{ calculatedTotal: i, date: localDate(2026, 1, 15) }],
      movie: { id: i, runtime: 60 + i * 10 }
    }))
    const { wrapper } = mountInsights({ mediaEntries: rising })
    await showTab(wrapper, 'ratings')
    await wrapper.setData({ selectedXAxis: 'runtime', selectedYAxis: 'userRating' })

    // Asserted on the computed: the readout renders inside an InsightsPane,
    // which shallowMount stubs, so its slot never reaches the DOM here.
    expect(wrapper.vm.scatterReading).toMatch(/Runtime .* and User Rating rise together/)
  })
})

// The Places tab (2026-09-08): "see what movies are set where", "I really
// like movies set in Paris", and a coverage map of the world. Drives the
// tab through the DOM; the map itself is tested in CoverageMap.test.js.
describe('Places tab', () => {
  // shallowMount stubs InsightsPane, which would swallow the lists inside
  // it — so this block mounts with a pane that renders its slot, and a
  // stubbed map (CoverageMap.test.js covers the drawing).
  function mountPlaces (mediaEntries) {
    // The tab and the set/filmed choice persist in localStorage, which jsdom
    // keeps across tests in a file — one test's "Filmed in" must not leak
    // into the next one's counts.
    window.localStorage.clear()
    const pushSpy = vi.fn()
    const commitSpy = vi.fn()
    const mockStore = {
      state: { currentLog: 'movieLog', settings: {} },
      getters: { allMediaAsArray: mediaEntries },
      commit: commitSpy,
      dispatch: vi.fn(() => Promise.resolve())
    }
    const wrapper = shallowMount(Insights, {
      global: {
        mocks: { $store: mockStore, $route: { query: {} }, $router: { push: pushSpy } },
        stubs: { InsightsPane: { template: '<div><slot /></div>' }, CoverageMap: true }
      }
    })
    return { wrapper, pushSpy, commitSpy }
  }
  // Opening the tab starts the lazy import of the country polygons; the
  // coverage line and the map only render once it has landed.
  async function showTab (wrapper, key) {
    await wrapper.setData({ activeTab: key })
    await wrapper.vm.loadWorld()
    await wrapper.vm.$nextTick()
    return wrapper
  }
  const paris = (type) => ({ name: 'Paris', lat: 48.8566, lon: 2.3522, type, id: 'Q90' })
  const placed = (id, title, score, locations, extra = {}) => ({
    dbKey: `m${id}`,
    movie: { id, title, release_date: '2001-04-25', runtime: 120, genres: [], locations, ...extra },
    ratings: [{ calculatedTotal: score, date: localDate(2026, 1, 15) }]
  })
  const library = () => [
    placed(1, 'Amélie', 9.5, [paris('narrative'), paris('filming')], { production_countries: [{ iso_3166_1: 'FR', name: 'France' }] }),
    placed(2, 'Ratatouille', 9.0, [paris('narrative')]),
    placed(3, 'Before Sunset', 8.5, [paris('narrative')]),
    placed(4, 'Lost in Translation', 9.8, [{ name: 'Tokyo', lat: 35.68, lon: 139.69, type: 'filming', id: 'Q1490' }])
  ]

  it('offers the tab, and ranks the places you love with their scores', async () => {
    const { wrapper } = mountPlaces(library())
    await showTab(wrapper, 'places')

    expect(wrapper.find('.insights-tab-places').exists()).toBe(true)
    const rows = wrapper.findAll('.place-row')
    // Places You Love needs three films: only Paris qualifies. Most Visited
    // lists both.
    expect(rows.map((r) => r.find('.place-row-name').text())).toEqual(['Paris', 'Paris', 'Tokyo'])
    expect(rows[0].find('.place-row-score').text()).toBe('9.00')
    expect(rows[0].find('.place-row-films').text()).toBe('3 films')
    expect(wrapper.find('.places-summary').text()).toMatch(/2 of \d+ countries, across 4 of your 4 films/)
  })

  it('narrows to set-in or filmed-in', async () => {
    const { wrapper } = mountPlaces(library())
    await showTab(wrapper, 'places')
    const filmedChip = wrapper.findAll('.people-chip').find((c) => c.text() === 'Filmed in')
    await filmedChip.trigger('click')
    await wrapper.vm.$nextTick()

    // Filmed in: Paris once (Amélie), Tokyo once.
    const most = wrapper.findAll('.place-row').map((r) => r.find('.place-row-films').text())
    expect(most).toEqual(['1 film', '1 film'])
    expect(wrapper.vm.placeType).toBe('filming')
  })

  it('tapping a place hands Home a real place chip', async () => {
    const { wrapper, commitSpy, pushSpy } = mountPlaces(library())
    await showTab(wrapper, 'places')
    await wrapper.find('.place-row').trigger('click')

    const chips = commitSpy.mock.calls.find(([name]) => name === 'setHomePageSearchChips')[1]
    expect(chips).toHaveLength(1)
    expect(chips[0]).toMatchObject({ type: 'place', value: 'Paris', display: 'Paris' })
    expect(commitSpy).toHaveBeenCalledWith('setHomePagePromoteGroup', 'place')
    expect(pushSpy).toHaveBeenCalledWith('/')
  })

  it('a tapped country shows its breakdown and its places', async () => {
    const { wrapper } = mountPlaces(library())
    await showTab(wrapper, 'places')
    wrapper.vm.selectCountry({ iso: 'FR', name: 'France' })
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.country-card-title').text()).toContain('France')
    expect(wrapper.find('.country-card-title').text()).toContain('3 films')
    expect(wrapper.find('.country-card-breakdown').text()).toBe('3 set here · 1 filmed here · 1 made here')
    expect(wrapper.find('.place-pill').text()).toBe('Paris 3')
  })

  it('says how to fill places in when there are none', async () => {
    const { wrapper } = mountPlaces([placed(1, 'Unplaced', 7, [])])
    await showTab(wrapper, 'places')
    expect(wrapper.find('.places-empty').text()).toMatch(/Filming & story locations/)
    expect(wrapper.find('.place-row').exists()).toBe(false)
  })
})
