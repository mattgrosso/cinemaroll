// Deep Stats — the engine behind /stats (adopted and adapted from Brian's
// Movie Log after a full survey of his Stats suite, 2026-08-15). Pure and
// store-free; every section returns plain data a screen can render.
// Group scoring uses the Log Score (logScore.js) throughout.

import { logScore, globalAverage } from './logScore.js';
import { findTiedGroup } from './tieBreakTournament.js';
import { isShortEntry } from './shorts.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

function mostRecent (entry) {
  const ratings = entry?.ratings || [];
  let best = null;
  ratings.forEach((rating) => {
    const time = new Date(rating?.date ?? NaN).getTime();
    if (!Number.isFinite(time)) return;
    if (!best || time > best.time) best = { rating, time };
  });
  return best;
}

function viewingTimes (entry) {
  return (entry?.ratings || [])
    .map((rating) => new Date(rating?.date ?? NaN).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// The Crown: walk release years oldest-first; each film that beats the
// all-time-high rating takes the crown and reigns until dethroned.
export function crownTimeline (entries, getRatingFn, now = Date.now()) {
  const dated = (entries || [])
    .map((entry) => {
      const rating = getRatingFn(entry)?.calculatedTotal;
      const year = new Date(entry?.movie?.release_date ?? NaN).getFullYear();
      if (!Number.isFinite(rating) || !Number.isFinite(year)) return null;
      return { entry, rating, year };
    })
    .filter(Boolean)
    .sort((a, b) => (a.year - b.year) || (b.rating - a.rating));

  const reigns = [];
  let high = -Infinity;
  dated.forEach(({ entry, rating, year }) => {
    if (rating > high) {
      high = rating;
      if (reigns.length) reigns[reigns.length - 1].until = year;
      reigns.push({ entry, rating, year, until: null });
    }
  });

  const nowYear = new Date(now).getFullYear();
  return reigns.map((reign, index) => ({
    ...reign,
    current: index === reigns.length - 1,
    reignYears: (reign.until ?? nowYear) - reign.year
  }));
}

// ---------------------------------------------------------------------------
// The Pantheon: every film with a perfect mark in any rating category, from
// its most recent viewing. Cinema Roll's criteria and their perfect values.
const PANTHEON_CATEGORIES = [
  { key: 'direction', label: 'Direction', perfect: 10 },
  { key: 'imagery', label: 'Imagery', perfect: 10 },
  { key: 'story', label: 'Story', perfect: 10 },
  { key: 'performance', label: 'Performance', perfect: 10 },
  { key: 'soundtrack', label: 'Soundtrack', perfect: 10 },
  { key: 'overall', label: 'Overall', perfect: 10 },
  { key: 'love', label: 'Love', perfect: 5 },
  { key: 'stickiness', label: 'Stickiness', perfect: 5 }
];

export function pantheon (entries, getRatingFn) {
  const categories = PANTHEON_CATEGORIES.map((category) => ({ ...category, films: [] }));
  const perFilmCounts = new Map();

  (entries || []).forEach((entry) => {
    const recent = mostRecent(entry);
    if (!recent) return;
    const total = getRatingFn(entry)?.calculatedTotal ?? null;
    categories.forEach((category) => {
      if (Number(recent.rating[category.key]) === category.perfect) {
        category.films.push({ entry, rating: total });
        perFilmCounts.set(entry, (perFilmCounts.get(entry) || 0) + 1);
      }
    });
  });

  categories.forEach((category) => category.films.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0)));

  // Constellations: films perfect in 2+ categories, most stars first.
  const constellations = [...perFilmCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([entry, count]) => ({ entry, count }))
    .sort((a, b) => b.count - a.count);

  return {
    categories: categories.filter((category) => category.films.length),
    constellations,
    perfectFilms: perFilmCounts.size,
    totalMarks: [...perFilmCounts.values()].reduce((a, b) => a + b, 0)
  };
}

