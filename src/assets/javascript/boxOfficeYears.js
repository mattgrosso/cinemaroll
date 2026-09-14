// Release years ranked by the worldwide gross of the films you've rated from
// them (bug report, 2026-09-13: "a rank of years based on total box office
// for the movies that I brought in... look at years from my financial
// perspective... most profitable years, largest gross, just like what I've
// actually watched").
//
// Two readings, and the toggle is the whole point: "as released" sums the
// dollars each film actually took, "today's dollars" runs every figure
// through inflation.js first — a library spanning eighty years makes the
// unadjusted sum quietly favour the recent decades (see inflation.js).
//
// TMDB's `revenue` is worldwide gross (formatMoney.js), and 0 means "we
// don't know" — a film without a figure adds nothing and isn't counted.
import { releaseYear, adjustForInflation } from './inflation.js';

/**
 * @param {Array} entries  library entries ({ movie: { revenue, release_date } })
 * @param {{ adjusted?: boolean }} options  today's dollars (true) or as released
 * @returns {Array<{ year, total, count, top, topGross }>}  biggest total first
 */
export function boxOfficeByYear (entries, { adjusted = false } = {}) {
  const byYear = new Map();

  (entries || []).forEach((entry) => {
    const movie = entry?.movie;
    const raw = Number(movie?.revenue) || 0;
    if (!(raw > 0)) return;
    const year = releaseYear(movie.release_date);
    if (year == null) return;
    const gross = adjusted ? adjustForInflation(raw, year) : raw;
    if (!(gross > 0)) return;
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ entry, gross });
  });

  return [...byYear.entries()]
    .map(([year, films]) => {
      const biggest = films.reduce((best, film) => (film.gross > best.gross ? film : best), films[0]);
      return {
        year,
        count: films.length,
        total: films.reduce((sum, film) => sum + film.gross, 0),
        top: biggest.entry,
        topGross: biggest.gross
      };
    })
    .sort((a, b) => (b.total - a.total) || (b.count - a.count) || (b.year - a.year));
}
