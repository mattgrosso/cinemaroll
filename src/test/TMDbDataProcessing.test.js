import { describe, it, expect, vi, beforeEach } from 'vitest'
import addRating from '@/assets/javascript/AddRating.js'

// Import axios for mocking
import axios from 'axios'
import store from '@/store/index'

// Mock external dependencies
vi.mock('axios', () => ({
  default: {
    get: vi.fn()
  }
}))

vi.mock('@/store/index', () => ({
  default: {
    state: {
      currentLog: 'movieLog',
      movieLog: {},
      tvLog: {},
      isOnline: true
    },
    getters: {
      allMediaSortedByRating: []
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  }
}))

const fetchLocationsForIdsMock = vi.fn(() => Promise.resolve({}))
vi.mock('@/assets/javascript/movieLocations.js', async () => {
  const actual = await vi.importActual('@/assets/javascript/movieLocations.js')
  return {
    ...actual,
    fetchLocationsForIds: (...args) => fetchLocationsForIdsMock(...args)
  }
})

const warmImageCacheMock = vi.fn()
vi.mock('@/assets/javascript/offlinePosterCache.js', async () => {
  const actual = await vi.importActual('@/assets/javascript/offlinePosterCache.js')
  return {
    ...actual,
    warmImageCache: (...args) => warmImageCacheMock(...args)
  }
})

// enqueueWrite resolves the stored record, matching the real implementation.
const enqueueWriteMock = vi.fn((entry) => Promise.resolve({ id: 'queued-1', attempts: 0, lastError: null, createdAt: Date.now(), ...entry }))
const removePendingWriteMock = vi.fn(() => Promise.resolve())
const updatePendingWriteMock = vi.fn(() => Promise.resolve())
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  enqueueWrite: (...args) => enqueueWriteMock(...args),
  removePendingWrite: (...args) => removePendingWriteMock(...args),
  updatePendingWrite: (...args) => updatePendingWriteMock(...args)
}))