// ---------------------------------------------------------------------------
// Rewatches: return engagements and how long they take.
export function rewatchStats (entries) {
  let repeatViewings = 0;
  const revisited = [];
  const gaps = [];
  const quickest = [];
  let totalFilms = 0;

  (entries || []).forEach((entry) => {
    const times = viewingTimes(entry);
    if (!times.length) return;
    totalFilms += 1;
    if (times.length < 2) return;
    repeatViewings += times.length - 1;
    revisited.push({ entry, viewings: times.length });
    let minGap = Infinity;
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      gaps.push(gap);
      if (gap < minGap) minGap = gap;
    }
    quickest.push({ entry, gapMs: minGap, gapDays: minGap / DAY_MS });
  });

  if (!revisited.length) return null;

  const sortedGaps = [...gaps].sort((a, b) => a - b);
  const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];

  return {
    repeatViewings,
    filmsRevisited: revisited.length,
    rewatchRate: revisited.length / totalFilms,
    medianReturnYears: medianGap / YEAR_MS,
    mostRewatched: revisited.sort((a, b) => b.viewings - a.viewings).slice(0, 12),
    quickestReturns: [...quickest].sort((a, b) => a.gapMs - b.gapMs).slice(0, 12),
    // "We should add one that has the longest times between re-watches. We
    // already have shortest times." (2026-08-17) Same candidates, other end.
    longestReturns: [...quickest].sort((a, b) => b.gapMs - a.gapMs).slice(0, 12)
  };
}

// ---------------------------------------------------------------------------
// Marathon Club: greatest runs by day / week / month, plus lifetime totals.
function periodKeys (time) {
  const date = new Date(time);
  const day = date.toDateString();
  const oneJan = new Date(date.getFullYear(), 0, 1);
  const week = `${date.getFullYear()}-w${Math.ceil(((date - oneJan) / DAY_MS + oneJan.getDay() + 1) / 7)}`;
  const month = `${date.getFullYear()}-${date.getMonth()}`;
  return { day, week, month };
}

export function marathonStats (entries, { includeShorts = false, topDays = 3 } = {}) {
  const byDay = new Map();
  const byWeek = new Map();
  const byMonth = new Map();
  let admissions = 0;
  let screenMinutes = 0;

  (entries || []).forEach((entry) => {
    const runtime = entry?.movie?.runtime;
    if (!includeShorts && isShortEntry(entry)) return;
    viewingTimes(entry).forEach((time) => {
      admissions += 1;
      if (Number.isFinite(runtime) && runtime > 0) screenMinutes += runtime;
      const { day, week, month } = periodKeys(time);
      [[byDay, day], [byWeek, week], [byMonth, month]].forEach(([map, key]) => {
        const bucket = map.get(key) || { count: 0, minutes: 0, entries: [], time };
        bucket.count += 1;
        bucket.minutes += Number.isFinite(runtime) && runtime > 0 ? runtime : 0;
        bucket.entries.push(entry);
        map.set(key, bucket);
      });
    });
  });

  if (!admissions) return null;

  const recordOf = (map) => [...map.values()].sort((a, b) => (b.count - a.count) || (b.minutes - a.minutes))[0];
  const biggestDays = [...byDay.entries()]
    .map(([day, bucket]) => ({ day, ...bucket }))
    .sort((a, b) => (b.count - a.count) || (b.minutes - a.minutes))
    .slice(0, topDays);

  return {
    admissions,
    screenMinutes,
    movieDays: byDay.size,
    activeWeeks: byWeek.size,
    activeMonths: byMonth.size,
    dayRecord: recordOf(byDay),
    weekRecord: recordOf(byWeek),
    monthRecord: recordOf(byMonth),
    topDays: biggestDays
  };
}

// ---------------------------------------------------------------------------
// Activity years: what you watched each calendar year, log-scored.
export function yearStats (entries, getRatingFn, weights) {
  const globalAvg = globalAverage(entries, getRatingFn);
  const byYear = new Map();

  (entries || []).forEach((entry) => {
    const recent = mostRecent(entry);
    if (!recent) return;
    const watchYear = new Date(recent.time).getFullYear();
    const releaseYear = new Date(entry?.movie?.release_date ?? NaN).getFullYear();
    const rating = getRatingFn(entry)?.calculatedTotal;
    const bucket = byYear.get(watchYear) || { watched: [], fromYear: 0 };
    bucket.watched.push({ entry, rating });
    if (releaseYear === watchYear) bucket.fromYear += 1;
    byYear.set(watchYear, bucket);
  });

  return [...byYear.entries()]
    .map(([year, bucket]) => {
      const scores = bucket.watched.map((w) => w.rating).filter(Number.isFinite);
      const top = [...bucket.watched].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
      return {
        year,
        watched: bucket.watched.length,
        fromYear: bucket.fromYear,
        score: logScore(scores, globalAvg, weights),
        top: top?.entry || null
      };
    })
    .sort((a, b) => b.year - a.year);
}

