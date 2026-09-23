import store from '../../store/index';
import { baseNormalized, applyNormalization } from './normalizationPicker.js';

// The library-wide score range that normalization stretches every rating
// across. allMediaRatingsArray is a cached Vuex getter - the same array
// object until movieLog changes - so its identity is the cache key. This
// used to be `Math.min(...allRatings)` / `Math.max(...allRatings)` INSIDE
// every getRating call: two spreads over the whole library (1,435 films) per
// score, and Insights asks for thousands of scores on open. Profiled at
// ~550ms of pure min/max on a desktop, ~2.7s at phone speed - the "tapping
// Insights takes forever" report (Matt, 2026-09-23), which read as an
// offline problem but had nothing to do with the network. The old
// module-level copy was also only refreshed when EMPTY, so the range went
// stale the moment a rating was added mid-session.
let rangeMemo = { ratings: undefined, min: undefined, max: undefined };

const scoreRange = () => {
  const ratings = store.getters.allMediaRatingsArray;
  if (ratings !== rangeMemo.ratings) {
    let min = Infinity;
    let max = -Infinity;
    for (const score of ratings) {
      // A NaN score (an entry with no calculatedTotal) is skipped rather
      // than poisoning the whole range, which is what the spread did.
      if (score < min) min = score;
      if (score > max) max = score;
    }
    rangeMemo = { ratings, min, max };
  }
  return rangeMemo;
};

// The raw weighted score alone — shared by the display path below and by
// anchor resolution (which must NOT recurse into normalization).
const rawCalculatedTotal = (rating) => {
  const tweakValue = parseFloat(rating.tweakValue || 0);

  const direction = store.getters.weight("direction") * parseFloat(rating.direction);
  const imagery = store.getters.weight("imagery") * parseFloat(rating.imagery);
  const love = store.getters.weight("love") * parseFloat(rating.love);
  const overall = store.getters.weight("overall") * (parseFloat(rating.overall) + tweakValue);
  const performance = store.getters.weight("performance") * parseFloat(rating.performance);
  const soundtrack = store.getters.weight("soundtrack") * parseFloat(rating.soundtrack);
  const story = store.getters.weight("story") * parseFloat(rating.story);

  let cleanStickiness = rating.stickiness;

  if ((!cleanStickiness || cleanStickiness > 5) && cleanStickiness !== 0) {
    cleanStickiness = parseFloat(rating.impression) || 1;
  }

  const stickiness = store.getters.weight("stickiness") * parseFloat(cleanStickiness);

  const total = direction + imagery + story + performance + soundtrack + love + overall + stickiness;
  // FOUR decimal places kept, TWO displayed (formatScore.js is the only
  // display path). Matt, 2026-08-21: "maintain scores to three decimal places
  // or even four... the additional decimal places that we track but don't
  // display would only really be there so that we could always sort in terms
  // of score... The score is the rank. We just need more precision."
  //
  // The arithmetic behind it: at 2dp the whole 0-10 range has 1,000 slots and
  // the library passed 1,379 films, so a fully tie-free ranking was
  // mathematically impossible - and the tiebreak tournament's ±0.01 nudges
  // (which land on the SECOND decimal) had to spend those same scarce slots,
  // often manufacturing a fresh tie as they broke one. At 4dp there are
  // 100,000 slots, and tournament nudges now land on the fourth decimal
  // (tweakDeltaForRank), invisible in every display but decisive in every
  // sort. Films whose criteria produce genuinely identical weighted sums
  // still tie exactly - that's what the tournament is for.
  return parseFloat((total / 10).toFixed(4));
};

// Rating-curve anchors (settings.normalizationAnchors = { ten, five } as
// dbKeys) resolved to 0-10 base positions. Memoized on the identity of the
// anchors object + movieLog + the score range — getRating runs per-movie in
// grids, so this must not re-resolve every call.
let anchorMemo = { anchors: undefined, movieLog: undefined, min: undefined, max: undefined, result: null };

const resolveAnchorBases = (minRating, maxRating) => {
  const anchors = store.state.settings.normalizationAnchors;
  const movieLog = store.state.movieLog;
  if (
    anchorMemo.anchors === anchors && anchorMemo.movieLog === movieLog &&
    anchorMemo.min === minRating && anchorMemo.max === maxRating
  ) {
    return anchorMemo.result;
  }

  const baseFor = (dbKey) => {
    if (!dbKey) return null;
    const entry = movieLog?.[dbKey];
    const recent = mostRecentRating(entry);
    if (!recent) return null;
    return baseNormalized(rawCalculatedTotal(recent), minRating, maxRating);
  };

  const result = anchors?.ten
    ? { tenBase: baseFor(anchors.ten), fiveBase: baseFor(anchors.five) }
    : null;
  anchorMemo = { anchors, movieLog, min: minRating, max: maxRating, result };
  return result;
};

const calculatePostStickyRatingFor = (rating) => {
  if (!rating) {
    return {
      calculatedTotal: 0
    };
  }

  const calculatedTotal = rawCalculatedTotal(rating);

  let normalizedRating;

  const { ratings: allRatings, min: minRating, max: maxRating } = scoreRange();

  if (allRatings.length && minRating !== Infinity) {
    if (maxRating !== minRating) {
      const base = baseNormalized(calculatedTotal, minRating, maxRating);
      const anchorBases = resolveAnchorBases(minRating, maxRating);
      normalizedRating = applyNormalization(base, {
        tweak: store.state.settings.normalizationTweak || 0.25,
        tenBase: anchorBases?.tenBase ?? null,
        fiveBase: anchorBases?.fiveBase ?? null
      });
    } else {
      // If maxRating and minRating are equal, set normalizedRating to a default value
      normalizedRating = 10; // or any other default value you prefer
    }
  }

  // Clamp the normalized rating between 0 and 10
  normalizedRating = Math.max(0, Math.min(10, normalizedRating));

  return {
    ...rating,
    calculatedTotal,
    normalizedRating
  };
}

const mostRecentRating = (media) => {
  if (!media?.ratings?.length) {
    return null;
  }

  let mostRecentRating = media.ratings[0];

  media.ratings.forEach((rating) => {
    if (!mostRecentRating?.date) {
      mostRecentRating = rating;
    } else if (rating.date && new Date(rating.date).getTime() > new Date(mostRecentRating.date).getTime()) {
      mostRecentRating = rating;
    }
  })

  return mostRecentRating;
}

export const getAllRatings = (dbEntry) => {
  if (!dbEntry || !dbEntry.ratings) {
    return null;
  }

  const ratings = dbEntry.ratings;

  if (!Array.isArray(ratings) || ratings.length === 0) {
    return null;
  }

  return ratings.map(calculatePostStickyRatingFor);
}

export const getRating = (dbEntry) => {
  const mostRecent = mostRecentRating(dbEntry);
  return calculatePostStickyRatingFor(mostRecent);
}

// The most recent rating's raw weighted total and nothing else: no
// normalization, so no dependency on the library-wide range. This is what
// the store's allMediaRatingsArray getter must use - that getter IS the
// range's input, and if it went through getRating it would read itself
// mid-computation (a Vue computed re-entered returns undefined). It is also
// the right thing for any sort comparator: calculatedTotal is the rank, and
// the normalization step is pure display.
export const rawScore = (dbEntry) => {
  const mostRecent = mostRecentRating(dbEntry);
  return mostRecent ? rawCalculatedTotal(mostRecent) : 0;
}