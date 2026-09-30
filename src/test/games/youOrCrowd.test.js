import { describe, it, expect } from 'vitest';
import { youOrCrowdRounds, answerFor, percentLabel, MIN_GAP } from '@/assets/javascript/games/youOrCrowd.js';

const entry = (id, mine, poster = '/p.jpg') => ({ dbKey: `k${id}`, movie: { id, title: `Film ${id}`, poster_path: poster }, ratings: [{ calculatedTotal: mine }] });
const getRating = (e) => e.ratings[0];

describe('youOrCrowdRounds', () => {
  it('keeps only films with a poster, a crowd rating and a decisive gap', () => {
    const films = { 1: { rating: 4.5 }, 2: { rating: 1.0 }, 3: { rating: 3.0 }, 4: { rating: 4.9 } };
    // Mine: 1 -> 9 (both love it: agree), 2 -> 9 (I love, crowd hates), 3 -> 2 (I hate, crowd middling), 4 -> 10 but no poster
    const rounds = youOrCrowdRounds([entry(1, 9), entry(2, 9.5), entry(3, 2), entry(4, 10, null), entry(5, 8)], getRating, films);
    const ids = rounds.map((r) => r.tmdbId).sort();
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(ids).not.toContain(4); // no poster
    expect(ids).not.toContain(5); // no crowd rating
    expect(rounds.every((r) => Math.abs(r.gap) >= MIN_GAP)).toBe(true);
  });

  it('answers "you" when you rank it higher and "crowd" when they do', () => {
    expect(answerFor({ gap: 0.4 })).toBe('you');
    expect(answerFor({ gap: -0.4 })).toBe('crowd');
  });
});

describe('percentLabel', () => {
  it('turns a percentile into top-N words, never top 0%', () => {
    expect(percentLabel(0.88)).toBe('top 12%');
    expect(percentLabel(1)).toBe('top 1%');
    expect(percentLabel(0)).toBe('top 100%');
    expect(percentLabel(null)).toBe('');
  });
});
