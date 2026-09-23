import { describe, it, expect, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import DBGridLayoutSearchResult from '@/components/DBGridLayoutSearchResult.vue'
import { getRating } from '@/assets/javascript/GetRating.js'

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5, normalizedRating: 5, date: Date.now() })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

function makeResult (overrides = {}) {
  return {
    dbKey: 'abc123',
    movie: {
      id: 42,
      title: 'Oppenheimer',
      release_date: '2023-07-19',
      runtime: 180,
      poster_path: '/poster.jpg',
      genres: [],
      crew: [],
      flatKeywords: [],
      ...overrides.movie
    },
    ratings: [{ calculatedTotal: 8.5, normalizedRating: 8, date: Date.now() }],
    ...overrides
  }
}

function factory ({ allAcademyAwards = [], result = makeResult() } = {}) {
  const mockStore = {
    state: {
      settings: { letterboxdConnected: false, letterboxdUsername: '' },
      allAcademyAwards
    },
    getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map([[result.dbKey, 1]]) },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  return shallowMount(DBGridLayoutSearchResult, {
    props: { result, index: 0, keywordCounts: {}, allCounts: [] },
    global: {
      mocks: { $store: mockStore },
      directives: { lazy: () => {} }
    }
  })
}

describe('DBGridLayoutSearchResult — Academy Award wins/nominations, sourced from the locally-cached full dataset (state.allAcademyAwards) instead of a live per-movie fetch', () => {
  it('shows only wins/nominations for THIS result\'s movie, filtered from the shared dataset', () => {
    const allAcademyAwards = [
      { id: 1, tmdb: '42', category: 'Best Original Score', isActing: false, isWinner: true },
      { id: 2, tmdb: '42', category: 'Best Original Screenplay', isActing: false, isWinner: false },
      { id: 3, tmdb: '99', category: 'Best Picture', isActing: false, isWinner: true }
    ]
    const wrapper = factory({ allAcademyAwards })

    expect(wrapper.vm.academyAwardWins.map((a) => a.category)).toEqual(['Best Original Score'])
    expect(wrapper.vm.academyAwardNominations.map((a) => a.category)).toEqual(['Best Original Screenplay'])
  })

  it('renders no wins/nominations when the cached dataset has nothing for this movie (bug report: this section used to silently render empty for EVERY movie, due to an unawaited-promise bug — this confirms the fix actually surfaces real data, not just that empty stays empty)', () => {
    const wrapper = factory({ allAcademyAwards: [] })

    expect(wrapper.vm.academyAwardWins).toEqual([])
    expect(wrapper.vm.academyAwardNominations).toEqual([])
  })
})

describe('DBGridLayoutSearchResult — offline placeholder ratings (isPendingReconciliation)', () => {
  it('shows a "Pending match" badge and falls back to the not-found poster for a placeholder result', () => {
    const result = makeResult({ movie: { id: 'offline-abc', poster_path: null, isPendingReconciliation: true } })
    const wrapper = factory({ result })

    expect(wrapper.find('.pending-match-badge').exists()).toBe(true)
    expect(wrapper.vm.posterImageUrl(result)).not.toContain('image.tmdb.org')
  })

  it('does not show the badge for a normal, already-matched result', () => {
    const wrapper = factory()

    expect(wrapper.find('.pending-match-badge').exists()).toBe(false)
  })

  it('routes to /reconcile/:dbKey instead of /movie/:id when a pending-reconciliation card is tapped', () => {
    const result = makeResult({ dbKey: 'my-db-key', movie: { id: 'offline-abc', isPendingReconciliation: true } })
    const push = vi.fn()
    const wrapper = factory({ result })
    wrapper.vm.$router = { push }

    wrapper.vm.showDetails()

    expect(push).toHaveBeenCalledWith('/reconcile/my-db-key')
  })
})

describe('DBGridLayoutSearchResult — Academy Award wins/nominations (continued)', () => {
  it('tolerates a missing allAcademyAwards entirely without throwing (cold direct load before it has fetched)', () => {
    const result = makeResult()
    const mockStore = {
      state: { settings: { letterboxdConnected: false, letterboxdUsername: '' } },
      getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map([[result.dbKey, 1]]) },
      commit: vi.fn(),
      dispatch: vi.fn()
    }

    const wrapper = shallowMount(DBGridLayoutSearchResult, {
      props: { result, index: 0, keywordCounts: {}, allCounts: [] },
      global: {
        mocks: { $store: mockStore },
        directives: { lazy: () => {} }
      }
    })

    expect(wrapper.vm.academyAwardWins).toEqual([])
    expect(wrapper.vm.academyAwardNominations).toEqual([])
  })
})

