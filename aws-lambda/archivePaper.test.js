import { describe, expect, it } from 'vitest';
import { favorites, anniversarySoon, lookupOrder, reviewItem, addToPool } from './archivePaper.js';
import { flatten } from './logPaper.js';

const t = (s) => Date.parse(s);
const now = t('2026-10-28T12:00:00-04:00');
const log = {
  heat: { movie: { id: 949, title: 'Heat', release_date: '1995-12-15' }, ratings: [{ date: t('2020-01-01'), rating: 8.0 }, { date: t('2024-01-01'), rating: 9.5 }] },
  jaws: { movie: { id: 578, title: 'Jaws', release_date: '1975-10-30' }, ratings: [{ date: t('2021-01-01'), rating: 9.0 }] },
  meh: { movie: { id: 1, title: 'Meh', release_date: '1990-01-01' }, ratings: [{ date: t('2021-01-01'), rating: 6.0 }] },
  fresh: { movie: { id: 2, title: 'New One', release_date: '2025-05-01' }, ratings: [{ date: t('2025-06-01'), rating: 9.8 }] }
};
const ebert = { role: 'release', critic: 'Roger Ebert', outlet: 'Chicago Sun-Times', year: 1995, summary: 'A <great> crime film.', url: 'https://www.rogerebert.com/reviews/heat-1995' };

describe('the archive pool', () => {
  it('keeps films he rated 8.5 or higher (his best rating) that are five years old or more', () => {
    expect(favorites(flatten(log), now).map((f) => [f.title, f.rating])).toEqual([['Heat', 9.5], ['Jaws', 9]]);
  });

  it('looks up a film whose release comes round this week first', () => {
    const films = favorites(flatten(log), now);
    expect(anniversarySoon(films[1], now)).toBe(true);
    expect(lookupOrder(films, new Set(), now).map((f) => f.title)).toEqual(['Jaws', 'Heat']);
    expect(lookupOrder(films, new Set(['578']), now).map((f) => f.title)).toEqual(['Heat']);
  });

  it('makes each review one story, named by critic and role, and adds each only once', () => {
    const [heat] = favorites(flatten(log), now);
    const item = reviewItem(heat, ebert, now);
    expect(item.title).toBe('Roger Ebert on Heat, 1995');
    expect(item.content_html).toContain('A &lt;great&gt; crime film.');
    expect(item.content_html).toContain('which you rated 9.5');
    expect(reviewItem(heat, { ...ebert, role: 'revisit', critic: 'Staff review', outlet: 'The Ringer', url: 'https://theringer.com/heat' }, now).title).toBe('Looking back: The Ringer on Heat, 1995');
    const first = addToPool([], [heat], { 949: [ebert, { ...ebert, url: '' }] }, now);
    expect(first.added).toBe(1);
    expect(addToPool(first.items, [heat], { 949: [ebert] }, now).added).toBe(0);
  });
});
