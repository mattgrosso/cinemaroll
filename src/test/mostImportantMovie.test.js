import { describe, it, expect } from 'vitest';
import { PERSONAL_AWARD_CATEGORIES, PERSONAL_AWARD_CATEGORY_NAMES, categoriesForYear } from '@/assets/javascript/personalAwardsCategories.js';
import { entriesEligibleFor } from '@/assets/javascript/awardEligibility.js';
import { categoryKind } from '@/assets/javascript/awardsShare.js';

// Matt, 2026-10-09: "I would like a category for most important movie" — in
// every year, not added by hand as a custom award.
describe('Most Important Movie', () => {
  it('is a standard film category, last in the ceremony', () => {
    const last = PERSONAL_AWARD_CATEGORIES[PERSONAL_AWARD_CATEGORIES.length - 1];
    expect(last).toEqual({ key: 'mostImportantMovie', name: 'Most Important Movie', type: 'movie' });
    expect(PERSONAL_AWARD_CATEGORY_NAMES.mostImportantMovie).toBe('Most Important Movie');
    expect(categoryKind('Most Important Movie')).toBe('movie');
  });

  it('appears in every year, including one with nothing saved', () => {
    expect(categoriesForYear(undefined).map((c) => c.key)).toContain('mostImportantMovie');
    expect(categoriesForYear({ completed: true, categories: {} }).map((c) => c.key)).toContain('mostImportantMovie');
  });

  it('takes any film rated that year', () => {
    const year = [
      { dbKey: 'a', movie: { title: 'Shoah', genres: [{ name: 'Documentary' }], production_countries: [{ iso_3166_1: 'FR' }] } },
      { dbKey: 'b', movie: { title: 'Do the Right Thing', genres: [{ name: 'Drama' }], production_countries: [{ iso_3166_1: 'US' }] } }
    ];
    expect(entriesEligibleFor('mostImportantMovie', year).map((e) => e.movie.title)).toEqual(['Shoah', 'Do the Right Thing']);
  });
});
