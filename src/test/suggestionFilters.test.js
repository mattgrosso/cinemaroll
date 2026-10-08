import { describe, it, expect, beforeEach, vi } from 'vitest';
import { loadRuntimes, knownRuntime, clearRuntimeCache, isSuggestedShort, isVideoExtra, asksForShorts } from '@/assets/javascript/suggestionFilters.js';

describe('suggestionFilters', () => {
  beforeEach(() => clearRuntimeCache());

  it('looks each runtime up once, and retries a failed one next time', async () => {
    const fetchOne = vi.fn((id) => (id === 2 ? Promise.reject(new Error('down')) : Promise.resolve(id * 10)));
    await loadRuntimes([1, 2, 1], fetchOne);
    expect(knownRuntime(1)).toBe(10);
    expect(knownRuntime(2)).toBeUndefined();

    await loadRuntimes([1, 2], fetchOne);
    expect(fetchOne.mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  });

  it('judges a short by the one rule, from either shape', async () => {
    await loadRuntimes([5, 6], (id) => Promise.resolve(id === 5 ? 40 : 41));
    expect(isSuggestedShort({ id: 5 })).toBe(true);
    expect(isSuggestedShort({ id: 6 })).toBe(false);
    expect(isSuggestedShort({ movie: { runtime: 12 } })).toBe(true);
    // Unknown runtime is not a short.
    expect(isSuggestedShort({ id: 7 })).toBe(false);
  });

  it('flags TMDB videos as extras', () => {
    expect(isVideoExtra({ video: true })).toBe(true);
    expect(isVideoExtra({ video: false })).toBe(false);
  });

  it('notices a request for shorts, and not "short on time"', () => {
    expect(asksForShorts('animated shorts')).toBe(true);
    expect(asksForShorts('a short film about grief')).toBe(true);
    expect(asksForShorts("I'm short on time")).toBe(false);
  });
});
