import { describe, it, expect } from 'vitest';
import {
  allViewings,
  calendarCoverage,
  viewingsInYear,
  bookends,
  calendarGrid,
  monthlyBests,
  streaks,
  weekdayPattern,
  releaseSpread,
  discoveryMix,
  yearSignature,
  superlatives,
  versusPreviousYear,
  scoreShape
} from '@/assets/javascript/yearInReview.js';

// Local-midnight timestamps. Fixtures must never use `new Date('2026-01-01')`
// — that parses as UTC and lands on Dec 31 in this timezone.
const at = (y, m, d) => new Date(y, m - 1, d, 20, 0, 0).getTime();

/** Mirrors GetRating's getAllRatings: every rating, normalized, in order. */
const getAllRatings = (entry) => entry?.ratings || null;

function entry (id, ratings, movie = {}) {
  return {
    dbKey: `k${id}`,
    ratings,
    movie: { id, title: `Film ${id}`, runtime: 120, release_date: '1999-06-15', ...movie }
  };
}

function watched (id, date, score, movie) {
  return entry(id, [{ date, calculatedTotal: score }], movie);
}

describe('viewingsInYear', () => {
  it('counts a film watched twice in the year as two viewings', () => {
    const entries = [entry(1, [
      { date: at(2026, 3, 4), calculatedTotal: 7 },
      { date: at(2026, 9, 9), calculatedTotal: 8 }
    ])];

    expect(viewingsInYear(entries, getAllRatings, 2026)).toHaveLength(2);
  });

  it('takes each viewing its own score, not the most recent one', () => {
    const entries = [entry(1, [
      { date: at(2026, 3, 4), calculatedTotal: 4 },
      { date: at(2027, 1, 1), calculatedTotal: 9 }
    ])];

    const [viewing] = viewingsInYear(entries, getAllRatings, 2026);
    expect(viewing.score).toBe(4);
  });

  // One rule app-wide (shorts.js, 2026-09-29): runtime alone, Home's cutoff.
  // A feature TMDB tags "Short" stays in, as it does on Home.
  it('excludes shorts by runtime unless asked for them — not by genre tag', () => {
    const entries = [
      watched(1, at(2026, 5, 5), 7),
      watched(2, at(2026, 5, 6), 7, { genres: [{ name: 'Short' }] }),
      watched(3, at(2026, 5, 7), 7, { runtime: 12 })
    ];

    expect(viewingsInYear(entries, getAllRatings, 2026).map((v) => v.movie.id)).toEqual([1, 2]);
    expect(viewingsInYear(entries, getAllRatings, 2026, { includeShorts: true })).toHaveLength(3);
  });

  it('accepts the epoch-ms strings the database actually stores', () => {
    const entries = [entry(1, [{ date: String(at(2026, 4, 4)), calculatedTotal: 7 }])];
    expect(viewingsInYear(entries, getAllRatings, 2026)).toHaveLength(1);
  });

  it('is null-safe and skips entries with no movie or no ratings', () => {
    expect(viewingsInYear(null, getAllRatings, 2026)).toEqual([]);
    expect(viewingsInYear([{}, { movie: null }, entry(1, [])], getAllRatings, 2026)).toEqual([]);
  });

  it('comes back in chronological order', () => {
    const entries = [
      watched(1, at(2026, 12, 1), 7),
      watched(2, at(2026, 2, 1), 7),
      watched(3, at(2026, 7, 1), 7)
    ];

    expect(viewingsInYear(entries, getAllRatings, 2026).map((v) => v.dbKey))
      .toEqual(['k2', 'k3', 'k1']);
  });
});

