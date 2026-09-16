// Pure search/filter/sort logic extracted from Home.vue so it can be unit-tested
// in isolation (no component mount required). These functions read NOTHING from
// `this` — every dependency (the current sort value/order, and a getRating-style
// rating accessor) is passed in explicitly. Home.vue keeps thin method wrappers
// that supply those from component state, so all existing call sites are unchanged.
//
// Behavior here is byte-for-byte the logic that previously lived on the component;
// the equivalence is guarded by SortResultsFast.test.js, ChipFiltering.test.js,
// QuickLinksFiltering.test.js (via the wrappers) plus searchFiltering.test.js
// (direct unit tests of these exports).

// The text primitives live in searchText.js (Phase 3: the kind registry
// needs them without an import cycle); re-exported here so the many existing
import { placeNames } from './places.js';
import { uniqueViewingTags } from '../../utils/tags.js';
// importers keep working unchanged.
import { normalizeSearchText, looseSearchText } from './searchText.js';
import { numeralTokens, numeralTokensMatch, titleMatchesValue } from './numberWords.js';
import { FILTER_KINDS, getListOfYearsFromRange } from './filterKinds.js';
import { adjustedMovieMoney } from './inflation.js';

export { normalizeSearchText, looseSearchText, getListOfYearsFromRange };

/**
 * Precompute the normalized strings applyFilter needs so they aren't re-derived
 * per movie on every keystroke.
 *
 * ONE form per name. Cast is deliberately untrimmed here (Six Degrees walks the
 * full billing list), so a second copy of every cast name is thousands of extra
 * strings held for the whole library at once — enough GC pressure to double the
 * cost of an unrelated library sort, measured. Names therefore keep their word
 * boundaries and rely on `normalizeSearchText` alone, which is why that folds
 * hyphens to spaces; only the title, one string per movie, also keeps a loose
 * form, and that's where run-together spellings ("spiderman") actually come up.
 */
export function buildSearchFields (movie, ratings = []) {
  return {
    // Viewing tags live on the RATINGS, not the movie — the one searchable
    // field that needs the whole library entry. Matt, 2026-09-16: "I have a
    // tag that's called back focus, and when I search for it in the search
    // bar, no films come up." Normalized like everything else; the tag chip
    // (FILTER_KINDS.tag) keeps reading the ratings directly.
    tags: uniqueViewingTags(ratings).map(normalizeSearchText),
    // Filming and story locations from Wikidata (places.js). Both types in
    // one list: a chip for "Paris" means films that touch Paris either way,
    // and the movie page says which.
    places: placeNames(movie).map(normalizeSearchText),
    title: normalizeSearchText(movie.title),
    titleLoose: looseSearchText(movie.title),
    // Number words folded to digits, as tokens — the bridge between a library
    // that stored "Nine to Five" and a thumb that types "9 to 5". One extra
    // small array per movie, title only: see numberWords.js.
    titleNumerals: numeralTokens(movie.title),
    keywords: (movie.flatKeywords || []).filter(Boolean).map(normalizeSearchText),
    genres: (movie.genres || []).filter(g => g.name).map(g => normalizeSearchText(g.name)),
    cast: (movie.cast || []).filter(p => p.name).map(p => normalizeSearchText(p.name)),
    // job kept original-case for the exact `=== 'Director'` check; jobLower for
    // the producer substring check.
    crew: (movie.crew || []).filter(p => p.name).map(p => ({
      name: normalizeSearchText(p.name),
      job: p.job || '',
      jobLower: normalizeSearchText(p.job)
    })),
    companies: (movie.production_companies || []).filter(c => c.name).map(c => normalizeSearchText(c.name))
  };
}

/**
 * Does `result` match `filter`? Decorated library entries carry `_search`;
 * quick-link-sourced entries may not, so we build it on the fly when missing.
 */
export function applyFilter (result, filter) {
  // One lookup, no switch: each kind's matcher lives in filterKinds.js,
  // beside everything else that kind knows how to do. An unknown type
  // matches nothing, as the old switch's default always did.
  const kind = FILTER_KINDS[filter.type];
  if (!kind) return false;

  return kind.matchLocal(result, filter, result._search || buildSearchFields(result.movie, result.ratings));
}

/**
 * The four money sorts. Requested 2026-08-25: "add a couple new sorting
 * options to the main results page. We need to be able to sort by budget, by
 * box office, and then by profit and by percentage of budget returned."
 *
 * Kept together because they share one awkward property: the data is optional.
 * TMDB reports 0 for "we don't know", which is indistinguishable from a
 * genuinely free production, so the whole app treats 0 and undefined alike as
 * unknown (see MovieDetail's Box Office section). Roughly a fifth of a mature
 * library has no figures at all.
 */
