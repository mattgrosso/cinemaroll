// Which films are waiting for a stickiness score, and WHEN that becomes true.
//
// This existed three times over — Home.vue, StickinessInline.vue and (in its
// own shape) pushDigest.js — which is how the three drifted. It lives here
// so the prompt, the card and the push notification answer one question with
// one piece of code, and so `now` can be an ARGUMENT rather than a call to
// Date.now() buried inside a Vue computed.
//
// That last part is the whole point. Bug reports -P1Xo9Blv0-axmB4zrWL and
// -P1_e7pw0t5rtO7vlFj4 (2026-09-15): "I just got a notification that said
// that District 9 was ready for its stickiness rating. I tapped on that
// notification ... but did not show me District 9 or any notification on
// there, any banner about stickiness."
//
// The candidate list was a computed whose only reactive dependency was the
// entries array, while its actual answer also depended on the clock:
//
//     const moreThanAWeekAgo = ratingDate < new Date().getTime() - ONE_WEEK
//
// Vue caches a computed until a reactive dependency changes, and the wall
// clock is not one. So on an installed PWA that had been sitting in memory
// since before the film matured, the list stayed frozen at the empty value it
// had when the library last changed — and the push Lambda fires at the exact
// instant a film matures (District 9 crossed its six-month boundary at
// 15:19:36 and the push went out at 15:20:45). The tap focused a warm app
// holding a stale "nothing to do". Nothing short of a cold launch could
// dislodge it.
//
// Passing `now` in makes the staleness impossible to reintroduce silently:
// a caller has to supply a clock, and a reactive one re-runs the list.
//
// The two passes: a film is asked about a week after it was rated, and again
// six months after. SIX_MONTHS_MS is half a Julian year, the odd constant
// this feature has always used; it is kept exactly so no film's boundary
// moves under it.

export const ONE_WEEK_MS = 604800000;
export const SIX_MONTHS_MS = 15778476000;

// A missing date reads as 2021 — i.e. "long ago, so it's due". Ratings
// predate the field, and the alternative is a film that can never be asked
// about.
const MISSING_DATE_FALLBACK = '1/1/2021';

/**
 * The rating a stickiness question is about: the one with the latest date,
 * which is what GetRating.js resolves an entry to and therefore what the
 * prompt reads and writes back to.
 *
 * Exported because pushDigest.js has to pick the SAME rating. It used to
 * take the last element of the array instead, on the belief that the prompt
 * used favoriteTuning.js's mixin — the prompt does not; both Home.vue and
 * StickinessInline.vue define their own `mostRecentRating` that calls
 * getRating. On any rewatch logged out of date order the two picked
 * different ratings, so the push could name a film the prompt would never
 * ask about.
 */
export function mostRecentRatingOf (entry) {
  if (!entry?.ratings?.length) return null;

  return entry.ratings.reduce((winner, rating) => {
    if (!winner?.date) return rating;
    if (rating?.date && new Date(rating.date).getTime() > new Date(winner.date).getTime()) return rating;
    return winner;
  }, entry.ratings[0]);
}

export function ratingDateOf (rating) {
  return new Date(rating?.date || MISSING_DATE_FALLBACK).getTime();
}

/**
 * Is this rating waiting on either stickiness pass?
 *
 * Both are checked independently: a film that answered its one-week prompt
 * comes back six months later for the second, and one rated long enough ago
 * can be due for both at once (it is still a single entry in the queue).
 */
export function ratingNeedsStickiness (rating, now = Date.now()) {
  if (!rating) return false;

  const ratedAt = ratingDateOf(rating);
  if (!Number.isFinite(ratedAt)) return false;

  const needsWeek = !rating.userAddedStickiness && ratedAt < now - ONE_WEEK_MS;
  const needsSixMonths = !rating.userAddedSixMonthStickiness && ratedAt < now - SIX_MONTHS_MS;

  return needsWeek || needsSixMonths;
}

/**
 * When an entry that is NOT yet due becomes due — the earliest boundary it
 * is still waiting on, or null if it is due already or waiting on nothing.
 * Deliberately the earliest and only the earliest: a film waiting on both
 * passes is one row in the prompt, so emitting both boundaries would let a
 * caller count the same film twice.
 */
export function nextStickinessDueAt (rating, now = Date.now()) {
  if (!rating) return null;

  const ratedAt = ratingDateOf(rating);
  if (!Number.isFinite(ratedAt)) return null;

  const boundaries = [];
  if (!rating.userAddedStickiness) boundaries.push(ratedAt + ONE_WEEK_MS);
  if (!rating.userAddedSixMonthStickiness) boundaries.push(ratedAt + SIX_MONTHS_MS);

  const next = Math.min(...boundaries.filter((at) => at > now));
  return Number.isFinite(next) ? next : null;
}

/**
 * The prompt's queue: every entry waiting on a stickiness score, most
 * recently rated first.
 *
 * `ratingOf` picks the rating to judge an entry by — the components pass
 * GetRating.js's date-max reading, which is also what they then write back
 * to. It is called ONCE per entry and the result carried through the sort,
 * because getRating is uncached and moderately expensive and this runs over
 * the whole library (CLAUDE.md: never call it inside a sort comparator —
 * the old inline copies of this did exactly that, five times per entry).
 */
export function stickinessCandidates (entries, { ratingOf, now = Date.now() } = {}) {
  if (!Array.isArray(entries) || typeof ratingOf !== 'function') return [];

  return entries
    .map((entry) => ({ entry, rating: ratingOf(entry) }))
    .filter(({ rating }) => ratingNeedsStickiness(rating, now))
    .sort((a, b) => ratingDateOf(b.rating) - ratingDateOf(a.rating))
    .map(({ entry }) => entry);
}
