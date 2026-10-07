import { describe, it, expect, vi } from 'vitest';
import { reportFeedFallback, fallbackReportDue, REPORT_EVERY_MS } from '@/utils/syncFallbackReport.js';

// Matt (2026-10-06): "if we ever do stop validating, catch it quickly."
describe('reportFeedFallback', () => {
  const feedUrl = 'https://movie-log-ae673-default-rtdb.firebaseio.com/clubFeed/brian/secret.json';

  it('reports an established feed that fell back, as a fingerprinted Sentry warning naming the reason', async () => {
    const capture = vi.fn(async () => {});
    const seen = new Map();
    const sent = await reportFeedFallback({ friendName: 'Brian', feedUrl, reason: 'body-mismatch', established: true, now: 1000, capture, seen });
    expect(sent).toBe(true);
    expect(capture).toHaveBeenCalledWith('Film Club feed fell back to v1: Brian (body-mismatch)', {
      level: 'warning',
      tags: { feature: 'film-club-sync', reason: 'body-mismatch', feedHost: 'movie-log-ae673-default-rtdb.firebaseio.com' },
      fingerprint: ['film-club-v2-fallback', 'movie-log-ae673-default-rtdb.firebaseio.com', 'Brian']
    });
  });

  it('never reports a peer that has not supported v2, and reports a given feed at most hourly', async () => {
    const capture = vi.fn(async () => {});
    const seen = new Map();
    expect(await reportFeedFallback({ friendName: 'Old App', feedUrl, reason: 'no-meta', established: false, capture, seen })).toBe(false);
    expect(await reportFeedFallback({ friendName: 'Brian', feedUrl, reason: 'gap', established: true, now: 1000, capture, seen })).toBe(true);
    expect(await reportFeedFallback({ friendName: 'Brian', feedUrl, reason: 'gap', established: true, now: 1000 + REPORT_EVERY_MS - 1, capture, seen })).toBe(false);
    expect(await reportFeedFallback({ friendName: 'Brian', feedUrl, reason: 'gap', established: true, now: 1000 + REPORT_EVERY_MS, capture, seen })).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(fallbackReportDue('x', 5, new Map())).toBe(true);
  });

  it('a failing capture is swallowed, never thrown into the sync', async () => {
    const capture = vi.fn(async () => { throw new Error('offline'); });
    await expect(reportFeedFallback({ friendName: 'Brian', feedUrl, reason: 'gap', established: true, capture, seen: new Map() })).resolves.toBe(true);
  });
});
