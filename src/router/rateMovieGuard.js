// Which film the Rate screen is for lives only in the store (setMovieToRate),
// never in the URL, so a reload on /rate-movie - or an app update reloading
// the page - lands on the screen with `movieToRate` back at its empty {}.
// Sentry, 2026-10-09: that blank screen asked /keywords with no title and the
// endpoint answered 400. With nothing to rate, the screen sends you Home.
export function hasMovieToRate (movie) {
  return Boolean(movie && typeof movie.title === 'string' && movie.title.trim());
}

export function rateMovieRedirect ({ loggedIn, movieToRate }) {
  if (!loggedIn) return '/login';
  if (!hasMovieToRate(movieToRate)) return '/';
  return null;
}
