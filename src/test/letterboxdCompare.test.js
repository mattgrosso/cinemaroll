import { describe, it, expect } from 'vitest';
import {
  crowdRating,
  cultRatio,
  crowdRows,
  tasteVsCrowd,
  agreementLabel,
  crowdSortValue,
  crowdLovesList,
  disagreeList,
  cultList,
  crowdLine,
  yearVsCrowd,
  clubVsCrowd
} from '@/assets/javascript/letterboxdCompare.js';

const entry = (id, mine, title = `Film ${id}`) => ({ dbKey: `k${id}`, movie: { id, title }, ratings: [{ calculatedTotal: mine }] });
const getRating = (e) => e.ratings[0];

describe('crowdRating / cultRatio', () => {
  const films = { 1: { rating: 4.1, ratingCount: 1000, fans: 80 }, 2: { missing: true }, 3: { failedAt: 5 } };
  it('reads a rating and treats missing or failed films as unknown', () => {
    expect(crowdRating(films, 1)).toBe(4.1);
    expect(crowdRating(films, 2)).toBeNull();
    expect(crowdRating(films, 3)).toBeNull();
    expect(crowdRating(films, 99)).toBeNull();
    expect(crowdRating(null, 1)).toBeNull();
  });
  it('cult ratio is fans per thousand ratings', () => {
    expect(cultRatio(films[1])).toBe(80);
    expect(cultRatio({ rating: 4, ratingCount: 0, fans: 3 })).toBeNull();
  });
});

describe('crowdRows', () => {
  it('ranks both sides within the shared set and drops films without a crowd rating', () => {
    const films = { 1: { rating: 4.5 }, 2: { rating: 3.0 }, 3: { rating: 4.0 } };
    const rows = crowdRows([entry(1, 9), entry(2, 8), entry(3, 5), entry(4, 10)], getRating, films);
    expect(rows.map((r) => r.tmdbId)).toEqual([1, 2, 3]);
    const byId = Object.fromEntries(rows.map((r) => [r.tmdbId, r]));
    expect(byId[1].myPct).toBe(1);
    expect(byId[1].crowdPct).toBe(1);
    expect(byId[1].gap).toBe(0);
    expect(byId[2].gap).toBeCloseTo(0.5); // you rank it middle, the crowd ranks it last
    expect(byId[3].gap).toBeCloseTo(-0.5);
  });

  it('shares ranks on ties', () => {
    const films = { 1: { rating: 4 }, 2: { rating: 4 }, 3: { rating: 3 } };
    const rows = crowdRows([entry(1, 7), entry(2, 8), entry(3, 9)], getRating, films);
    const byId = Object.fromEntries(rows.map((r) => [r.tmdbId, r]));
    expect(byId[1].crowdRank).toBe(1.5);
    expect(byId[2].crowdRank).toBe(1.5);
  });
});

describe('tasteVsCrowd', () => {
  it('is not ready below the minimum', () => {
    const films = { 1: { rating: 4 }, 2: { rating: 3 } };
    expect(tasteVsCrowd([entry(1, 8), entry(2, 6)], getRating, films, { minCount: 20 })).toEqual({ count: 2, ready: false });
  });

  it('perfect agreement is 1, reversed order is -1, and the lists pick the widest gaps', () => {
    const agree = {};
    const disagree = {};
    const entries = [];
    for (let i = 1; i <= 25; i += 1) {
      entries.push(entry(i, i / 2.5));
      agree[i] = { rating: 0.5 + (i / 25) * 4.5 };
      disagree[i] = { rating: 5 - (i / 25) * 4.5 };
    }
    const same = tasteVsCrowd(entries, getRating, agree, { minCount: 20, cap: 3 });
    expect(same.ready).toBe(true);
    expect(same.spearman).toBeCloseTo(1);
    expect(same.label).toBe('in step');
    expect(same.youLove).toEqual([]);
    expect(same.crowdLoves).toEqual([]);

    const flipped = tasteVsCrowd(entries, getRating, disagree, { minCount: 20, cap: 3 });
    expect(flipped.spearman).toBeCloseTo(-1);
    expect(flipped.label).toBe('at odds');
    expect(flipped.youLove.map((r) => r.tmdbId)).toEqual([25, 24, 23]);
    expect(flipped.crowdLoves.map((r) => r.tmdbId)).toEqual([1, 2, 3]);
  });
});

describe('agreementLabel', () => {
  it('words for the bands', () => {
    expect(agreementLabel(0.8)).toBe('in step');
    expect(agreementLabel(0.5)).toBe('mostly in step');
    expect(agreementLabel(0.3)).toBe('loosely related');
    expect(agreementLabel(0)).toBe('on separate paths');
    expect(agreementLabel(-0.5)).toBe('at odds');
    expect(agreementLabel(null)).toBeNull();
  });
});

