import { describe, it, expect } from 'vitest';
import { getSortValue, isSortValueUnknown, sortResultsFast, applyFilter, buildSearchFields } from '@/assets/javascript/searchFiltering.js';

// Home's Letterboxd pieces (2026-09-29): the crowd-rating sort reads the
// `_crowd` Home decorates from letterboxdFilms, and my review text is one
// more field the plain search reads.
const getRating = (item) => item.ratings[0];
const entry = (id, crowd, calculatedTotal = 7) => ({ dbKey: `k${id}`, movie: { id, title: `Film ${id}`, release_date: '2000-01-01' }, ratings: [{ calculatedTotal }], _crowd: crowd });

describe('sort by Letterboxd rating', () => {
  it('reads _crowd and treats a missing one as unknown', () => {
    expect(getSortValue(entry(1, 4.2), 'letterboxd', getRating)).toBe(4.2);
    expect(getSortValue(entry(2, null), 'letterboxd', getRating)).toBe(-1);
    expect(isSortValueUnknown(entry(2, null), 'letterboxd')).toBe(true);
    expect(isSortValueUnknown(entry(1, 4.2), 'letterboxd')).toBe(false);
  });

  it('sinks unrated films to the bottom in both directions', () => {
    const items = [entry(1, 3.1), entry(2, null), entry(3, 4.5)];
    const best = sortResultsFast(items, { sortValue: 'letterboxd', sortOrder: 'bestOrNewestOnTop', getRating });
    expect(best.map((i) => i.movie.id)).toEqual([3, 1, 2]);
    const worst = sortResultsFast(items, { sortValue: 'letterboxd', sortOrder: 'worstOrOldestOnTop', getRating });
    expect(worst.map((i) => i.movie.id)).toEqual([1, 3, 2]);
  });
});

describe('searching my reviews', () => {
  const withReview = (text) => ({
    movie: { id: 1, title: 'Influencer' },
    ratings: [],
    _search: { ...buildSearchFields({ id: 1, title: 'Influencer' }, []), reviews: [text.toLowerCase()] }
  });

  it('a word from a review finds the film', () => {
    const result = withReview('The biggest spoiler is that it is produced by Shudder.');
    expect(applyFilter(result, { type: 'general', value: 'shudder' })).toBe(true);
    expect(applyFilter(result, { type: 'general', value: 'produced by' })).toBe(true);
    expect(applyFilter(result, { type: 'general', value: 'tarantino' })).toBe(false);
  });

  it('needs at least three characters before prose counts', () => {
    const result = withReview('An ode to joy.');
    expect(applyFilter(result, { type: 'general', value: 'od' })).toBe(false);
    expect(applyFilter(result, { type: 'general', value: 'ode' })).toBe(true);
  });

  it('an entry with no reviews field still works', () => {
    const result = { movie: { id: 2, title: 'Heat' }, ratings: [], _search: buildSearchFields({ id: 2, title: 'Heat' }, []) };
    expect(applyFilter(result, { type: 'general', value: 'heat' })).toBe(true);
    expect(applyFilter(result, { type: 'general', value: 'shudder' })).toBe(false);
  });
});
