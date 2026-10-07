// Which of a year's films a personal-awards category may draw from.
//
// Three standard categories are gated: Best Animated Feature and Best
// Documentary Feature by TMDB genre, and — since 2026-10-07 — Best
// International Feature by where the film was made. Matt: "it would be nice
// to try to see more films not produced in the United States. And so
// awarding those feels like a worthy task." The name is the Academy's own
// (it dropped "Foreign Language Film" in 2019 for much the same reason), and
// Movie Log's "Best Foreign Film" lines up with it in the club view.
//
// International means: TMDB lists at least one production country and none
// of them is the US. A British or Irish film qualifies; a US co-production
// does not. A film whose countries are unknown (never fetched) is not
// eligible until they are — see backfillProductionCountries.

export const INTERNATIONAL_CATEGORY = 'bestInternationalFeature';

export function productionCountryCodes (movie) {
  const list = movie?.production_countries;
  return Array.isArray(list) ? list.map((c) => c?.iso_3166_1).filter(Boolean) : null;
}

export function isInternationalFilm (movie) {
  const codes = productionCountryCodes(movie);
  return Boolean(codes && codes.length && !codes.includes('US'));
}

export function countriesKnown (movie) {
  return Array.isArray(movie?.production_countries);
}

const hasGenre = (entry, name) => Boolean(entry?.movie?.genres && entry.movie.genres.some((genre) => genre?.name === name));

/** The entries (library rows, `{ movie, ... }`) a category may nominate from. */
export function entriesEligibleFor (categoryKey, entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (categoryKey === 'bestAnimatedFeature') return list.filter((entry) => hasGenre(entry, 'Animation'));
  if (categoryKey === 'bestDocumentaryFeature') return list.filter((entry) => hasGenre(entry, 'Documentary'));
  if (categoryKey === INTERNATIONAL_CATEGORY) return list.filter((entry) => isInternationalFilm(entry?.movie));
  return list;
}

/** Why a gated category is greyed out for a year with nothing eligible; null for the rest. */
export function disabledReasonFor (categoryKey) {
  if (categoryKey === 'bestAnimatedFeature') return 'No animated films rated this year';
  if (categoryKey === 'bestDocumentaryFeature') return 'No documentaries rated this year';
  if (categoryKey === INTERNATIONAL_CATEGORY) return 'No films made outside the US rated this year';
  return null;
}

export const GATED_CATEGORIES = ['bestAnimatedFeature', 'bestDocumentaryFeature', INTERNATIONAL_CATEGORY];

/** "France · Germany" — where a film was made, for a nominee caption. */
export function countriesLabel (movie, limit = 3) {
  const names = (movie?.production_countries || []).map((c) => c?.name).filter(Boolean);
  if (!names.length) return '';
  return names.length > limit ? `${names.slice(0, limit).join(' · ')} +${names.length - limit}` : names.join(' · ');
}
