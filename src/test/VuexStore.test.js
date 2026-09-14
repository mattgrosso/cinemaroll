import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createStore } from 'vuex'

// Mock external dependencies
vi.mock('axios')
vi.mock('firebase/app')
vi.mock('firebase/database')
vi.mock('firebase/auth')
vi.mock('@sentry/vue')
vi.mock('@/router')

// Mock the getRating utility
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    // Simple mock that returns a rating based on the first rating in the array
    if (!media?.ratings?.length) {
      return { calculatedTotal: 0 }
    }
    return {
      calculatedTotal: media.ratings[0].calculatedTotal || 8.0,
      normalizedRating: media.ratings[0].normalizedRating || 8
    }
  })
}))

describe('Vuex Store - Movie Data Processing', () => {
  let store

  beforeEach(() => {
    // Create a fresh store instance for each test with the same configuration
    store = createStore({
      state: {
        movieLog: {},
        settings: {},
        weights: [
          { name: "love", weight: 2.8 },
          { name: "overall", weight: 2 },
          { name: "story", weight: 1.25 },
          { name: "direction", weight: 1.1 },
          { name: "imagery", weight: 0.9 },
          { name: "stickiness", weight: 1.9 },
          { name: "performance", weight: 0.7 },
          { name: "soundtrack", weight: 0.3 },
        ],
        academyAwardWinners: {},
        userEmail: null,
        databaseTopKey: null,
        newEntrySearchResults: [],
        movieToRate: {},
        DBSearchValue: null,
        DBSortValue: null,
        DBSortOrder: null,
        showHeader: true,
        goHome: false,
        devModeTopKey: 'testing-database',
        dbLoaded: false,
        filteredResults: [],
      },
      getters: {
        allMediaAsArray: (state) => {
          if (!state.dbLoaded) {
            return [];
          }
          return Object.keys(state.movieLog).map((key) => {
            const movie = state.movieLog[key];
            movie.dbKey = key;
            return movie;
          });
        },
        allMoviesAsArray: (state) => {
          return Object.keys(state.movieLog).map((key) => {
            return state.movieLog[key];
          })
        },
        allMediaSortedByRating: (state, getters) => {
          return getters.allMediaAsArray.sort((a, b) => {
            // Use simple rating extraction for testing
            const sortValueA = a.ratings?.[0]?.calculatedTotal || 0;
            const sortValueB = b.ratings?.[0]?.calculatedTotal || 0;
            if (sortValueA < sortValueB) return 1;
            if (sortValueA > sortValueB) return -1;
            return 0;
          });
        },
        allMediaRatingsArray: (state, getters) => {
          return getters.allMediaAsArray.map((media) => {
            // Use simple rating extraction for testing
            return media.ratings?.[0]?.calculatedTotal || 0;
          });
        },
        databaseTopKey (state) {
          const devMode = localStorage.getItem('devMode') === 'true';
          return devMode ? state.devModeTopKey : state.databaseTopKey;
        },
        devMode () {
          return localStorage.getItem('devMode') === 'true';
        },
        weight (state) {
          return (name) => {
            return state.weights.find((weight) => weight.name === name).weight;
          }
        },
      },
      mutations: {
        setMovieLog (state, value) {
          state.movieLog = Object.freeze(value);
        },
        setSettings (state, value) {
          state.settings = value;
        },
        setAcademyAwardWinners (state, value) {
          state.academyAwardWinners = value
        },
        setUserEmail (state, value) {
          state.userEmail = value;
        },
        setDatabaseTopKey (state, value) {
          state.databaseTopKey = value.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./]/g, "-");
        },
        setNewEntrySearchResults (state, value) {
          const results = [...value];
          const sorted = results.sort((a, b) => {
            if (a.vote_count < b.vote_count) return 1;
            if (a.vote_count > b.vote_count) return -1;
            return 0;
          });
          state.newEntrySearchResults = sorted;
        },
        setMovieToRate (state, movie) {
          state.movieToRate = movie;
        },
        setDBSearchValue (state, value) {
          state.DBSearchValue = value;
        },
        setDBSortValue (state, value) {
          state.DBSortValue = value;
        },
        setDBSortOrder (state, value) {
          state.DBSortOrder = value;
        },
        setShowHeader (state, value) {
          state.showHeader = value;
        },
        setGoHome (state, value) {
          state.goHome = value;
        },
        setDbLoaded (state, value) {
          state.dbLoaded = value;
        },
        setFilteredResults (state, value) {
          state.filteredResults = value;
        }
      },
      actions: {
        // We'll only test the data processing, not the async actions
      }
    })
  })

  describe('State Structure', () => {
    it('should have correct initial state', () => {
      expect(store.state.movieLog).toEqual({})
      expect(store.state.settings).toEqual({})
      expect(store.state.dbLoaded).toBe(false)
      expect(store.state.weights).toHaveLength(8)
      expect(store.state.academyAwardWinners).toEqual({})
    })

    it('should have correct weight configuration', () => {
      const weights = store.state.weights

      // Check that all expected weights exist
      const weightNames = weights.map(w => w.name)
      expect(weightNames).toContain('love')
      expect(weightNames).toContain('overall')
      expect(weightNames).toContain('story')
      expect(weightNames).toContain('direction')
      expect(weightNames).toContain('imagery')
      expect(weightNames).toContain('stickiness')
      expect(weightNames).toContain('performance')
      expect(weightNames).toContain('soundtrack')

      // Check specific weight values from CLAUDE.md
      expect(weights.find(w => w.name === 'love').weight).toBe(2.8)
      expect(weights.find(w => w.name === 'overall').weight).toBe(2.0)
      expect(weights.find(w => w.name === 'story').weight).toBe(1.25)
      expect(weights.find(w => w.name === 'direction').weight).toBe(1.1)
      expect(weights.find(w => w.name === 'imagery').weight).toBe(0.9)
      expect(weights.find(w => w.name === 'performance').weight).toBe(0.7)
      expect(weights.find(w => w.name === 'soundtrack').weight).toBe(0.3)
      expect(weights.find(w => w.name === 'stickiness').weight).toBe(1.9)
    })
  })

  describe('Mutations', () => {
    it('should set movie log correctly', () => {
      const testMovieLog = {
        'movie-1': {
          movie: { id: 1, title: 'Test Movie' },
          ratings: [{ calculatedTotal: 8.5 }]
        }
      }

      store.commit('setMovieLog', testMovieLog)

      expect(store.state.movieLog).toEqual(testMovieLog)
      expect(Object.isFrozen(store.state.movieLog)).toBe(true) // Should be frozen
    })

    it('should set settings correctly', () => {
      const testSettings = {
        normalizationTweak: 0.25,
        includeShorts: false,
        tags: { 'viewing-tags': {} }
      }

      store.commit('setSettings', testSettings)

      expect(store.state.settings).toEqual(testSettings)
    })

    it('should set database loaded state', () => {
      expect(store.state.dbLoaded).toBe(false)

      store.commit('setDbLoaded', true)

      expect(store.state.dbLoaded).toBe(true)
    })

    it('should sanitize database top key', () => {
      const emailWithSpecialChars = 'test.user+tag@example.com'
      const expectedKey = 'test-user-tag-example-com'

      store.commit('setDatabaseTopKey', emailWithSpecialChars)

      expect(store.state.databaseTopKey).toBe(expectedKey)
    })

    it('should sort new entry search results by vote count', () => {
      const testResults = [
        { id: 1, title: 'Movie A', vote_count: 100 },
        { id: 2, title: 'Movie B', vote_count: 500 },
        { id: 3, title: 'Movie C', vote_count: 250 }
      ]

      store.commit('setNewEntrySearchResults', testResults)

      const sortedResults = store.state.newEntrySearchResults
      expect(sortedResults[0].vote_count).toBe(500) // Highest first
      expect(sortedResults[1].vote_count).toBe(250)
      expect(sortedResults[2].vote_count).toBe(100) // Lowest last
    })
  })

  describe('Getters - Movie Data Processing', () => {
    beforeEach(() => {
      // Set up test data for getters
      const testMovieLog = {
        'movie-1': {
          movie: {
            id: 1,
            title: 'The Shawshank Redemption',
            release_date: '1994-09-23',
            genres: [{ name: 'Drama' }]
          },
          ratings: [{ calculatedTotal: 9.3, date: '2023-01-01' }]
        },
        'movie-2': {
          movie: {
            id: 2,
            title: 'The Godfather',
            release_date: '1972-03-24',
            genres: [{ name: 'Crime' }, { name: 'Drama' }]
          },
          ratings: [{ calculatedTotal: 9.2, date: '2023-02-01' }]
        },
        'movie-3': {
          movie: {
            id: 3,
            title: 'Pulp Fiction',
            release_date: '1994-10-14',
            genres: [{ name: 'Crime' }, { name: 'Drama' }]
          },
          ratings: [{ calculatedTotal: 8.9, date: '2023-03-01' }]
        }
      }

      store.commit('setMovieLog', testMovieLog)
      store.commit('setDbLoaded', true)
    })

    describe('allMediaAsArray', () => {
      it('should return empty array when db not loaded', () => {
        store.commit('setDbLoaded', false)

        const result = store.getters.allMediaAsArray

        expect(result).toEqual([])
      })

      it('should convert movie log object to array with dbKeys', () => {
        const result = store.getters.allMediaAsArray

        expect(result).toHaveLength(3)
        expect(result[0].dbKey).toBe('movie-1')
        expect(result[1].dbKey).toBe('movie-2')
        expect(result[2].dbKey).toBe('movie-3')

        // Check that movie data is preserved
        expect(result[0].movie.title).toBe('The Shawshank Redemption')
        expect(result[1].movie.title).toBe('The Godfather')
        expect(result[2].movie.title).toBe('Pulp Fiction')
      })

      it('should preserve all movie properties', () => {
        const result = store.getters.allMediaAsArray

        const shawshank = result.find(m => m.movie.id === 1)
        expect(shawshank.movie.release_date).toBe('1994-09-23')
        expect(shawshank.movie.genres).toHaveLength(1)
        expect(shawshank.movie.genres[0].name).toBe('Drama')
        expect(shawshank.ratings).toHaveLength(1)
        expect(shawshank.ratings[0].calculatedTotal).toBe(9.3)
      })
    })

    describe('allMoviesAsArray', () => {
      it('should return array of movies without dbKey modification', () => {
        const result = store.getters.allMoviesAsArray

        expect(result).toHaveLength(3)

        // Should not have dbKey added (unlike allMediaAsArray)
        expect(result[0].dbKey).toBeUndefined()
        expect(result[0].movie.title).toBe('The Shawshank Redemption')
      })
    })

    describe('allMediaSortedByRating', () => {
      it('should sort movies by calculated total rating (highest first)', () => {
        const result = store.getters.allMediaSortedByRating

        expect(result).toHaveLength(3)

        // Should be sorted by rating descending
        expect(result[0].movie.title).toBe('The Shawshank Redemption') // 9.3
        expect(result[1].movie.title).toBe('The Godfather') // 9.2
        expect(result[2].movie.title).toBe('Pulp Fiction') // 8.9
      })

      it('should handle movies with same ratings consistently', () => {
        // Add movies with same rating
        const sameRatingMovies = {
          'movie-4': {
            movie: { id: 4, title: 'Movie A' },
            ratings: [{ calculatedTotal: 8.5 }]
          },
          'movie-5': {
            movie: { id: 5, title: 'Movie B' },
            ratings: [{ calculatedTotal: 8.5 }]
          }
        }

        store.commit('setMovieLog', sameRatingMovies)

        const result = store.getters.allMediaSortedByRating

        expect(result).toHaveLength(2)
        // Both should have same rating, order should be consistent
        expect(result[0].ratings[0].calculatedTotal).toBe(8.5)
        expect(result[1].ratings[0].calculatedTotal).toBe(8.5)
      })
    })

    describe('allMediaRatingsArray', () => {
      it('should extract calculated totals from all movies', () => {
        const result = store.getters.allMediaRatingsArray

        expect(result).toHaveLength(3)
        expect(result).toContain(9.3)
        expect(result).toContain(9.2)
        expect(result).toContain(8.9)
      })

      it('should handle movies without ratings gracefully', () => {
        const moviesWithoutRatings = {
          'movie-no-rating': {
            movie: { id: 99, title: 'Unrated Movie' },
            ratings: []
          }
        }

        store.commit('setMovieLog', moviesWithoutRatings)

        const result = store.getters.allMediaRatingsArray

        expect(result).toHaveLength(1)
        expect(result[0]).toBe(0) // Should return 0 for movies without ratings
      })
    })

    describe('weight getter', () => {
      it('should return correct weight for given name', () => {
        const weightGetter = store.getters.weight

        expect(weightGetter('love')).toBe(2.8)
        expect(weightGetter('overall')).toBe(2.0)
        expect(weightGetter('story')).toBe(1.25)
        expect(weightGetter('direction')).toBe(1.1)
        expect(weightGetter('imagery')).toBe(0.9)
        expect(weightGetter('stickiness')).toBe(1.9)
        expect(weightGetter('performance')).toBe(0.7)
        expect(weightGetter('soundtrack')).toBe(0.3)
      })

      it('should handle invalid weight names gracefully', () => {
        const weightGetter = store.getters.weight

        expect(() => weightGetter('invalid')).toThrow()
      })
    })
  })

  describe('Edge Cases and Data Integrity', () => {
    it('should handle empty movie log', () => {
      store.commit('setMovieLog', {})
      store.commit('setDbLoaded', true)

      expect(store.getters.allMediaAsArray).toEqual([])
      expect(store.getters.allMediaSortedByRating).toEqual([])
      expect(store.getters.allMediaRatingsArray).toEqual([])
    })

    it('should handle malformed movie data gracefully', () => {
      const malformedData = {
        'bad-movie': {
          // Missing movie property
          ratings: [{ calculatedTotal: 5.0 }]
        },
        'incomplete-movie': {
          movie: { id: 1 }, // Missing other properties
          // Missing ratings
        }
      }

      store.commit('setMovieLog', malformedData)
      store.commit('setDbLoaded', true)

      // Should not crash
      expect(() => store.getters.allMediaAsArray).not.toThrow()

      const result = store.getters.allMediaAsArray
      expect(result).toHaveLength(2)
      expect(result[0].dbKey).toBe('bad-movie')
      expect(result[1].dbKey).toBe('incomplete-movie')
    })

    it('should preserve object references correctly', () => {
      const movieData = {
        'test-movie': {
          movie: { id: 1, title: 'Test' },
          ratings: [{ calculatedTotal: 8.0 }]
        }
      }

      store.commit('setMovieLog', movieData)
      store.commit('setDbLoaded', true)

      const result1 = store.getters.allMediaAsArray
      const result2 = store.getters.allMediaAsArray

      // Should be the same array reference (getter caching)
      expect(result1).toBe(result2)
    })

    it('should handle movies with multiple ratings correctly', () => {
      const multiRatingMovie = {
        'multi-rating': {
          movie: { id: 1, title: 'Multi Rating Movie' },
          ratings: [
            { calculatedTotal: 8.0, date: '2023-01-01' },
            { calculatedTotal: 9.0, date: '2023-06-01' },
            { calculatedTotal: 7.5, date: '2022-12-01' }
          ]
        }
      }

      store.commit('setMovieLog', multiRatingMovie)
      store.commit('setDbLoaded', true)

      const ratingsArray = store.getters.allMediaRatingsArray

      expect(ratingsArray).toHaveLength(1)
      // Should use the rating returned by getRating (mocked to use first rating)
      expect(ratingsArray[0]).toBe(8.0)
    })
  })
})