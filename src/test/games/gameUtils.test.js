import { describe, it, expect } from 'vitest';
import {
  getEligibleEntries, ratingFor, hashString, makeSeededRng, shuffle, pickRandomDistinct,
  movieYear, movieDecade, movieDirectors, movieCastNames, movieGenreNames,
  movieWriters, movieComposers, movieCinematographers, movieEditors, movieProducers,
  entryKey, compareNumber, matchesAllTokens, rankTitleMatches, typeaheadText
} from '@/assets/javascript/games/gameUtils.js';

function entry (overrides = {}) {
  return {
    dbKey: overrides.dbKey || 'key',
    ratings: overrides.ratings || [{ calculatedTotal: 5 }],
    movie: {
      id: 1,
      title: 'Movie',
      poster_path: '/p.jpg',
      release_date: '2010-05-01',
      runtime: 120,
      crew: [{ name: 'Dir One', job: 'Director' }],
      cast: [{ name: 'Actor One' }, { name: 'Actor Two' }],
      genres: [{ name: 'Drama' }],
      ...overrides.movie
    }
  };
}

describe('getEligibleEntries', () => {
  it('keeps only entries with a poster, release date, and at least one rating', () => {
    const good = entry();
    const noPoster = entry({ movie: { poster_path: null } });
    const noDate = entry({ movie: { release_date: null } });
    const noRatings = entry({ ratings: [] });
    const missingMovie = { dbKey: 'x', ratings: [{ calculatedTotal: 1 }] };

    const result = getEligibleEntries([good, noPoster, noDate, noRatings, missingMovie, null, undefined]);
    expect(result).toEqual([good]);
  });

  it('returns an empty array for falsy input', () => {
    expect(getEligibleEntries(null)).toEqual([]);
    expect(getEligibleEntries(undefined)).toEqual([]);
  });

  describe('shorts filtering (same runtime<=40min threshold as Home.vue)', () => {
    it('excludes shorts by default', () => {
      const feature = entry();
      const short = entry({ dbKey: 'short', movie: { runtime: 30 } });
      expect(getEligibleEntries([feature, short])).toEqual([feature]);
    });

    it('includes shorts when explicitly asked to', () => {
      const feature = entry();
      const short = entry({ dbKey: 'short', movie: { runtime: 30 } });
      const result = getEligibleEntries([feature, short], true);
      expect(result.map((e) => e.dbKey)).toEqual(expect.arrayContaining(['key', 'short']));
    });

    it('does not exclude a movie with no runtime recorded (falsy runtime is not treated as a short)', () => {
      const noRuntime = entry({ movie: { runtime: null } });
      expect(getEligibleEntries([noRuntime])).toEqual([noRuntime]);
    });
  });
});

describe('ratingFor', () => {
  it('reads calculatedTotal from the injected rating function', () => {
    const getRatingFn = () => ({ calculatedTotal: 7.5 });
    expect(ratingFor(entry(), getRatingFn)).toBe(7.5);
  });

  it('defaults to 0 when the rating is missing or malformed', () => {
    expect(ratingFor(entry(), () => null)).toBe(0);
    expect(ratingFor(entry(), () => ({}))).toBe(0);
    expect(ratingFor(null, () => ({ calculatedTotal: 9 }))).toBe(0);
  });
});

