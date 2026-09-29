// Year in Review: what one particular year of watching looked like.
//
// Deliberately NOT the same job as deepStats.js. That page interrogates the
// whole library and asks what's true of it overall; this one asks what was
// true of a single year, and the interesting questions are different — the
// rhythm of it, what was unusual about it, how it compared to the year before.
//
// The unit here is a VIEWING, not a film. A film watched twice in a year is
// two viewings and belongs to both months it was seen in. The old page mixed
// the two units — it counted films for the headline and viewings for the
// monthly chart, so the bars could add up to more than the total above them.
//
// This module owns that viewing-level model, so anything else needing it
// imports from here: Insights uses `allViewings` + `calendarCoverage` for the
// all-time version of the heatmap.

import { isShort } from './shorts.js';

/** Ratings store `date` as an epoch-ms number or a string of one. */
function timeOf (rating) {
  if (rating?.date == null) return null;
  const ms = typeof rating.date === 'number' ? rating.date : parseInt(rating.date, 10);
  return Number.isFinite(ms) ? ms : null;
}

/** Local midnight, so a viewing lands on the day the user experienced it. */
function dayKey (ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function releaseYearOf (movie) {
  const year = new Date(movie?.release_date ?? NaN).getFullYear();
  return Number.isFinite(year) ? year : null;
}

/**
 * Every viewing you have ever recorded, oldest first.
 *
 * The page needs this year, last year and all-time, and `getAllRatingsFn`
 * re-normalizes every rating it touches — so it walks the library once here
 * and filters, rather than three times.
 *
 * `getAllRatingsFn` is injected rather than imported so this module stays
 * store-free and directly testable — the same reason searchFiltering.js and
 * the games modules live out here.
 */
export function allViewings (entries, getAllRatingsFn, { includeShorts = false } = {}) {
  const viewings = [];

  (entries || []).forEach((entry) => {
    const movie = entry?.movie;
    if (!movie) return;
    if (!includeShorts && isShort(movie)) return;

    const rated = getAllRatingsFn(entry) || [];
    rated.forEach((rating) => {
      const at = timeOf(rating);
      if (at === null) return;

      viewings.push({
        entry,
        movie,
        dbKey: entry.dbKey,
        at,
        year: new Date(at).getFullYear(),
        day: dayKey(at),
        score: Number.isFinite(rating?.calculatedTotal) ? rating.calculatedTotal : null,
        runtime: Number.isFinite(movie.runtime) ? movie.runtime : null,
        releaseYear: releaseYearOf(movie)
      });
    });
  });

  return viewings.sort((a, b) => a.at - b.at);
}

/** Every viewing that happened in `year`, oldest first. */
export function viewingsInYear (entries, getAllRatingsFn, year, options = {}) {
  return allViewings(entries, getAllRatingsFn, options).filter((viewing) => viewing.year === year);
}

/** The first and last thing you watched all year. */
export function bookends (viewings) {
  if (!viewings?.length) return null;
  return { first: viewings[0], last: viewings[viewings.length - 1] };
}

/**
 * One year laid out as twelve month rows by day-of-month — the same shape as
 * `calendarCoverage`'s all-time grid, so both heatmaps read alike and both
 * fit a phone without scrolling sideways.
 *
 * This replaced a 7-row-by-53-column contribution graph. That layout is the
 * conventional one and it was accurate, but it ran wider than the screen, and
 * Matt preferred the Insights shape once he'd seen it: "I like how you got the
 * whole calendar on the one screen without scrolling... let's do that also on
 * the Year in Review and imitate that shape" (2026-08-17).
 *
 * Days that haven't happened yet are marked `future` rather than counted as
 * days you watched nothing — in August, an empty November is not a fact about
 * your viewing.
 */
export function calendarGrid (viewings, year, now = Date.now()) {
  const counts = new Map();
  (viewings || []).forEach((viewing) => {
    counts.set(viewing.day, (counts.get(viewing.day) || 0) + 1);
  });

  const today = new Date(now);
  let busiest = 0;

  const months = Array.from({ length: 12 }, (unused, month) => {
    // Day 0 of the next month is the last day of this one, which gets
    // February right in a leap year without a special case.
    const length = new Date(year, month + 1, 0).getDate();

    return {
      month,
      days: Array.from({ length }, (unused2, index) => {
        const day = index + 1;
        const date = new Date(year, month, day);
        const count = counts.get(dayKey(date.getTime())) || 0;
        if (count > busiest) busiest = count;

        return { month, day, count, future: date > today };
      })
    };
  });

  return { months, busiest, watchedDays: counts.size };
}

/** Twelve months, each with its count and the best thing you saw in it. */
export function monthlyBests (viewings) {
  const months = Array.from({ length: 12 }, (unused, index) => ({
    month: index,
    count: 0,
    minutes: 0,
    best: null
  }));

  (viewings || []).forEach((viewing) => {
    const month = months[new Date(viewing.at).getMonth()];
    month.count += 1;
    month.minutes += viewing.runtime || 0;
    if (viewing.score !== null && (!month.best || viewing.score > month.best.score)) {
      month.best = viewing;
    }
  });

  return months;
}

/**
 * The longest run of consecutive days with a film, and the longest gap
 * without one. Both are bounded by the year, so a drought that started in
 * December is measured to New Year's Eve and no further.
 */
export function streaks (viewings, year, now = Date.now()) {
  if (!viewings?.length) return null;

  const days = [...new Set(viewings.map((viewing) => viewing.day))].sort();
  const asDate = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const DAY = 24 * 60 * 60 * 1000;
  const gapBetween = (a, b) => Math.round((asDate(b) - asDate(a)) / DAY);

  let best = { length: 1, from: days[0], to: days[0] };
  let run = { length: 1, from: days[0], to: days[0] };
  let drought = { length: 0, from: null, to: null };

  for (let i = 1; i < days.length; i++) {
    const gap = gapBetween(days[i - 1], days[i]);
    if (gap === 1) {
      run = { length: run.length + 1, from: run.from, to: days[i] };
      if (run.length > best.length) best = { ...run };
    } else {
      if (gap - 1 > drought.length) drought = { length: gap - 1, from: days[i - 1], to: days[i] };
      run = { length: 1, from: days[i], to: days[i] };
    }
  }

  // The year's own edges count as droughts too: a year that opened with a
  // six-week silence had a six-week silence, whether or not it ends in one.
  const jan1 = dayKey(new Date(year, 0, 1).getTime());
  const leadIn = gapBetween(jan1, days[0]);
  if (leadIn > drought.length) drought = { length: leadIn, from: jan1, to: days[0] };

  // An unfinished year is measured to today, not to a December 31st that
  // hasn't happened — otherwise every current year reports a huge fake drought.
  const endOfYear = new Date(year, 11, 31);
  const edge = new Date(now) < endOfYear ? new Date(now) : endOfYear;
  const tail = gapBetween(days[days.length - 1], dayKey(edge.getTime()));
  if (tail > drought.length) drought = { length: tail, from: days[days.length - 1], to: dayKey(edge.getTime()) };

  return { longest: best, drought: drought.length ? drought : null, watchedDays: days.length };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Which day of the week you actually watch films on. */
export function weekdayPattern (viewings) {
  const counts = WEEKDAYS.map((name, index) => ({ name, index, count: 0 }));
  (viewings || []).forEach((viewing) => {
    counts[new Date(viewing.at).getDay()].count += 1;
  });

  const total = counts.reduce((sum, day) => sum + day.count, 0);
  const top = [...counts].sort((a, b) => b.count - a.count)[0];
  return {
    days: counts,
    busiest: total ? top : null,
    // The share the top day takes, for "you are a Friday person" phrasing.
    share: total ? Math.round((top.count / total) * 100) : 0
  };
}

/**
 * New releases versus everything else. The point being that "how much of
 * this year did you spend in this year" is a real question about taste.
 */
export function releaseSpread (viewings, year) {
  const dated = (viewings || []).filter((viewing) => viewing.releaseYear !== null);
  if (!dated.length) return null;

  const decades = new Map();
  let thisYear = 0;
  let oldest = dated[0];

  dated.forEach((viewing) => {
    if (viewing.releaseYear === year) thisYear += 1;
    if (viewing.releaseYear < oldest.releaseYear) oldest = viewing;
    const decade = Math.floor(viewing.releaseYear / 10) * 10;
    decades.set(decade, (decades.get(decade) || 0) + 1);
  });

  return {
    thisYear,
    catalogue: dated.length - thisYear,
    total: dated.length,
    currentShare: Math.round((thisYear / dated.length) * 100),
    oldest,
    span: dated.length ? Math.max(...dated.map((v) => v.releaseYear)) - oldest.releaseYear : 0,
    decades: [...decades.entries()]
      .map(([decade, count]) => ({ decade, label: `${decade}s`, count }))
      .sort((a, b) => a.decade - b.decade)
  };
}

/** Films seen for the first time this year, versus ones you came back to. */
export function discoveryMix (viewings, getAllRatingsFn) {
  const firstTime = [];
  const revisits = [];
  const seen = new Set();

  (viewings || []).forEach((viewing) => {
    const rated = getAllRatingsFn(viewing.entry) || [];
    const earlier = rated.some((rating) => {
      const at = timeOf(rating);
      return at !== null && at < viewing.at;
    });
    // A film watched twice this year is one discovery and one revisit.
    if (earlier || seen.has(viewing.dbKey)) revisits.push(viewing);
    else firstTime.push(viewing);
    seen.add(viewing.dbKey);
  });

  return { firstTime, revisits };
}

/**
 * What made this year different from your usual: the genres, directors and
 * keywords you leaned into far harder than you normally do.
 *
 * Over-representation, not rating — "you watched three times as much horror
 * as usual" is a fact about the year, where "you rate horror highly" is a
 * fact about you and already lives on Deep Stats. A facet has to clear a
 * minimum count so a single film can't produce an infinite ratio.
 */
export function yearSignature (viewings, allViewings, { minCount = 3, cap = 6 } = {}) {
  const tally = (list) => {
    const counts = new Map();
    (list || []).forEach((viewing) => {
      const movie = viewing.movie || {};
      // Each bucket carries its own facet and value: splitting a joined key
      // back apart truncates every multi-word one ("based on novel or book").
      const add = (facet, value) => {
        if (!value) return;
        const key = `${facet} ${value}`;
        const bucket = counts.get(key) || { facet, value, count: 0 };
        bucket.count += 1;
        counts.set(key, bucket);
      };
      (movie.genres || []).forEach((genre) => add('genre', genre?.name));
      (movie.keywords || []).forEach((keyword) => add('keyword', keyword?.name));
      (movie.crew || []).forEach((person) => {
        if (person?.job === 'Director') add('director', person.name);
      });
      const decade = viewing.releaseYear === null ? null : `${Math.floor(viewing.releaseYear / 10) * 10}s`;
      add('decade', decade);
    });
    return counts;
  };

  const yearCounts = tally(viewings);
  const allCounts = tally(allViewings);
  const yearTotal = (viewings || []).length;
  const allTotal = (allViewings || []).length;
  if (!yearTotal || !allTotal) return [];

  const signals = [];
  yearCounts.forEach((bucket, key) => {
    if (bucket.count < minCount) return;
    const yearShare = bucket.count / yearTotal;
    const lifetimeShare = (allCounts.get(key)?.count || 0) / allTotal;
    if (!lifetimeShare) return;

    const ratio = yearShare / lifetimeShare;
    if (ratio <= 1) return;
    signals.push({
      facet: bucket.facet,
      value: bucket.value,
      count: bucket.count,
      ratio: Math.round(ratio * 10) / 10,
      yearShare: Math.round(yearShare * 1000) / 10
    });
  });

  // Capped per facet type for the same reason Standouts is: TMDB tags films
  // with far more keywords than anything else, so keywords win on volume.
  const perType = new Map();
  return signals
    .sort((a, b) => b.ratio - a.ratio || b.count - a.count)
    .filter((signal) => {
      const seen = perType.get(signal.facet) || 0;
      if (seen >= 2) return false;
      perType.set(signal.facet, seen + 1);
      return true;
    })
    .slice(0, cap);
}

/** The extremes of the year, each one a viewing you can tap through to. */
export function superlatives (viewings) {
  const list = viewings || [];
  if (!list.length) return {};

  const pick = (candidates, better) => candidates.reduce((best, viewing) => (
    !best || better(viewing, best) ? viewing : best
  ), null);

  const scored = list.filter((viewing) => viewing.score !== null);
  const timed = list.filter((viewing) => viewing.runtime);
  const dated = list.filter((viewing) => viewing.releaseYear !== null);

  return {
    best: pick(scored, (a, b) => a.score > b.score),
    worst: pick(scored, (a, b) => a.score < b.score),
    longest: pick(timed, (a, b) => a.runtime > b.runtime),
    shortest: pick(timed, (a, b) => a.runtime < b.runtime),
    oldest: pick(dated, (a, b) => a.releaseYear < b.releaseYear)
  };
}

/**
 * This year against last year, for the handful of numbers worth comparing.
 *
 * `throughDate` trims last year to the same point on the calendar. Without
 * it, a year still in progress is compared against a complete one, and every
 * delta reads negative for no reason but the date — an August 2026 is always
 * going to have fewer films in it than the whole of 2025.
 */
export function versusPreviousYear (viewings, previousViewings, { throughDate = null } = {}) {
  let comparable = previousViewings || [];
  let partial = false;

  if (throughDate) {
    const edge = new Date(throughDate);
    // The same month and day, one year earlier, to the end of that day.
    const cutoff = new Date(
      edge.getFullYear() - 1, edge.getMonth(), edge.getDate(), 23, 59, 59, 999
    ).getTime();
    const trimmed = comparable.filter((viewing) => viewing.at <= cutoff);
    partial = trimmed.length !== comparable.length;
    comparable = trimmed;
  }

  const summarize = (list) => {
    const scored = (list || []).filter((viewing) => viewing.score !== null);
    return {
      count: (list || []).length,
      minutes: (list || []).reduce((sum, viewing) => sum + (viewing.runtime || 0), 0),
      average: scored.length
        ? Math.round((scored.reduce((sum, v) => sum + v.score, 0) / scored.length) * 100) / 100
        : null
    };
  };

  const now = summarize(viewings);
  const before = summarize(comparable);
  if (!before.count) return null;

  const delta = (a, b) => (a === null || b === null ? null : Math.round((a - b) * 100) / 100);
  return {
    now,
    before,
    partial,
    countDelta: now.count - before.count,
    minutesDelta: now.minutes - before.minutes,
    averageDelta: delta(now.average, before.average)
  };
}

/** The rating spread of the year, in whole-number buckets. */
export function scoreShape (viewings) {
  const buckets = Array.from({ length: 11 }, (unused, index) => ({ score: index, count: 0 }));
  let scored = 0;

  (viewings || []).forEach((viewing) => {
    if (viewing.score === null) return;
    buckets[Math.max(0, Math.min(10, Math.round(viewing.score)))].count += 1;
    scored += 1;
  });

  const peak = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  return { buckets, scored, peak };
}

// ---------------------------------------------------------------------------
// All-time calendar coverage
// ---------------------------------------------------------------------------

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Every calendar DATE — Jan 1 through Dec 31 — collapsed across all the years
 * you've been watching. Matt, 2026-08-17: "it'd be cool to see if there's any
 * specific dates that I have yet to watch a movie on."
 *
 * So this is deliberately not the year heatmap's grid. That one is 7 rows of
 * weekdays because it shows one real year; a date's weekday moves from year to
 * year, so collapsing years onto a weekday grid would be meaningless. This is
 * 12 rows of months by day-of-month, which is what "which dates" actually asks.
 *
 * Feb 29 is included and counted honestly: it only comes round every fourth
 * year, so an empty one says much less than an empty March 3rd. `rare` marks it
 * so the caller can say so rather than listing it as an ordinary gap.
 */
export function calendarCoverage (viewings) {
  const counts = new Map();
  const years = new Set();

  (viewings || []).forEach((viewing) => {
    const date = new Date(viewing.at);
    counts.set(
      `${date.getMonth()}-${date.getDate()}`,
      (counts.get(`${date.getMonth()}-${date.getDate()}`) || 0) + 1
    );
    years.add(date.getFullYear());
  });

  let busiest = 0;
  let covered = 0;
  const missing = [];

  const months = DAYS_IN_MONTH.map((length, month) => ({
    month,
    days: Array.from({ length }, (unused, index) => {
      const day = index + 1;
      const count = counts.get(`${month}-${day}`) || 0;
      const rare = month === 1 && day === 29;

      if (count > busiest) busiest = count;
      if (count) covered += 1;
      else missing.push({ month, day, rare });

      return { month, day, count, rare };
    })
  }));

  const total = DAYS_IN_MONTH.reduce((sum, length) => sum + length, 0);
  return {
    months,
    busiest,
    covered,
    total,
    missing,
    years: years.size,
    percent: Math.round((covered / total) * 100)
  };
}
