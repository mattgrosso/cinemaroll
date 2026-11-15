import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PERSONAL_AWARD_CATEGORIES, PERSONAL_AWARD_CATEGORY_NAMES, categoriesForYear } from '@/assets/javascript/personalAwardsCategories.js';
import { entriesEligibleFor } from '@/assets/javascript/awardEligibility.js';
import { categoryKind, houseCategoryRank } from '@/assets/javascript/awardsShare.js';

// Matt, 2026-11-14: "Matching the Oscars, I want to add ... a best casting
// award", in every year, then "I'll have to go through them and add casting
// nominees" without every finished year reopening.
describe('Best Casting', () => {
  it('is a standard film category, right after the acting awards', () => {
    const keys = PERSONAL_AWARD_CATEGORIES.map((c) => c.key);
    expect(keys.indexOf('bestCasting')).toBe(keys.indexOf('bestSupportingActress') + 1);
    expect(PERSONAL_AWARD_CATEGORIES.find((c) => c.key === 'bestCasting')).toEqual({ key: 'bestCasting', name: 'Best Casting', type: 'movie' });
    expect(PERSONAL_AWARD_CATEGORY_NAMES.bestCasting).toBe('Best Casting');
    expect(categoryKind('Best Casting')).toBe('movie');
  });

  it('lines up with the Academy\'s own Best Casting', () => {
    expect(houseCategoryRank('Best Casting')).toBeLessThan(houseCategoryRank('Best Screenplay or Writing'));
  });

  it('appears in every year, including a finished one, undecided', () => {
    const finished = { completed: true, categories: { bestPicture: { winner: { movieId: 1 } } } };
    expect(categoriesForYear(finished).map((c) => c.key)).toContain('bestCasting');
    expect(categoriesForYear(undefined).map((c) => c.key)).toContain('bestCasting');
  });

  it('takes any film rated that year', () => {
    const year = [{ dbKey: 'a', movie: { title: 'Heat' } }, { dbKey: 'b', movie: { title: 'Shoah', genres: [{ name: 'Documentary' }] } }];
    expect(entriesEligibleFor('bestCasting', year).map((e) => e.movie.title)).toEqual(['Heat', 'Shoah']);
  });

  it('ranks nominees by Performance, in both of the modal\'s sort maps', () => {
    const modal = readFileSync(resolve(__dirname, '../components/PersonalAwardsModal.vue'), 'utf8');
    expect(modal.match(/bestCasting: 'performance'/g)).toHaveLength(2);
  });
});
