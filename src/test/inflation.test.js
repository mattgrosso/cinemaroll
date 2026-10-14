import { describe, it, expect } from 'vitest';
import {
  adjustForInflation, adjustGross, ticketsSold, adjustedMovieMoney, releaseYear, BASE_YEAR, CPI, TICKET_PRICES, WORDING
} from '../assets/javascript/inflation.js';

// Requested 2026-08-26: "I would also like to have a way to show boxoffice
// numbers adjusted for inflation." A library spanning eighty years makes
// every unadjusted money comparison quietly wrong.

describe('the CPI table', () => {
  it('covers the whole span of cinema, and then some', () => {
    expect(CPI['1913']).toBeDefined();
    expect(CPI[String(BASE_YEAR)]).toBeDefined();
    expect(BASE_YEAR).toBeGreaterThanOrEqual(2024);
  });

  it('rises over the long run, which is the only property the maths needs', () => {
    expect(CPI['2023']).toBeGreaterThan(CPI['1993']);
    expect(CPI['1993']).toBeGreaterThan(CPI['1963']);
  });
});

describe('releaseYear', () => {
  // TMDB dates are bare "YYYY-MM-DD", which parse as UTC midnight and slip a
  // year backwards west of Greenwich if read in local time.
  it('reads a New Year\'s Day release as its own year', () => {
    expect(releaseYear('1993-01-01')).toBe(1993);
    expect(releaseYear('2023-07-21')).toBe(2023);
  });

  it('refuses rather than guessing', () => {
    expect(releaseYear(null)).toBeNull();
    expect(releaseYear('')).toBeNull();
    expect(releaseYear('not a date')).toBeNull();
  });
});

describe('adjustForInflation', () => {
  it('moves an old figure UP into today\'s money', () => {
    const adjusted = adjustForInflation(100_000_000, 1993);
    expect(adjusted).toBeGreaterThan(100_000_000);
    // 1993 -> now is roughly a doubling; the exact factor is the table's.
    expect(adjusted / 100_000_000).toBeCloseTo(CPI[String(BASE_YEAR)] / CPI['1993'], 6);
  });

  it('leaves a figure already in base-year money alone', () => {
    expect(adjustForInflation(500, BASE_YEAR)).toBe(500);
  });

  // Refusing would blank the newest films — the ones most likely to be looked
  // at — over one year of drift.
  it('treats a film newer than the table as already current', () => {
    expect(adjustForInflation(500, BASE_YEAR + 1)).toBe(500);
  });

  it('scales the older figure more, which is the whole point', () => {
    const older = adjustForInflation(1_000_000, 1950);
    const newer = adjustForInflation(1_000_000, 2000);
    expect(older).toBeGreaterThan(newer);
  });

  it('says it cannot rather than inventing a number', () => {
    expect(adjustForInflation(100, 1800)).toBeNull();
    expect(adjustForInflation(100, null)).toBeNull();
    expect(adjustForInflation(null, 1993)).toBeNull();
    expect(adjustForInflation(NaN, 1993)).toBeNull();
    expect(adjustForInflation(100, 'not a year')).toBeNull();
  });
});

describe('adjustedMovieMoney', () => {
  const movie = (overrides) => ({ release_date: '1993-06-11', budget: 63_000_000, revenue: 920_000_000, ...overrides });

  it('adjusts either figure off the film\'s own release year: the budget by CPI, the gross by ticket price', () => {
    const cpiFactor = CPI[String(BASE_YEAR)] / CPI['1993'];
    const ticketFactor = TICKET_PRICES[String(BASE_YEAR)] / TICKET_PRICES['1993'];
    expect(adjustedMovieMoney(movie(), 'budget')).toBeCloseTo(63_000_000 * cpiFactor, 2);
    expect(adjustedMovieMoney(movie(), 'revenue')).toBeCloseTo(920_000_000 * ticketFactor, 2);
    expect(ticketFactor).not.toBeCloseTo(cpiFactor, 1);
  });

  // TMDB's 0 means "we don't know", the same as everywhere else in the app —
  // adjusting it would turn a blank into a confident $0.
  it('treats a zero figure as unknown, not as nothing', () => {
    expect(adjustedMovieMoney(movie({ budget: 0 }), 'budget')).toBeNull();
    expect(adjustedMovieMoney(movie({ revenue: undefined }), 'revenue')).toBeNull();
  });

  it('cannot adjust a film with no release date', () => {
    expect(adjustedMovieMoney(movie({ release_date: null }), 'budget')).toBeNull();
  });

  it('is safe on nothing at all', () => {
    expect(adjustedMovieMoney(null, 'budget')).toBeNull();
    expect(adjustedMovieMoney({}, 'revenue')).toBeNull();
  });

  // The comparison that motivated the feature.
  it('puts a 1993 hit and a 2023 hit on the same footing', () => {
    const jurassicPark = adjustedMovieMoney({ release_date: '1993-06-11', revenue: 920_000_000 }, 'revenue');
    const barbie = adjustedMovieMoney({ release_date: '2023-07-21', revenue: 1_450_000_000 }, 'revenue');
    // Raw, Barbie is far ahead. Adjusted, they are much closer.
    expect(1_450_000_000 / 920_000_000).toBeGreaterThan(1.5);
    expect(barbie / jurassicPark).toBeLessThan(1.1);
  });
});

describe('adjustGross — a gross is tickets (the table shared with Box Office Archive)', () => {
  it('scales by the average ticket price between the two years', () => {
    expect(adjustGross(920_000_000, 1993) / 920_000_000).toBeCloseTo(TICKET_PRICES[String(BASE_YEAR)] / TICKET_PRICES['1993'], 6);
    expect(ticketsSold(920_000_000, 1993)).toBeCloseTo(920_000_000 / TICKET_PRICES['1993'], 3);
  });
  it('leaves the base year and later alone, and refuses what it cannot do honestly', () => {
    expect(adjustGross(500, BASE_YEAR)).toBe(500);
    expect(adjustGross(500, BASE_YEAR + 1)).toBe(500);
    expect(adjustGross(500, 1850)).toBeNull();
    expect(adjustGross(null, 1993)).toBeNull();
  });
  it('carries the shared wording', () => {
    expect(WORDING.inBaseYear).toBe(`In ${BASE_YEAR} dollars`);
    expect(WORDING.asReported).toBe('As reported');
    expect(WORDING.grossMethod).toBe('by average ticket price');
    expect(WORDING.budgetMethod).toBe('by CPI');
  });
});