export const BOX_OFFICE_SORTS = new Set(['budget', 'boxOffice', 'profit', 'returnPct']);

/**
 * A film's two money figures, optionally re-expressed in today's dollars.
 *
 * `adjusted` falls back to the raw figure when the film can't be adjusted (no
 * release date, a year off the end of the CPI table) rather than dropping to
 * zero — a film that simply lacks a date must not be reclassified as having
 * no box office and sink out of the list.
 */
const boxOfficeFor = (item, adjusted = false) => {
  const budget = item?.movie?.budget || 0;
  const revenue = item?.movie?.revenue || 0;
  if (!adjusted) return { budget, revenue };
  return {
    budget: adjustedMovieMoney(item?.movie, 'budget') ?? budget,
    revenue: adjustedMovieMoney(item?.movie, 'revenue') ?? revenue
  };
};

/**
 * From when a missing box office means "it never sold tickets" rather than
 * "nobody wrote the number down".
 *
 * Before roughly this year, a blank gross is almost always unrecorded history
 * — The Searchers, Breathless, Bringing Up Baby and A Trip to the Moon all
 * sit in that pile, and their budgets are real and belong on a budget sort.
 * After it, a real budget with no gross at all is the signature of a
 * streaming original.
 */
export const STREAMING_ERA_YEAR = 2015;

/**
 * A modern film carrying a real budget and no box office whatsoever.
 *
 * There is no reliable way to ASK whether something played in cinemas
 * (tested 2026-08-26): TMDB's release types count a three-week
 * awards-eligibility run as theatrical, so The Irishman and Red Notice both
 * read as cinema releases; and `production_companies` names who MADE a film,
 * not who released it, so Netflix appears on none of its own. What is left is
 * the shape of the data itself, gated by era.
 *
 * Requested 2026-08-26: "the budget numbers get a bit skewed by movies that
 * go straight to streaming."
 */
export const isModernWithNoBoxOffice = (item) => {
  const movie = item?.movie;
  if (!movie) return false;
  if (!(movie.budget > 0)) return false;
  if (movie.revenue > 0) return false;

  const year = Number(String(movie.release_date || '').slice(0, 4));
  return Number.isFinite(year) && year >= STREAMING_ERA_YEAR;
};

/**
 * Whether this item has no answer for this sort — which is different from
 * having a low one. Unknowns sink to the bottom in BOTH directions (see the
 * comparators): flipping to worst-on-top to find the biggest flops should
 * show flops, not three hundred films with no figures.
 *
 * Profit and percentage-returned need both numbers; budget and box office
 * need only their own.
 */
export function isSortValueUnknown (item, key) {
  if (!BOX_OFFICE_SORTS.has(key)) return false;
  const { budget, revenue } = boxOfficeFor(item);
  // A budget IS known for a streaming original — but it isn't comparable to
  // one that sold tickets, which is the complaint. Sunk rather than hidden,
  // so it's still findable at the end of the list.
  //
  // Scoped to 'budget' as a statement of intent, not because it is load-
  // bearing: isModernWithNoBoxOffice only ever fires on a film with zero
  // revenue, and zero revenue already makes boxOffice, profit and returnPct
  // unknown on the lines below. A mutation that applies it to all four passes
  // every test. It would start mattering the day this counted NEGLIGIBLE box
  // office rather than exactly none.
  if (key === 'budget') return budget <= 0 || isModernWithNoBoxOffice(item);
  if (key === 'boxOffice') return revenue <= 0;
  return budget <= 0 || revenue <= 0;
}

/**
 * The sort key value for `item`. `getRating(item)` returns the rating object
 * (the component passes its mostRecentRating, which wraps GetRating.js).
 */
export function getSortValue (item, key, getRating, { adjusted = false } = {}) {
  if (BOX_OFFICE_SORTS.has(key)) {
    // Return on budget is deliberately NOT adjusted. Budget and box office
    // are in the same year's dollars, so scaling both by the same factor
    // cancels — this is belt-and-braces, not load-bearing (a mutation that
    // removes it passes every test, because the maths already agrees). It
    // stays as a statement of intent, and it would start mattering the day
    // the two figures were ever adjusted by different indices.
    const { budget, revenue } = boxOfficeFor(item, adjusted && key !== 'returnPct');
    if (key === 'budget') return budget;
    if (key === 'boxOffice') return revenue;
    if (key === 'profit') return revenue - budget;
    // Percentage of budget returned: 250 means it made two and a half times
    // what it cost. Guarded against a zero budget, which would be Infinity
    // and would sort above every real film.
    return budget > 0 ? (revenue / budget) * 100 : 0;
  }
  if (key === 'rating') {
    return getRating(item).calculatedTotal;
  } else if (key === 'release') {
    return new Date(item.movie.release_date);
  } else if (key === 'title') {
    return item.movie.title;
  } else if (key === 'watched') {
    const date = getRating(item).date || '3/22/1982';
    return new Date(date);
  } else if (key === 'views') {
    return item.ratings.length;
  } else {
    const keyScore = parseInt(getRating(item)[key]);
    const keysToCompare = ['direction', 'imagery', 'impression', 'love', 'performance', 'soundtrack', 'stickiness', 'story'];
    const isKeyScoreHighestScore = keysToCompare.some((keyToCompare) => {
      const keyToCompareScore = parseInt(getRating(item)[keyToCompare]);
      return keyToCompareScore >= keyScore;
    });
    return isKeyScoreHighestScore ? keyScore : 0;
  }
}

