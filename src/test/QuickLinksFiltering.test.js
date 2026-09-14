import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import Home from '@/components/Home.vue'

// Mock external dependencies
vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}))

vi.mock('lodash/debounce', () => ({
  default: vi.fn((fn) => fn) // Remove debouncing for tests
}))

vi.mock('lodash/uniq', () => ({
  default: vi.fn(arr => [...new Set(arr)]) // Simple unique implementation
}))

// Mock the getRating utility
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    if (!media?.ratings?.length) {
      return { calculatedTotal: 0, date: null }
    }
    return {
      calculatedTotal: media.ratings[0].calculatedTotal || 8.0,
      normalizedRating: media.ratings[0].normalizedRating || 8,
      date: media.ratings[0].date
    }
  })
}))

describe('Quick Links Filtering System', () => {
  let wrapper
  let mockStore
  let mockMovies

  beforeEach(async () => {
    // Create test movies with different years and ratings
    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth()
    const lastYear = currentYear - 1

    mockMovies = [
      {
        movie: {
          id: 1,
          title: 'Best Movie 2024',
          release_date: `${currentYear}-06-15`,
          genres: [{ name: 'Drama' }],
          cast: [{ name: 'Actor One' }],
          crew: [{ name: 'Director One', job: 'Director' }],
          production_companies: [{ name: 'Studio One' }],
          flatKeywords: ['keyword1']
        },
        ratings: [{
          calculatedTotal: 9.5,
          date: `${Date.now()}` // This year, this month
        }],
        dbKey: 'movie-1'
      },
      {
        movie: {
          id: 2,
          title: 'Good Movie 2023',
          release_date: `${lastYear}-03-10`,
          genres: [{ name: 'Action' }],
          cast: [{ name: 'Actor Two' }],
          crew: [{ name: 'Director Two', job: 'Director' }],
          production_companies: [{ name: 'Studio Two' }],
          flatKeywords: ['keyword2']
        },
        ratings: [{
          calculatedTotal: 8.7,
          date: `${new Date(lastYear, 5, 15).getTime()}` // Last year
        }],
        dbKey: 'movie-2'
      },
      {
        movie: {
          id: 3,
          title: 'Decent Movie 2022',
          release_date: '2022-01-20',
          genres: [{ name: 'Comedy' }],
          cast: [{ name: 'Actor Three' }],
          crew: [{ name: 'Director Three', job: 'Director' }],
          production_companies: [{ name: 'Studio Three' }],
          flatKeywords: ['keyword3']
        },
        ratings: [{
          calculatedTotal: 7.8,
          date: `${new Date(2022, 5, 10).getTime()}` // 2022 date - different from current year
        }],
        dbKey: 'movie-3'
      },
      {
        movie: {
          id: 4,
          title: 'Another Movie 2024',
          release_date: `${currentYear}-08-25`,
          genres: [{ name: 'Thriller' }],
          cast: [{ name: 'Actor Four' }],
          crew: [{ name: 'Director Four', job: 'Director' }],
          production_companies: [{ name: 'Studio Four' }],
          flatKeywords: ['keyword4']
        },
        ratings: [{
          calculatedTotal: 8.2,
          date: `${new Date(currentYear, currentMonth, 5).getTime()}` // This year, this month
        }],
        dbKey: 'movie-4'
      }
    ]

    // Mock Academy Award winners
    const mockAcademyAwards = {
      bestPicture: [
        {
          id: 1, // Matches first movie
          title: 'Best Movie 2024',
          release_date: `${currentYear}-06-15`,
          academyAwardsYear: currentYear
        },
        {
          id: 999, // Unrated movie
          title: 'Unrated Best Picture',
          release_date: '2020-01-01',
          academyAwardsYear: 2020
        }
      ]
    }

    mockStore = {
      state: {
        dbLoaded: true,
        databaseTopKey: 'test-user',
        currentLog: 'movieLog',
        DBSearchValue: '',
        DBSortValue: 'rating',
        academyAwardWinners: mockAcademyAwards,
        settings: {
          normalizationTweak: 0.25,
          tieBreakTweak: 1,
          includeShorts: false,
          tags: {
            'viewing-tags': {
              'family-friendly': { title: 'family-friendly' },
              'date-night': { title: 'date-night' }
            }
          }
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
      },
      getters: {
        allMediaAsArray: mockMovies,
        allMoviesAsArray: mockMovies,
        allMediaSortedByRating: [...mockMovies].sort((a, b) => b.ratings[0].calculatedTotal - a.ratings[0].calculatedTotal)
      },
      commit: vi.fn(),
      dispatch: vi.fn()
    }

    wrapper = mount(Home, {
      global: {
        mocks: {
          $store: mockStore,
          $route: { query: {} },
          $router: { push: vi.fn() }
        },
        stubs: {
          DBGridLayoutSearchResult: {
            template: '<div data-testid="db-grid-result">{{ result.movie.title }}</div>',
            props: ['result', 'keywordCounts', 'allCounts', 'index', 'resultsAreFiltered', 'sortValue', 'activeQuickLinkList']
          },
          NoResults: true,
          StickinessModal: true,
          TweakModal: true,
          InsetBrowserModal: true
        }
      }
    })

    // Mock the allEntriesWithFlatKeywordsAdded computed property
    wrapper.vm.allEntriesWithFlatKeywordsAdded = mockMovies.map(movie => ({
      ...movie,
      movie: {
        ...movie.movie,
        flatKeywords: movie.movie.flatKeywords || []
      }
    }))

    await wrapper.vm.$nextTick()
  })

  // Phase 4 of the filter redesign: a curated list is a CHIP (type 'list'),
  // not a parallel mode. activeListChip is the single source of which list
  // is active; activeQuickLinkList remains only for the browse pickers.
  describe('Quick Links State Management', () => {
    it('should start with no list chip active', () => {
      expect(wrapper.vm.activeListChip).toBeNull()
      expect(wrapper.vm.activeQuickLinkList).toBe('title')
    })

    it('should toggle a list chip on and off', () => {
      wrapper.vm.toggleQuickLinksList('annual')
      expect(wrapper.vm.activeListChip).toMatchObject({ type: 'list', value: 'annual', display: 'Annual Best' })

      wrapper.vm.toggleQuickLinksList('annual')
      expect(wrapper.vm.activeListChip).toBeNull()
    })

    it('should switch between lists, one chip at a time', () => {
      wrapper.vm.toggleQuickLinksList('annual')
      expect(wrapper.vm.activeListChip.value).toBe('annual')

      wrapper.vm.toggleQuickLinksList('bestPicture')
      expect(wrapper.vm.activeListChip.value).toBe('bestPicture')
      // Replaced, not stacked: two base sets at once has no meaning.
      expect(wrapper.vm.activeFilters.filter(f => f.type === 'list')).toHaveLength(1)

      wrapper.vm.toggleQuickLinksList('thisYear')
      expect(wrapper.vm.activeListChip.value).toBe('thisYear')
    })

    it('should clear the list chip when passed null', () => {
      wrapper.vm.toggleQuickLinksList('annual')
      expect(wrapper.vm.activeListChip.value).toBe('annual')

      wrapper.vm.toggleQuickLinksList(null)
      expect(wrapper.vm.activeListChip).toBeNull()
    })

    it('removes the chip through removeFilter, like any other chip', () => {
      wrapper.vm.toggleQuickLinksList('bestPicture')
      const chip = wrapper.vm.activeListChip

      wrapper.vm.removeFilter(chip.id)
      expect(wrapper.vm.activeListChip).toBeNull()
      expect(wrapper.vm.unifiedFilteredResults).toHaveLength(4) // back to everything
    })
  })

  describe('Annual Best (Best Movie From Each Year)', () => {
    it('should return best rated movie from each year', () => {
      const result = wrapper.vm.bestMovieFromEachYear

      expect(result).toHaveLength(3) // 2024, 2023, 2022

      // Check that we get the highest rated movie from each year
      const movie2024 = result.find(m => new Date(m.movie.release_date).getFullYear() === new Date().getFullYear())
      const movie2023 = result.find(m => new Date(m.movie.release_date).getFullYear() === new Date().getFullYear() - 1)

      expect(movie2024.movie.title).toBe('Best Movie 2024') // 9.5 rating vs 8.2
      expect(movie2023.movie.title).toBe('Good Movie 2023') // Only movie from 2023
    })

    it('should filter to annual best when activeQuickLinkList is "annual"', () => {
      wrapper.vm.toggleQuickLinksList('annual')

      const result = wrapper.vm.unifiedFilteredResults

      expect(result).toHaveLength(3) // Best from each year
      expect(result.every(movie =>
        wrapper.vm.bestMovieFromEachYear.includes(movie)
      )).toBe(true)
    })
  })

  describe('Best Picture Filter', () => {
    it('should return Academy Award Best Picture winners', () => {
      const result = wrapper.vm.bestPictures

      expect(result).toHaveLength(2) // 1 rated + 1 unrated

      // Check that rated movie is included with proper data
      const ratedMovie = result.find(m => m.movie.id === 1)
      expect(ratedMovie).toBeDefined()
      expect(ratedMovie.falseEntry).toBeUndefined()
      expect(ratedMovie.movie.academyAwardsYear).toBe(new Date().getFullYear())

      // Check that unrated movie is included as falseEntry
      const unratedMovie = result.find(m => m.movie.id === 999)
      expect(unratedMovie).toBeDefined()
      expect(unratedMovie.falseEntry).toBe(true)
    })

    it('should return only rated Best Pictures in bestPicturesWithRatings', () => {
      const result = wrapper.vm.bestPicturesWithRatings

      expect(result).toHaveLength(1) // Only the rated movie
      expect(result[0].movie.id).toBe(1)
      expect(result[0].falseEntry).toBeUndefined()
    })

    it('should filter to Best Pictures when activeQuickLinkList is "bestPicture"', () => {
      wrapper.vm.toggleQuickLinksList('bestPicture')

      const result = wrapper.vm.unifiedFilteredResults

      expect(result).toHaveLength(2) // Includes falseEntry movies
      expect(result.some(m => m.movie.id === 1)).toBe(true) // Rated winner
      expect(result.some(m => m.movie.id === 999)).toBe(true) // Unrated winner
    })
  })

  describe('This Year Filter', () => {
    it('should return movies rated this year', () => {
      const result = wrapper.vm.thisYearsMovies

      expect(result).toHaveLength(2) // 2 movies rated this year

      result.forEach(movie => {
        const mostRecentRating = wrapper.vm.mostRecentRating(movie)
        const ratingYear = new Date(parseInt(mostRecentRating.date)).getFullYear()
        expect(ratingYear).toBe(new Date().getFullYear())
      })
    })

    it('should filter to this year when activeQuickLinkList is "thisYear"', () => {
      wrapper.vm.toggleQuickLinksList('thisYear')

      const result = wrapper.vm.unifiedFilteredResults

      expect(result).toHaveLength(2)
      expect(result.map(m => m.movie.title)).toContain('Best Movie 2024')
      expect(result.map(m => m.movie.title)).toContain('Another Movie 2024')
    })
  })

  describe('Last Year Filter', () => {
    it('should return movies rated last year', () => {
      // First add the lastYearsMovies computed property test
      const lastYear = new Date().getFullYear() - 1

      // Find movies rated last year from our test data
      const lastYearMovies = mockMovies.filter(movie => {
        const mostRecentRating = wrapper.vm.mostRecentRating(movie)
        if (mostRecentRating && mostRecentRating.date) {
          const ratingYear = new Date(parseInt(mostRecentRating.date)).getFullYear()
          return ratingYear === lastYear
        }
        return false
      })

      expect(lastYearMovies).toHaveLength(1)
      expect(lastYearMovies[0].movie.title).toBe('Good Movie 2023')
    })
  })

  describe('This Month Filter', () => {
    it('should return movies rated this month', () => {
      const result = wrapper.vm.thisMonthsMovies

      expect(result).toHaveLength(2) // 2 movies rated this month

      result.forEach(movie => {
        const mostRecentRating = wrapper.vm.mostRecentRating(movie)
        const ratingDate = new Date(parseInt(mostRecentRating.date))
        expect(ratingDate.getMonth()).toBe(new Date().getMonth())
        expect(ratingDate.getFullYear()).toBe(new Date().getFullYear())
      })
    })

    it('should filter to this month when activeQuickLinkList is "thisMonth"', () => {
      wrapper.vm.toggleQuickLinksList('thisMonth')

      const result = wrapper.vm.unifiedFilteredResults

      expect(result).toHaveLength(2)
      expect(result.map(m => m.movie.title)).toContain('Best Movie 2024')
      expect(result.map(m => m.movie.title)).toContain('Another Movie 2024')
    })
  })

  describe('Quick Link Display Names', () => {
    it('should return correct display names for quick links', () => {
      expect(wrapper.vm.getQuickLinkDisplayName('annual')).toBe('Annual Best')
      expect(wrapper.vm.getQuickLinkDisplayName('bestPicture')).toBe('Best Picture')
      expect(wrapper.vm.getQuickLinkDisplayName('thisYear')).toBe('This Year')
      expect(wrapper.vm.getQuickLinkDisplayName('lastYear')).toBe('Last Year')
      expect(wrapper.vm.getQuickLinkDisplayName('thisMonth')).toBe('This Month')
      expect(wrapper.vm.getQuickLinkDisplayName('lastMonth')).toBe('Last Month')
      expect(wrapper.vm.getQuickLinkDisplayName('notOnLetterboxd')).toBe('Not on Letterboxd')
    })

    it('should return the key itself for unknown quick links', () => {
      expect(wrapper.vm.getQuickLinkDisplayName('unknownLink')).toBe('unknownLink')
      expect(wrapper.vm.getQuickLinkDisplayName('custom-tag')).toBe('custom-tag')
    })
  })

  describe('Tag-based Quick Links', () => {
    it('should handle tag-based quick links', async () => {
      // Test the toggle functionality directly by setting the state
      // This simulates what would happen if toggleQuickLinksList were called with a valid tag
      wrapper.vm.activeQuickLinkList = 'family-friendly'

      await wrapper.vm.$nextTick()

      expect(wrapper.vm.activeQuickLinkList).toBe('family-friendly')

      // Test that clearing works
      wrapper.vm.toggleQuickLinksList('family-friendly') // Should toggle off since it's already active
      expect(wrapper.vm.activeQuickLinkList).toBe('title')
    })

    it('should recognize tags from settings', async () => {
      // Wait for computed properties to be ready
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.tags).toContain('family-friendly')
      expect(wrapper.vm.tags).toContain('date-night')
    })
  })

  describe('Quick Link Clearing', () => {
    it('should clear a browse picker using clearQuickLink method', () => {
      wrapper.vm.activeQuickLinkList = 'genre'
      wrapper.vm.clearQuickLink()
      expect(wrapper.vm.activeQuickLinkList).toBe('title')
    })

    it('should clear the typed input when toggling a list', () => {
      wrapper.vm.inputValue = 'half typed'
      wrapper.vm.toggleQuickLinksList('annual')

      expect(wrapper.vm.inputValue).toBe('')
    })
  })

  describe('Edge Cases and Data Integrity', () => {
    it('should handle empty movie data gracefully', () => {
      // Test with no movies
      mockStore.getters.allMediaAsArray = []
      wrapper = mount(Home, {
        global: {
          mocks: {
            $store: mockStore,
            $route: { query: {} },
            $router: { push: vi.fn() }
          },
          stubs: {
            DBGridLayoutSearchResult: true,
            NoResults: true,
            StickinessModal: true,
            TweakModal: true,
            InsetBrowserModal: true
          }
        }
      })

      expect(wrapper.vm.bestMovieFromEachYear).toEqual([])
      expect(wrapper.vm.thisYearsMovies).toEqual([])
      expect(wrapper.vm.thisMonthsMovies).toEqual([])
    })

    it('should handle movies without ratings', () => {
      const movieWithoutRating = {
        movie: {
          id: 5,
          title: 'No Rating Movie',
          release_date: '2024-01-01'
        },
        ratings: [],
        dbKey: 'movie-5'
      }

      mockStore.getters.allMediaAsArray = [movieWithoutRating]
      wrapper.vm.$forceUpdate()

      // Should not crash when processing movies without ratings
      expect(() => wrapper.vm.thisYearsMovies).not.toThrow()
      expect(() => wrapper.vm.bestMovieFromEachYear).not.toThrow()
    })

    it('should handle invalid dates gracefully', () => {
      const movieWithBadDate = {
        movie: {
          id: 6,
          title: 'Bad Date Movie',
          release_date: 'invalid-date'
        },
        ratings: [{ calculatedTotal: 8.0, date: 'invalid-timestamp' }],
        dbKey: 'movie-6'
      }

      mockStore.getters.allMediaAsArray = [movieWithBadDate]
      wrapper.vm.$forceUpdate()

      // Should not crash with invalid dates
      expect(() => wrapper.vm.thisYearsMovies).not.toThrow()
      expect(() => wrapper.vm.thisMonthsMovies).not.toThrow()
    })

    it('should handle missing Academy Award data', () => {
      mockStore.state.academyAwardWinners = { bestPicture: [] }
      wrapper.vm.$forceUpdate()

      // Should not crash when Academy Award data is missing
      expect(() => wrapper.vm.bestPictures).not.toThrow()
      expect(wrapper.vm.bestPictures).toEqual([])
    })
  })

  describe('Integration with Unified Filtering', () => {
    it('should return all movies when no quick link is active', () => {
      wrapper.vm.activeQuickLinkList = 'title'

      const result = wrapper.vm.unifiedFilteredResults

      expect(result).toHaveLength(4) // All test movies
    })

    it('should properly combine a list chip with additional filters', () => {
      wrapper.vm.toggleQuickLinksList('thisYear')

      // The whole point of lists-as-chips: they compose.
      wrapper.vm.activeFilters.push({
        id: 'genre-1',
        type: 'genre',
        value: 'Drama',
        display: 'Drama'
      })

      const result = wrapper.vm.unifiedFilteredResults

      // Should have movies from this year AND with Drama genre
      expect(result).toHaveLength(1) // Only "Best Movie 2024" matches both criteria
      expect(result[0].movie.title).toBe('Best Movie 2024')
    })
  })
})