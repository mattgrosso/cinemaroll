import { describe, it, expect } from 'vitest';
import {
  collectPlayableKeywords,
  pickKeyword,
  entryHasKeyword,
  traitsOf,
  affinityScore,
  buildStampRound,
  resolveSwipe,
  keywordChangeFor
} from '../../assets/javascript/games/stamp.js';

let nextId = 1;
const movie = ({
  keywords = [], aiKeywords = [], customKeywords = [], removedKeywords = [],
  directors = [], cast = [], genres = ['Drama'], year = 2015
} = {}) => {
  const id = nextId++;
  return {
    dbKey: `key-${id}`,
    movie: {
      id,
      title: `Movie ${id}`,
      poster_path: `/p${id}.jpg`,
      release_date: `${year}-06-15`,
      genres: genres.map((name) => ({ name })),
      keywords: keywords.map((name) => ({ name })),
      chatGPTKeywords: aiKeywords,
      customKeywords,
      removedKeywords,
      crew: directors.map((name) => ({ name, job: 'Director' })),
      cast: cast.map((name) => ({ name, character: 'Someone' }))
    },
    ratings: [{ calculatedTotal: 7, date: Date.now() }]
  };
};

// Deterministic "shuffle" so round composition is testable.
const noShuffle = () => 0;

describe('entryHasKeyword', () => {
  it('matches case-insensitively across TMDB and AI keywords', () => {
    expect(entryHasKeyword(movie({ keywords: ['Heist'] }), 'heist')).toBe(true);
    expect(entryHasKeyword(movie({ aiKeywords: ['dinosaurs'] }), 'Dinosaurs')).toBe(true);
    expect(entryHasKeyword(movie({ keywords: ['Heist'] }), 'romance')).toBe(false);
  });

  it('respects a keyword the user removed', () => {
    // computeFlatKeywords subtracts removedKeywords, and this game has to agree
    // with what the movie page shows.
    expect(entryHasKeyword(movie({ keywords: ['Heist'], removedKeywords: ['Heist'] }), 'heist')).toBe(false);
  });
});

describe('collectPlayableKeywords', () => {
  const withKeyword = (count, options) => Array.from({ length: count }, () => movie(options));

  it('skips keywords with too few examples to learn from', () => {
    const entries = [...withKeyword(6, { keywords: ['heist'] }), ...withKeyword(2, { keywords: ['rare'] })];
    const words = collectPlayableKeywords(entries).map((k) => k.keyword);

    expect(words).toContain('heist');
    expect(words).not.toContain('rare');
  });

  it('skips broad labels that are on too much of the library', () => {
    // "friendship" is on 359 movies in the real library — four of those share
    // nothing a player can meaningfully confirm.
    const entries = withKeyword(60, { keywords: ['friendship'] });
    expect(collectPlayableKeywords(entries, { min: 5, max: 40 })).toEqual([]);
  });

  it('tracks how many of the examples came from the AI', () => {
    const entries = [
      ...withKeyword(4, { aiKeywords: ['dinosaurs'] }),
      ...withKeyword(3, { keywords: ['dinosaurs'] })
    ];
    const found = collectPlayableKeywords(entries).find((k) => k.keyword === 'dinosaurs');

    expect(found.count).toBe(7);
    expect(found.aiCount).toBe(4);
  });

  it('tolerates an empty library', () => {
    expect(collectPlayableKeywords([])).toEqual([]);
    expect(collectPlayableKeywords(null)).toEqual([]);
  });
});

describe('pickKeyword', () => {
  const playable = [
    { keyword: 'tmdb only', count: 9, aiCount: 0 },
    { keyword: 'ai backed', count: 6, aiCount: 6 }
  ];

  it('prefers keywords the AI generated', () => {
    // "even better, the ones that we have AI generating" — those are the
    // least-checked data in the library.
    expect(pickKeyword(playable, () => 0).keyword).toBe('ai backed');
    expect(pickKeyword(playable, () => 0.99).keyword).toBe('ai backed');
  });

  it('falls back to any eligible keyword when none are AI-backed', () => {
    expect(pickKeyword([playable[0]], () => 0).keyword).toBe('tmdb only');
  });

  it('avoids handing back the keyword just finished', () => {
    expect(pickKeyword(playable, () => 0, 'ai backed').keyword).toBe('tmdb only');
  });

  it('will reuse the only keyword there is rather than return nothing', () => {
    expect(pickKeyword([playable[0]], () => 0, 'tmdb only').keyword).toBe('tmdb only');
  });

  it('returns null when there is nothing at all', () => {
    expect(pickKeyword([], () => 0)).toBeNull();
  });
});

