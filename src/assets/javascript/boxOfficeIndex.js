// Every library-wide box office number, from Box Office History (Matt,
// 2026-11-09: "Do all of the box office numbers in Cinema Roll now come from
// boxofficehistory.com? They really ought to"). The movie page's tile already
// read the archive film by film; this is the same data for the whole library
// at once: the archive's index/tmdb.json, one file keyed by TMDB id
// ({ id, y, d, w?, r?, t? }: archive id, year, domestic, worldwide, each
// release as [year, gross], tickets sold). The network side is
// utils/boxOfficeHistoryRequest.js (fetchArchiveIndex); the store keeps the
// file as state.boxOfficeIndex and every caller passes it in.
//
// The rules, one place:
// - "Box office" is the archive's DOMESTIC lifetime gross, the same number
//   the movie page's tile leads with. In base-year dollars it is restated
//   release by release (grossTodayByRuns), exactly as the tile does it.
// - Profit and return compare the budget with the archive's WORLDWIDE gross,
//   the honest comparison for a budget (a domestic-only profit would make
//   every hit look smaller than it was).
// - Budgets stay TMDB's: the archive doesn't keep them.
// - A film the archive doesn't know has no box office (0, the app's
//   "unknown"), so it sinks like any film without figures. No mixing in
//   TMDB's undated, unsourced number beside the archive's.
// - Until the file has loaded at all (first launch, offline before it was
//   ever fetched), `index` is null and everything reads TMDB as it used to,
//   so lists never go blank while it arrives.
import { grossTodayByRuns } from './boxOfficeHistory.js';
import { adjustedMovieMoney, adjustGross, releaseYear } from './inflation.js';

/** The archive's entry for a movie, or null. */
export const archiveEntryFor = (index, movie) => {
  if (!index || movie?.id == null) return null;
  return index[String(movie.id)] || null;
};

const yearOf = (entry, movie) => entry?.y ?? releaseYear(movie?.release_date);

/**
 * A movie's money: { budget, boxOffice, worldwide }, each 0 when unknown.
 * `adjusted` restates them in base-year dollars (budget by CPI, grosses by
 * ticket price), falling back to the reported figure when a year can't be
 * restated, so a film without a date never drops to "unknown".
 */
export function movieMoney (movie, index, { adjusted = false } = {}) {
  const rawBudget = movie?.budget > 0 ? movie.budget : 0;
  const budget = adjusted && rawBudget ? (adjustedMovieMoney(movie, 'budget') ?? rawBudget) : rawBudget;

  if (!index) {
    const raw = movie?.revenue > 0 ? movie.revenue : 0;
    const gross = adjusted && raw ? (adjustedMovieMoney(movie, 'revenue') ?? raw) : raw;
    return { budget, boxOffice: gross, worldwide: gross };
  }

  const entry = archiveEntryFor(index, movie);
  const domestic = entry?.d > 0 ? entry.d : 0;
  const worldwide = entry?.w > 0 ? entry.w : 0;
  if (!adjusted) return { budget, boxOffice: domestic, worldwide };

  const year = yearOf(entry, movie);
  const runs = Array.isArray(entry?.r) ? entry.r.map(([y, gross]) => ({ year: y, gross })) : null;
  const domesticToday = domestic && year ? grossTodayByRuns(domestic, year, runs, entry.t) : null;
  const worldwideToday = worldwide && year ? adjustGross(worldwide, year) : null;
  return {
    budget,
    boxOffice: domestic ? (domesticToday ?? domestic) : 0,
    worldwide: worldwide ? (worldwideToday ?? worldwide) : 0
  };
}

/** "domestic" once the archive is in use, "worldwide" while TMDB stands in. */
export const grossKind = (index) => (index ? 'domestic' : 'worldwide');
