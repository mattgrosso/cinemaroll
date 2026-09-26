import { describe, it, expect } from 'vitest';
import { monthlyBreakdown, weeklyBreakdown, yearlyBreakdown } from '../assets/javascript/activityBreakdown.js';

const now = new Date(2026, 8, 26, 15, 0); // Sat Sep 26 2026, afternoon

describe('monthlyBreakdown', () => {
  it('lists every month back to the first viewing, newest first, gaps included', () => {
    const rows = monthlyBreakdown([
      new Date(2026, 8, 2), new Date(2026, 8, 20), new Date(2026, 6, 4)
    ], now);
    expect(rows.map((r) => [r.label, r.count])).toEqual([
      ['September 2026', 2], ['August 2026', 0], ['July 2026', 1]
    ]);
  });

  it('crosses a year boundary', () => {
    const rows = monthlyBreakdown([new Date(2025, 11, 31)], new Date(2026, 0, 5));
    expect(rows.map((r) => r.label)).toEqual(['January 2026', 'December 2025']);
  });

  it('ignores unparseable dates and returns nothing for no viewings', () => {
    expect(monthlyBreakdown([], now)).toEqual([]);
    expect(monthlyBreakdown(['not a date'], now)).toEqual([]);
  });
});

describe('weeklyBreakdown', () => {
  it('uses the same rolling window as the This Week tile (today + six days back)', () => {
    const rows = weeklyBreakdown([
      new Date(2026, 8, 26, 22), // today, late
      new Date(2026, 8, 20, 1),  // six days back, early — still this week
      new Date(2026, 8, 19)      // seven days back — last week
    ], now);
    expect(rows[0]).toMatchObject({ label: 'Sep 20 – Sep 26', count: 2 });
    expect(rows[1]).toMatchObject({ label: 'Sep 13 – Sep 19', count: 1 });
    expect(rows).toHaveLength(2);
  });

  it('keeps empty weeks and labels the year once the window leaves this year', () => {
    const rows = weeklyBreakdown([new Date(2025, 11, 29)], new Date(2026, 0, 12));
    expect(rows.map((r) => r.count)).toEqual([0, 0, 1]);
    expect(rows[2].label).toBe('Dec 23 – Dec 29, 2025');
  });
});

describe('yearlyBreakdown', () => {
  it('gives each year a total and a count up to today\'s date', () => {
    const rows = yearlyBreakdown([
      new Date(2026, 1, 1),
      new Date(2025, 8, 26, 21), // same date last year, evening — counts to-date
      new Date(2025, 8, 27),     // the day after — total only
      new Date(2023, 0, 1)
    ], now);
    expect(rows).toEqual([
      { key: 'y2026', label: '2026', count: 1, toDate: 1 },
      { key: 'y2025', label: '2025', count: 2, toDate: 1 },
      { key: 'y2024', label: '2024', count: 0, toDate: 0 },
      { key: 'y2023', label: '2023', count: 1, toDate: 1 }
    ]);
  });
});
