import { describe, it, expect } from 'vitest';
import { summarize } from '../../scripts/delta-shadow-report.mjs';

// The phase-2 decision rests on these numbers, so they get tested rather than
// eyeballed. Shadow mode has been running since v1.45.15 but its readings only
// ever existed in localStorage on whichever device ran the check.
const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 7, 16, 12).getTime();

const reading = (daysAgo, identical = true, extra = {}) => ({
  at: NOW - daysAgo * DAY,
  identical,
  compared: 1374,
  deltaEntries: 3,
  missing: 0,
  stale: 0,
  extra: 0,
  ...extra
});

describe('summarize', () => {
  it('reports nothing when there is nothing to report', () => {
    expect(summarize({}).count).toBe(0);
    expect(summarize(null).count).toBe(0);
  });

  it('counts the readings and the span they cover', () => {
    const summary = summarize({ a: reading(10), b: reading(5), c: reading(0) }, NOW);

    expect(summary.count).toBe(3);
    expect(summary.spanDays).toBe(10);
    expect(summary.sinceLastDays).toBe(0);
  });

  // The distinction that matters: an old divergence that hasn't recurred is
  // not the same as one yesterday.
  it('counts the CURRENT clean streak, not the total clean count', () => {
    const summary = summarize({
      a: reading(9),
      b: reading(8, false, { stale: 2 }),
      c: reading(3),
      d: reading(1)
    }, NOW);

    expect(summary.count).toBe(4);
    expect(summary.diverged).toHaveLength(1);
    expect(summary.streak).toBe(2);
  });

  it('reports a zero streak when the most recent launch diverged', () => {
    const summary = summarize({ a: reading(5), b: reading(0, false, { missing: 1 }) }, NOW);

    expect(summary.streak).toBe(0);
    expect(summary.diverged).toHaveLength(1);
  });

  it('orders by time regardless of the key order it was read in', () => {
    const summary = summarize({ z: reading(0), a: reading(7) }, NOW);

    expect(summary.spanDays).toBe(7);
    expect(summary.sinceLastDays).toBe(0);
  });

  it('ignores malformed readings rather than counting them', () => {
    const summary = summarize({ a: reading(1), b: null, c: { identical: true } }, NOW);

    expect(summary.count).toBe(1);
  });

  // Sentry, 2026-10-20: a save landing between the two reads is not the
  // delta path being wrong, and must not make the report say "NOT safe".
  it('counts a write race apart from divergences, without breaking the streak', () => {
    const summary = summarize({
      a: reading(3),
      b: reading(2, false, { stale: 1, race: true }),
      c: reading(1)
    }, NOW);

    expect(summary.diverged).toHaveLength(0);
    expect(summary.races).toHaveLength(1);
    expect(summary.streak).toBe(3);
  });
});