// Requested 2026-08-26: "show the sorted values in the tiny bar below each
// poster. We do this already for some of the sort types but let's expand that
// to the specific category sorts (we should show the individual scores that
// we're sorting on) and now for the budget ones."
describe('DBGridLayoutSearchResult — the caption names whatever the list is sorted by', () => {
  const sortedBy = (sortValue, movie = {}, moneyInTodaysDollars = false) => {
    const result = makeResult({ movie: { budget: 200_000_000, revenue: 900_000_000, ...movie } })
    const mockStore = {
      state: { settings: { letterboxdConnected: false, letterboxdUsername: '' }, allAcademyAwards: [], moneyInTodaysDollars },
      getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map([[result.dbKey, 1]]) },
      commit: vi.fn(),
      dispatch: vi.fn()
    }
    return shallowMount(DBGridLayoutSearchResult, {
      props: { result, index: 0, keywordCounts: {}, allCounts: [], sortValue },
      global: { mocks: { $store: mockStore }, directives: { lazy: () => {} } }
    })
  }

  it('shows the money figure for each of the four money sorts', () => {
    expect(sortedBy('budget').vm.sortDetail).toBe('$200M')
    expect(sortedBy('boxOffice').vm.sortDetail).toBe('$900M')
    expect(sortedBy('profit').vm.sortDetail).toBe('+$700M')
    expect(sortedBy('returnPct').vm.sortDetail).toBe('450%')
  })

  // TMDB's 0 means "we don't know", not "it made nothing" — and these are the
  // same films that sink to the bottom of the sort.
  it('shows a dash, never "$0", when the figures are missing', () => {
    expect(sortedBy('budget', { budget: 0 }).vm.sortDetail).toBe('—')
    expect(sortedBy('boxOffice', { revenue: 0 }).vm.sortDetail).toBe('—')
    expect(sortedBy('profit', { revenue: 0 }).vm.sortDetail).toBe('—')
    expect(sortedBy('returnPct', { budget: 0 }).vm.sortDetail).toBe('—')
  })

  it('names the criterion score when sorted by one', () => {
    // getRating is mocked at the top of this file; extend it for these.
    getRating.mockReturnValue({ calculatedTotal: 8.44, direction: 9, soundtrack: 6, date: Date.now() })
    expect(sortedBy('direction').vm.sortDetail).toBe('dir 9')
    expect(sortedBy('soundtrack').vm.sortDetail).toBe('sndtk 6')
    getRating.mockReturnValue({ calculatedTotal: 5, normalizedRating: 5, date: Date.now() })
  })

  // A bare "9" beside an 8.44 score reads as a second, contradictory rating.
  it('labels the criterion rather than showing a bare number', () => {
    getRating.mockReturnValue({ calculatedTotal: 8.44, story: 7, date: Date.now() })
    expect(sortedBy('story').vm.sortDetail).toMatch(/^stry /)
    getRating.mockReturnValue({ calculatedTotal: 5, normalizedRating: 5, date: Date.now() })
  })

  it('says nothing for sorts that have no value to add', () => {
    // The score already sits on the right of this same bar; title has none.
    expect(sortedBy('rating').vm.sortDetail).toBe('')
    expect(sortedBy('title').vm.sortDetail).toBe('')
    expect(sortedBy('').vm.sortDetail).toBe('')
  })

  it('says nothing when a criterion was never scored', () => {
    getRating.mockReturnValue({ calculatedTotal: 8.44, date: Date.now() })
    expect(sortedBy('imagery').vm.sortDetail).toBe('')
    getRating.mockReturnValue({ calculatedTotal: 5, normalizedRating: 5, date: Date.now() })
  })

  // Matt, 2026-08-26: "when we sort by the various money things, we don't
  // need to [show the rank]... the only place the overall rank is useful is
  // sorted by rating."
  it('renders the figure and NOT the overall rank', () => {
    const wrapper = sortedBy('budget')
    expect(wrapper.find('.details').text()).toContain('$200M')
    expect(wrapper.find('.rank').exists()).toBe(false)
    expect(wrapper.vm.showsOverallRank).toBe(false)
  })

  it('keeps the rank on the rating sort, and only there', () => {
    expect(sortedBy('rating').vm.showsOverallRank).toBe(true)
    // An empty sortValue IS the rating sort — see getSortValue's default.
    expect(sortedBy('').vm.showsOverallRank).toBe(true)
    expect(sortedBy('rating').find('.rank').exists()).toBe(true)

    for (const other of ['watched', 'release', 'views', 'title', 'direction', 'budget', 'boxOffice', 'profit', 'returnPct']) {
      expect(sortedBy(other).vm.showsOverallRank).toBe(false)
    }
  })

  it('names the date or the view count on their own sorts, without a rank', () => {
    expect(sortedBy('views').find('.details').text()).toMatch(/view/)
    expect(sortedBy('views').find('.rank').exists()).toBe(false)
    expect(sortedBy('watched').find('.rank').exists()).toBe(false)
    expect(sortedBy('release').find('.rank').exists()).toBe(false)
  })

  // Nothing to say on a title sort — but the score still has to sit right,
  // which needs a left-hand element for space-between to push against.
  it('leaves an empty slot rather than no slot when there is nothing to say', () => {
    const details = sortedBy('title').find('.details')
    expect(details.element.children.length).toBeGreaterThanOrEqual(2)
  })
})