/**
 * Decorate-sort-undecorate sort. Computes each item's primary + secondary sort
 * value ONCE (one getRating per item for the common "rating" sort), then sorts
 * on the cached values with semantics identical to sortResults. Returns a NEW
 * array (does not mutate the input).
 */
export function sortResultsFast (array, { sortValue, sortOrder, getRating, adjusted = false }) {
  const key = sortValue || 'rating';
  const bestOnTop = sortOrder === 'bestOrNewestOnTop';

  const decorated = array.map((item) => {
    const rating = getRating(item);
    const secondary = rating.calculatedTotal;
    const primary = key === 'rating' ? rating.calculatedTotal : getSortValue(item, key, getRating, { adjusted });
    return { item, primary, secondary, unknown: isSortValueUnknown(item, key) };
  });

  decorated.sort((a, b) => {
    // "No figures" is not a low number — it sinks whichever way the sort
    // points. Only the money sorts can ever set this.
    if (a.unknown !== b.unknown) {
      return a.unknown ? 1 : -1;
    }
    // Mirror sortResults exactly, including the quirk that === on two Date objects
    // is false (so date sorts skip the secondary tiebreak).
    if (a.primary === b.primary) {
      if (a.secondary < b.secondary) {
        return bestOnTop ? 1 : -1;
      }
      if (a.secondary > b.secondary) {
        return bestOnTop ? -1 : 1;
      }
      return 0;
    }
    if (a.primary < b.primary) {
      return bestOnTop ? 1 : -1;
    }
    if (a.primary > b.primary) {
      return bestOnTop ? -1 : 1;
    }
    return 0;
  });

  return decorated.map((d) => d.item);
}

/**
 * Reference comparator (the oracle sortResultsFast is tested against). Kept
 * identical to the legacy in-component comparator.
 */
export function sortResults (a, b, { sortValue, sortOrder, getRating, adjusted = false }) {
  const key = sortValue || 'rating';

  // Kept in lockstep with sortResultsFast — searchFiltering.test.js asserts
  // the two produce byte-identical orderings.
  const unknownA = isSortValueUnknown(a, key);
  const unknownB = isSortValueUnknown(b, key);
  if (unknownA !== unknownB) {
    return unknownA ? 1 : -1;
  }

  const sortValueA = getSortValue(a, key, getRating, { adjusted });
  const sortValueB = getSortValue(b, key, getRating, { adjusted });

  if (sortValueA === sortValueB) {
    const secondarySortValueA = getRating(a).calculatedTotal;
    const secondarySortValueB = getRating(b).calculatedTotal;

    if (secondarySortValueA < secondarySortValueB) {
      return sortOrder === 'bestOrNewestOnTop' ? 1 : -1;
    }
    if (secondarySortValueA > secondarySortValueB) {
      return sortOrder === 'bestOrNewestOnTop' ? -1 : 1;
    }
    return 0;
  }

  if (sortValueA < sortValueB) {
    return sortOrder === 'bestOrNewestOnTop' ? 1 : -1;
  }
  if (sortValueA > sortValueB) {
    return sortOrder === 'bestOrNewestOnTop' ? -1 : 1;
  }
  return 0;
}

/**
 * Does this term (loosely) appear in any library TITLE?
 *
 * detectFilterType's exact-entity cascade uses this as a guard: an exact
 * entity match can hijack a term that is also a title. "Alice" is Mary
 * Alice's surname (Malcolm X, Awakenings), so it committed as a person chip
 * that quietly matched her two films while three Alice-titled movies sat
 * unfound (report -P0Cx5UWJTGUo-o2S3EU). A general chip's local matching is
 * a superset of every structured chip's — exact keyword/genre, substring
 * cast/crew/company — so when the term matches any title, falling through
 * to general loses nothing and adds the titles back. Deliberately choosing
 * the person/genre/keyword reading stays possible through the typeahead,
 * which passes expectedType and skips the cascade entirely.
 *
 * Loose on both sides, same as the general matcher's title check, so a
 * run-together "spiderman" guards the same titles it would find.
 */
