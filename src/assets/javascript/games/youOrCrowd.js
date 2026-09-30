// You or the Crowd? (2026-09-29, Matt: "it would also be fun to be able to
// guess if I rated a movie higher or if they did"). One film from the
// library at a time: did you rank it higher than the Letterboxd crowd did,
// or did they? Pure and store-free; the component only renders.
//
// "Higher" is by RANK within the films both sides rated — your percentile
// among your own scores against the crowd's percentile among its ratings —
// because a 0–10 weighted score and a 0.5–5 star average can't be compared
// directly (letterboxdCompare.js). Films where the two sit within MIN_GAP
// of each other are left out: a coin flip is not a question.
import { crowdRows } from '../letterboxdCompare.js';

export const MIN_GAP = 0.12;

export function youOrCrowdRounds (entries, getRatingFn, films, { minGap = MIN_GAP } = {}) {
  return crowdRows(entries, getRatingFn, films)
    .filter((row) => Math.abs(row.gap) >= minGap && row.entry?.movie?.poster_path);
}

export const answerFor = (row) => (row.gap > 0 ? 'you' : 'crowd');

// A percentile as the words the reveal uses: 0.88 -> "top 12%".
export const percentLabel = (pct) => {
  if (!Number.isFinite(pct)) return '';
  const top = Math.max(1, Math.round((1 - pct) * 100));
  return `top ${top}%`;
};