describe('affinityScore', () => {
  // The whole point: "what movies might fit the tag but don't have it yet?"
  // The already-tagged movies define the tag; everything else is scored by how
  // much it resembles them.
  const taggedTraits = [traitsOf(movie({ directors: ['Agnes Varda'], keywords: ['heist', 'paris'], genres: ['Crime'], year: 1975 }))];

  it('scores a shared director above a shared genre', () => {
    const sameDirector = affinityScore(traitsOf(movie({ directors: ['Agnes Varda'], genres: ['Comedy'], year: 2020 })), taggedTraits);
    const sameGenre = affinityScore(traitsOf(movie({ directors: ['Someone Else'], genres: ['Crime'], year: 2020 })), taggedTraits);

    expect(sameDirector).toBeGreaterThan(sameGenre);
  });

  it('scores shared keywords above a shared genre', () => {
    const sharedKeywords = affinityScore(traitsOf(movie({ keywords: ['heist', 'paris'], genres: ['Comedy'], year: 2020 })), taggedTraits);
    const sharedGenre = affinityScore(traitsOf(movie({ genres: ['Crime'], year: 2020 })), taggedTraits);

    expect(sharedKeywords).toBeGreaterThan(sharedGenre);
  });

  it('gives nothing to a movie with nothing in common', () => {
    expect(affinityScore(traitsOf(movie({ directors: ['Nobody'], genres: ['Horror'], year: 2020 })), taggedTraits)).toBe(0);
  });

  it('counts evidence across MULTIPLE tagged movies, not just the best single match', () => {
    const oneMatch = [traitsOf(movie({ directors: ['Agnes Varda'] }))];
    const threeMatches = Array.from({ length: 3 }, () => traitsOf(movie({ directors: ['Agnes Varda'] })));
    const candidate = traitsOf(movie({ directors: ['Agnes Varda'], genres: ['Nothing'] }));

    expect(affinityScore(candidate, threeMatches)).toBeGreaterThan(affinityScore(candidate, oneMatch));
  });

  it('caps how much one very keyword-heavy movie can contribute', () => {
    // Without a cap, a film sharing 30 keywords with one tagged movie would
    // outrank a director shared across the whole tagged set.
    const many = traitsOf(movie({ keywords: Array.from({ length: 30 }, (_, i) => `kw${i}`) }));
    const tagged = [traitsOf(movie({ keywords: Array.from({ length: 30 }, (_, i) => `kw${i}`), genres: ['Nothing'] }))];

    expect(affinityScore(many, tagged)).toBeLessThanOrEqual(3 * 3 + 2 * 1 + 1);
  });
});

