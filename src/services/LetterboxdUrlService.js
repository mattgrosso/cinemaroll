import { normalizedRatingToStars } from '../assets/javascript/starRating.js';

class LetterboxdUrlService {
  /**
   * Convert movie title to Letterboxd URL slug (without year)
   * Examples:
   * "Fight Club" → "fight-club"
   * "The Dark Knight" → "dark-knight"
   * "Pulp Fiction" → "pulp-fiction"
   */
  static generateMovieSlug (title) {
    if (!title) return null;

    // Convert to lowercase and replace spaces with hyphens
    const slug = title.toLowerCase()
      // Keep articles like "The" - Letterboxd usually keeps them
      // .replace(/^(the|a|an)\s+/i, '') // Removed this line
      // Replace special characters and spaces with hyphens
      .replace(/[^a-z0-9\s]/g, '')
      // Replace multiple spaces with single space
      .replace(/\s+/g, ' ')
      // Trim and replace spaces with hyphens
      .trim()
      .replace(/\s/g, '-')
      // Remove multiple consecutive hyphens
      .replace(/-+/g, '-')
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, '');

    // Note: Letterboxd doesn't use years in URLs for most movies
    // Only add year for disambiguation when absolutely necessary

    return slug;
  }

  /**
   * Today's date as a local YYYY-MM-DD string (Letterboxd's `date` param format).
   * Built from local date components — NOT toISOString(), which is UTC and would
   * log the wrong day for late-evening viewings in western timezones.
   */
  static todayLocalISODate () {
    return this.toLocalISODate(new Date());
  }

  /**
   * Any date-ish value (timestamp, Date, parseable string) as a local
   * YYYY-MM-DD string. Returns null if it isn't a real date.
   *
   * Built from LOCAL components for the same reason as todayLocalISODate:
   * toISOString() is UTC and would report the previous day for anything
   * watched in the evening in a western timezone.
   */
  static toLocalISODate (value) {
    if (value === null || value === undefined || value === '') return null;

    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return null;

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Letterboxd's `rating` deep-link param is a 0.5–5 star value in 0.5 steps —
   * exactly Cinema Roll's canonical star conversion, so this simply delegates.
   */
  static normalizedRatingToStars (normalizedRating) {
    return normalizedRatingToStars(normalizedRating);
  }

  /**
   * Generate full Letterboxd URLs.
   * options.normalizedRating (0–10) is forwarded to the log link as a star rating.
   * options.viewingDate (timestamp/Date/string) sets the logged viewing date;
   * defaults to today only when there isn't a usable one.
   */
  static generateUrls (title, year, options = {}) {
    const slug = this.generateMovieSlug(title, year);
    if (!slug || !title) return null;

    // URL encode the title for the app URL
    const encodedTitle = encodeURIComponent(title);

    // Letterboxd's log deep link no longer defaults the viewing date to today
    // (an app update changed this), so we pass a date explicitly. Without it,
    // logs followed through from Cinema Roll on mobile land with no date.
    //
    // Use the date the movie was actually WATCHED, not today. Bug report: "it
    // should have the date automatically filled in ... Even if I didn't watch
    // it today and also even if I have watched it multiple times." Callers pass
    // the viewing being logged (the most recent one); today is only the
    // fallback for a rating with no usable date.
    const viewingDate = this.toLocalISODate(options.viewingDate) || this.todayLocalISODate();

    // Pre-fill the star rating from Cinema Roll when we have one.
    const stars = this.normalizedRatingToStars(options.normalizedRating);
    const ratingParam = stars !== null ? `&rating=${stars}` : '';

    return {
      slug,
      webUrl: `https://letterboxd.com/film/${slug}/`,
      appUrl: `letterboxd://x-callback-url/search?query=${encodedTitle}&type=film`,
      appLogUrl: `letterboxd://x-callback-url/log?name=${encodedTitle}&date=${viewingDate}${ratingParam}`,
      reviewsUrl: `https://letterboxd.com/film/${slug}/reviews/`
    };
  }

  /**
   * Generate user-specific URLs
   */
  static generateUserUrls (username, title, year) {
    const slug = this.generateMovieSlug(title, year);
    if (!slug || !username) return null;

    return {
      userProfile: `https://letterboxd.com/${username}/`,
      userFilms: `https://letterboxd.com/${username}/films/`,
      userReviews: `https://letterboxd.com/${username}/films/reviews/`,
      userFilmPage: `https://letterboxd.com/${username}/film/${slug}/`
    };
  }

  /**
   * Smart deep link to movie with app/web fallback
   * Opens search in app, with web fallback
   */
  static openMovie (title, year, options = {}) {
    const urls = this.generateUrls(title, year);
    if (!urls) {
      console.error('Could not generate Letterboxd URLs for:', title, year);
      return false;
    }

    // Try to open the app first with x-callback-url search
    try {
      window.location.href = urls.appUrl;

      // Fallback to web after delay if app doesn't open
      const fallbackDelay = options.fallbackDelay || 1500;
      setTimeout(() => {
        this.tryWebUrlWithFallback(title, urls.webUrl);
      }, fallbackDelay);

      return true;
    } catch (error) {
      console.error('Error opening Letterboxd app, opening web instead:', error);
      this.tryWebUrlWithFallback(title, urls.webUrl);
      return true;
    }
  }

  /**
   * Deep link to log/rate a movie in the Letterboxd app
   */
  static logMovie (title, year, options = {}) {
    const urls = this.generateUrls(title, year, options);
    if (!urls) {
      console.error('Could not generate Letterboxd URLs for:', title, year);
      return false;
    }

    // Try to open the app first with x-callback-url log
    try {
      window.location.href = urls.appLogUrl;

      // Fallback to web after delay if app doesn't open
      const fallbackDelay = options.fallbackDelay || 1500;
      setTimeout(() => {
        this.tryWebUrlWithFallback(title, urls.webUrl);
      }, fallbackDelay);

      return true;
    } catch (error) {
      console.error('Error opening Letterboxd app for logging, opening web instead:', error);
      this.tryWebUrlWithFallback(title, urls.webUrl);
      return true;
    }
  }

  /**
   * Try web URL, with fallback to search if the direct link fails
   */
  static tryWebUrlWithFallback (title, primaryUrl) {
    // Try the primary URL first
    const testLink = document.createElement('a');
    testLink.href = primaryUrl;
    testLink.target = '_blank';
    testLink.style.display = 'none';
    document.body.appendChild(testLink);
    testLink.click();
    document.body.removeChild(testLink);
    // Note: we can't detect a 404 in the browser; the user can fall back to
    // Letterboxd's own search if the direct film URL misses.
  }

  /**
   * Open movie reviews page
   */
  static openMovieReviews (title, year) {
    const urls = this.generateUrls(title, year);
    if (!urls) return false;

    window.open(urls.reviewsUrl, '_blank');
    return true;
  }

  /**
   * Open user's profile
   */
  static openUserProfile (username) {
    if (!username) return false;

    const profileUrl = `https://letterboxd.com/${username}/`;
    window.open(profileUrl, '_blank');
    return true;
  }
}

export default LetterboxdUrlService;