describe('bookends', () => {
  it('gives the first and last film of the year', () => {
    const entries = [
      watched(1, at(2026, 6, 6), 7),
      watched(2, at(2026, 1, 3), 7),
      watched(3, at(2026, 11, 20), 7)
    ];

    const ends = bookends(viewingsInYear(entries, getAllRatings, 2026));
    expect(ends.first.dbKey).toBe('k2');
    expect(ends.last.dbKey).toBe('k3');
  });

  it('is null on an empty year', () => {
    expect(bookends([])).toBe(null);
  });
});

describe('calendarGrid', () => {
  // Deliberately no longer a 7-row contribution graph: it ran wider than a
  // phone, and this matches the all-time grid on Insights.
  const finished = at(2027, 6, 1);

  it('lays the year out as twelve month rows by day-of-month', () => {
    const grid = calendarGrid([], 2026, finished);

    expect(grid.months).toHaveLength(12);
    expect(grid.months[0].days).toHaveLength(31);
    expect(grid.months[3].days).toHaveLength(30);
    expect(grid.months.reduce((sum, month) => sum + month.days.length, 0)).toBe(365);
  });

  it('gives February its extra day in a leap year and not otherwise', () => {
    expect(calendarGrid([], 2024, finished).months[1].days).toHaveLength(29);
    expect(calendarGrid([], 2026, finished).months[1].days).toHaveLength(28);
    expect(calendarGrid([], 2024, finished).months.reduce((sum, m) => sum + m.days.length, 0)).toBe(366);
  });

  it('counts viewings per date and reports the busiest', () => {
    const entries = [
      watched(1, at(2026, 5, 10), 7),
      watched(2, at(2026, 5, 10), 7),
      watched(3, at(2026, 5, 10), 7),
      watched(4, at(2026, 8, 1), 7)
    ];

    const grid = calendarGrid(viewingsInYear(entries, getAllRatings, 2026), 2026, finished);

    expect(grid.months[4].days[9].count).toBe(3);
    expect(grid.busiest).toBe(3);
    expect(grid.watchedDays).toBe(2);
  });

  // In August, an empty November is not a fact about your viewing.
  it('marks days that have not happened yet rather than counting them empty', () => {
    const midYear = at(2026, 8, 15);
    const grid = calendarGrid([], 2026, midYear);

    expect(grid.months[10].days[0].future).toBe(true);
    expect(grid.months[0].days[0].future).toBe(false);
    // The 15th has arrived; the 16th has not.
    expect(grid.months[7].days[14].future).toBe(false);
    expect(grid.months[7].days[15].future).toBe(true);
  });

  it('marks nothing as future once the year is over', () => {
    const grid = calendarGrid([], 2026, finished);
    expect(grid.months.flatMap((month) => month.days).some((day) => day.future)).toBe(false);
  });
});

describe('monthlyBests', () => {
  it('returns all twelve months even when most are empty', () => {
    expect(monthlyBests([])).toHaveLength(12);
  });

  it('picks each month its own best film', () => {
    const entries = [
      watched(1, at(2026, 3, 2), 6),
      watched(2, at(2026, 3, 20), 9),
      watched(3, at(2026, 7, 4), 5)
    ];

    const months = monthlyBests(viewingsInYear(entries, getAllRatings, 2026));
    expect(months[2].best.dbKey).toBe('k2');
    expect(months[2].count).toBe(2);
    expect(months[6].best.dbKey).toBe('k3');
    expect(months[0].best).toBe(null);
  });
});

