// Money from one year, expressed in another year's dollars.
//
// Requested 2026-08-26: "I would also like to have a way to show boxoffice
// numbers adjusted for inflation." Jurassic Park took $920M in 1993 and
// Barbie took $1.45B in 2023 — those are not the same distance apart as the
// raw numbers suggest, and a library spanning eighty years makes every
// unadjusted money comparison quietly wrong.
//
// ONE TABLE, SHARED WITH BOX OFFICE ARCHIVE (2026-10-14, Matt: "unify the
// concepts of today's dollars"). `src/assets/data/inflation.json` is the
// archive's /api/v1/inflation.json, refreshed with `yarn fetch-inflation`
// and bundled because this PWA works offline. Two methods, by what the
// money is:
//
//   - a GROSS is tickets → average US ticket price of its year (the old
//     Box Office Mojo method): `adjustGross`.
//   - a BUDGET is not tickets → CPI: `adjustForInflation`.
//
// Ticket prices after 2019 are estimates (2019 carried forward by CPI) and
// the table says which. Return on budget stays inflation-neutral: both sides
// are the same year's dollars, so this module offers no way to adjust it.

import table from '../data/inflation.json';

export const CPI = table.cpi;
export const TICKET_PRICES = table.ticketPrices;

// The year every adjusted figure is expressed in — the latest full year in
// the table. When a newer annual average is added, this follows it.
export const BASE_YEAR = table.baseYear;

// The words every screen uses, so the two apps never drift: "As reported" /
// "In 2025 dollars", and the method each kind of money goes by.
export const WORDING = table.wording || { asReported: 'As reported', inBaseYear: `In ${BASE_YEAR} dollars`, grossMethod: 'by average ticket price', budgetMethod: 'by CPI' };
export const TICKET_PRICE_ESTIMATED_YEARS = table.ticketPricesEstimated || [];

const EARLIEST_CPI_YEAR = Math.min(...Object.keys(CPI).map(Number));
const EARLIEST_TICKET_YEAR = Math.min(...Object.keys(TICKET_PRICES).map(Number));

/**
 * The release year a money figure belongs to, from a TMDB release date.
 * Returns null rather than guessing — an unadjustable figure must be able to
 * say so.
 */
export const releaseYear = (releaseDate) => {
  if (!releaseDate) return null;
  const parsed = new Date(releaseDate);
  if (Number.isNaN(parsed.getTime())) return null;
  // getUTCFullYear, not getFullYear: TMDB dates are bare "YYYY-MM-DD", which
  // parse as UTC midnight and slip to the previous year west of Greenwich.
  const year = parsed.getUTCFullYear();
  return Number.isFinite(year) ? year : null;
};

const numeric = (amount) => {
  const value = typeof amount === 'number' ? amount : parseFloat(amount);
  return Number.isFinite(value) ? value : null;
};

/**
 * `amount` in `fromYear` dollars -> the same purchasing power in BASE_YEAR,
 * by CPI. For budgets (and anything that isn't tickets).
 *
 * Returns null when it cannot be done honestly: no amount, no year, or a year
 * the table doesn't cover. A year LATER than the table's last (a film
 * released this year, against a table that ends last year) is treated as
 * already-current rather than refused — the drift is one year of inflation,
 * and refusing would blank the newest films, which are the ones most likely
 * to be looked at.
 */
export const adjustForInflation = (amount, fromYear) => {
  const value = numeric(amount);
  if (value === null) return null;

  const year = Number(fromYear);
  if (!Number.isFinite(year) || year < EARLIEST_CPI_YEAR) return null;

  if (year >= BASE_YEAR) return value;

  const from = CPI[String(year)];
  const to = CPI[String(BASE_YEAR)];
  if (!from || !to) return null;

  return value * (to / from);
};

/**
 * A gross from `fromYear` -> what the same number of tickets would take at
 * BASE_YEAR's average ticket price. Same contract as adjustForInflation.
 */
export const adjustGross = (amount, fromYear) => {
  const value = numeric(amount);
  if (value === null) return null;

  const year = Number(fromYear);
  if (!Number.isFinite(year) || year < EARLIEST_TICKET_YEAR) return null;

  if (year >= BASE_YEAR) return value;

  const from = TICKET_PRICES[String(year)];
  const to = TICKET_PRICES[String(BASE_YEAR)];
  if (!from || !to) return null;

  return value * (to / from);
};

/** Tickets a gross bought at its year's average price, or null. */
export const ticketsSold = (amount, fromYear) => {
  const value = numeric(amount);
  const price = TICKET_PRICES[String(Number(fromYear))];
  return value !== null && price ? value / price : null;
};

/**
 * The same, taking a whole movie — the shape every caller actually has.
 * `field` is 'budget' (by CPI) or 'revenue' (a gross: by ticket price).
 */
export const adjustedMovieMoney = (movie, field) => {
  const raw = movie?.[field] || 0;
  // TMDB's 0 means "we don't know", the same as everywhere else in the app.
  if (!(raw > 0)) return null;
  const year = releaseYear(movie?.release_date);
  return field === 'revenue' ? adjustGross(raw, year) : adjustForInflation(raw, year);
};