// ---------------------------------------------------------------------------
// Genres, ranked by log score.
export function genreStats (entries, getRatingFn, weights, { minCount = 3, cap = 8, perGenre = 5 } = {}) {
  const globalAvg = globalAverage(entries, getRatingFn);
  const byGenre = new Map();

  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    if (!Number.isFinite(rating)) return;
    (entry?.movie?.genres || []).forEach((genre) => {
      if (!genre?.name) return;
      const bucket = byGenre.get(genre.name) || [];
      bucket.push({ entry, rating });
      byGenre.set(genre.name, bucket);
    });
  });

  return [...byGenre.entries()]
    .filter(([, films]) => films.length >= minCount)
    .map(([name, films]) => ({
      name,
      count: films.length,
      score: logScore(films.map((f) => f.rating), globalAvg, weights),
      top: [...films].sort((a, b) => b.rating - a.rating).slice(0, perGenre).map((f) => f.entry)
    }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, cap);
}
// ---------------------------------------------------------------------------
// Standouts
// ---------------------------------------------------------------------------

/**
 * The things you rate unusually highly — across every facet at once, not just
 * genres. Matt, 2026-08-16: "it'd be cool to find outliers around, like,
 * things that have unusually high log scores. Not just genres, but keywords
 * and directors and all that stuff... that would be an interesting pantheon."
 *
 * Ranked by LIFT, not by log score. Log score rewards depth, so ranking by it
 * puts Drama, Comedy and "the 1990s" on top — which is just a restatement of
 * which categories are biggest, and tells you nothing you didn't know. What
 * makes something a standout is that you rate it unusually WELL.
 *
 * Lift is a Bayesian-adjusted mean minus your global average: each facet's
 * average is pulled toward the global one in proportion to how little
 * evidence there is, so eight films at 9.5 survives the adjustment while one
 * film at 10 does not. That is the same shrinkage Log Score uses for the same
 * reason — it just isn't also rewarding size here.
 *
 * The log score rides along for display, because "how good is this corner of
 * the library outright" is a fair second question.
 */