describe('streaks', () => {
  const now = at(2027, 6, 1); // A safely finished 2026.

  it('finds the longest run of consecutive days', () => {
    const entries = [
      watched(1, at(2026, 4, 1), 7),
      watched(2, at(2026, 4, 2), 7),
      watched(3, at(2026, 4, 3), 7),
      watched(4, at(2026, 9, 1), 7),
      watched(5, at(2026, 9, 2), 7)
    ];

    const result = streaks(viewingsInYear(entries, getAllRatings, 2026), 2026, now);
    expect(result.longest.length).toBe(3);
    expect(result.longest.from).toBe('2026-04-01');
    expect(result.longest.to).toBe('2026-04-03');
  });

  it('does not let two films on one day count as a two-day streak', () => {
    const entries = [
      watched(1, at(2026, 4, 1), 7),
      watched(2, at(2026, 4, 1), 7)
    ];

    expect(streaks(viewingsInYear(entries, getAllRatings, 2026), 2026, now).longest.length).toBe(1);
  });

  // The year's own edges are droughts too, or a January spent watching
  // nothing simply wouldn't appear.
  it('counts the silence before the first film of the year', () => {
    // Nothing until March, then something every week to the end of the year,
    // so the lead-in is unambiguously the longest gap.
    const entries = [watched(1, at(2026, 3, 1), 7)];
    for (let week = 1; week <= 43; week++) {
      entries.push(watched(100 + week, at(2026, 3, 1) + week * 7 * 24 * 60 * 60 * 1000, 7));
    }

    const result = streaks(viewingsInYear(entries, getAllRatings, 2026), 2026, now);
    expect(result.drought.length).toBe(59); // Jan 1 to Mar 1.
  });

  it('counts the silence after the last film of a finished year', () => {
    const entries = [watched(1, at(2026, 1, 2), 7), watched(2, at(2026, 3, 1), 7)];
    const result = streaks(viewingsInYear(entries, getAllRatings, 2026), 2026, now);

    expect(result.drought.from).toBe('2026-03-01');
    expect(result.drought.length).toBe(305); // Mar 1 to Dec 31.
  });

  // A year in progress must not report the rest of itself as a drought — the
  // eleven months of 2026 that haven't happened yet aren't a dry spell.
  it('measures an unfinished year to today, not to December 31st', () => {
    const entries = [watched(1, at(2026, 2, 1), 7), watched(2, at(2026, 2, 5), 7)];
    const earlyInTheYear = at(2026, 2, 10);

    const result = streaks(viewingsInYear(entries, getAllRatings, 2026), 2026, earlyInTheYear);

    // The Jan 1 lead-in (31 days), not the 329 days left on the calendar.
    expect(result.drought.length).toBe(31);
    expect(result.drought.from).toBe('2026-01-01');
  });

  it('is null on an empty year', () => {
    expect(streaks([], 2026, now)).toBe(null);
  });
});

describe('weekdayPattern', () => {
  it('names the day you actually watch films on and its share', () => {
    // 2026-05-01 is a Friday.
    const entries = [
      watched(1, at(2026, 5, 1), 7),
      watched(2, at(2026, 5, 8), 7),
      watched(3, at(2026, 5, 15), 7),
      watched(4, at(2026, 5, 6), 7)
    ];

    const pattern = weekdayPattern(viewingsInYear(entries, getAllRatings, 2026));
    expect(pattern.busiest.name).toBe('Friday');
    expect(pattern.busiest.count).toBe(3);
    expect(pattern.share).toBe(75);
    expect(pattern.days).toHaveLength(7);
  });

  it('is safe with nothing watched', () => {
    expect(weekdayPattern([]).busiest).toBe(null);
    expect(weekdayPattern([]).share).toBe(0);
  });
});

describe('releaseSpread', () => {
  it('splits new releases from catalogue and finds the oldest', () => {
    const entries = [
      watched(1, at(2026, 2, 1), 7, { release_date: '2026-04-10' }),
      watched(2, at(2026, 3, 1), 7, { release_date: '2026-08-10' }),
      watched(3, at(2026, 4, 1), 7, { release_date: '1954-08-10' }),
      watched(4, at(2026, 5, 1), 7, { release_date: '1988-08-10' })
    ];

    const spread = releaseSpread(viewingsInYear(entries, getAllRatings, 2026), 2026);
    expect(spread.thisYear).toBe(2);
    expect(spread.catalogue).toBe(2);
    expect(spread.currentShare).toBe(50);
    expect(spread.oldest.dbKey).toBe('k3');
    expect(spread.span).toBe(72);
    expect(spread.decades.map((d) => d.label)).toEqual(['1950s', '1980s', '2020s']);
  });

  it('is null when nothing has a release date', () => {
    const entries = [watched(1, at(2026, 2, 1), 7, { release_date: null })];
    expect(releaseSpread(viewingsInYear(entries, getAllRatings, 2026), 2026)).toBe(null);
  });
});

