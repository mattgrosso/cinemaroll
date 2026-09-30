import { describe, it, expect } from 'vitest';
import { timeAgo } from '@/assets/javascript/timeAgo.js';

// Mid-month and mid-day: `new Date('YYYY-01-01')` parses as UTC and shifts a
// day (and sometimes a year) backwards in this repo's test timezone.
const NOW = new Date(2026, 7, 16, 12, 0, 0).getTime();
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('counts minutes, then hours, then days', () => {
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe('5 minutes ago');
    expect(timeAgo(NOW - 3 * HOUR, NOW)).toBe('3 hours ago');
    expect(timeAgo(NOW - 4 * DAY, NOW)).toBe('4 days ago');
  });

  it('says just now for the first minute', () => {
    expect(timeAgo(NOW, NOW)).toBe('just now');
    expect(timeAgo(NOW - 59 * 1000, NOW)).toBe('just now');
  });

  it('singularizes rather than saying "1 minutes ago"', () => {
    expect(timeAgo(NOW - MINUTE, NOW)).toBe('1 minute ago');
    expect(timeAgo(NOW - HOUR, NOW)).toBe('1 hour ago');
    expect(timeAgo(NOW - DAY, NOW)).toBe('yesterday');
  });

  it('crosses each boundary cleanly', () => {
    expect(timeAgo(NOW - 59 * MINUTE, NOW)).toBe('59 minutes ago');
    expect(timeAgo(NOW - 60 * MINUTE, NOW)).toBe('1 hour ago');
    expect(timeAgo(NOW - 23 * HOUR, NOW)).toBe('23 hours ago');
    expect(timeAgo(NOW - 24 * HOUR, NOW)).toBe('yesterday');
  });

  // "After it goes past the good number of days, it should just give the date."
  it('switches to a date after a fortnight', () => {
    expect(timeAgo(NOW - 13 * DAY, NOW)).toBe('13 days ago');
    expect(timeAgo(NOW - 14 * DAY, NOW)).toBe('Aug 2');
  });

  it('includes the year once it is a different one', () => {
    expect(timeAgo(new Date(2025, 10, 3, 12).getTime(), NOW)).toBe('Nov 3, 2025');
  });

  it('does not read a slightly-ahead clock as a negative age', () => {
    expect(timeAgo(NOW + 30 * 1000, NOW)).toBe('just now');
  });

  it('returns null for anything unusable, so nothing renders', () => {
    expect(timeAgo(null, NOW)).toBeNull();
    expect(timeAgo(undefined, NOW)).toBeNull();
    expect(timeAgo(0, NOW)).toBeNull();
    expect(timeAgo(NaN, NOW)).toBeNull();
    expect(timeAgo('yesterday', NOW)).toBeNull();
  });

  // The Film Club feed's caption fits stars and this on one line.
  it('has a compact form for tight spaces', () => {
    const short = (t) => timeAgo(t, NOW, { short: true });

    expect(short(NOW)).toBe('now');
    expect(short(NOW - 45 * MINUTE)).toBe('45m');
    expect(short(NOW - 3 * HOUR)).toBe('3h');
    expect(short(NOW - DAY)).toBe('yesterday');
    expect(short(NOW - 5 * DAY)).toBe('5d');
    expect(short(new Date(2026, 5, 4, 12).getTime())).toBe('Jun 4');
    expect(short(new Date(2025, 8, 4, 12).getTime())).toBe('9/4/25');
    expect(short(null)).toBeNull();
  });

  // A friend's end-of-day copy stamps each viewing at noon UTC of the day it
  // was watched. Hours would read that noon back as a time ("14h"), which is
  // the one thing the copy exists to hide.
  it('counts an end-of-day copy in calendar days, never hours', () => {
    const day = (t) => timeAgo(t, NOW, { dayOnly: true });
    const short = (t) => timeAgo(t, NOW, { dayOnly: true, short: true });
    const noonUtc = (y, m, d) => Date.UTC(y, m, d, 12);

    // NOW is Aug 16, midday local: yesterday's stamp is ~a day old either way,
    // but a stamp from late last night must still say "yesterday", not "13h".
    expect(day(noonUtc(2026, 7, 15))).toBe('yesterday');
    expect(timeAgo(noonUtc(2026, 7, 15), new Date(2026, 7, 16, 0, 30).getTime(), { dayOnly: true })).toBe('yesterday');
    expect(short(noonUtc(2026, 7, 15))).toBe('yesterday');
    expect(day(noonUtc(2026, 7, 11))).toBe('5 days ago');
    expect(short(noonUtc(2026, 7, 11))).toBe('5d');
    expect(day(noonUtc(2026, 5, 4))).toBe('Jun 4');
    expect(short(noonUtc(2025, 8, 4))).toBe('9/4/25');
    expect(day(null)).toBeNull();
  });
});