describe('TMDb Data Processing & Movie Rating Addition', () => {
  let mockTMDbData
  let mockCreditsData
  let mockKeywordsData
  let mockRatings

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock TMDb API responses
    mockTMDbData = {
      id: 550,
      title: 'Fight Club',
      release_date: '1999-10-15',
      runtime: 139,
      backdrop_path: '/fCayJrkfRaCRCTh8GqN30f8oyQF.jpg',
      poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
      imdb_id: 'tt0137523',
      genres: [
        { id: 18, name: 'Drama' },
        { id: 53, name: 'Thriller' }
      ],
      production_companies: [
        { id: 508, name: '20th Century Fox' },
        { id: 711, name: 'Fox 2000 Pictures' }
      ],
      budget: 63000000,
      revenue: 100853753
    }

    mockCreditsData = {
      cast: [
        { name: 'Brad Pitt', character: 'Tyler Durden' },
        { name: 'Edward Norton', character: 'The Narrator' },
        { name: 'Helena Bonham Carter', character: 'Marla Singer' }
      ],
      crew: [
        { name: 'David Fincher', job: 'Director' },
        { name: 'Chuck Palahniuk', job: 'Novel' },
        { name: 'Jim Uhls', job: 'Screenplay' }
      ]
    }

    mockKeywordsData = {
      keywords: [
        { id: 825, name: 'support group' },
        { id: 849, name: 'dual identity' },
        { id: 851, name: 'nihilism' }
      ]
    }

    mockRatings = [
      {
        id: 550,
        love: 9,
        overall: 9,
        story: 8,
        direction: 10,
        imagery: 9,
        performance: 9,
        soundtrack: 8,
        stickiness: 9,
        date: '2023-10-15',
        medium: 'Theater',
        ownership: 'Digital',
        chatGPTKeywords: ['psychological', 'underground']
      }
    ]

    // Setup default axios mock responses
    axios.get.mockImplementation((url) => {
      if (url.includes('/movie/550?')) {
        return Promise.resolve({ data: mockTMDbData })
      }
      if (url.includes('/movie/550/credits')) {
        return Promise.resolve({ data: mockCreditsData })
      }
      if (url.includes('/movie/550/keywords')) {
        return Promise.resolve({ data: mockKeywordsData })
      }
      if (url.includes('/person/') && url.includes('/movie_credits')) {
        return Promise.resolve({
          data: {
            crew: [
              {
                id: 550,
                job: 'Director',
                title: 'Fight Club',
                release_date: '1999-10-15',
                popularity: 8.5
              },
              {
                id: 26752,
                job: 'Director',
                title: 'Gone Girl',
                release_date: '2014-10-01',
                popularity: 9.2
              }
            ]
          }
        })
      }
      return Promise.reject(new Error('Unknown URL'))
    })

    // Reset store state
    store.state.movieLog = {}
    store.state.currentLog = 'movieLog'
    store.state.isOnline = true
    // vi.clearAllMocks() above only clears call history, not a custom
    // mockImplementation a previous test may have set on the shared
    // store.dispatch mock instance (e.g. to simulate writeDatabaseEntryNow
    // rejecting) - reset it back to its pristine no-op-resolving default so
    // that doesn't leak into unrelated tests.
    store.dispatch.mockReset()
  })

  describe('TMDb API Data Fetching', () => {
    it('should fetch movie data, credits, and keywords from TMDb API', async () => {
      await addRating(mockRatings)

      expect(axios.get).toHaveBeenCalledTimes(3)
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/movie/550?'))
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/movie/550/credits'))
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/movie/550/keywords'))
    })

    it('should handle TV show data when currentLog is tvLog', async () => {
      store.state.currentLog = 'tvLog'
      const tvRatings = [{
        ...mockRatings[0],
        tvShowId: 550
      }]
      // Keep the id field since the function requires ratings[0].id to exist
      // The getTMDBData function will use either id or tvShowId

      // Update axios mock to handle TV show endpoints
      axios.get.mockImplementation((url) => {
        if (url.includes('/tv/550?')) {
          return Promise.resolve({ data: mockTMDbData })
        }
        if (url.includes('/tv/550/credits')) {
          return Promise.resolve({ data: mockCreditsData })
        }
        if (url.includes('/tv/550/keywords')) {
          return Promise.resolve({ data: mockKeywordsData })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      await addRating(tvRatings)

      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/tv/550?'))
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/tv/550/credits'))
      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/tv/550/keywords'))
    })

    it('throws rather than silently writing a broken entry when every TMDb call fails for a new movie', async () => {
      axios.get.mockRejectedValue(new Error('API Error'))

      await expect(addRating(mockRatings)).rejects.toThrow('Failed to fetch TMDB data for id 550')
    })

    it('should handle missing ratings gracefully', async () => {
      // The actual implementation will throw an error when accessing ratings[0] on empty array
      // This is expected behavior that should be handled by the calling code
      await expect(addRating([])).rejects.toThrow()
      expect(axios.get).not.toHaveBeenCalled()
    })

    it('should handle ratings without id', async () => {
      const ratingsWithoutId = [{ love: 8, overall: 7 }]

      const result = await addRating(ratingsWithoutId)

      expect(result).toBeUndefined()
      expect(axios.get).not.toHaveBeenCalled()
    })
  })

  describe('Data Transformation and Processing', () => {
    it('should correctly transform TMDb data for storage', async () => {
      const result = await addRating(mockRatings)

      const movieData = result.value.movie

      expect(movieData.id).toBe(550)
      expect(movieData.title).toBe('Fight Club')
      expect(movieData.release_date).toBe('1999-10-15')
      expect(movieData.runtime).toBe(139)
      expect(movieData.backdrop_path).toBe('/fCayJrkfRaCRCTh8GqN30f8oyQF.jpg')
      expect(movieData.poster_path).toBe('/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg')
      expect(movieData.imdb_id).toBe('tt0137523')
      // budget/revenue are already present on the same /movie/{id} response
      // this test's other assertions come from - no extra TMDb call needed.
      expect(movieData.budget).toBe(63000000)
      expect(movieData.revenue).toBe(100853753)
    })

    it('should process cast data correctly', async () => {
      const result = await addRating(mockRatings)

      const cast = result.value.movie.cast

      expect(cast).toHaveLength(3)
      expect(cast[0]).toEqual({
        name: 'Brad Pitt',
        character: 'Tyler Durden'
      })
      expect(cast[1]).toEqual({
        name: 'Edward Norton',
        character: 'The Narrator'
      })
      expect(cast[2]).toEqual({
        name: 'Helena Bonham Carter',
        character: 'Marla Singer'
      })
    })

    it('should process crew data correctly', async () => {
      const result = await addRating(mockRatings)

      const crew = result.value.movie.crew

      expect(crew).toHaveLength(3)
      expect(crew[0]).toEqual({
        name: 'David Fincher',
        job: 'Director'
      })
      expect(crew[1]).toEqual({
        name: 'Chuck Palahniuk',
        job: 'Novel'
      })
      expect(crew[2]).toEqual({
        name: 'Jim Uhls',
        job: 'Screenplay'
      })
    })

    it('should process genres and production companies', async () => {
      const result = await addRating(mockRatings)

      const movieData = result.value.movie

      expect(movieData.genres).toEqual([
        { id: 18, name: 'Drama' },
        { id: 53, name: 'Thriller' }
      ])
      expect(movieData.production_companies).toEqual([
        { id: 508, name: '20th Century Fox' },
        { id: 711, name: 'Fox 2000 Pictures' }
      ])
    })

    it('should process keywords correctly', async () => {
      const result = await addRating(mockRatings)

      const keywords = result.value.movie.keywords

      expect(keywords).toEqual([
        { id: 825, name: 'support group' },
        { id: 849, name: 'dual identity' },
        { id: 851, name: 'nihilism' }
      ])
    })

    it('should handle keywords from TV shows (results field)', async () => {
      store.state.currentLog = 'tvLog'
      const tvRatings = [{
        ...mockRatings[0],
        tvShowId: 550
      }]
      // Keep the id field since the function requires ratings[0].id to exist

      // Update the mock to return results field for TV shows
      const originalKeywords = mockKeywordsData.keywords
      axios.get.mockImplementation((url) => {
        if (url.includes('/tv/550?')) {
          return Promise.resolve({ data: mockTMDbData })
        }
        if (url.includes('/tv/550/credits')) {
          return Promise.resolve({ data: mockCreditsData })
        }
        if (url.includes('/tv/550/keywords')) {
          return Promise.resolve({ data: { results: originalKeywords } })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      const result = await addRating(tvRatings)

      expect(result.value.movie.keywords).toEqual(originalKeywords)
    })

    it('should process ChatGPT keywords from multiple ratings', async () => {
      const multipleRatings = [
        {
          id: 550,
          love: 9,
          chatGPTKeywords: ['psychological', 'underground']
        },
        {
          id: 550,
          love: 8,
          chatGPTKeywords: ['underground', 'consumerism', 'fight']
        }
      ]

      const result = await addRating(multipleRatings)

      const chatGPTKeywords = result.value.movie.chatGPTKeywords

      expect(chatGPTKeywords).toEqual(['psychological', 'underground', 'consumerism', 'fight'])
      expect(chatGPTKeywords).toHaveLength(4) // Should deduplicate 'underground'
    })

    it('should remove ownership from ratings but preserve in movie data', async () => {
      const result = await addRating(mockRatings)

      expect(result.value.movie.ownership).toBe('Digital')
      expect(result.value.ratings[0].ownership).toBeUndefined()
    })
  })

  describe('Database Key Generation', () => {
    it('should generate new key when movie not in database', async () => {
      const result = await addRating(mockRatings)

      expect(result.path).toMatch(/^movieLog\/\d+-[a-f0-9-]+-Fight Club$/)
      expect(result.path).toContain('Fight Club') // Title preserved with space
    })

    it('should use existing key when movie already in database', async () => {
      // Add movie to mock database
      store.state.movieLog = {
        'existing-key-fight-club': {
          movie: { id: 550, title: 'Fight Club' },
          ratings: []
        }
      }

      const result = await addRating(mockRatings)

      expect(result.path).toBe('movieLog/existing-key-fight-club')
    })

    it('should sanitize title for safe key generation', async () => {
      mockTMDbData.title = 'Movie: With/Special\\Characters!@#$%^&*()_+{}[]|;\':"<>?,./'

      const result = await addRating(mockRatings)

      // Check that special characters are replaced with dashes
      expect(result.path).toContain('Movie- With-Special')
      // The backslash is not in the replacement regex, so we can't check for it
      // Let's check for a subset of special characters that should be replaced
      expect(result.path).not.toMatch(/[!@#$%^&*()_+{}[\]|;':"<>?,.]/)
    })

    it('should handle empty title gracefully', async () => {
      mockTMDbData.title = ''

      const result = await addRating(mockRatings)

      expect(result.path).toMatch(/^movieLog\/\d+-[a-f0-9-]+-$/)
    })
  })

  describe('Edge Cases and Error Handling', () => {
    it('should handle missing TMDb data fields gracefully', async () => {
      // TMDb data with missing fields
      mockTMDbData = {
        id: 550,
        title: 'Fight Club'
        // Missing many fields
      }
      mockCreditsData = { cast: [], crew: [] }
      mockKeywordsData = { keywords: [] }

      const result = await addRating(mockRatings)

      const movieData = result.value.movie

      expect(movieData.backdrop_path).toBeUndefined()
      expect(movieData.poster_path).toBeUndefined()
      expect(movieData.imdb_id).toBeUndefined()
      expect(movieData.runtime).toBeUndefined()
      expect(movieData.genres).toBeUndefined() // When field is missing from tmdbData, it's undefined
      expect(movieData.production_companies).toBeUndefined()
      expect(movieData.cast).toEqual([]) // Empty arrays from mockCreditsData
      expect(movieData.crew).toEqual([])
      expect(movieData.keywords).toEqual([]) // Empty array from mockKeywordsData
    })

    it('should throw rather than write a broken entry when TMDb fails for a genuinely new movie (bug fix - the old behavior silently wrote id: null, title: "", no cast/crew)', async () => {
      // Main movie data succeeds, but credits and keywords fail
      axios.get.mockImplementation((url) => {
        if (url.includes('/movie/550?')) {
          return Promise.resolve({ data: mockTMDbData })
        }
        return Promise.reject(new Error('API Error'))
      })

      await expect(addRating(mockRatings)).rejects.toThrow('Failed to fetch TMDB data for id 550')
    })

    it('falls back to the existing local movie data instead of throwing when TMDb fails for a movie already in the library', async () => {
      store.state.movieLog = {
        'existing-key-fight-club': {
          movie: {
            id: 550,
            title: 'Fight Club',
            poster_path: '/old-poster.jpg',
            backdrop_path: '/old-backdrop.jpg',
            genres: [{ id: 18, name: 'Drama' }],
            cast: [{ name: 'Brad Pitt', character: 'Tyler Durden' }],
            crew: [{ name: 'David Fincher', job: 'Director' }],
            keywords: [],
            production_companies: [],
            imdb_id: 'tt0137523',
            runtime: 139,
            chatGPTKeywords: ['existing-keyword']
          },
          ratings: [{ id: 550, love: 7 }]
        }
      }
      axios.get.mockImplementation((url) => {
        if (url.includes('/movie/550?')) {
          return Promise.resolve({ data: mockTMDbData })
        }
        return Promise.reject(new Error('API Error'))
      })

      const result = await addRating(mockRatings)

      expect(result.path).toBe('movieLog/existing-key-fight-club')
      expect(result.value.movie.title).toBe('Fight Club')
      expect(result.value.movie.poster_path).toBe('/old-poster.jpg')
      expect(result.value.movie.cast).toEqual([{ name: 'Brad Pitt', character: 'Tyler Durden' }])
      // New rating's chatGPTKeywords merged with the previously-stored ones
      expect(result.value.movie.chatGPTKeywords).toEqual(expect.arrayContaining(['existing-keyword', 'psychological', 'underground']))
    })

    it('should handle malformed API responses', async () => {
      // Mock malformed responses - the function will crash on malformed data
      // This tests that the function needs proper error handling for production
      axios.get.mockImplementation((url) => {
        if (url.includes('/movie/550?')) {
          return Promise.resolve({ data: mockTMDbData })
        }
        if (url.includes('/credits')) {
          return Promise.resolve({ data: { cast: null, crew: null } })
        }
        if (url.includes('/keywords')) {
          return Promise.resolve({ data: { keywords: null } })
        }
        return Promise.reject(new Error('Unknown URL'))
      })

      // The function will throw an error when trying to map over null values
      await expect(addRating(mockRatings)).rejects.toThrow()
    })

    it('should handle very large datasets', async () => {
      // Create large cast and crew arrays
      const largeCast = Array(100).fill().map((_, i) => ({
        name: `Actor ${i}`,
        character: `Character ${i}`
      }))
      // A realistic TMDB crew: a handful of credits the app reads, buried in
      // ninety-odd it never touches.
      const largeCrew = [
        { name: 'The Director', job: 'Director' },
        { name: 'The Writer', job: 'Screenplay' },
        { name: 'The DP', job: 'Director of Photography' },
        ...Array(97).fill().map((_, i) => ({ name: `Crew Member ${i}`, job: 'Stunts' }))
      ]

      mockCreditsData = { cast: largeCast, crew: largeCrew }

      const result = await addRating(mockRatings)

      // Cast is kept in full — Six Degrees walks the whole billing list.
      expect(result.value.movie.cast).toHaveLength(100)
      // Crew is trimmed to what's actually read; storing all of it made crew
      // half the entire database.
      expect(result.value.movie.crew.map((p) => p.job)).toEqual([
        'Director', 'Screenplay', 'Director of Photography'
      ])
    })

    it('does not write fields that are injected when reading', async () => {
      // dbKey and _search come from the store getter and Home's search
      // memoisation; carrying them across a re-rate is how they ended up in
      // the database in the first place.
      store.state.movieLog = {
        existing: {
          movie: { id: 550, title: 'Test Movie' },
          ratings: [],
          dbKey: 'existing',
          _search: { title: 'test movie' },
          customPosterPath: '/keep-me.jpg'
        }
      }

      const result = await addRating(mockRatings)

      expect(result.value.dbKey).toBeUndefined()
      expect(result.value._search).toBeUndefined()
      // ...while genuinely-owned entry data still survives a re-rate.
      expect(result.value.customPosterPath).toBe('/keep-me.jpg')
    })

    it('should handle multiple ratings with different ChatGPT keywords', async () => {
      const multipleRatings = [
        {
          id: 550,
          love: 9,
          chatGPTKeywords: ['psychological']
        },
        {
          id: 550,
          love: 8
          // No chatGPTKeywords
        },
        {
          id: 550,
          love: 7,
          chatGPTKeywords: ['underground', 'consumerism']
        }
      ]

      const result = await addRating(multipleRatings)

      expect(result.value.movie.chatGPTKeywords).toEqual(['psychological', 'underground', 'consumerism'])
    })
  })

  describe('Store Integration', () => {
    it('commits the entry to local state, ALWAYS durably queues it before attempting anything, then attempts a direct write and removes the queue entry once confirmed (bulletproofing, Jul 2026: enqueue must happen before the network attempt, not only as a fallback after failure, so a rating survives even if the app is killed mid-write - not just mid-idle)', async () => {
      const result = await addRating(mockRatings)

      // Optimistic local commit - see setMovieLogEntry's comment in
      // store/index.js for why the movie needs to show up immediately
      // regardless of connectivity or what happens below.
      expect(store.commit).toHaveBeenCalledWith('setMovieLogEntry', {
        key: result.path.split('movieLog/')[1],
        value: result.value
      })
      // Enqueued BEFORE the write attempt - this is the actual durability
      // guarantee, not an afterthought.
      expect(enqueueWriteMock).toHaveBeenCalledWith({ type: 'write', dbEntry: result })
      const enqueueOrder = enqueueWriteMock.mock.invocationCallOrder[0]
      const dispatchOrder = store.dispatch.mock.invocationCallOrder[0]
      expect(enqueueOrder).toBeLessThan(dispatchOrder)
      expect(store.dispatch).toHaveBeenCalledWith('writeDatabaseEntryNow', result)
      // Confirmed - the now-redundant queue entry is removed.
      expect(removePendingWriteMock).toHaveBeenCalledWith('queued-1')
    })

    it('leaves the queue entry in place (does not remove it) AND re-throws if the direct write fails while nominally online, so the caller surfaces a real error instead of trusting an unconfirmed save - the data itself is never at risk either way', async () => {
      store.dispatch.mockImplementation((action) => {
        if (action === 'writeDatabaseEntryNow') return Promise.reject(new Error('write failed'))
        return Promise.resolve()
      })

      await expect(addRating(mockRatings)).rejects.toThrow('write failed')
      expect(enqueueWriteMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'write' }))
      expect(removePendingWriteMock).not.toHaveBeenCalled()
    })

    it('skips the direct write attempt entirely and leaves it durably queued when offline, without throwing', async () => {
      store.state.isOnline = false

      const result = await addRating(mockRatings)

      expect(store.dispatch).not.toHaveBeenCalledWith('writeDatabaseEntryNow', expect.anything())
      expect(enqueueWriteMock).toHaveBeenCalledWith({ type: 'write', dbEntry: result })
      expect(removePendingWriteMock).not.toHaveBeenCalled()
    })

    it('a placeholder rating swallows a direct-write failure instead of throwing, and does NOT remove its queue entry - reconciliation tracking (and the safety net for a retry) stays intact regardless of this attempt\'s outcome, matching the feature\'s existing "sync eventually" UX', async () => {
      store.dispatch.mockImplementation((action) => {
        if (action === 'writeDatabaseEntryNow') return Promise.reject(new Error('write failed'))
        return Promise.resolve()
      })

      const result = await addRating([{ id: 'offline-swallow-test', title: 'Some Movie', love: 5 }])

      expect(result).toBeDefined()
      expect(enqueueWriteMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'placeholder' }))
      expect(removePendingWriteMock).not.toHaveBeenCalled()
      expect(updatePendingWriteMock).not.toHaveBeenCalledWith('queued-1', { written: true })
    })

    it('a placeholder rating marks its queue entry "written" (kept for reconciliation, not removed) once the direct write succeeds', async () => {
      const result = await addRating([{ id: 'offline-written-test', title: 'Some Movie', love: 5 }])

      expect(result).toBeDefined()
      expect(updatePendingWriteMock).toHaveBeenCalledWith('queued-1', { written: true })
      expect(removePendingWriteMock).not.toHaveBeenCalled()
    })

    it('should return database entry structure', async () => {
      const result = await addRating(mockRatings)

      expect(result).toHaveProperty('path')
      expect(result).toHaveProperty('value')
      expect(result.path).toMatch(/^movieLog\//)
      expect(result.value).toHaveProperty('movie')
      expect(result.value).toHaveProperty('ratings')
    })

    it('should warm the offline image cache with the new poster and backdrop urls', async () => {
      await addRating(mockRatings)

      expect(warmImageCacheMock).toHaveBeenCalledWith([
        'https://image.tmdb.org/t/p/w342/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
        'https://image.tmdb.org/t/p/w500/fCayJrkfRaCRCTh8GqN30f8oyQF.jpg'
      ])
    })

    it('should not attempt to warm the cache when TMDb fetch fails for a new movie (addRating throws first)', async () => {
      axios.get.mockRejectedValue(new Error('API Error'))

      await expect(addRating(mockRatings)).rejects.toThrow()
      expect(warmImageCacheMock).not.toHaveBeenCalled()
    })

    it('should not attempt to warm the cache when ratings have no id (addMovieRating returns early)', async () => {
      await addRating([{ love: 8, overall: 7 }])

      expect(warmImageCacheMock).not.toHaveBeenCalled()
    })

    it('should handle missing environment variables', async () => {
      // Temporarily clear the API key
      const originalApiKey = process.env.VUE_APP_TMDB_API_KEY
      delete process.env.VUE_APP_TMDB_API_KEY

      await addRating(mockRatings)

      expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('api_key=undefined'))

      // Restore API key
      process.env.VUE_APP_TMDB_API_KEY = originalApiKey
    })
  })

  describe('Offline rating support', () => {
    it('skips the TMDb fetch entirely when offline and the movie already has local data', async () => {
      store.state.isOnline = false
      store.state.movieLog = {
        'existing-key-fight-club': {
          movie: {
            id: 550,
            title: 'Fight Club',
            poster_path: '/old-poster.jpg',
            backdrop_path: '/old-backdrop.jpg',
            genres: [],
            cast: [],
            crew: [],
            keywords: [],
            production_companies: [],
            imdb_id: 'tt0137523',
            runtime: 139,
            chatGPTKeywords: []
          },
          ratings: [{ id: 550, love: 7 }]
        }
      }

      const result = await addRating(mockRatings)

      expect(axios.get).not.toHaveBeenCalled()
      expect(result.path).toBe('movieLog/existing-key-fight-club')
      expect(result.value.movie.poster_path).toBe('/old-poster.jpg')
      expect(store.commit).toHaveBeenCalledWith('setMovieLogEntry', {
        key: 'existing-key-fight-club',
        value: result.value
      })
    })

    it('builds a placeholder entry for a brand-new movie rated offline, with no TMDb call and no id: null / empty-title fallout', async () => {
      const placeholderRatings = [{
        id: 'offline-abc-123',
        title: 'Some Movie I Remember',
        year: '2010',
        love: 8,
        overall: 7
      }]

      const result = await addRating(placeholderRatings)

      expect(axios.get).not.toHaveBeenCalled()
      expect(result.value.movie).toMatchObject({
        id: 'offline-abc-123',
        title: 'Some Movie I Remember',
        release_date: '2010-01-01',
        runtime: 90,
        poster_path: null,
        backdrop_path: null,
        genres: [],
        cast: [],
        crew: [],
        isPendingReconciliation: true
      })
      expect(enqueueWriteMock).toHaveBeenCalledWith(expect.objectContaining({
        type: 'placeholder',
        placeholderMovieId: 'offline-abc-123',
        title: 'Some Movie I Remember',
        year: '2010',
        status: 'unreconciled'
      }))
      expect(store.commit).toHaveBeenCalledWith('setMovieLogEntry', expect.objectContaining({
        value: expect.objectContaining({ movie: expect.objectContaining({ isPendingReconciliation: true }) })
      }))
    })

    it('defaults a placeholder release_date/runtime to safe non-null values when no year was typed (avoids breaking date-parsing call sites and the "shorts" filter, which treats null runtime as 0)', async () => {
      const placeholderRatings = [{ id: 'offline-no-year', title: 'Untitled Memory', love: 5 }]

      const result = await addRating(placeholderRatings)

      const currentYear = new Date().getFullYear()
      expect(result.value.movie.release_date).toBe(`${currentYear}-01-01`)
      expect(result.value.movie.runtime).toBe(90)
    })

    // Bug report: an airplane-mode rating "seemed to work" and then was gone
    // for good — an enqueueWrite that silently failed (it never throws, it
    // resolves null) leaves NOTHING durable while offline, so pretending the
    // save happened is exactly how a rating vanishes without a trace.
    it('throws (and never fakes an optimistic save) when offline and the durable enqueue itself fails', async () => {
      store.state.isOnline = false
      enqueueWriteMock.mockResolvedValueOnce(null)
      const placeholderRatings = [{ id: 'offline-doomed', title: 'Doomed Movie', love: 5 }]

      await expect(addRating(placeholderRatings)).rejects.toThrow(/offline storage/i)

      expect(store.commit).not.toHaveBeenCalledWith('setMovieLogEntry', expect.anything())
    })

    it('a placeholder rated ONLINE surfaces a failure when both the enqueue and the direct write fail — no safety net left to silently trust', async () => {
      store.state.isOnline = true
      enqueueWriteMock.mockResolvedValueOnce(null)
      store.dispatch.mockRejectedValueOnce(new Error('network down'))

      await expect(addRating([{ id: 'offline-unsafe', title: 'Unsafe Movie', love: 5 }])).rejects.toThrow('network down')
    })

    it('commits the optimistic entry only AFTER the durable enqueue has resolved', async () => {
      const order = []
      enqueueWriteMock.mockImplementationOnce(async (entry) => {
        order.push('enqueue')
        return { id: 'queued-1', ...entry }
      })
      store.commit.mockImplementationOnce((mutation) => {
        if (mutation === 'setMovieLogEntry') order.push('commit')
      })

      await addRating([{ id: 'offline-ordered', title: 'Ordered Movie', love: 5 }])

      expect(order).toEqual(['enqueue', 'commit'])
    })

    it('reuses the same movieLog key for a second offline edit of the same not-yet-reconciled placeholder', async () => {
      const id = 'offline-repeat'
      const first = await addRating([{ id, title: 'Repeat Movie', love: 5 }])

      // Simulate the optimistic commit having actually landed in local state,
      // the way store/index.js's real setMovieLogEntry mutation would -
      // findKeyForMovieInDatabase reads store.state.movieLog directly.
      const key = first.path.split('movieLog/')[1]
      store.state.movieLog = { [key]: first.value }

      const second = await addRating([{ id, title: 'Repeat Movie', love: 8 }])

      expect(second.path).toBe(first.path)
    })
  })
})
// The user's ask: "Every new movie should automatically pull that data... so
// that I don't need to push that button except just once right now in order to
// catch up for past entries."
describe('locations are fetched automatically on a new rating', () => {
  const paris = { name: 'Paris', lat: 48.85, lon: 2.35, type: 'filming', id: 'Q90' }

  const tmdbOk = () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/credits')) return Promise.resolve({ data: { cast: [], crew: [] } })
      if (url.includes('/keywords')) return Promise.resolve({ data: { keywords: [] } })
      return Promise.resolve({ data: { id: 42, title: 'Test Movie', genres: [], production_countries: [], spoken_languages: [] } })
    })
  }

  // storeLocationsForRating is fire-and-forget, so the assertions have to wait
  // for the microtask queue rather than for addRating itself.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  beforeEach(() => {
    vi.clearAllMocks()
    store.state.movieLog = {}
    store.state.isOnline = true
    fetchLocationsForIdsMock.mockResolvedValue({})
    tmdbOk()
  })

  it('looks up and stores locations without being asked', async () => {
    fetchLocationsForIdsMock.mockResolvedValue({ 42: [paris] })
    store.commit.mockImplementation((type, payload) => {
      if (type === 'setMovieLogEntry') store.state.movieLog[payload.key] = payload.value
    })

    await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    expect(fetchLocationsForIdsMock).toHaveBeenCalledWith(['42'])
    const write = store.dispatch.mock.calls.find(([, arg]) => arg?.path?.endsWith('/movie/locations'))
    expect(write).toBeTruthy()
    expect(write[1].value).toEqual([paris])
  })

  it('writes a leaf path, so it cannot clobber sibling movie fields', async () => {
    fetchLocationsForIdsMock.mockResolvedValue({ 42: [paris] })
    store.commit.mockImplementation((type, payload) => {
      if (type === 'setMovieLogEntry') store.state.movieLog[payload.key] = payload.value
    })

    await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    const write = store.dispatch.mock.calls.find(([, arg]) => arg?.path?.endsWith('/movie/locations'))
    expect(write[1].path).toMatch(/^movieLog\/[^/]+\/movie\/locations$/)
  })

  it('records an explicit empty array when Wikidata knows nothing, so it is not re-queried forever', async () => {
    fetchLocationsForIdsMock.mockResolvedValue({})
    store.commit.mockImplementation((type, payload) => {
      if (type === 'setMovieLogEntry') store.state.movieLog[payload.key] = payload.value
    })

    await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    const write = store.dispatch.mock.calls.find(([, arg]) => arg?.path?.endsWith('/movie/locations'))
    expect(write[1].value).toEqual([])
  })

  it('does not look anything up while offline', async () => {
    store.state.isOnline = false
    store.state.movieLog = { existing: { movie: { id: 42, title: 'Test Movie' }, ratings: [] } }

    await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    expect(fetchLocationsForIdsMock).not.toHaveBeenCalled()
  })

  it('does not look anything up for an offline placeholder, which has no TMDB id to join on', async () => {
    await addRating([{ id: 'offline-abc', title: 'Half Remembered Movie', date: Date.now() }])
    await settle()

    expect(fetchLocationsForIdsMock).not.toHaveBeenCalled()
  })

  it('does not re-query a movie whose locations are already known', async () => {
    // Re-rating a movie that already has them: the carry-over below means
    // dbEntry.value.movie.locations is already set, so there is nothing to do.
    store.state.movieLog = {
      existing: { movie: { id: 42, title: 'Test Movie', locations: [paris] }, ratings: [] }
    }

    await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    expect(fetchLocationsForIdsMock).not.toHaveBeenCalled()
  })

  it('never lets a Wikidata failure affect the rating itself', async () => {
    fetchLocationsForIdsMock.mockRejectedValue(new Error('WDQS down'))

    // The rating must still resolve normally, not reject.
    const dbEntry = await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])
    await settle()

    expect(dbEntry).toBeTruthy()
    expect(dbEntry.value.movie.title).toBe('Test Movie')
  })
})