export function termMatchesAnyTitle (term, entries) {
  const loose = looseSearchText(term);
  if (!loose) return false;
  return (entries || []).some((entry) => {
    const title = entry?.movie?.title || '';
    const fields = entry?._search ?? {
      titleLoose: looseSearchText(title),
      titleNumerals: numeralTokens(title)
    };
    return titleMatchesValue(fields, term);
  });
}

// "A Trip to the Moon" and "trip to the moon" are the same name; a leading
// article is how English titles a thing, not part of what the thing is called.
// Stripped from the NORMALIZED (still-spaced) form so only a whole leading
// word goes — "A.I." normalizes without a space after the a and is untouched.
const LEADING_ARTICLE = /^(a|an|the) /;
const namedForm = (value) => looseSearchText(normalizeSearchText(value).replace(LEADING_ARTICLE, ''));

/**
 * Is this movie NAMED by one of the active filters — i.e. is a typed/general
 * filter's text this movie's TITLE?
 *
 * Exists for one purpose: rescuing shorts from the includeShorts=false
 * exclusion. That setting keeps 15-minute films out of browsing, stats and
 * entity counts, but it was also applied to search — so typing the exact
 * title of a short you'd rated found NOTHING ("A Trip to the Moon", "A Matter
 * of Loaf and Death"; report -P0Jz3pTqFQuw, 2026-08-30). A film you ask for
 * by name should never be hidden by a tidiness preference.
 *
 * NAMED means the whole name, forgiving a leading article on either side —
 * not a substring. The first version rescued on containment, and the very
 * next live test showed why that's wrong (Matt, 2026-08-31): searching "moon"
 * surfaced A Trip to the Moon with shorts hidden, and the toggle appeared
 * dead. "moon" is browsing; Matt's own words drew the line — "a trip to the
 * moon, WHICH IS THE NAME OF THE MOVIE." Substrings are what the toggle is
 * for; the name is what the rescue is for.
 *
 * Deliberately TITLE-only and GENERAL-only: a genre/person/decade chip is
 * browsing, and browsing is exactly what the setting is for.
 *
 * Loose comparison (punctuation/spacing-blind), same as the general matcher's
 * own title check, so "triptothemoon" run together still names it.
 */
export function titleNamedByFilters (result, filters) {
  const title = result?.movie?.title || '';
  if (!title) return false;
  const titleLoose = result?._search?.titleLoose ?? looseSearchText(title);
  const titleNamed = namedForm(title);
  const titleNumerals = result?._search?.titleNumerals ?? numeralTokens(title);
  const titleNumeralsNamed = numeralTokens(normalizeSearchText(title).replace(LEADING_ARTICLE, ''));
  return (filters || []).some((filter) => {
    if (filter?.type !== 'general') return false;
    const queryLoose = looseSearchText(filter.value);
    if (!queryLoose) return false;
    if (queryLoose === titleLoose || namedForm(filter.value) === titleNamed) return true;
    // Asked for by name, in the other spelling of its number: "9 to 5" names
    // the film stored as "Nine to Five" just as squarely. Whole name only —
    // the rescue this feeds is about naming a short, not browsing for one.
    const queryNumerals = numeralTokens(filter.value);
    const queryNumeralsNamed = numeralTokens(normalizeSearchText(filter.value).replace(LEADING_ARTICLE, ''));
    return (queryNumerals.length === titleNumerals.length && numeralTokensMatch(titleNumerals, queryNumerals)) ||
      (queryNumeralsNamed.length === titleNumeralsNamed.length && numeralTokensMatch(titleNumeralsNamed, queryNumeralsNamed));
  });
}

/**
 * How many ranked "Did you mean?" suggestions (best first) fit on one line
 * next to the "Did you mean?: " label, given the search input's rendered
 * width. A character-count estimate, not pixel-exact text measurement -
 * Home.vue's .did-you-mean-inline backstops this with CSS overflow:hidden +
 * text-overflow:ellipsis, so the real requirement here is "don't wildly
 * overshoot," not perfect precision. Always returns at least 1 (when there's
 * at least one candidate) rather than 0, even if that one term doesn't
 * perfectly fit - showing nothing isn't better than a truncated suggestion.
 */
export function countDidYouMeanSuggestionsThatFit (candidates, maxWidthPx, avgCharWidthPx = 6) {
  if (!candidates.length || !maxWidthPx) {
    return candidates.length ? 1 : 0;
  }

  let used = 'Did you mean?: '.length * avgCharWidthPx;
  let count = 0;

  for (const candidate of candidates) {
    const separatorChars = count > 0 ? 2 : 0; // ", "
    const termWidth = (candidate.value.length + separatorChars) * avgCharWidthPx;
    if (count > 0 && used + termWidth > maxWidthPx) {
      break;
    }
    used += termWidth;
    count += 1;
  }

  return Math.max(count, 1);
}