describe('Home helpers', () => {
  const films = {
    1: { rating: 4.3, ratingCount: 50000, fans: 4000 },
    2: { rating: 4.4, ratingCount: 200, fans: 50 },
    3: { rating: 2.1, ratingCount: 90000, fans: 100 }
  };
  const entries = [entry(1, 9), entry(2, 4), entry(3, 9.5), entry(4, 7)];

  it('sorts unknown films last', () => {
    expect(crowdSortValue(entries[0], films)).toBe(4.3);
    expect(crowdSortValue(entries[3], films)).toBe(-1);
  });

  it('crowd loves needs both a high rating and a real crowd', () => {
    expect(crowdLovesList(entries, films, { minRating: 4, minCount: 1000 }).map((e) => e.movie.id)).toEqual([1]);
  });

  it('disagree lists the widest rank gaps first, either direction', () => {
    // Films 2 and 3 are both a full-scale disagreement (one each way); film 1 agrees.
    const ids = disagreeList(entries, getRating, films, { minGap: 0.4 }).map((e) => e.movie.id);
    expect(ids.sort()).toEqual([2, 3]);
    expect(disagreeList(entries, getRating, films, { minGap: 1.5 })).toEqual([]);
  });

  it('cult films have many fans per rating', () => {
    expect(cultList(entries, films, { minRatio: 40, minCount: 100 }).map((e) => e.movie.id)).toEqual([2, 1]);
  });

  it('crowdLine formats with a compact count when given a formatter', () => {
    expect(crowdLine(films, 1, (n) => `${Math.round(n / 1000)}K`)).toBe('★ 4.30 · 50K');
    expect(crowdLine(films, 1)).toBe('★ 4.30');
    expect(crowdLine(films, 9)).toBeNull();
  });
});

describe('yearVsCrowd', () => {
  const viewing = (id, score, at = 1) => ({ movie: { id, title: `Film ${id}` }, dbKey: `k${id}`, score, at });

  it('counts a film once at its latest score and names the hottest take and the crowd pick', () => {
    const films = {};
    const viewings = [];
    for (let i = 1; i <= 10; i += 1) {
      viewings.push(viewing(i, i));
      films[i] = { rating: 0.5 + i * 0.4, ratingCount: 1000 };
    }
    // Film 10: I loved it (10), the crowd hates it; film 1: reverse.
    films[10] = { rating: 0.6, ratingCount: 1000 };
    films[1] = { rating: 4.9, ratingCount: 1000 };
    viewings.push(viewing(5, 9.5, 2)); // re-rated later in the year
    const result = yearVsCrowd(viewings, films);
    expect(result.ready).toBe(true);
    expect(result.count).toBe(10);
    expect(result.hottest.tmdbId).toBe(10);
    expect(result.crowdPick.tmdbId).toBe(1);
    expect(result.agreed.tmdbId).toBe(9); // high on both sides, no gap
  });

  it('is not ready for a thin year', () => {
    expect(yearVsCrowd([viewing(1, 5)], { 1: { rating: 3 } }).ready).toBe(false);
  });
});

describe('clubVsCrowd', () => {
  const films = {};
  for (let i = 1; i <= 20; i += 1) films[i] = { rating: 0.5 + i * 0.2, ratingCount: 5000 };
  const myEntries = [];
  for (let i = 1; i <= 20; i += 1) myEntries.push(entry(i, i / 2));
  const contrarian = { name: 'Rex', ratings: Object.fromEntries(Array.from({ length: 20 }, (_, k) => [k + 1, { r: 10 - k / 2, t: `Film ${k + 1}` }])) };
  const shelfOnly = { name: 'Shelf', recent: [] };

  it('ranks each person by how their ratings track the crowd, skipping shelf-only sharers', () => {
    const { people } = clubVsCrowd(myEntries, getRating, { a: contrarian, b: shelfOnly }, films);
    expect(people.map((p) => p.who)).toEqual(['You', 'Rex']);
    expect(people[0].spearman).toBeCloseTo(1);
    expect(people[1].spearman).toBeCloseTo(-1);
    expect(people[1].label).toBe('at odds');
  });

  it('lists the films where the club average parts ways with the crowd', () => {
    const { divides } = clubVsCrowd(myEntries, getRating, { a: contrarian }, films);
    expect(divides.length).toBeGreaterThan(0);
    expect(divides[0].scores).toHaveLength(2);
    expect(Math.abs(divides[0].gap)).toBeGreaterThanOrEqual(0.3);
  });
});
