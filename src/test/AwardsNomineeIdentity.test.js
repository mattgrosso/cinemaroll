import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'

// Regression guard for the "saved nominees/winners show at the top of the modal
// but aren't highlighted as selected in the lists below" bug.
//
// The grid lights up a saved pick via isNominee()/isWinner(), which compare
// identities through getOptionId(). For Best Director the freshly-computed
// option is a movie-group (no top-level id) while a nominee restored from saved
// (minimal) storage carries a top-level id ("directors-<movieId>"). If
// getOptionId classifies those two shapes differently, the saved Director pick
// never lights up on reopen — even though it persisted correctly. These tests
// exercise the real convert/expand round-trip the modal uses on save/reload.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

function movieEntry (id, title, directorName) {
  return {
    movie: {
      id,
      title,
      release_date: '2015-06-01',
      poster_path: `/${title}.jpg`,
      crew: [{ name: directorName, job: 'Director' }],
      cast: []
    },
    ratings: [{ calculatedTotal: 7 }]
  }
}

// Mirrors the movie-group object shape produced by getEligibleOptionsByMovie()
// for a Best Director option.
function freshDirectorOption (entry) {
  return {
    movieId: entry.movie.id,
    movie: entry.movie,
    allCast: [{
      id: `directors-${entry.movie.id}`,
      name: entry.movie.crew[0].name,
      directors: entry.movie.crew.filter((p) => p.job === 'Director'),
      movie: entry.movie,
      movieId: entry.movie.id
    }],
    loadedCast: [],
    hasMore: false,
    isLoading: false
  }
}

describe('PersonalAwardsModal — saved nominee identity (Best Director)', () => {
  let wrapper
  let entryA

  beforeEach(() => {
    entryA = movieEntry(101, 'Sicario', 'Denis Villeneuve')

    const mockStore = {
      state: {
        settings: { personalAwards: {} },
        databaseTopKey: 'mattgrosso-gmail-com',
        weights: []
      },
      dispatch: vi.fn(),
      commit: vi.fn()
    }

    wrapper = mount(PersonalAwardsModal, {
      props: { allEntriesWithFlatKeywordsAdded: [entryA] },
      global: {
        mocks: { $store: mockStore },
        stubs: { Modal: true }
      }
    })
    wrapper.vm.currentYear = 2015
    wrapper.vm.selectedCategory = 'bestDirector'
  })

  it('highlights a saved Best Director nominee/winner after the storage round-trip', () => {
    const fresh = freshDirectorOption(entryA)

    // Simulate save → reload: the modal stores a minimal nominee and expands it
    // back when the year is reopened.
    const minimal = wrapper.vm.convertNomineeToMinimal(fresh)
    const reloaded = wrapper.vm.expandNomineeFromMinimal(minimal)

    wrapper.vm.awardsData = {
      bestDirector: { nominees: [reloaded], winner: reloaded, noNominees: false }
    }

    // The freshly-computed grid option must match the reloaded saved pick.
    expect(wrapper.vm.isNominee(fresh)).toBe(true)
    expect(wrapper.vm.isWinner(fresh)).toBe(true)
  })

  it('still recognizes an in-session nominee (no round-trip) — regression guard', () => {
    const fresh = freshDirectorOption(entryA)
    wrapper.vm.awardsData = {
      bestDirector: { nominees: [fresh], winner: fresh, noNominees: false }
    }
    expect(wrapper.vm.isNominee(fresh)).toBe(true)
    expect(wrapper.vm.isWinner(fresh)).toBe(true)
  })

  it('does not cross-match a different movie', () => {
    const entryB = movieEntry(202, 'Arrival', 'Denis Villeneuve')
    const freshA = freshDirectorOption(entryA)
    const freshB = freshDirectorOption(entryB)

    const minimal = wrapper.vm.convertNomineeToMinimal(freshA)
    const reloaded = wrapper.vm.expandNomineeFromMinimal(minimal)
    wrapper.vm.awardsData = {
      bestDirector: { nominees: [reloaded], winner: reloaded, noNominees: false }
    }

    // Same director name, different movie → must NOT be treated as the same pick.
    expect(wrapper.vm.isNominee(freshB)).toBe(false)
    expect(wrapper.vm.isWinner(freshB)).toBe(false)
  })
})

