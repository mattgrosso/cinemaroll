import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import MovieDetail from '@/components/MovieDetail.vue'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5, normalizedRating: 5 })),
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
      backdrop_path: '/backdrop.jpg',
      genres: [],
      crew: [],
      ...overrides.movie
    },
    ratings: [{ calculatedTotal: 8.5, normalizedRating: 8, date: Date.now() }],
    ...overrides
  }
}

describe('MovieDetail - awards sections', () => {
  let wrapper
  let mockStore
  let pushSpy
  let dispatchSpy

  function mountWithSettings (settings) {
    pushSpy = vi.fn()
    dispatchSpy = vi.fn(() => Promise.resolve())
    mockStore = {
      state: {
        movieLog: {},
        settings,
        academyAwardWinners: {}
      },
      getters: { allMoviesAsArray: [], allMediaAsArray: [] },
      commit: vi.fn(),
      dispatch: dispatchSpy
    }

    return shallowMount(MovieDetail, {
      global: {
        mocks: {
          $store: mockStore,
          $route: { params: { tmdbId: '42' }, query: {} },
          $router: { push: pushSpy }
        },
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
      }
    })
  }

  describe('personal awards (settings.personalAwards)', () => {
    beforeEach(async () => {
      wrapper = mountWithSettings({
        tags: { 'viewing-tags': {} },
        personalAwards: {
          2023: {
            categories: {
              bestPicture: {
                winner: { type: 'movie', movieId: 42 },
                nominees: [{ type: 'movie', movieId: 42 }, { type: 'movie', movieId: 99 }]
              },
              bestActor: {
                winner: null,
                nominees: [{ type: 'person', id: 'p1', name: 'Cillian Murphy', movieId: 42 }]
              },
              bestDirector: {
                winner: { type: 'person', id: 'd1', name: 'Someone Else', movieId: 7 },
                nominees: [{ type: 'person', id: 'd1', name: 'Someone Else', movieId: 7 }]
              }
            }
          }
        }
      })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
    })

    it('classifies a movieId match on the winner as a win', () => {
      expect(wrapper.vm.personalAwardWins).toEqual([
        { id: '2023-bestPicture', year: '2023', category: 'Best Picture', names: null }
      ])
    })

    it('classifies a movieId match in nominees (but not winner) as a nomination, carrying the nominee name', () => {
      expect(wrapper.vm.personalAwardNominations).toEqual([
        { id: '2023-bestActor', year: '2023', category: 'Best Actor', names: ['Cillian Murphy'] }
      ])
    })

    it('does not surface categories for a different movie', () => {
      const allIds = [...wrapper.vm.personalAwardWins, ...wrapper.vm.personalAwardNominations].map((a) => a.id)
      expect(allIds).not.toContain('2023-bestDirector')
    })

    it('openPersonalAwardsYear navigates straight to the awards page with the year in the URL', async () => {
      await wrapper.vm.openPersonalAwardsYear('2023')

      // The old settings-flag handoff (setDBValue x3 + push Home) could race
      // the navigation and open nothing — direct routing replaced it.
      expect(pushSpy).toHaveBeenCalledWith({ path: '/awards', query: { year: 2023 } })
      expect(dispatchSpy).not.toHaveBeenCalledWith('setDBValue', expect.objectContaining({ path: 'settings/awardsPromptState' }))
    })
  })

  // Report 2026-10-25: The Great Escape showed Best Supporting Actor as won
  // by James Garner AND Richard Attenborough — both were nominated, only
  // Garner won.
  describe('a winner shares the film with another nominee', () => {
    beforeEach(async () => {
      wrapper = mountWithSettings({
        tags: { 'viewing-tags': {} },
        personalAwards: {
          1963: {
            categories: {
              bestPicture: {
                winner: { type: 'movie', movieId: 42 },
                nominees: [{ type: 'movie', movieId: 42 }]
              },
              bestSupportingActor: {
                winner: { type: 'person', name: 'James Garner', movieId: 42 },
                nominees: [
                  { type: 'person', name: 'James Garner', movieId: 42 },
                  { type: 'person', name: 'Richard Attenborough', movieId: 42 },
                  { type: 'person', name: 'Someone Else', movieId: 7 }
                ]
              }
            }
          }
        }
      })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
    })

    it('credits the win to the winner alone', () => {
      expect(wrapper.vm.personalAwardWins).toEqual([
        { id: '1963-bestPicture', year: '1963', category: 'Best Picture', names: null },
        { id: '1963-bestSupportingActor', year: '1963', category: 'Best Supporting Actor', names: ['James Garner'] }
      ])
    })

    it('lists the co-star who lost under Nominated', () => {
      expect(wrapper.vm.personalAwardNominations).toEqual([
        { id: '1963-bestSupportingActor', year: '1963', category: 'Best Supporting Actor', names: ['Richard Attenborough'] }
      ])
    })
  })

  // Report 2026-10-16: "best picture is always at the top and then it works
  // its way down from there" — the awards page's order, not Firebase's
  // alphabetical keys (which put bestActor ahead of bestPicture).
  describe('personal awards read in the awards page\'s order', () => {
    it('newest year first, and within a year the standard categories in order, then custom awards oldest first', async () => {
      const win = { winner: { type: 'movie', movieId: 42 }, nominees: [{ type: 'movie', movieId: 42 }] }
      wrapper = mountWithSettings({
        tags: { 'viewing-tags': {} },
        personalAwards: {
          2022: { categories: { bestPicture: win } },
          2023: {
            customCategories: { 'custom-zebra': { name: 'Zebra Prize', createdAt: 1 }, 'custom-apple': { name: 'Apple Prize', createdAt: 2 } },
            categories: {
              'custom-apple': win,
              'custom-zebra': win,
              bestActor: { winner: { type: 'person', name: 'Cillian Murphy', movieId: 42 }, nominees: [{ type: 'person', name: 'Cillian Murphy', movieId: 42 }] },
              bestCinematography: win,
              bestDirector: win,
              bestPicture: win
            }
          }
        }
      })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })

      expect(wrapper.vm.personalAwardWins.map((a) => `${a.year} ${a.category}`)).toEqual([
        '2023 Best Picture',
        '2023 Best Director',
        '2023 Best Actor',
        '2023 Best Cinematography',
        '2023 Zebra Prize',
        '2023 Apple Prize',
        '2022 Best Picture'
      ])
    })
  })

  describe('other-ceremony awards (assets/javascript/otherAwards.js)', () => {
    beforeEach(async () => {
      wrapper = mountWithSettings({ tags: { 'viewing-tags': {} } })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
    })

    it('surfaces the real Golden Globe + BAFTA wins bundled in the static dataset for a known film', () => {
      const wins = wrapper.vm.otherAwardWins
      expect(wins.some((w) => w.ceremony === 'Golden Globe Awards')).toBe(true)
      expect(wins.some((w) => w.ceremony === 'BAFTA Awards')).toBe(true)
    })

    it('returns nothing for a movie absent from the static dataset', async () => {
      await wrapper.setData({ movie: { ...wrapper.vm.movie, title: 'Definitely Not A Real Award Movie Title', id: 999 } })
      expect(wrapper.vm.otherAwardWins).toEqual([])
      expect(wrapper.vm.otherAwardNominations).toEqual([])
    })
  })

  describe('personalAwardSectionTitle — uses the configured award name', () => {
    it('defaults to "The Oscar" when unset', () => {
      wrapper = mountWithSettings({ tags: { 'viewing-tags': {} } })
      expect(wrapper.vm.personalAwardSectionTitle).toBe('The Oscar')
    })

    it('reflects a custom configured name, adding "The" if missing', () => {
      wrapper = mountWithSettings({ tags: { 'viewing-tags': {} }, personalAwardName: 'Groskers' })
      expect(wrapper.vm.personalAwardSectionTitle).toBe('The Groskers')
    })

    it('does not double up "The" when already present', () => {
      wrapper = mountWithSettings({ tags: { 'viewing-tags': {} }, personalAwardName: 'The Groskers' })
      expect(wrapper.vm.personalAwardSectionTitle).toBe('The Groskers')
    })
  })

  describe('goToWikipedia', () => {
    let openSpy

    beforeEach(async () => {
      wrapper = mountWithSettings({ tags: { 'viewing-tags': {} } })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })
      openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
    })

    afterEach(() => {
      openSpy.mockRestore()
    })

    it('routes through Wikipedia\'s search "go" endpoint rather than a raw /wiki/ page URL', () => {
      wrapper.vm.goToWikipedia('81st Golden Globe Awards')
      expect(openSpy).toHaveBeenCalledWith(
        'https://en.wikipedia.org/wiki/Special:Search?search=81st%20Golden%20Globe%20Awards&go=Go',
        '_blank'
      )
    })

    it('falls back to the movie title when no query is given', () => {
      wrapper.vm.goToWikipedia()
      expect(openSpy).toHaveBeenCalledWith(
        'https://en.wikipedia.org/wiki/Special:Search?search=Oppenheimer&go=Go',
        '_blank'
      )
    })
  })

  describe('Awards section — always visible, scrolls instead of collapsing', () => {
    it('renders the awards body immediately (no expand step) and drops the year prefix from personal award entries', async () => {
      wrapper = mountWithSettings({
        tags: { 'viewing-tags': {} },
        personalAwards: {
          2023: { categories: { bestPicture: { winner: { type: 'movie', movieId: 42 }, nominees: [] } } }
        }
      })
      await wrapper.setData({ result: makeResult(), movie: makeResult().movie })

      expect(wrapper.find('.awards-body').exists()).toBe(true)
      const winnerLink = wrapper.find('.awards .personal-awards .winners a')
      expect(winnerLink.text()).toBe('Best Picture')
      expect(winnerLink.text()).not.toContain('2023')
    })
  })

  describe('Academy Award wins/nominations, sourced from the locally-cached full dataset (state.allAcademyAwards) instead of a live per-movie fetch', () => {
    // Formerly a regression test for a real leak bug: MovieDetail's
    // component instance is REUSED (not remounted) when navigating from one
    // movie's page directly to another's via router params, and the old
    // manually-managed `data().awardsData` field stayed stale across that
    // navigation unless explicitly reset. Now that academyAwardWins/
    // academyAwardNominations are a plain computed derived from
    // `this.movie` + the store (see MovieDetail.vue's awardsForMovie), that
    // whole class of bug is structurally impossible — there's no cached
    // field left to go stale. Kept as a behavioral test of the same
    // scenario (switching movies shows the right movie's wins) rather than
    // deleted, since the underlying behavior still deserves coverage.
    it('shows only the CURRENT movie\'s wins/nominations, filtered from the shared full dataset, and switches cleanly when the route changes', async () => {
      const movieA = { id: 42, title: 'Oppenheimer', release_date: '2023-07-19', runtime: 180, poster_path: '/a.jpg', genres: [], crew: [] };
      const movieB = { id: 99, title: 'Some Other Film', release_date: '2010-01-01', runtime: 100, poster_path: '/b.jpg', genres: [], crew: [] };

      const allAcademyAwards = [
        { id: 1, tmdb: '42', category: 'Best Original Score', isActing: false, isWinner: true },
        { id: 2, tmdb: '42', category: 'Best Original Screenplay', isActing: false, isWinner: false },
        { id: 3, tmdb: '99', category: 'Best Original Screenplay', isActing: false, isWinner: true }
      ];

      const mockStore = {
        state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {}, allAcademyAwards, dbLoaded: true },
        getters: { allMediaAsArray: [{ dbKey: 'a', movie: movieA, ratings: [] }, { dbKey: 'b', movie: movieB, ratings: [] }] },
        commit: vi.fn(),
        dispatch: vi.fn()
      };

      const wrapper = shallowMount(MovieDetail, {
        global: {
          mocks: {
            $store: mockStore,
            $route: { params: { tmdbId: '42' }, query: {} },
            $router: { push: vi.fn() }
          },
          stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
        }
      });

      await wrapper.vm.loadMovieData('42');
      expect(wrapper.vm.academyAwardWins.map((a) => a.category)).toEqual(['Best Original Score']);
      expect(wrapper.vm.academyAwardNominations.map((a) => a.category)).toEqual(['Best Original Screenplay']);

      await wrapper.vm.loadMovieData('99');
      expect(wrapper.vm.academyAwardWins.map((a) => a.category)).toEqual(['Best Original Screenplay']);
      expect(wrapper.vm.academyAwardNominations).toEqual([]);
    });

    it('tolerates a missing/empty allAcademyAwards (cold direct navigation before it loads) without throwing', async () => {
      const movieA = { id: 42, title: 'Oppenheimer', release_date: '2023-07-19', runtime: 180, poster_path: '/a.jpg', genres: [], crew: [] };
      const mockStore = {
        state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {}, dbLoaded: true },
        getters: { allMediaAsArray: [{ dbKey: 'a', movie: movieA, ratings: [] }] },
        commit: vi.fn(),
        dispatch: vi.fn()
      };

      const wrapper = shallowMount(MovieDetail, {
        global: {
          mocks: {
            $store: mockStore,
            $route: { params: { tmdbId: '42' }, query: {} },
            $router: { push: vi.fn() }
          },
          stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
        }
      });

      await wrapper.vm.loadMovieData('42');
      expect(wrapper.vm.academyAwardWins).toEqual([]);
      expect(wrapper.vm.academyAwardNominations).toEqual([]);
    });
  });
})
