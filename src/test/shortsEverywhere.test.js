// Report 2026-09-29: "the one that says number in a day shouldn't include
// shorts if I have shorts turned off, and in fact that should be true of all
// things everywhere." The fun facts, the Insights counts/charts/People tab,
// the library-stats sections and Library Poster all read the whole library.
import { describe, it, expect, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { isShort, withoutShorts, includeShortsSetting } from '@/assets/javascript/shorts.js'
import FunFactsRow from '@/components/FunFactsRow.vue'
import Insights from '@/components/Insights.vue'
import LibraryPoster from '@/components/LibraryPoster.vue'
import statsSection from '@/components/stats/statsSection.js'

// The real getRating normalizes against settings this fixture doesn't carry;
// Insights.test.js mocks it the same way.
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => ({ ...(media?.ratings?.at(-1) || {}) })),
  getAllRatings: vi.fn((media) => media?.ratings || null)
}))

function localDate (year, month, day, hour = 12) {
  return new Date(year, month - 1, day, hour).getTime()
}

function film (id, runtime, date = localDate(2026, 3, 7), extra = {}) {
  return {
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: 5 + id / 10, date }],
    movie: {
      id,
      title: `Film ${id}`,
      runtime,
      release_date: '2000-01-01',
      poster_path: `/p${id}.jpg`,
      genres: [{ name: runtime <= 40 ? 'Animation' : 'Drama' }],
      cast: [],
      crew: [{ job: 'Director', name: runtime <= 40 ? 'Short Maker' : 'Feature Maker' }],
      keywords: [],
      ...extra
    }
  }
}

// A night of four shorts plus one feature on another day: with shorts off,
// there is no "biggest movie day" story at all.
const library = () => [
  film(1, 12), film(2, 15), film(3, 20), film(4, 9),
  film(5, 110, localDate(2026, 3, 8))
]

function store (entries, includeShorts) {
  return {
    state: { currentLog: 'movieLog', settings: { includeShorts } },
    getters: { allMoviesAsArray: entries, allMediaAsArray: entries },
    commit: vi.fn(),
    dispatch: vi.fn(() => Promise.resolve())
  }
}

describe('the shared short-film rule', () => {
  it('is 40 minutes or under; unknown runtime is not a short', () => {
    expect(isShort({ runtime: 40 })).toBe(true)
    expect(isShort({ runtime: 41 })).toBe(false)
    expect(isShort({ runtime: 0 })).toBe(false)
    expect(isShort({ runtime: null })).toBe(false)
    expect(isShort({ runtime: 100, genres: [{ name: 'Short' }] })).toBe(false)
  })

  it('withoutShorts filters by the setting and hands back the same array for the same library', () => {
    const entries = library()
    expect(withoutShorts(entries, true)).toBe(entries)
    const off = withoutShorts(entries, false)
    expect(off.map((e) => e.movie.id)).toEqual([5])
    expect(withoutShorts(entries, false)).toBe(off)
    expect(withoutShorts(undefined, false)).toEqual([])
  })

  it('defaults to shorts OFF unless the setting is explicitly true', () => {
    expect(includeShortsSetting({ settings: {} })).toBe(false)
    expect(includeShortsSetting({})).toBe(false)
    expect(includeShortsSetting({ settings: { includeShorts: true } })).toBe(true)
  })
})

describe('fun facts respect the shorts setting', () => {
  const mountRow = (includeShorts) => shallowMount(FunFactsRow, {
    global: { mocks: { $store: store(library(), includeShorts) } }
  })

  it('a night of shorts is not the biggest movie day when shorts are off', () => {
    const facts = mountRow(false).vm.facts
    expect(facts.find((f) => f.key === 'biggestDay')).toBeUndefined()
  })

  it('counts them when shorts are on', () => {
    const facts = mountRow(true).vm.facts
    expect(facts.find((f) => f.key === 'biggestDay').value).toBe('4 in one day')
  })
})

describe('Insights respects the shorts setting past the headline numbers', () => {
  const mountInsights = (includeShorts) => shallowMount(Insights, {
    global: {
      mocks: {
        $store: store(library(), includeShorts),
        $route: { query: {} },
        $router: { push: vi.fn() }
      }
    }
  })

  it('counts, ratings and the People tab leave shorts out when they are off', () => {
    const vm = mountInsights(false).vm
    expect(vm.resultsWithRatings.map((e) => e.movie.id)).toEqual([5])
    expect(vm.countDirectors).toEqual({ 'Feature Maker': 1 })
    expect(vm.countedGenres).toEqual({ Drama: 1 })
    expect(vm.activePeopleProps.allEntriesWithFlatKeywordsAdded.map((e) => e.movie.id)).toEqual([5])
  })

  it('keeps them when shorts are on', () => {
    const vm = mountInsights(true).vm
    expect(vm.resultsWithRatings).toHaveLength(5)
    expect(vm.countDirectors).toEqual({ 'Short Maker': 4, 'Feature Maker': 1 })
  })

  it('the calendar-gaps grid still counts a short as having watched something that day', () => {
    const vm = mountInsights(false).vm
    expect(vm.coverage).toBeTruthy()
    const days = new Set(vm.coverage.missing.map((gap) => `${gap.month}-${gap.day}`))
    expect(days.has('2-7')).toBe(false) // Mar 7: only shorts, still covered
  })
})

describe('library-stats sections and Library Poster respect the shorts setting', () => {
  it('the stats sections read a library without shorts', () => {
    const library = statsSection.computed.library.call({ $store: store(libraryFixture(), false) })
    expect(library.map((e) => e.movie.id)).toEqual([5])
  })

  it('Library Poster builds from a library without shorts', () => {
    const wrapper = shallowMount(LibraryPoster, { global: { mocks: { $store: store(libraryFixture(), false), $router: { push: vi.fn() } } } })
    expect(wrapper.vm.library.map((e) => e.movie.id)).toEqual([5])
  })
})

function libraryFixture () { return library() }
