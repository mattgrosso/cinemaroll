import { describe, it, expect, vi } from 'vitest';

// Report 2026-10-16: a movie page's awards should read in the awards page's
// order. The real dataset happens to list most films tidily, so this file
// hands findOtherAwardsForMovie a deliberately shuffled one.
vi.mock('@/assets/data/otherAwardsWinners.json', () => ({
  default: [
    { ceremony: 'Venice Film Festival', category: 'Golden Lion', year: 2020, title: 'Test Film', isWinner: true, tmdb: 7 },
    { ceremony: 'Golden Globe Awards', category: 'Best Director', year: 2020, title: 'Test Film', isWinner: true, tmdb: 7 },
    { ceremony: 'BAFTA Awards', category: 'Best Film', year: 2020, title: 'Test Film', isWinner: true, tmdb: 7 },
    { ceremony: 'Golden Globe Awards', category: 'Best Motion Picture – Drama', year: 2020, title: 'Test Film', isWinner: true, tmdb: 7 },
    { ceremony: 'Cannes Film Festival', category: "Palme d'Or", year: 2020, title: 'Test Film', isWinner: true, tmdb: 7 }
  ]
}));

const { findOtherAwardsForMovie } = await import('@/assets/javascript/otherAwards.js');

describe('findOtherAwardsForMovie — order', () => {
  it('ceremonies as the awards page tabs run them, the top prize first within each', () => {
    const { wins } = findOtherAwardsForMovie({ id: 7, title: 'Test Film', release_date: '2020-09-01' });
    expect(wins.map((w) => `${w.ceremony} · ${w.category}`)).toEqual([
      'Golden Globe Awards · Best Motion Picture – Drama',
      'Golden Globe Awards · Best Director',
      'BAFTA Awards · Best Film',
      'Cannes Film Festival · Palme d\'Or',
      'Venice Film Festival · Golden Lion'
    ]);
  });
});
