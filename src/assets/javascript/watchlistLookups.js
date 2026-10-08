import { deviceCache } from '../../utils/deviceCache.js';

// A favourite's filmography and a favourite film's recommendations, kept on
// the device for a week. Sentry N+1 (2026-10-08, again after the name
// searches were cached): every open still asked TMDB for the same dozens of
// credit lists and recommendation lists. A week keeps new releases arriving
// while a normal open asks for nothing. Stored trimmed to what ranking and
// the rows read, and without the films ranking would drop anyway, so the
// whole store stays small.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const peopleCredits = deviceCache('cinemaRoll.watchlist.credits', { maxAgeMs: WEEK_MS, maxEntries: 120 });
export const filmRecommendations = deviceCache('cinemaRoll.watchlist.recommendations', { maxAgeMs: WEEK_MS, maxEntries: 60 });
const MIN_RANKED_VOTES = 50; // rankWatchlistCandidates' default minVotes

export function trimForWatchlist (movies) {
  return (movies || [])
    .filter((movie) => movie && movie.id != null && (movie.vote_count || 0) >= MIN_RANKED_VOTES)
    .map((movie) => ({
      id: movie.id,
      title: movie.title,
      poster_path: movie.poster_path,
      backdrop_path: movie.backdrop_path,
      release_date: movie.release_date,
      vote_average: movie.vote_average,
      vote_count: movie.vote_count,
      popularity: movie.popularity,
      genre_ids: movie.genre_ids,
      adult: movie.adult,
      video: movie.video
    }));
}

/** Tests, and nothing else. */
export function forgetWatchlistLookups () {
  peopleCredits.clear();
  filmRecommendations.clear();
}
