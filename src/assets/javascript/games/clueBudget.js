import {
  movieDecade,
  movieGenreNames,
  movieCastNames,
  movieDirectors,
  movieWriters,
  movieYear,
  movieComposers,
  movieCinematographers
} from './gameUtils.js';

// Pure, store-free rules for the Clue Budget game: spend a fixed starting
// budget on clues about a hidden movie, then guess it before you're broke.
// See CLAUDE.md for the full design writeup (a friend's idea, relayed by
// the user) and the reasoning behind these specific costs.

export const STARTING_BUDGET = 100;

function clamp (value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// --- Dynamic pricing -------------------------------------------------
//
// TMDB gives a real `popularity` score for PEOPLE (every cast/crew member
// on a movie's own /credits response) and, indirectly, for KEYWORDS and
// COMPANIES via how many movies share that keyword/company id
// (/discover/movie's total_results — TMDB doesn't expose a popularity
// field for either directly). The component fetches these live, once per
// round (ClueBudgetGame.vue); this module just turns a raw number into a
// price once it has one. All three curves are log-scaled on purpose —
// both popularity and movie-count have a long tail (a handful of huge
// values, everything else clustered low), so a linear scale would make
// almost every real value look identically cheap or identically expensive.

const PERSON_PRICE_MIN = 8;
const PERSON_PRICE_MAX = 35;

// Direct: more universally recognizable → costs more. log2(1+p) rather
// than log2(p) so a popularity of 0 (no signal at all) doesn't blow up.
export function priceFromPersonPopularity (popularity) {
  const p = Math.max(0, popularity || 0);
  return clamp(Math.round(5 + 4.5 * Math.log2(1 + p)), PERSON_PRICE_MIN, PERSON_PRICE_MAX);
}

const KEYWORD_PRICE_MIN = 8;
const KEYWORD_PRICE_MAX = 30;

// Inverse: shared by fewer movies → narrows the field more → costs more.
// The opposite direction from person pricing, on purpose.
export function priceFromKeywordRarity (movieCount) {
  const n = Math.max(1, movieCount || 1);
  return clamp(Math.round(32 - 1.9 * Math.log2(n)), KEYWORD_PRICE_MIN, KEYWORD_PRICE_MAX);
}

const COMPANY_PRICE_MIN = 6;
const COMPANY_PRICE_MAX = 25;

// Also inverse, same reasoning as keywords, but a visibly narrower/lower
// band and gentler slope — a company's movie COUNT is a prolificness
// proxy, not a fame score (a24 vs. Warner Bros. isn't really "less
// famous," just less prolific), so it's a noisier signal than the other
// two and priced with a bit less confidence baked in.
export function priceFromCompanyRarity (movieCount) {
  const n = Math.max(1, movieCount || 1);
  return clamp(Math.round(25 - 1.5 * Math.log2(n)), COMPANY_PRICE_MIN, COMPANY_PRICE_MAX);
}

// Highest popularity among a group (e.g. co-writers, co-directors) — if
// you'd recognize ANY one of them, the clue has done its job, so price by
// whichever name in the group is most identifying.
function maxPopularity (names, peoplePopularity) {
  const known = names.map((name) => peoplePopularity[name]).filter((p) => p != null);
  return known.length ? Math.max(...known) : null;
}

// --- Fallback (fixed) costs -------------------------------------------
//
// Used until the corresponding live data resolves (or if it never does —
// a failed fetch, or a keyword/person TMDB genuinely has no id/score for).
// Same hand-assigned tier reasoning as before dynamic pricing existed:
// weak/broad category info is cheap, anything close to a direct
// fingerprint is expensive. See CLAUDE.md for the full history, including
// why CAST_COSTS specifically prices #1 (top-billed) highest, not lowest.
const FALLBACK_KEYWORD_COSTS = [10, 15];
const FALLBACK_CAST_COSTS = [30, 25, 20];
const CAST_LIMIT = FALLBACK_CAST_COSTS.length;

// Three across on a phone is five full rows — see ClueBudgetGame.vue.
export const TARGET_CLUE_COUNT = 15;

// Costs for top-up entries, continuing each list's own direction: cast gets
// cheaper further down the billing, keywords get dearer as they get nicher.
const fallbackCastCost = (index) =>
  FALLBACK_CAST_COSTS[index] ?? Math.max(8, FALLBACK_CAST_COSTS[FALLBACK_CAST_COSTS.length - 1] - 4 * (index - FALLBACK_CAST_COSTS.length + 1));

const fallbackKeywordCost = (index) =>
  FALLBACK_KEYWORD_COSTS[index] ?? Math.min(25, FALLBACK_KEYWORD_COSTS[FALLBACK_KEYWORD_COSTS.length - 1] + 4 * (index - FALLBACK_KEYWORD_COSTS.length + 1));
const FALLBACK_COSTS = {
  producer: 8,
  company: 10,
  editor: 10,
  composer: 12,
  cinematographer: 12,
  yourRating: 12,
  tagline: 15,
  writer: 15,
  director: 20
};

// Builds every clue AVAILABLE for this movie (not yet purchased — the
// component tracks purchase state separately). Only includes a clue when
// the underlying data actually exists for this movie (e.g. no production
// company on file → no Production Company clue) — never a clue with
// nothing to show.
//
// `extras` carries everything that isn't persisted locally and has to be
// fetched live from TMDB per round (see ClueBudgetGame.vue):
//   - tagline: string. Omit/falsy → no Tagline clue offered at all yet.
//   - peoplePopularity: { [personName]: popularity } from the movie's own
//     /credits response. A name missing from this map just uses the
//     fallback cost for that clue — never blocks the clue from appearing.
//   - keywordMovieCounts: { [keywordString]: total_results } — only ever
//     populated for keywords that came from TMDB (have a resolvable
//     keyword id; AI/custom keywords don't and always use the fallback).
//   - companyMovieCount: total_results for the primary production company.
//   - yourRating: the player's own calculated score for this movie (number).
//     Not derivable here — see the Your Rating clue below.
// Call buildClueDeck again as each extra resolves to refresh prices in
// place — the component re-merges rather than replacing already-purchased
// clues, so a price update never retroactively changes what was paid.
export function buildClueDeck (entry, extras = {}) {
  const { tagline, peoplePopularity = {}, keywordMovieCounts = {}, yourRating } = extras;
  const clues = [];

  const decade = movieDecade(entry);
  if (decade != null) clues.push({ key: 'decade', label: 'Decade', cost: 5, value: `${decade}s` });

  const runtime = entry?.movie?.runtime;
  const year = movieYear(entry);
  if (year != null) clues.push({ key: 'year', label: 'Exact Year', cost: 10, value: String(year) });

  if (runtime) clues.push({ key: 'runtime', label: 'Runtime', cost: 5, value: `~${runtime} min` });

  const genres = movieGenreNames(entry);
  if (genres.length) clues.push({ key: 'genres', label: genres.length > 1 ? 'Genres' : 'Genre', cost: 8, value: genres.join(', ') });

  // User request: "we should add my rating as a buyable clue." Passed in via
  // extras (not read off the entry) because a rating needs GetRating.js +
  // the Vuex weight getters to compute, which this store-free module can't
  // reach — same reason tagline comes in that way. Flat-priced: unlike the
  // people/keyword/company clues there's no TMDB signal to scale against,
  // and how identifying a given score is depends entirely on the shape of
  // the player's own library (a 9.4 narrows hard, a 6.5 barely at all), so
  // a mid-range fixed cost is the honest choice rather than a fake curve.
  if (typeof yourRating === 'number' && Number.isFinite(yourRating)) {
    clues.push({ key: 'yourRating', label: 'Your Rating', cost: FALLBACK_COSTS.yourRating, value: yourRating.toFixed(2) });
  }

  const keywords = (entry?.movie?.flatKeywords || []).filter(Boolean);
  keywords.slice(0, FALLBACK_KEYWORD_COSTS.length).forEach((keyword, index) => {
    const movieCount = keywordMovieCounts[keyword];
    const cost = movieCount != null ? priceFromKeywordRarity(movieCount) : FALLBACK_KEYWORD_COSTS[index];
    clues.push({ key: `keyword-${index}`, label: `Theme/Keyword #${index + 1}`, cost, value: keyword });
  });

  const composers = movieComposers(entry);
  if (composers.length) {
    const popularity = maxPopularity(composers, peoplePopularity);
    clues.push({ key: 'composer', label: 'Composer', cost: popularity != null ? priceFromPersonPopularity(popularity) : FALLBACK_COSTS.composer, value: composers[0] });
  }

  const cinematographers = movieCinematographers(entry);
  if (cinematographers.length) {
    const popularity = maxPopularity(cinematographers, peoplePopularity);
    clues.push({ key: 'cinematographer', label: 'Cinematographer', cost: popularity != null ? priceFromPersonPopularity(popularity) : FALLBACK_COSTS.cinematographer, value: cinematographers[0] });
  }

  if (tagline) clues.push({ key: 'tagline', label: 'Tagline', cost: FALLBACK_COSTS.tagline, value: tagline });

  const writers = movieWriters(entry);
  if (writers.length) {
    const popularity = maxPopularity(writers, peoplePopularity);
    clues.push({ key: 'writer', label: writers.length > 1 ? 'Writers' : 'Writer', cost: popularity != null ? priceFromPersonPopularity(popularity) : FALLBACK_COSTS.writer, value: writers.join(', ') });
  }

  const directors = movieDirectors(entry);
  if (directors.length) {
    const popularity = maxPopularity(directors, peoplePopularity);
    clues.push({ key: 'director', label: directors.length > 1 ? 'Directors' : 'Director', cost: popularity != null ? priceFromPersonPopularity(popularity) : FALLBACK_COSTS.director, value: directors.join(', ') });
  }

  const cast = movieCastNames(entry, CAST_LIMIT);
  cast.forEach((name, index) => {
    const popularity = peoplePopularity[name];
    const cost = popularity != null ? priceFromPersonPopularity(popularity) : FALLBACK_CAST_COSTS[index];
    clues.push({ key: `cast-${index}`, label: `Cast Member #${index + 1}`, cost, value: name });
  });

  // Top up to a full shop.
  //
  // The clue TYPES above are patchy: tagline is fetched live and often
  // absent, and across the library composer is on 85% of movies, writer 96%,
  // cinematographer 94%. So a deck capped by type alone plays short — the
  // reported round offered 10 of a possible 15. Cast and keyword lists run
  // much deeper (94% of movies have 8+ cast, 85% have 6+ keywords), so
  // whatever's missing is made up from those, alternating so neither
  // dominates. Falls short only if the movie genuinely hasn't got the data.
  const extraCast = movieCastNames(entry, TARGET_CLUE_COUNT).slice(cast.length);
  const extraKeywords = keywords.slice(FALLBACK_KEYWORD_COSTS.length);

  let castIndex = 0;
  let keywordIndex = 0;
  while (clues.length < TARGET_CLUE_COUNT && (castIndex < extraCast.length || keywordIndex < extraKeywords.length)) {
    if (castIndex < extraCast.length) {
      const name = extraCast[castIndex];
      const index = cast.length + castIndex;
      const popularity = peoplePopularity[name];
      clues.push({
        key: `cast-${index}`,
        label: `Cast Member #${index + 1}`,
        cost: popularity != null ? priceFromPersonPopularity(popularity) : fallbackCastCost(index),
        value: name
      });
      castIndex++;
    }
    if (clues.length >= TARGET_CLUE_COUNT) break;
    if (keywordIndex < extraKeywords.length) {
      const keyword = extraKeywords[keywordIndex];
      const index = FALLBACK_KEYWORD_COSTS.length + keywordIndex;
      const movieCount = keywordMovieCounts[keyword];
      clues.push({
        key: `keyword-${index}`,
        label: `Theme/Keyword #${index + 1}`,
        cost: movieCount != null ? priceFromKeywordRarity(movieCount) : fallbackKeywordCost(index),
        value: keyword
      });
      keywordIndex++;
    }
  }

  return clues;
}