describe('discoveryMix', () => {
  it('separates first-time watches from films you came back to', () => {
    const entries = [
      entry(1, [{ date: at(2026, 5, 1), calculatedTotal: 7 }]),
      entry(2, [
        { date: at(2019, 5, 1), calculatedTotal: 6 },
        { date: at(2026, 6, 1), calculatedTotal: 8 }
      ])
    ];

    const viewings = viewingsInYear(entries, getAllRatings, 2026);
    const mix = discoveryMix(viewings, getAllRatings);

    expect(mix.firstTime.map((v) => v.dbKey)).toEqual(['k1']);
    expect(mix.revisits.map((v) => v.dbKey)).toEqual(['k2']);
  });

  it('treats a film seen twice this year as one discovery and one revisit', () => {
    const entries = [entry(1, [
      { date: at(2026, 2, 1), calculatedTotal: 7 },
      { date: at(2026, 9, 1), calculatedTotal: 7 }
    ])];

    const viewings = viewingsInYear(entries, getAllRatings, 2026);
    const mix = discoveryMix(viewings, getAllRatings);

    expect(mix.firstTime).toHaveLength(1);
    expect(mix.revisits).toHaveLength(1);
  });
});

describe('yearSignature', () => {
  // Over-representation against your own habits, not raw volume.
  it('surfaces what you leaned into unusually hard, not what you watch most', () => {
    const horror = { genres: [{ name: 'Horror' }] };
    const drama = { genres: [{ name: 'Drama' }] };

    // This year: 5 horror, 5 drama.
    const thisYear = Array.from({ length: 10 }, (unused, i) =>
      watched(i, at(2026, 2, 1), 7, i < 5 ? horror : drama));
    // All time: horror is rare, drama is the bread and butter.
    const allTime = [
      ...Array.from({ length: 5 }, (unused, i) => watched(100 + i, at(2020, 2, 1), 7, horror)),
      ...Array.from({ length: 95 }, (unused, i) => watched(200 + i, at(2020, 2, 1), 7, drama))
    ];

    const signature = yearSignature(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(allTime, getAllRatings, 2020)
    );

    expect(signature[0].value).toBe('Horror');
    expect(signature[0].ratio).toBeGreaterThan(1);
    // Drama is half the year but perfectly normal for this viewer.
    expect(signature.some((s) => s.value === 'Drama')).toBe(false);
  });

  it('keeps multi-word values intact', () => {
    const tagged = { keywords: [{ name: 'based on novel or book' }] };
    const thisYear = Array.from({ length: 6 }, (unused, i) => watched(i, at(2026, 2, 1), 7, tagged));
    const allTime = [
      ...Array.from({ length: 3 }, (unused, i) => watched(100 + i, at(2020, 2, 1), 7, tagged)),
      ...Array.from({ length: 97 }, (unused, i) => watched(200 + i, at(2020, 2, 1), 7))
    ];

    const signature = yearSignature(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(allTime, getAllRatings, 2020)
    );

    expect(signature.some((s) => s.value === 'based on novel or book')).toBe(true);
  });

  it('ignores anything too rare to mean anything', () => {
    const thisYear = [
      watched(1, at(2026, 2, 1), 7, { genres: [{ name: 'Fluke' }] }),
      ...Array.from({ length: 20 }, (unused, i) => watched(10 + i, at(2026, 2, 1), 7))
    ];
    const allTime = Array.from({ length: 100 }, (unused, i) => watched(200 + i, at(2020, 2, 1), 7));

    const signature = yearSignature(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(allTime, getAllRatings, 2020)
    );

    expect(signature.some((s) => s.value === 'Fluke')).toBe(false);
  });

  it('caps each facet type so keywords cannot take every slot', () => {
    const thisYear = [];
    const allTime = [];
    for (let k = 0; k < 8; k++) {
      const tagged = { keywords: [{ name: `kw${k}` }] };
      for (let i = 0; i < 4; i++) thisYear.push(watched(k * 100 + i, at(2026, 2, 1), 7, tagged));
      allTime.push(watched(9000 + k, at(2020, 2, 1), 7, tagged));
    }
    for (let i = 0; i < 200; i++) allTime.push(watched(5000 + i, at(2020, 2, 1), 7));

    const signature = yearSignature(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(allTime, getAllRatings, 2020)
    );

    expect(signature.filter((s) => s.facet === 'keyword').length).toBeLessThanOrEqual(2);
  });

  it('is empty when there is nothing to compare against', () => {
    expect(yearSignature([], [])).toEqual([]);
  });
});