// Requested 2026-08-26: "a way to show boxoffice numbers adjusted for
// inflation." The caption has to agree with the sort, or a list ordered by
// today's dollars would be labelled with the original ones.
describe('DBGridLayoutSearchResult — the caption follows the money mode', () => {
  const card = (sortValue, movie, adjusted) => {
    const result = makeResult({ movie: { budget: 63_000_000, revenue: 920_000_000, release_date: '1993-06-11', ...movie } })
    const mockStore = {
      state: { settings: { letterboxdConnected: false, letterboxdUsername: '' }, allAcademyAwards: [], moneyInTodaysDollars: adjusted },
      getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map([[result.dbKey, 1]]) },
      commit: vi.fn(),
      dispatch: vi.fn()
    }
    return shallowMount(DBGridLayoutSearchResult, {
      props: { result, index: 0, keywordCounts: {}, allCounts: [], sortValue },
      global: { mocks: { $store: mockStore }, directives: { lazy: () => {} } }
    })
  }

  it('shows the original figures with the mode off', () => {
    expect(card('boxOffice', {}, false).vm.sortDetail).toBe('$920M')
    expect(card('budget', {}, false).vm.sortDetail).toBe('$63M')
  })

  it('shows bigger figures with the mode on', () => {
    // 1993 money is worth ~2.23x today's, per the bundled CPI table.
    expect(card('boxOffice', {}, true).vm.sortDetail).toBe('$2.1B')
    expect(card('budget', {}, true).vm.sortDetail).toBe('$141M')
  })

  it('adjusts profit too', () => {
    expect(card('profit', {}, false).vm.sortDetail).toBe('+$857M')
    expect(card('profit', {}, true).vm.sortDetail).toBe('+$1.9B')
  })

  // A ratio of two same-year figures has no era to be adjusted out of.
  it('leaves return on budget identical either way', () => {
    expect(card('returnPct', {}, true).vm.sortDetail)
      .toBe(card('returnPct', {}, false).vm.sortDetail)
  })

  it('still shows a dash for a film with no figures, adjusted or not', () => {
    expect(card('boxOffice', { revenue: 0 }, true).vm.sortDetail).toBe('—')
  })

  // Falling back to zero would reclassify an undated film as having no box
  // office at all.
  it('falls back to the raw figure when a film has no release date', () => {
    expect(card('boxOffice', { release_date: null }, true).vm.sortDetail).toBe('$920M')
  })
})

// Requested 2026-08-26: sink streaming originals on the budget sort. A $150M
// film sitting at the bottom of "most expensive" has to say why, or it reads
// as a bug rather than a decision.
describe('DBGridLayoutSearchResult — the sunk-film marker', () => {
  const card = (sortValue, movie) => {
    const result = makeResult({ movie: { budget: 150_000_000, revenue: 0, release_date: '2020-07-10', ...movie } })
    const mockStore = {
      state: { settings: { letterboxdConnected: false, letterboxdUsername: '' }, allAcademyAwards: [], moneyInTodaysDollars: false },
      getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map([[result.dbKey, 1]]) },
      commit: vi.fn(),
      dispatch: vi.fn()
    }
    return shallowMount(DBGridLayoutSearchResult, {
      props: { result, index: 0, keywordCounts: {}, allCounts: [], sortValue },
      global: { mocks: { $store: mockStore }, directives: { lazy: () => {} } }
    })
  }

  it('marks a modern film with a budget and no box office', () => {
    const wrapper = card('budget')
    expect(wrapper.vm.marksNoBoxOffice).toBe(true)
    expect(wrapper.find('.no-box-office').exists()).toBe(true)
    // The budget is still shown — it's known, just not comparable.
    expect(wrapper.vm.sortDetail).toBe('$150M')
  })

  it('explains itself on the mark rather than leaving a bare glyph', () => {
    expect(card('budget').find('.no-box-office').attributes('title')).toMatch(/No box office reported/)
  })

  // The whole point of the era gate.
  it('never marks an old film whose gross was simply never recorded', () => {
    expect(card('budget', { release_date: '1956-03-13', budget: 3_750_000 }).vm.marksNoBoxOffice).toBe(false)
  })

  it('never marks a film that sold tickets', () => {
    expect(card('budget', { revenue: 500_000_000 }).vm.marksNoBoxOffice).toBe(false)
  })

  // Only the budget sort sinks these, so only it explains itself.
  it('stays out of the way on every other sort', () => {
    expect(card('boxOffice').vm.marksNoBoxOffice).toBe(false)
    expect(card('rating').vm.marksNoBoxOffice).toBe(false)
    expect(card('profit').vm.marksNoBoxOffice).toBe(false)
  })
})
