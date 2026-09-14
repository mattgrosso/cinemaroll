class LetterboxdScrapingService {
  /**
   * Check if a movie is logged in a user's Letterboxd profile
   * Returns { watched: boolean, rating: string|null, review: string|null }
   */
  static async checkMovieStatus (username, movieTitle, movieYear) {
    if (!username || !movieTitle) {
      return { watched: false, rating: null, review: null, error: 'Missing username or movie title' };
    }

    try {
      // First, try to get the user's films list
      const filmsData = await this.scrapeUserFilms(username);

      // Search for the movie in their films
      const movieMatch = this.findMovieInUserData(filmsData, movieTitle, movieYear);

      if (movieMatch) {
        return {
          watched: true,
          rating: movieMatch.rating,
          review: movieMatch.review,
          watchedDate: movieMatch.date
        };
      }

      return { watched: false, rating: null, review: null };
    } catch (error) {
      console.error('Error checking movie status on Letterboxd:', error);
      return { watched: false, rating: null, review: null, error: error.message };
    }
  }

  /**
   * Scrape a user's films from their Letterboxd profile
   */
  static async scrapeUserFilms (username) {
    console.log(`Scraping Letterboxd profile: ${username}`);

    const allFilms = [];
    let page = 1;
    const maxPages = 20; // Safety limit - 20 pages * 72 films = ~1440 films max

    try {
      // Try multiple CORS proxies in order of preference
      const proxies = [
        'https://api.allorigins.win/get?url=',
        'https://corsproxy.io/?',
        'https://api.codetabs.com/v1/proxy?quest='
      ];

      let workingProxy = null;

      // Find a working proxy first by actually testing with real requests
      for (const proxyUrl of proxies) {
        try {
          const testUrl = `https://letterboxd.com/${username}/films/`;
          const fullUrl = proxyUrl + encodeURIComponent(testUrl);

          const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; CinemaRoll/1.0)'
            }
          });

          if (response.ok) {
            // Test if we actually get valid content
            const contentType = response.headers.get('content-type') || '';
            let testContent;

            if (contentType.includes('application/json')) {
              const data = await response.json();
              testContent = data.contents || data.body || data.data || data;
            } else {
              testContent = await response.text();
            }

            if (typeof testContent === 'string' &&
                (testContent.includes('letterboxd') || testContent.includes('<!DOCTYPE'))) {
              workingProxy = proxyUrl;
              break;
            }
          }
        } catch {
          continue;
        }
      }

      if (!workingProxy) {
        throw new Error('No working proxy found');
      }

      // Now scrape all pages
      while (page <= maxPages) {
        const pageUrl = page === 1
          ? `https://letterboxd.com/${username}/films/`
          : `https://letterboxd.com/${username}/films/page/${page}/`;

        try {
          const fullUrl = workingProxy + encodeURIComponent(pageUrl);

          const response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
              Accept: 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (compatible; CinemaRoll/1.0)'
            }
          });

          if (!response.ok) {
            break; // Stop if we get an error (likely means no more pages)
          }

          // Handle different response types
          const contentType = response.headers.get('content-type') || '';
          let htmlContent;

          if (contentType.includes('application/json')) {
            // JSON response (allorigins.win format)
            const data = await response.json();
            htmlContent = data.contents || data.body || data.data || data;
          } else {
            // Direct HTML response (corsproxy.io and codetabs format)
            htmlContent = await response.text();
          }

          // Validate we got HTML content
          if (typeof htmlContent !== 'string' ||
              (!htmlContent.includes('letterboxd') && !htmlContent.includes('<!DOCTYPE'))) {
            break;
          }

          // Parse the HTML to extract film data
          const pageFilms = this.parseLetterboxdFilmsHTML(htmlContent, username, page);

          if (pageFilms.length === 0) {
            break;
          }

          allFilms.push(...pageFilms);

          // Small delay between pages to be respectful
          await new Promise(resolve => setTimeout(resolve, 1000));
          page++;
        } catch {
          break; // Stop pagination on error
        }
      }

      const diaryEntries = await this.scrapeUserDiary(username, workingProxy);

      // Merge films with diary data to get accurate watch dates and reviews
      const finalFilms = this.mergeFilmsWithDiary(allFilms, diaryEntries);

      return {
        username,
        films: finalFilms,
        scrapedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Failed to scrape Letterboxd for ${username}:`, error);

      // Fallback to mock data if scraping fails
      console.log('Falling back to mock data...');
      return this.getMockUserData(username);
    }
  }

  /**
   * Parse Letterboxd films page HTML to extract movie data
   */
  static parseLetterboxdFilmsHTML (html) {
    try {
      // Create a temporary DOM element to parse HTML
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const films = [];

      // Try multiple selectors that Letterboxd might use
      const possibleSelectors = [
        '.poster-container',
        '.film-poster',
        '.poster',
        '.film-poster-link',
        '.poster-viewingdata',
        '[data-film-id]',
        '.film-detail',
        '.poster img[alt]'
      ];

      let filmElements = [];

      for (const selector of possibleSelectors) {
        const elements = doc.querySelectorAll(selector);

        if (elements.length > filmElements.length) {
          filmElements = elements;
        }
      }

      if (filmElements.length === 0) {
        return [];
      }

      filmElements.forEach((element) => {
        try {
          // Try multiple ways to extract movie title
          let title = null;

          // Method 1: img alt attribute
          const imgElement = element.querySelector('img');
          if (imgElement) {
            title = imgElement.getAttribute('alt');
          }

          // Method 2: data attributes
          if (!title) {
            title = element.getAttribute('data-film-name') ||
                   element.getAttribute('data-film-title');
          }

          // Method 3: link title or text content
          if (!title) {
            const linkElement = element.querySelector('a');
            if (linkElement) {
              title = linkElement.getAttribute('title') ||
                     linkElement.textContent?.trim();
            }
          }

          if (!title || title.length < 2) {
            return;
          }

          // Focus on what we actually need: reviews and dates
          // We don't need year or rating - Cinema Roll already has that

          // Get the JSON endpoint for detailed film data (reviews, dates)
          const detailsEndpoint = element.getAttribute('data-details-endpoint');
          const filmSlug = element.getAttribute('data-film-slug');

          // Store the endpoints for later review/date fetching
          const filmData = {
            title: title.trim(),
            filmId: element.getAttribute('data-film-id'),
            filmSlug,
            detailsEndpoint,
            targetLink: element.getAttribute('data-target-link')
          };

          films.push({
            title: title.trim(),
            filmId: filmData.filmId,
            filmSlug: filmData.filmSlug,
            detailsEndpoint: filmData.detailsEndpoint,
            targetLink: filmData.targetLink,
            review: null,
            watchedDate: null,
            year: null,
            rating: null
          });
        } catch {
          // Silent error handling
        }
      });

      return films;
    } catch (error) {
      console.error('Error parsing Letterboxd HTML:', error);
      return [];
    }
  }

  /**
   * Enrich films with review/date data from JSON endpoints
   */
  static async enrichFilmsWithJsonData (films, workingProxy) {
    if (!workingProxy || !films.length) return films;

    const enrichedFilms = [];

    for (const film of films) {
      if (!film.detailsEndpoint) {
        enrichedFilms.push(film);
        continue;
      }

      try {
        const jsonUrl = `https://letterboxd.com${film.detailsEndpoint}`;
        const fullUrl = workingProxy + encodeURIComponent(jsonUrl);

        console.log(`📋 Fetching JSON for "${film.title}": ${jsonUrl}`);

        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Mozilla/5.0 (compatible; CinemaRoll/1.0)'
          }
        });

        if (!response.ok) {
          console.log(`❌ JSON fetch failed for "${film.title}": ${response.status}`);
          enrichedFilms.push(film);
          continue;
        }

        // Handle different response types
        const contentType = response.headers.get('content-type') || '';
        let jsonData;

        if (contentType.includes('application/json')) {
          const data = await response.json();
          jsonData = data.contents || data.body || data.data || data;
        } else {
          const textData = await response.text();
          try {
            jsonData = JSON.parse(textData);
          } catch {
            console.log(`❌ Invalid JSON for "${film.title}"`);
            enrichedFilms.push(film);
            continue;
          }
        }

        // Extract review and date from JSON
        const review = this.extractReviewFromJson(jsonData);
        const watchedDate = this.extractDateFromJson(jsonData);

        enrichedFilms.push({
          ...film,
          review,
          watchedDate
        });

        console.log(`✅ "${film.title}": Review=${review ? 'Yes' : 'None'}, Date=${watchedDate || 'Unknown'}`);

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.log(`❌ Error fetching JSON for "${film.title}": ${error.message}`);
        enrichedFilms.push(film);
      }
    }

    return enrichedFilms;
  }

  /**
   * Extract review text from Letterboxd JSON data
   */
  static extractReviewFromJson (jsonData) {
    // Look for common review fields in JSON
    const reviewFields = [
      'review',
      'reviewText',
      'body',
      'content',
      'description',
      'userReview'
    ];

    for (const field of reviewFields) {
      if (jsonData[field] && typeof jsonData[field] === 'string' && jsonData[field].trim()) {
        return jsonData[field].trim();
      }
    }

    return null;
  }

  /**
   * Extract watch date from Letterboxd JSON data
   */
  static extractDateFromJson (jsonData) {
    // Look for common date fields in JSON
    const dateFields = [
      'watchedDate',
      'viewingDate',
      'dateWatched',
      'logDate',
      'diaryDate',
      'createdDate'
    ];

    for (const field of dateFields) {
      if (jsonData[field]) {
        try {
          const date = new Date(jsonData[field]);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Scrape user's diary for watch dates using working proxy
   */
  static async scrapeUserDiary (username, workingProxy) {
    if (!workingProxy) {
      console.log('📝 No working proxy available for diary scraping');
      return [];
    }

    try {
      const diaryUrl = `https://letterboxd.com/${username}/films/diary/`;
      const fullUrl = workingProxy + encodeURIComponent(diaryUrl);

      const response = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (compatible; CinemaRoll/1.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`Diary HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle different response types like we do for films
      const contentType = response.headers.get('content-type') || '';
      let htmlContent;

      if (contentType.includes('application/json')) {
        const data = await response.json();
        htmlContent = data.contents || data.body || data.data || data;
      } else {
        htmlContent = await response.text();
      }

      if (typeof htmlContent !== 'string') {
        throw new Error('Invalid diary response format');
      }

      return this.parseLetterboxdDiaryHTML(htmlContent);
    } catch (error) {
      console.error(`Failed to scrape diary for ${username}:`, error);
      return [];
    }
  }

  /**
   * Parse diary HTML to extract watch dates, ratings, and reviews
   */
  static parseLetterboxdDiaryHTML (html) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const diaryEntries = [];

      // Target the specific diary table structure
      const diaryRows = doc.querySelectorAll('#diary-table .diary-entry-row');

      diaryRows.forEach((row) => {
        try {
          // Extract movie title from data attribute
          const filmName = row.getAttribute('data-film-name') ||
                           row.querySelector('[data-film-name]')?.getAttribute('data-film-name');

          if (!filmName) {
            return;
          }

          // Extract date from the day cell's URL (more reliable than text)
          const dayLinkElement = row.querySelector('.td-day a[href]');
          let watchedDate = null;

          if (dayLinkElement) {
            const dayUrl = dayLinkElement.getAttribute('href');
            // URL format: /mattgrosso/films/diary/for/2025/06/28/
            const dateMatch = dayUrl.match(/\/diary\/for\/(\d{4})\/(\d{2})\/(\d{2})\//);

            if (dateMatch) {
              const [, year, month, day] = dateMatch;
              watchedDate = `${year}-${month}-${day}`; // ISO format: 2025-06-28
            }
          }

          // Extract rating
          const ratingElement = row.querySelector('.rating.rated-8, .rating.rated-10, .rating.rated-6, .rating.rated-4, .rating.rated-2, .rating[class*="rated-"]');
          let rating = null;
          if (ratingElement) {
            const ratingClass = ratingElement.className;
            const ratingMatch = ratingClass.match(/rated-(\d+)/);
            if (ratingMatch) {
              const ratingValue = parseInt(ratingMatch[1]);
              rating = this.formatRating(ratingValue / 2); // Convert 10-point to 5-star
            }
          }

          // Extract review link
          const reviewElement = row.querySelector('.td-review a[href]');
          const reviewUrl = reviewElement ? reviewElement.getAttribute('href') : null;
          const hasReview = !!reviewUrl;

          // Extract viewing JSON URL for detailed data
          const viewingJsonUrl = row.querySelector('[data-viewing-json-url]')?.getAttribute('data-viewing-json-url');

          const entry = {
            title: filmName.trim(),
            watchedDate,
            rating,
            hasReview,
            reviewUrl,
            viewingJsonUrl,
            viewingId: row.getAttribute('data-viewing-id')
          };

          diaryEntries.push(entry);
        } catch {
          // Silent error handling
        }
      });
      return diaryEntries;
    } catch (error) {
      console.error('Error parsing diary HTML:', error);
      return [];
    }
  }

  /**
   * Parse Letterboxd date format to ISO string
   */
  static parseLetterboxdDate (dateText) {
    try {
      // Handle formats like "Jan 15, 2024" or "15 Jan 2024"
      const date = new Date(dateText);
      return date.toISOString().split('T')[0];
    } catch (error) {
      console.error('Error parsing date:', dateText, error);
      return new Date().toISOString().split('T')[0]; // Fallback to today
    }
  }

  /**
   * Merge films data with diary data for accurate watch dates and reviews
   */
  static mergeFilmsWithDiary (films, diaryEntries) {
    return films.map(film => {
      // Find matching diary entries
      const matchingDiaryEntries = diaryEntries.filter(entry =>
        this.normalizeMovieTitle(entry.title) === this.normalizeMovieTitle(film.title)
      );

      if (matchingDiaryEntries.length > 0) {
        // Use the most recent diary entry for primary data
        const mostRecentEntry = matchingDiaryEntries.sort((a, b) =>
          new Date(b.watchedDate) - new Date(a.watchedDate)
        )[0];

        return {
          ...film,
          watchedDate: mostRecentEntry.watchedDate,
          rating: mostRecentEntry.rating || film.rating, // Use diary rating if available
          review: mostRecentEntry.hasReview ? mostRecentEntry.reviewUrl : null,
          hasReview: mostRecentEntry.hasReview,
          multipleViewings: matchingDiaryEntries.length > 1,
          diaryEntries: matchingDiaryEntries // Store all diary entries for this film
        };
      }

      return film;
    });
  }

  /**
   * Find a movie in the user's scraped data
   */
  static findMovieInUserData (userData, movieTitle, movieYear) {
    if (!userData || !userData.films) return null;

    // Normalize the search title
    const normalizedSearchTitle = this.normalizeMovieTitle(movieTitle);
    const searchYear = parseInt(movieYear);

    // Search through the user's films
    for (const film of userData.films) {
      const normalizedFilmTitle = this.normalizeMovieTitle(film.title);

      // Check for title match
      if (normalizedFilmTitle === normalizedSearchTitle) {
        // If we have year info, check that too
        if (searchYear && film.year && Math.abs(film.year - searchYear) > 1) {
          continue; // Year mismatch, keep looking
        }

        return {
          title: film.title,
          year: film.year,
          rating: film.rating,
          review: film.review,
          date: film.watchedDate
        };
      }
    }

    return null;
  }

  /**
   * Normalize movie titles for comparison
   */
  static normalizeMovieTitle (title) {
    if (!title) return '';

    // Handle special cases for very short or problematic titles
    const specialCases = {
      f1: 'f1',
      m: 'm',
      'three colors blue': 'threecolorsblue',
      'three color blue': 'threecolorsblue',
      'trois couleurs bleu': 'threecolorsblue'
    };

    const normalized = title.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove punctuation
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();

    // Check for special cases after basic normalization
    const noSpaces = normalized.replace(/\s/g, '');
    if (specialCases[normalized] || specialCases[noSpaces]) {
      return specialCases[normalized] || specialCases[noSpaces];
    }

    return normalized;
  }

  /**
   * Mock data for testing - replace with real scraping
   * Simulates multiple viewings of the same movie
   */
  static getMockUserData (username) {
    // Simulate popular movies that might be in someone's Letterboxd
    // Including multiple viewings of some films
    const mockFilms = [
      {
        title: "Fight Club",
        year: 1999,
        rating: "★★★★☆",
        review: null,
        watchedDate: "2023-06-15"
      },
      {
        title: "Fight Club",
        year: 1999,
        rating: "★★★★★",
        review: "Even better on rewatch!",
        watchedDate: "2024-01-10"
      },
      {
        title: "The Dark Knight",
        year: 2008,
        rating: "★★★★★",
        review: "Incredible performance by Heath Ledger.",
        watchedDate: "2023-07-20"
      },
      {
        title: "Pulp Fiction",
        year: 1994,
        rating: "★★★★☆",
        review: null,
        watchedDate: "2023-05-10"
      },
      {
        title: "The Godfather",
        year: 1972,
        rating: "★★★★★",
        review: "A masterpiece of cinema.",
        watchedDate: "2023-04-05"
      },
      {
        title: "Inception",
        year: 2010,
        rating: "★★★★☆",
        review: null,
        watchedDate: "2023-08-12"
      },
      {
        title: "Inception",
        year: 2010,
        rating: "★★★☆☆",
        review: "Still confusing on second watch.",
        watchedDate: "2024-03-20"
      }
    ];

    return {
      username,
      films: mockFilms,
      scrapedAt: new Date().toISOString()
    };
  }

  /**
   * Cache management for user data
   */
  static getCacheKey (username) {
    return `letterboxd_user_${username}`;
  }

  static isCacheValid (cacheEntry, maxAgeHours = 24) {
    if (!cacheEntry || !cacheEntry.scrapedAt) return false;

    const cacheAge = Date.now() - new Date(cacheEntry.scrapedAt).getTime();
    const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert hours to milliseconds

    return cacheAge < maxAge;
  }

  /**
   * Get cached user data or scrape fresh data
   */
  static async getUserData (username, forceRefresh = false) {
    const cacheKey = this.getCacheKey(username);

    // Check cache first (if not forcing refresh)
    if (!forceRefresh) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsedCache = JSON.parse(cached);
          if (this.isCacheValid(parsedCache)) {
            return parsedCache;
          }
        } catch {
          // Silent error handling
        }
      }
    }

    // Scrape fresh data
    const userData = await this.scrapeUserFilms(username);

    // Cache the results
    try {
      localStorage.setItem(cacheKey, JSON.stringify(userData));
    } catch (error) {
      console.error('Error caching Letterboxd data:', error);
    }

    return userData;
  }

  /**
   * Convert rating symbols to numeric values for comparison
   */
  static parseRating (ratingStr) {
    if (!ratingStr) return null;

    // Count stars
    const starCount = (ratingStr.match(/★/g) || []).length;
    const halfStars = (ratingStr.match(/½/g) || []).length * 0.5;

    return starCount + halfStars;
  }

  /**
   * Format rating for display
   */
  static formatRating (rating) {
    if (!rating) return null;

    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 === 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return '★'.repeat(fullStars) +
           (hasHalfStar ? '½' : '') +
           '☆'.repeat(emptyStars);
  }

  /**
   * Test method to debug scraping
   */
  static async testScraping (username) {
    try {
      // Clear cache for testing
      localStorage.removeItem(this.getCacheKey(username));

      // Scrape fresh data
      const userData = await this.getUserData(username, true);

      console.log(`✅ Found ${userData.films ? userData.films.length : 0} films from Letterboxd`);

      return userData;
    } catch (error) {
      console.error('❌ Scraping test failed:', error);
      return null;
    }
  }
}

export default LetterboxdScrapingService;