describe('superlatives', () => {
  it('finds the extremes of the year', () => {
    const entries = [
      watched(1, at(2026, 2, 1), 9.5, { runtime: 90, release_date: '2001-06-15' }),
      watched(2, at(2026, 3, 1), 2.0, { runtime: 210, release_date: '1966-06-15' }),
      watched(3, at(2026, 4, 1), 6.0, { runtime: 45, release_date: '2020-06-15' })
    ];

    const best = superlatives(viewingsInYear(entries, getAllRatings, 2026));
    expect(best.best.dbKey).toBe('k1');
    expect(best.worst.dbKey).toBe('k2');
    expect(best.longest.dbKey).toBe('k2');
    expect(best.shortest.dbKey).toBe('k3');
    expect(best.oldest.dbKey).toBe('k2');
  });

  it('is an empty object on an empty year', () => {
    expect(superlatives([])).toEqual({});
  });
});

describe('versusPreviousYear', () => {
  it('reports the deltas against last year', () => {
    const thisYear = [
      watched(1, at(2026, 2, 1), 8, { runtime: 100 }),
      watched(2, at(2026, 3, 1), 6, { runtime: 100 })
    ];
    const lastYear = [watched(3, at(2025, 2, 1), 5, { runtime: 100 })];

    const comparison = versusPreviousYear(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(lastYear, getAllRatings, 2025)
    );

    expect(comparison.countDelta).toBe(1);
    expect(comparison.minutesDelta).toBe(100);
    expect(comparison.averageDelta).toBe(2);
  });

  it('is null when there is no previous year to compare to', () => {
    expect(versusPreviousYear([{ score: 7, runtime: 90 }], [])).toBe(null);
  });

  // Otherwise an August 2026 always looks like a collapse next to a whole 2025.
  it('trims last year to the same point on the calendar for a year in progress', () => {
    const thisYear = [
      watched(1, at(2026, 2, 1), 7, { runtime: 100 }),
      watched(2, at(2026, 3, 1), 7, { runtime: 100 })
    ];
    const lastYear = [
      watched(3, at(2025, 2, 1), 7, { runtime: 100 }),
      watched(4, at(2025, 3, 1), 7, { runtime: 100 }),
      // Everything after March is off the end of the comparable window.
      watched(5, at(2025, 8, 1), 7, { runtime: 100 }),
      watched(6, at(2025, 11, 1), 7, { runtime: 100 })
    ];

    const comparison = versusPreviousYear(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(lastYear, getAllRatings, 2025),
      { throughDate: at(2026, 4, 1) }
    );

    expect(comparison.before.count).toBe(2);
    expect(comparison.countDelta).toBe(0);
    expect(comparison.partial).toBe(true);
  });

  it('does not mark a finished year partial', () => {
    const thisYear = [watched(1, at(2026, 2, 1), 7, { runtime: 100 })];
    const lastYear = [watched(2, at(2025, 2, 1), 7, { runtime: 100 })];

    const comparison = versusPreviousYear(
      viewingsInYear(thisYear, getAllRatings, 2026),
      viewingsInYear(lastYear, getAllRatings, 2025),
      { throughDate: at(2027, 6, 1) }
    );

    expect(comparison.partial).toBe(false);
    expect(comparison.before.count).toBe(1);
  });
});