export function standouts (entries, getRatingFn, weights, { minCount = 4, perFacet = null, perType = 3, cap = 12 } = {}) {
  const globalAvg = globalAverage(entries, getRatingFn);
  if (!Number.isFinite(globalAvg)) return [];

  // "facet value" -> { facet, value, films: [{ entry, rating }] }
  const buckets = new Map();
  const add = (facet, value, entry, rating) => {
    if (!value) return;
    const key = facet + ' ' + value;
    const bucket = buckets.get(key) || { facet, value, films: [] };
    bucket.films.push({ entry, rating });
    buckets.set(key, bucket);
  };

  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    if (!Number.isFinite(rating)) return;
    const movie = entry?.movie || {};

    (movie.genres || []).forEach((genre) => add('genre', genre?.name, entry, rating));
    (movie.keywords || []).forEach((keyword) => add('keyword', keyword?.name, entry, rating));
    (movie.production_companies || []).forEach((company) => add('studio', company?.name, entry, rating));

    // Crew is matched by JOB, never by position: TMDB orders crew by
    // department, so a composer routinely sits well past index ten.
    (movie.crew || []).forEach((person) => {
      if (!person?.name) return;
      if (person.job === 'Director') add('director', person.name, entry, rating);
      else if (person.job === 'Original Music Composer' || person.job === 'Music') add('composer', person.name, entry, rating);
      else if (person.job === 'Director of Photography') add('cinematographer', person.name, entry, rating);
    });

    // Top billing only: the whole cast list would make every big film's
    // twentieth-billed actor a facet of its own.
    (movie.cast || []).slice(0, 5).forEach((person) => add('actor', person?.name, entry, rating));

    const year = new Date(movie.release_date ?? NaN).getFullYear();
    if (Number.isFinite(year)) add('decade', String(Math.floor(year / 10) * 10) + 's', entry, rating);
  });

  // The same prior Log Score uses: how many films of evidence it takes before
  // a facet's own average outweighs your global one.
  const prior = Number.isFinite(weights?.bayesianWeight) && weights.bayesianWeight > 0
    ? weights.bayesianWeight
    : 7;

  const scored = [...buckets.values()]
    .filter((bucket) => bucket.films.length >= minCount)
    .map((bucket) => {
      const ratings = bucket.films.map((film) => film.rating);
      const total = ratings.reduce((sum, value) => sum + value, 0);
      const adjusted = (globalAvg * prior + total) / (prior + ratings.length);

      return {
        facet: bucket.facet,
        value: bucket.value,
        count: bucket.films.length,
        score: logScore(ratings, globalAvg, weights),
        mean: Math.round((total / ratings.length) * 100) / 100,
        lift: Math.round((adjusted - globalAvg) * 100) / 100,
        // Every matching film, not a sample of them: the card says "11 rated"
        // and then showed six, which reads as a bug — "you're listing more
        // movies than you're showing. It should just be a horizontally
        // scrolling list of all the movies that match that specific thing"
        // (2026-08-17). The row already scrolls sideways, so length is free.
        top: (perFacet
          ? [...bucket.films].sort((a, b) => b.rating - a.rating).slice(0, perFacet)
          : [...bucket.films].sort((a, b) => b.rating - a.rating)
        ).map((film) => film.entry)
      };
    })
    .filter((bucket) => Number.isFinite(bucket.lift));

  // Capped per facet type, because TMDB tags films with far more keywords
  // than anything else: ranked purely by lift, sixteen of twenty-four slots
  // came back as keywords and the directors, actors and studios never
  // surfaced at all. The variety is the point of ranging over every facet.
  const perTypeCount = new Map();
  return scored
    .sort((a, b) => b.lift - a.lift)
    .filter((bucket) => {
      const seen = perTypeCount.get(bucket.facet) || 0;
      if (seen >= perType) return false;
      perTypeCount.set(bucket.facet, seen + 1);
      return true;
    })
    .slice(0, cap);
}

// Ties across the whole library (bug report, 2026-09-06: "Would be cool if I
// could see how many ties there are in the whole database").
//
// A tie is EXACT equality of calculatedTotal, fourth decimal included — the
// same `===` the tiebreak tournament uses (findTiedGroup), not a two-decimal
// look-alike: scores are kept at 4dp precisely so that films showing the same
// 7.16 can still be ordered. Two films that only match at 2dp are not tied,
// and the tournament would never offer them.
//
// `next` is literally what the tournament would take up next — the highest-
// scoring tie — computed by the tournament's own walker so the two screens
// can never disagree about it.
export function tieStats (entries, getRatingFn, { cap = 8 } = {}) {
  // Score once, then group — getRating in a comparator is the documented
  // perf trap (CLAUDE.md).
  const scored = (entries || [])
    .map((entry) => ({ entry, score: getRatingFn(entry)?.calculatedTotal }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => (b.score - a.score) || String(a.entry.movie?.title || '').localeCompare(String(b.entry.movie?.title || '')));
  if (!scored.length) return null;

  const byScore = new Map();
  scored.forEach(({ entry, score }) => {
    if (!byScore.has(score)) byScore.set(score, []);
    byScore.get(score).push(entry);
  });
  const groups = [...byScore.entries()]
    .filter(([, films]) => films.length > 1)
    .map(([score, films]) => ({ score, films }));
  if (!groups.length) return null;

  const tiedFilms = groups.reduce((sum, group) => sum + group.films.length, 0);
  const next = findTiedGroup(scored, (item) => item.score);
  const bySize = [...groups].sort((a, b) => (b.films.length - a.films.length) || (b.score - a.score));

  return {
    tiedFilms,
    groups: groups.length,
    largest: bySize[0].films.length,
    share: tiedFilms / scored.length,
    next: { score: next[0].score, films: next.map((item) => item.entry) },
    biggest: bySize.slice(0, cap)
  };
}
