// You or the Crowd? (2026-09-29, Matt: "it would also be fun to be able to
// guess if I rated a movie higher or if they did"). One film from the
// library at a time: did you score it higher than the Letterboxd crowd did,
// or did they? Pure and store-free; the component only renders.
//
// "Higher" is by SCORE, on the crowd's star scale: your normalised rating
// halved — the stars ToggleableRating shows — against Letterboxd's 0.5–5
// average. It shipped comparing ranks (letterboxdCompare.js's percentiles)
// and Matt reported, 2026-09-30: "The comparison for the new game should be
// our scores, not our ranks. I don't know what it means for the rank to be
// higher or lower." Insights' crowd sections still compare by rank.
//
// Films within MIN_GAP stars of each other are left out: a coin flip is not
// a question.
import { crowdRating } from '../letterboxdCompare.js';

export const MIN_GAP = 0.25;

export const myStars = (rating) => {
  const normalized = rating?.normalizedRating;
  return Number.isFinite(normalized) ? normalized / 2 : null;
};

export function youOrCrowdRounds (entries, getRatingFn, films, { minGap = MIN_GAP } = {}) {
  const rounds = [];
  for (const entry of entries || []) {
    if (!entry?.movie?.poster_path) continue;
    const tmdbId = entry.movie.id;
    const crowd = crowdRating(films, tmdbId);
    const mine = myStars(getRatingFn(entry));
    if (crowd === null || mine === null) continue;
    const gap = mine - crowd;
    if (Math.abs(gap) >= minGap) rounds.push({ entry, tmdbId, mine, crowd, gap });
  }
  return rounds;
}

export const answerFor = (row) => (row.gap > 0 ? 'you' : 'crowd');

// The crowd out-scores Matt on roughly three films in four (checked against
// the live library, 2026-09-30), so an unbalanced run is won by always
// tapping "The crowd did". A run deals the same number of each answer,
// shuffled together, so a blind guess stays a coin flip.
export function balancedDeck (rounds, shuffleFn) {
  const yours = shuffleFn(rounds.filter((row) => answerFor(row) === 'you'));
  const theirs = shuffleFn(rounds.filter((row) => answerFor(row) === 'crowd'));
  const each = Math.min(yours.length, theirs.length);
  return shuffleFn([...yours.slice(0, each), ...theirs.slice(0, each)]);
}

export const starLabel = (stars, digits) => (Number.isFinite(stars) ? `★ ${stars.toFixed(digits)}` : '');