describe('PersonalAwardsModal — surfacing deep acting nominees', () => {
  let wrapper

  // Movie with a 6-person cast; only the first 3 load into the grid initially.
  function castMovieEntry () {
    const cast = ['A', 'B', 'C', 'D', 'E', 'F'].map((letter, index) => ({
      id: `cast-${letter}`,
      name: `Actor ${letter}`,
      character: `Character ${letter}`,
      order: index
    }))
    return {
      movie: {
        id: 555,
        title: 'Big Ensemble',
        release_date: '2015-06-01',
        poster_path: '/big.jpg',
        crew: [],
        cast
      },
      ratings: [{ calculatedTotal: 7 }]
    }
  }

  beforeEach(() => {
    // TMDb person search → male (gender 2) so cast pass the actor gender filter.
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ results: [{ id: 1, gender: 2, profile_path: '/p.jpg' }] })
    }))

    const mockStore = {
      state: {
        settings: { personalAwards: {} },
        databaseTopKey: 'mattgrosso-gmail-com',
        weights: []
      },
      dispatch: vi.fn(),
      commit: vi.fn()
    }

    wrapper = mount(PersonalAwardsModal, {
      props: { allEntriesWithFlatKeywordsAdded: [castMovieEntry()] },
      global: {
        mocks: { $store: mockStore },
        stubs: { Modal: true }
      }
    })
    wrapper.vm.currentYear = 2015
  })

  it('surfaces an already-nominated actor who sits deeper than the initial batch', async () => {
    // Pre-seed a saved nominee for "Actor E" (cast index 4 — beyond the first 3).
    wrapper.vm.awardsData = {
      bestActor: {
        nominees: [{ id: 'cast-E', name: 'Actor E', movieId: 555, character: 'Character E' }],
        winner: null,
        noNominees: false
      }
    }

    await wrapper.vm.selectCategory('bestActor')

    const group = wrapper.vm.eligibleOptions.find((g) => String(g.movieId) === '555')
    const loadedIds = group.loadedCast.map((person) => person.id)

    // The first 3 still load, and the deep nominee is now also present exactly once.
    expect(loadedIds).toContain('cast-E')
    expect(loadedIds.filter((id) => id === 'cast-E')).toHaveLength(1)
    // And it reports as a nominee in the grid.
    const surfaced = group.loadedCast.find((person) => person.id === 'cast-E')
    expect(wrapper.vm.isNominee(surfaced)).toBe(true)
  })

  it('does not add extra tiles when there are no nominees', async () => {
    wrapper.vm.awardsData = {}

    await wrapper.vm.selectCategory('bestActor')

    const group = wrapper.vm.eligibleOptions.find((g) => String(g.movieId) === '555')
    // Only the initial batch of 3 is loaded.
    expect(group.loadedCast).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// Report -P1oV4wiVPs-5rAyJ9AN (2026-09-18, /awards?year=1993): "The X on
// nominees in the awards medal isn't actually removing them. Also, I think
// that the nominated people aren't being highlighted down below as they ought
// to be."
//
// Root cause: a person's saved `id` is whatever the film's cached TMDB cast
// carried the day they were nominated. Real 1993 data holds three shapes in
// one year — 'Liam Neeson-424', 1524, 'Julia Roberts'. Re-fetching a film's
// cast changes the shape a FRESH option gets while the saved nominee keeps the
// old one, so every `nom.id === option.id` comparison quietly stops matching.
// See samePersonNominee in personalAwards.js.
// ---------------------------------------------------------------------------
describe('PersonalAwardsModal — acting nominees whose saved id shape has drifted', () => {
  let wrapper

  // The saved nominee: id is the old 'Name-movieId' synthetic string.
  const savedNominee = {
    type: 'person',
    id: 'Liam Neeson-424',
    name: 'Liam Neeson',
    movieId: 424,
    character: 'Oskar Schindler'
  }

  // The same actor as the grid builds him TODAY: a real TMDB person id.
  const freshOption = {
    id: 3896,
    name: 'Liam Neeson',
    character: 'Oskar Schindler',
    movieId: 424,
    movie: { id: 424, title: "Schindler's List" },
    castPosition: 0
  }

  beforeEach(() => {
    const mockStore = {
      state: {
        settings: { personalAwards: {} },
        databaseTopKey: 'mattgrosso-gmail-com',
        weights: []
      },
      dispatch: vi.fn(),
      commit: vi.fn()
    }

    wrapper = mount(PersonalAwardsModal, {
      props: { allEntriesWithFlatKeywordsAdded: [] },
      global: {
        mocks: { $store: mockStore },
        stubs: { Modal: true }
      }
    })
    wrapper.vm.currentYear = 1993
    wrapper.vm.selectedCategory = 'bestActor'
  })

  it('highlights the grid tile for a nominee saved under a different id shape', () => {
    wrapper.vm.awardsData = {
      bestActor: { nominees: [savedNominee], winner: savedNominee, noNominees: false }
    }

    expect(wrapper.vm.isNominee(freshOption)).toBe(true)
    expect(wrapper.vm.isWinner(freshOption)).toBe(true)
  })

  it('removes a nominee via the × even when the grid holds no tile for them', () => {
    // The film has dropped out of the year's eligible list, so
    // eligibleOptionsByMovie has nothing to find. The × on the nominee's
    // poster in the top gallery must still work — this is the reported bug.
    wrapper.vm.optionsCache = { 'bestActor-1993': [] }
    wrapper.vm.awardsData = {
      bestActor: { nominees: [savedNominee], winner: savedNominee, noNominees: false }
    }

    wrapper.vm.toggleNominee(savedNominee)

    expect(wrapper.vm.awardsData.bestActor.nominees).toEqual([])
    expect(wrapper.vm.awardsData.bestActor.winner).toBe(null)
  })

  it('removes the nominee when the × is tapped on a drifted-id grid tile too', () => {
    wrapper.vm.optionsCache = { 'bestActor-1993': [] }
    wrapper.vm.awardsData = {
      bestActor: { nominees: [savedNominee], winner: null, noNominees: false }
    }

    wrapper.vm.toggleNominee(freshOption)

    expect(wrapper.vm.awardsData.bestActor.nominees).toEqual([])
  })

  it('still adds a nominee the grid cannot enumerate, rather than doing nothing', () => {
    wrapper.vm.optionsCache = { 'bestActor-1993': [] }
    wrapper.vm.awardsData = { bestActor: { nominees: [], winner: null, noNominees: false } }

    wrapper.vm.toggleNominee(freshOption)

    expect(wrapper.vm.awardsData.bestActor.nominees).toHaveLength(1)
    expect(wrapper.vm.awardsData.bestActor.nominees[0].name).toBe('Liam Neeson')
  })

  it('does not merge two different actors in the same film', () => {
    wrapper.vm.optionsCache = { 'bestActor-1993': [] }
    wrapper.vm.awardsData = {
      bestActor: { nominees: [savedNominee], winner: savedNominee, noNominees: false }
    }

    const otherActor = { id: 4756, name: 'Ben Kingsley', movieId: 424, movie: { id: 424 } }
    expect(wrapper.vm.isNominee(otherActor)).toBe(false)
    expect(wrapper.vm.isWinner(otherActor)).toBe(false)
  })

  it('groups an actor nominated twice into one gallery poster despite mixed id shapes', () => {
    // Real 1993 data: Holly Hunter saved twice, once per film.
    wrapper.vm.selectedCategory = 'bestSupportingActress'
    wrapper.vm.awardsData = {
      bestSupportingActress: {
        nominees: [
          { type: 'person', id: 'Holly Hunter', name: 'Holly Hunter', movieId: 37233, character: 'Tammy Hemphill', movie: { id: 37233, title: 'The Firm' } },
          { type: 'person', id: 1234, name: 'Holly Hunter', movieId: 713, character: 'Ada McGrath', movie: { id: 713, title: 'The Piano' } }
        ],
        winner: null,
        noNominees: false
      }
    }

    const gallery = wrapper.vm.getCurrentNominees()
    expect(gallery).toHaveLength(1)
    expect(gallery[0].allRoles).toHaveLength(2)
  })
})
