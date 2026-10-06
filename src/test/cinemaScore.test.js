import { describe, it, expect } from 'vitest';
import { cinemaScoreSearchUrl, normalizeTitle, pickCinemaScore, cinemaScoreReading } from '@/assets/javascript/cinemaScore.js';

// Matt, 2026-10-06: CinemaScore on the movie page, "as a review, essentially,
// not as a guide for what I might want to go watch".
describe('cinemaScore', () => {
  it('encodes the title the way the site’s own search does', () => {
    expect(cinemaScoreSearchUrl('Sinners')).toBe('https://webapp.cinemascore.com/guest/search/title/U2lubmVycw==');
    expect(cinemaScoreSearchUrl('Mother!')).toBe('https://webapp.cinemascore.com/guest/search/title/TW90aGVyIQ==');
    // UTF-8, not Latin-1: btoa alone would throw on the accent.
    expect(cinemaScoreSearchUrl('Amélie')).toBe('https://webapp.cinemascore.com/guest/search/title/QW3DqWxpZQ==');
  });

  it('compares titles by letters and digits, dropping a trailing year', () => {
    expect(normalizeTitle('DUNE (2021)')).toBe('DUNE');
    expect(normalizeTitle('Dune: Part Two')).toBe(normalizeTitle('DUNE: PART TWO'));
    expect(normalizeTitle('Fast & Furious')).toBe(normalizeTitle('Fast and Furious'));
    expect(normalizeTitle('One Battle After Another')).toBe('ONEBATTLEAFTERANOTHER');
  });

  const dunes = [
    { TITLE: 'DUNE (2021)', GRADE: 'A-', YEAR: '2021' },
    { TITLE: 'DUNE: PART TWO', GRADE: 'A', YEAR: '2024' }
  ];

  it('picks the exact title, never the substring match the search also returns', () => {
    expect(pickCinemaScore(dunes, { title: 'Dune', year: 2021 })).toEqual({ title: 'DUNE (2021)', grade: 'A-', year: 2021 });
    expect(pickCinemaScore(dunes, { title: 'Dune: Part Two', year: 2024 })).toEqual({ title: 'DUNE: PART TWO', grade: 'A', year: 2024 });
    expect(pickCinemaScore(dunes, { title: 'Dune Messiah', year: 2027 })).toBeNull();
  });

  it('uses the year to tell remakes apart, a year either way', () => {
    const remakes = [
      { TITLE: 'THE THING (1982)', GRADE: 'B', YEAR: '1982' },
      { TITLE: 'THE THING (2011)', GRADE: 'B-', YEAR: '2011' }
    ];
    expect(pickCinemaScore(remakes, { title: 'The Thing', year: 2011 }).grade).toBe('B-');
    // A December release polled in January.
    expect(pickCinemaScore(remakes, { title: 'The Thing', year: 1981 }).grade).toBe('B');
    // Neither year is close: no guess.
    expect(pickCinemaScore(remakes, { title: 'The Thing', year: 1951 })).toBeNull();
    // One candidate and no year to check: fine.
    expect(pickCinemaScore([remakes[0]], { title: 'The Thing' }).grade).toBe('B');
    // Two candidates and no year: ambiguous, so nothing.
    expect(pickCinemaScore(remakes, { title: 'The Thing' })).toBeNull();
  });

  it('is quiet on empty, malformed, or gradeless answers', () => {
    expect(pickCinemaScore([], { title: 'Sinners', year: 2025 })).toBeNull();
    expect(pickCinemaScore(null, { title: 'Sinners', year: 2025 })).toBeNull();
    expect(pickCinemaScore([{ TITLE: 'SINNERS', YEAR: '2025' }], { title: 'Sinners', year: 2025 })).toBeNull();
    expect(pickCinemaScore(dunes, { title: '', year: 2021 })).toBeNull();
  });

  it('has a reading for every grade on the card', () => {
    for (const grade of ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F']) {
      expect(cinemaScoreReading(grade)).not.toBe('');
    }
    expect(cinemaScoreReading('A+')).toMatch(/rarest/);
    expect(cinemaScoreReading('F')).toMatch(/hated/);
    expect(cinemaScoreReading('')).toBe('');
  });
});