describe('buildStampRound', () => {
  const taggedSet = (count, extra = {}) =>
    Array.from({ length: count }, () => movie({ aiKeywords: ['cosy'], ...extra }));

  it('returns nothing when the tag has no examples to learn from', () => {
    expect(buildStampRound([movie()], 'nonexistent').cards).toEqual([]);
  });

  it('builds a round of the requested size', () => {
    const entries = [...taggedSet(8), ...Array.from({ length: 40 }, () => movie())];
    expect(buildStampRound(entries, 'cosy', { rng: noShuffle }).cards).toHaveLength(20);
  });

  it('flags each card with whether the movie currently carries the tag', () => {
    const entries = [...taggedSet(8), ...Array.from({ length: 40 }, () => movie())];
    const { cards } = buildStampRound(entries, 'cosy', { rng: noShuffle });

    cards.forEach((card) => {
      expect(card.hasTag).toBe(entryHasKeyword(card.entry, 'cosy'));
    });
  });

  it('mixes already-tagged movies in for verification', () => {
    const entries = [...taggedSet(8), ...Array.from({ length: 40 }, () => movie())];
    const { cards } = buildStampRound(entries, 'cosy', { rng: noShuffle });

    expect(cards.filter((c) => c.hasTag).length).toBeGreaterThan(0);
    // ...but not ONLY tagged ones, or it's a re-confirmation chore.
    expect(cards.filter((c) => !c.hasTag).length).toBeGreaterThan(0);
  });

  it('prefers untagged movies that resemble the tagged ones', () => {
    const entries = [
      ...taggedSet(5, { directors: ['Agnes Varda'] }),
      // A strong candidate: same director, currently without the keyword.
      movie({ directors: ['Agnes Varda'] }),
      ...Array.from({ length: 40 }, () => movie({ directors: ['Nobody At All'], genres: ['Horror'], year: 1930 }))
    ];

    const { cards } = buildStampRound(entries, 'cosy', { rng: noShuffle });
    const suggested = cards.find((c) => !c.hasTag && c.entry.movie.crew.some((p) => p.name === 'Agnes Varda'));

    expect(suggested).toBeTruthy();
  });

  it('never puts the same movie in a round twice', () => {
    const entries = [...taggedSet(8, { directors: ['Shared'] }), ...Array.from({ length: 40 }, () => movie({ directors: ['Shared'] }))];
    const { cards } = buildStampRound(entries, 'cosy', { rng: noShuffle });

    const keys = cards.map((c) => c.entry.dbKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('still builds a (shorter) round in a small library', () => {
    const entries = [...taggedSet(3), movie(), movie()];
    const { cards } = buildStampRound(entries, 'cosy', { rng: noShuffle });

    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(5);
  });
});

describe('resolveSwipe', () => {
  it('names each outcome', () => {
    expect(resolveSwipe({ hasTag: false, verdict: 'yes' })).toBe('added');
    expect(resolveSwipe({ hasTag: true, verdict: 'no' })).toBe('removed');
    expect(resolveSwipe({ hasTag: true, verdict: 'yes' })).toBe('confirmed');
    expect(resolveSwipe({ hasTag: false, verdict: 'no' })).toBe('declined');
  });

  it('a pass is always a no-op, whatever the current state', () => {
    // "sometimes I'm not certain, and I don't wanna accidentally remove a tag
    // if it does make sense." Passing must never be destructive.
    expect(resolveSwipe({ hasTag: true, verdict: 'pass' })).toBe('passed');
    expect(resolveSwipe({ hasTag: false, verdict: 'pass' })).toBe('passed');
  });
});

describe('keywordChangeFor', () => {
  it('adds a brand-new keyword to customKeywords', () => {
    const { customKeywords } = keywordChangeFor(movie({}).movie, 'heist', true);
    expect(customKeywords).toEqual(['heist']);
  });

  it('does NOT duplicate a keyword that already exists upstream — it just un-removes it', () => {
    // The keyword came from TMDB and was removed; putting it back means
    // dropping it from removedKeywords, not adding a custom copy.
    const source = movie({ keywords: ['Heist'], removedKeywords: ['Heist'] }).movie;
    const next = keywordChangeFor(source, 'Heist', true);

    expect(next.removedKeywords).toEqual([]);
    expect(next.customKeywords).toEqual([]);
  });

  it('removes by adding to removedKeywords, since TMDB/AI keywords cannot just be deleted', () => {
    const source = movie({ aiKeywords: ['dinosaurs'] }).movie;
    const next = keywordChangeFor(source, 'dinosaurs', false);

    expect(next.removedKeywords).toEqual(['dinosaurs']);
  });

  it('drops a user-added keyword from customKeywords when removed', () => {
    const source = movie({ customKeywords: ['heist'] }).movie;
    const next = keywordChangeFor(source, 'heist', false);

    expect(next.customKeywords).toEqual([]);
    expect(next.removedKeywords).toEqual(['heist']);
  });

  it('does not duplicate an existing removal', () => {
    const source = movie({ keywords: ['heist'], removedKeywords: ['heist'] }).movie;
    expect(keywordChangeFor(source, 'heist', false).removedKeywords).toEqual(['heist']);
  });

  it('leaves everything alone for a blank keyword', () => {
    const source = movie({ customKeywords: ['a'], removedKeywords: ['b'] }).movie;
    expect(keywordChangeFor(source, '  ', true)).toEqual({ customKeywords: ['a'], removedKeywords: ['b'] });
  });

  it('round-trips: removing then re-adding leaves it visible again', () => {
    const source = movie({ keywords: ['heist'] }).movie;
    const removed = keywordChangeFor(source, 'heist', false);
    const restored = keywordChangeFor({ ...source, ...removed }, 'heist', true);

    expect(restored.removedKeywords).toEqual([]);
  });
});