// A rating save does a full set() of movieLog/<key>, and shapeTmdbDataIntoMovie
// builds a brand new movie object — so anything not carried across is wiped.
describe('re-rating preserves locally-owned data', () => {
  const paris = { name: 'Paris', lat: 48.85, lon: 2.35, type: 'filming', id: 'Q90' }

  beforeEach(() => {
    vi.clearAllMocks()
    store.state.isOnline = true
    fetchLocationsForIdsMock.mockResolvedValue({})
    axios.get.mockImplementation((url) => {
      if (url.includes('/credits')) return Promise.resolve({ data: { cast: [], crew: [] } })
      if (url.includes('/keywords')) return Promise.resolve({ data: { keywords: [] } })
      return Promise.resolve({ data: { id: 42, title: 'Test Movie', genres: [], production_countries: [], spoken_languages: [] } })
    })
  })

  it('keeps locations across a re-rate', async () => {
    store.state.movieLog = {
      existing: { movie: { id: 42, title: 'Test Movie', locations: [paris] }, ratings: [] }
    }

    const dbEntry = await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])

    expect(dbEntry.value.movie.locations).toEqual([paris])
  })

  it('keeps a custom poster across a re-rate', async () => {
    // Pre-existing bug found while adding locations: customPosterPath lives at
    // the ENTRY level, a sibling of movie/ratings, so the full set() destroyed
    // it every time a movie was re-rated.
    store.state.movieLog = {
      existing: {
        movie: { id: 42, title: 'Test Movie' },
        ratings: [],
        customPosterPath: '/my-poster.jpg',
        customBackdropPath: '/my-backdrop.jpg'
      }
    }

    const dbEntry = await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])

    expect(dbEntry.value.customPosterPath).toBe('/my-poster.jpg')
    expect(dbEntry.value.customBackdropPath).toBe('/my-backdrop.jpg')
  })

  it('still lets fresh TMDB data win for fields TMDB actually returns', async () => {
    // The whole point of re-fetching on a re-rate is picking up corrections.
    store.state.movieLog = {
      existing: { movie: { id: 42, title: 'Old Wrong Title', runtime: 1 }, ratings: [] }
    }

    const dbEntry = await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])

    expect(dbEntry.value.movie.title).toBe('Test Movie')
  })

  it('does not write dbKey, which the store injects at read time', async () => {
    store.state.movieLog = {
      existing: { movie: { id: 42, title: 'Test Movie' }, ratings: [], dbKey: 'existing' }
    }

    const dbEntry = await addRating([{ id: 42, title: 'Test Movie', date: Date.now() }])

    expect(dbEntry.value.dbKey).toBeUndefined()
  })
})
