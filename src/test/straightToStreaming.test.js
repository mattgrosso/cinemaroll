import { describe, it, expect } from 'vitest';
import { streamingWindowStart, hadWideRelease, streamingService, streamingCheck, rankStraightToStreaming } from '@/assets/javascript/discover.js';

// Bug report, 2026-10-25: "It's easy for streaming movies to just go by more
// or less unnoticed. Let's add a watch list of popular movies that went
// straight to streaming recently."
const NOW = new Date('2026-10-25T12:00:00Z').getTime();

const releases = (region, ...types) => ({
  results: [{ iso_3166_1: region, release_dates: types.map((type) => ({ type })) }]
});
const providers = (...flatrate) => ({ results: { US: { flatrate } } });

describe('straight to streaming', () => {
  it('looks back a year from today', () => {
    expect(streamingWindowStart(NOW)).toBe('2025-10-25');
  });

  it('a wide US theatrical release disqualifies a film', () => {
    expect(hadWideRelease(releases('US', 1, 3, 4))).toBe(true);
  });

  it('a limited run does not — streaming originals often get one', () => {
    expect(hadWideRelease(releases('US', 2, 4))).toBe(false);
  });

  it('only the US release counts: a wide opening abroad is still unseen here', () => {
    expect(hadWideRelease(releases('FR', 3))).toBe(false);
    expect(hadWideRelease(undefined)).toBe(false);
  });

  it('names the service, preferring the plain one over a resold channel or ad tier', () => {
    expect(streamingService(providers(
      { provider_name: 'HBO Max Amazon Channel', display_priority: 1 },
      { provider_name: 'HBO Max', display_priority: 2 }
    ))).toBe('HBO Max');
    expect(streamingService(providers({ provider_name: 'Netflix Standard with Ads', display_priority: 1 }))).toBe('Netflix');
    expect(streamingService(providers())).toBeNull();
  });

  it('reads both answers out of one TMDB details payload', () => {
    expect(streamingCheck({
      release_dates: releases('US', 4),
      'watch/providers': providers({ provider_name: 'Netflix', display_priority: 0 })
    })).toEqual({ wide: false, service: 'Netflix' });
  });

  const movie = (id, extra = {}) => ({ id, title: `Film ${id}`, release_date: '2026-05-01', vote_average: 7, vote_count: 500, ...extra });

  it('keeps only unchecked-out, never-wide films a service still carries, each with its service', () => {
    const checks = new Map([
      [1, { wide: false, service: 'Netflix' }],
      [2, { wide: true, service: 'Peacock' }],
      [3, { wide: false, service: null }]
      // 4 never got a check (its lookup failed)
    ]);
    const ranked = rankStraightToStreaming([movie(1), movie(2), movie(3), movie(4)], checks, new Set(), NOW);
    expect(ranked.map((m) => [m.id, m.service])).toEqual([[1, 'Netflix']]);
  });

  it('skips films already rated or excluded (hatted, dismissed)', () => {
    const checks = { 1: { wide: false, service: 'Netflix' }, 2: { wide: false, service: 'Netflix' }, 3: { wide: false, service: 'Netflix' } };
    const ranked = rankStraightToStreaming([movie(1), movie(2), movie(3)], checks, new Set([1]), NOW, { exclude: (m) => m.id === 2 });
    expect(ranked.map((m) => m.id)).toEqual([3]);
  });

  it('a genre you love lifts a film over a slightly better-rated one', () => {
    const checks = { 1: { wide: false, service: 'Netflix' }, 2: { wide: false, service: 'Netflix' } };
    const ranked = rankStraightToStreaming(
      [movie(1, { vote_average: 7.2, genre_ids: [27] }), movie(2, { vote_average: 7, genre_ids: [99] })],
      checks, new Set(), NOW, { profile: { 27: -1, 99: 1 } }
    );
    expect(ranked.map((m) => m.id)).toEqual([2, 1]);
  });

  it('lets a recent film in on fewer votes than the older rows ask for', () => {
    const checks = { 1: { wide: false, service: 'Netflix' } };
    expect(rankStraightToStreaming([movie(1, { vote_count: 30 })], checks, new Set(), NOW)).toHaveLength(1);
  });
});