describe('hashString + makeSeededRng', () => {
  it('is deterministic: same string -> same hash -> same rng sequence', () => {
    const h1 = hashString('2026-07-21');
    const h2 = hashString('2026-07-21');
    expect(h1).toBe(h2);

    const seq1 = [makeSeededRng(h1)(), makeSeededRng(h1)()];
    const seq2 = [makeSeededRng(h2)(), makeSeededRng(h2)()];
    expect(seq1).toEqual(seq2);
  });

  it('different strings produce different hashes (in the general case)', () => {
    expect(hashString('2026-07-21')).not.toBe(hashString('2026-07-22'));
  });

  it('makeSeededRng produces values in [0, 1)', () => {
    const rng = makeSeededRng(12345);
    for (let i = 0; i < 50; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('shuffle / pickRandomDistinct', () => {
  it('shuffle does not mutate the input and preserves all elements', () => {
    const input = [1, 2, 3, 4, 5];
    const result = shuffle(input, makeSeededRng(1));
    expect(input).toEqual([1, 2, 3, 4, 5]);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('is deterministic for a fixed rng', () => {
    const a = shuffle([1, 2, 3, 4, 5], makeSeededRng(42));
    const b = shuffle([1, 2, 3, 4, 5], makeSeededRng(42));
    expect(a).toEqual(b);
  });

  it('pickRandomDistinct returns the requested count with no duplicates', () => {
    const result = pickRandomDistinct([1, 2, 3, 4, 5], 3, makeSeededRng(7));
    expect(result.length).toBe(3);
    expect(new Set(result).size).toBe(3);
  });
});

describe('movie field helpers', () => {
  it('movieYear / movieDecade read from release_date', () => {
    const e = entry({ movie: { release_date: '1994-09-23' } });
    expect(movieYear(e)).toBe(1994);
    expect(movieDecade(e)).toBe(1990);
  });

  it('movieYear / movieDecade return null when there is no release date', () => {
    const e = entry({ movie: { release_date: null } });
    expect(movieYear(e)).toBeNull();
    expect(movieDecade(e)).toBeNull();
  });

  it('movieDirectors only includes crew with job === "Director"', () => {
    const e = entry({
      movie: {
        crew: [
          { name: 'Real Director', job: 'Director' },
          { name: 'Co-Director Person', job: 'Co-Director' },
          { name: 'Writer Person', job: 'Writer' }
        ]
      }
    });
    expect(movieDirectors(e)).toEqual(['Real Director']);
  });

  it('movieCastNames respects the limit', () => {
    const e = entry({ movie: { cast: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] } });
    expect(movieCastNames(e, 2)).toEqual(['A', 'B']);
  });

  it('movieGenreNames maps genre objects to names', () => {
    const e = entry({ movie: { genres: [{ name: 'Sci-Fi' }, { name: 'Thriller' }] } });
    expect(movieGenreNames(e)).toEqual(['Sci-Fi', 'Thriller']);
  });

  it('movieWriters/Composers/Cinematographers/Editors/Producers loose-match job substrings (movie.crew is unfiltered by job at save time)', () => {
    const e = entry({
      movie: {
        crew: [
          { name: 'Jane Director', job: 'Director' },
          { name: 'Wes Writer', job: 'Screenplay Writer' },
          { name: 'Hans Score', job: 'Original Music Composer' },
          { name: 'Roger Lens', job: 'Director of Photography' },
          { name: 'Thelma Cutter', job: 'Editor' },
          { name: 'Kevin Money', job: 'Executive Producer' },
          { name: 'Someone Else', job: 'Gaffer' }
        ]
      }
    });
    expect(movieWriters(e)).toEqual(['Wes Writer']);
    expect(movieComposers(e)).toEqual(['Hans Score']);
    expect(movieCinematographers(e)).toEqual(['Roger Lens']);
    expect(movieEditors(e)).toEqual(['Thelma Cutter']);
    expect(movieProducers(e)).toEqual(['Kevin Money']);
  });
});

describe('entryKey', () => {
  it('prefers dbKey, falls back to movie.id', () => {
    expect(entryKey(entry({ dbKey: 'abc' }))).toBe('abc');
    expect(entryKey({ movie: { id: 99 } })).toBe(99);
  });
});

describe('compareNumber', () => {
  it('reports match when equal', () => {
    expect(compareNumber(5, 5)).toEqual({ value: 5, direction: 'match', match: true });
  });

  it('reports "up" when the guess is below target, "down" when above', () => {
    expect(compareNumber(3, 5).direction).toBe('up');
    expect(compareNumber(8, 5).direction).toBe('down');
  });

  it('returns a null direction when either value is missing', () => {
    expect(compareNumber(null, 5).direction).toBeNull();
    expect(compareNumber(5, null).direction).toBeNull();
  });
});

describe('matchesAllTokens (bug report: "if I type man space gun it\'s not finding it")', () => {
  it('matches every token in any order, anywhere in the title', () => {
    expect(matchesAllTokens('The Old Man and the Gun', 'man gun')).toBe(true);
    expect(matchesAllTokens('The Old Man and the Gun', 'gun man')).toBe(true);
    expect(matchesAllTokens('The Old Man and the Gun', 'gun')).toBe(true);
    expect(matchesAllTokens('The Old Man and the Gun', 'old man')).toBe(true);
  });

  it('still requires every token to be present', () => {
    expect(matchesAllTokens('The Old Man and the Gun', 'man sword')).toBe(false);
  });

  it('is case-insensitive and tolerant of extra whitespace', () => {
    expect(matchesAllTokens('The Old Man and the Gun', '  MAN   Gun ')).toBe(true);
  });

  it('tokens match inside words, same as the old substring behavior', () => {
    expect(matchesAllTokens('Manchester by the Sea', 'man sea')).toBe(true);
  });

  it('rejects empty or missing input rather than matching everything', () => {
    expect(matchesAllTokens('Anything', '')).toBe(false);
    expect(matchesAllTokens('Anything', '   ')).toBe(false);
    expect(matchesAllTokens(null, 'man')).toBe(false);
  });
});

// Report -P1Px9lCmg (2026-09-13): "In poster zoom the poster was the movie
// 8 1/2 which is stylized with the numerals and when I type an eight it
// didn't come up in the auto complete so I wasn't able to find it."
describe('rankTitleMatches (report -P1Px9lCmg: "8" could not find 8½)', () => {
  const titled = (...titles) => titles.map((title, i) => ({ dbKey: `k${i}`, movie: { id: i, title } }));
  const names = (rows) => rows.map((row) => row.movie.title);

  it('finds 8½ from a single typed character', () => {
    const entries = titled('Heat', '8½', '8 Mile', 'Ocean\'s Eight');
    expect(names(rankTitleMatches(entries, '8'))).toEqual(['8½', '8 Mile']);
  });

  it('finds 8½ typed as 8 1/2, the way the keyboard offers it', () => {
    const entries = titled('Heat', '8½', '8 Mile');
    expect(names(rankTitleMatches(entries, '8 1/2'))).toEqual(['8½']);
  });

  it('puts titles that start with the term first, then words that start with it, then the rest', () => {
    const entries = titled('Human Nature', 'The Man Who Knew Too Much', 'Batman', 'Manhattan');
    expect(names(rankTitleMatches(entries, 'man'))).toEqual(['Manhattan', 'The Man Who Knew Too Much', 'Human Nature', 'Batman']);
  });

  it('still requires every token, in any order', () => {
    const entries = titled('The Old Man and the Gun', 'Top Gun', 'Old Yeller');
    expect(names(rankTitleMatches(entries, 'gun man'))).toEqual(['The Old Man and the Gun']);
  });

  it('caps the list and offers nothing for an empty term', () => {
    const entries = titled(...Array.from({ length: 20 }, (_, i) => `Movie ${i}`));
    expect(rankTitleMatches(entries, 'm')).toHaveLength(8);
    expect(rankTitleMatches(entries, 'm', { limit: 3 })).toHaveLength(3);
    expect(rankTitleMatches(entries, '   ')).toEqual([]);
  });

  it('ignores accents on both sides', () => {
    const entries = titled('Amélie', 'Léon');
    expect(names(rankTitleMatches(entries, 'amelie'))).toEqual(['Amélie']);
    expect(names(rankTitleMatches(entries, 'Léon'))).toEqual(['Léon']);
  });
});

describe('typeaheadText', () => {
  it('spells out fractions and drops accents', () => {
    expect(typeaheadText('8½')).toBe('81/2');
    expect(typeaheadText('Amélie')).toBe('amelie');
  });
});
