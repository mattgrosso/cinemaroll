import { describe, it, expect } from 'vitest';
import { youOrCrowdRounds, answerFor, balancedDeck, myStars, starLabel, MIN_GAP } from '@/assets/javascript/games/youOrCrowd.js';

// `normalized` is the 0–10 display score; the game compares it halved.
const entry = (id, normalized, poster = '/p.jpg') => ({ dbKey: `k${id}`, movie: { id, title: `Film ${id}`, poster_path: poster }, ratings: [{ normalizedRating: normalized }] });
const getRating = (e) => e.ratings[0];

describe('youOrCrowdRounds', () => {
  it('keeps only films with a poster, a crowd rating and a decisive gap', () => {
    const films = { 1: { rating: 4.4 }, 2: { rating: 1.0 }, 3: { rating: 3.0 }, 4: { rating: 4.9 } };
    const rounds = youOrCrowdRounds([entry(1, 9), entry(2, 9), entry(3, 2), entry(4, 2, null), entry(5, 8)], getRating, films);
    expect(rounds.map((r) => r.tmdbId).sort()).toEqual([2, 3]);
    // 1: 4.5 stars vs 4.4 — within MIN_GAP, a coin flip. 4: no poster. 5: no crowd rating.
    expect(rounds.every((r) => Math.abs(r.gap) >= MIN_GAP)).toBe(true);
  });

  // The report (2026-09-30): the game compared RANKS — your place for a film
  // in your list against its place in the crowd's. Here the crowd rates
  // everything low, so by rank the lowest film is "the crowd's" (both at the
  // bottom of their lists, 0 vs 0) — but by score you're clearly higher on
  // every one.
  it('compares scores on the star scale, not places in each list', () => {
    const films = { 1: { rating: 1.0 }, 2: { rating: 1.5 }, 3: { rating: 2.0 } };
    const rounds = youOrCrowdRounds([entry(1, 6), entry(2, 8), entry(3, 10)], getRating, films);
    expect(rounds).toHaveLength(3);
    expect(rounds.map(answerFor)).toEqual(['you', 'you', 'you']);
    expect(rounds[1]).toMatchObject({ mine: 4, crowd: 1.5, gap: 2.5 });
  });

  it('answers "you" when your stars are higher and "crowd" when theirs are', () => {
    expect(answerFor({ gap: 0.4 })).toBe('you');
    expect(answerFor({ gap: -0.4 })).toBe('crowd');
  });
});

describe('myStars', () => {
  it('halves the normalised 0–10 score, the stars the rating toggle shows', () => {
    expect(myStars({ normalizedRating: 7 })).toBe(3.5);
    expect(myStars({ calculatedTotal: 7 })).toBeNull();
    expect(myStars(null)).toBeNull();
  });
});

describe('balancedDeck', () => {
  it('deals as many "you" answers as "crowd" answers', () => {
    const rounds = [
      ...Array.from({ length: 3 }, (_, i) => ({ id: `y${i}`, gap: 1 })),
      ...Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, gap: -1 }))
    ];
    const deck = balancedDeck(rounds, (list) => [...list]);
    expect(deck).toHaveLength(6);
    expect(deck.filter((row) => answerFor(row) === 'you')).toHaveLength(3);
    expect(deck.filter((row) => answerFor(row) === 'crowd')).toHaveLength(3);
  });
});

describe('starLabel', () => {
  it('prints a star and the given decimals, blank when unknown', () => {
    expect(starLabel(4, 1)).toBe('★ 4.0');
    expect(starLabel(3.867, 2)).toBe('★ 3.87');
    expect(starLabel(null, 1)).toBe('');
  });
});
