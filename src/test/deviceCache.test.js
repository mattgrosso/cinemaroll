import { describe, it, expect, beforeEach } from 'vitest';
import { deviceCache } from '@/utils/deviceCache.js';
import { trimForWatchlist } from '@/assets/javascript/watchlistLookups.js';

const DAY = 24 * 3600 * 1000;

describe('deviceCache', () => {
  let cache;
  beforeEach(() => {
    cache = deviceCache('test.deviceCache', { maxAgeMs: 7 * DAY, maxEntries: 3 });
    cache.clear();
  });

  it('keeps a value in localStorage for the next launch', () => {
    cache.set('crew:31', [{ id: 1 }], 1000);
    expect(cache.get('crew:31', 1000)).toEqual([{ id: 1 }]);
    expect(JSON.parse(localStorage.getItem('test.deviceCache'))['crew:31'].value).toEqual([{ id: 1 }]);
    // A fresh instance over the same key — a relaunch — still has it.
    const relaunched = deviceCache('test.deviceCache', { maxAgeMs: 7 * DAY, maxEntries: 3 });
    expect(relaunched.get('crew:31', 1000)).toEqual([{ id: 1 }]);
  });

  it('forgets a value after its age limit, so it is asked for again', () => {
    cache.set('a', 1, 0);
    expect(cache.get('a', 6 * DAY)).toBe(1);
    expect(cache.get('a', 8 * DAY)).toBeUndefined();
  });

  it('keeps an empty answer, but never an undefined one', () => {
    cache.setMany([['empty', []], ['missing', undefined]], 0);
    expect(cache.get('empty', 0)).toEqual([]);
    expect(cache.get('missing', 0)).toBeUndefined();
  });

  it('drops the oldest entries past the cap', () => {
    cache.setMany([['a', 1], ['b', 2]], 1);
    cache.setMany([['c', 3], ['d', 4]], 2);
    expect(cache.get('a', 2)).toBeUndefined();
    expect(cache.get('b', 2)).toBe(2);
    expect(cache.get('d', 2)).toBe(4);
  });
});

describe('trimForWatchlist', () => {
  it('keeps what ranking and the rows read, and drops what ranking would', () => {
    const trimmed = trimForWatchlist([
      { id: 1, title: 'Kept', vote_count: 500, vote_average: 7, overview: 'long text', character: 'Joan', genre_ids: [18], poster_path: '/p.jpg' },
      { id: 2, title: 'Too few votes', vote_count: 12 }
    ]);
    expect(trimmed.map((movie) => movie.id)).toEqual([1]);
    expect(trimmed[0]).toMatchObject({ title: 'Kept', vote_count: 500, genre_ids: [18], poster_path: '/p.jpg' });
    expect(trimmed[0].overview).toBeUndefined();
  });
});