describe('scoreShape', () => {
  it('buckets scores into whole numbers and finds the peak', () => {
    const entries = [
      watched(1, at(2026, 2, 1), 7.4),
      watched(2, at(2026, 3, 1), 6.8),
      watched(3, at(2026, 4, 1), 2.1)
    ];

    const shape = scoreShape(viewingsInYear(entries, getAllRatings, 2026));
    expect(shape.buckets).toHaveLength(11);
    expect(shape.buckets[7].count).toBe(2);
    expect(shape.buckets[2].count).toBe(1);
    expect(shape.scored).toBe(3);
    expect(shape.peak).toBe(2);
  });

  it('ignores unscored viewings without dropping the bucket list', () => {
    const shape = scoreShape([{ score: null }]);
    expect(shape.scored).toBe(0);
    expect(shape.buckets).toHaveLength(11);
  });
});

describe('calendarCoverage', () => {
  it('lays out all 366 calendar dates as twelve months', () => {
    const coverage = calendarCoverage([]);

    expect(coverage.months).toHaveLength(12);
    expect(coverage.months[0].days).toHaveLength(31);
    expect(coverage.months[1].days).toHaveLength(29); // Feb 29 has to exist.
    expect(coverage.total).toBe(366);
  });

  it('collapses the same date across different years into one cell', () => {
    const entries = [
      watched(1, at(2021, 3, 7), 7),
      watched(2, at(2024, 3, 7), 7),
      watched(3, at(2026, 3, 7), 7)
    ];

    const coverage = calendarCoverage(allViewings(entries, getAllRatings));
    const march7 = coverage.months[2].days[6];

    expect(march7.count).toBe(3);
    expect(coverage.covered).toBe(1);
    expect(coverage.years).toBe(3);
  });

  // The whole point: which dates have you never once watched a film on.
  it('reports every date you have never watched anything on', () => {
    const entries = [watched(1, at(2024, 1, 1), 7)];
    const coverage = calendarCoverage(allViewings(entries, getAllRatings));

    expect(coverage.covered).toBe(1);
    expect(coverage.missing).toHaveLength(365);
    expect(coverage.missing.some((gap) => gap.month === 0 && gap.day === 1)).toBe(false);
    expect(coverage.missing.some((gap) => gap.month === 0 && gap.day === 2)).toBe(true);
  });

  it('marks Feb 29 as rare, since an empty one means much less', () => {
    const coverage = calendarCoverage([]);
    const leapDay = coverage.missing.find((gap) => gap.month === 1 && gap.day === 29);

    expect(leapDay.rare).toBe(true);
    expect(coverage.missing.filter((gap) => gap.rare)).toHaveLength(1);
  });

  it('tracks the busiest date and the covered percentage', () => {
    const entries = [
      watched(1, at(2021, 6, 4), 7),
      watched(2, at(2022, 6, 4), 7),
      watched(3, at(2023, 9, 1), 7)
    ];

    const coverage = calendarCoverage(allViewings(entries, getAllRatings));
    expect(coverage.busiest).toBe(2);
    expect(coverage.covered).toBe(2);
    expect(coverage.percent).toBe(1);
  });

  it('is safe with nothing watched at all', () => {
    const coverage = calendarCoverage(null);
    expect(coverage.covered).toBe(0);
    expect(coverage.percent).toBe(0);
    expect(coverage.missing).toHaveLength(366);
  });
});
