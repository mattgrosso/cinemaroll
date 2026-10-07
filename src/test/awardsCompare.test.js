import { describe, it, expect } from 'vitest';
import { agreementStats, mostDecoratedFilms, mostHonouredPeople, academyAlignment } from '@/assets/javascript/awardsCompare.js';

// Matt, 2026-10-07: "some other comparison views for our personal awards".
const won = (year, label, name) => ({ year, category: label.toLowerCase().replace(/ /g, ''), label, result: 'won', ...(name ? { name } : {}) });
const nom = (year, label) => ({ year, category: label.toLowerCase().replace(/ /g, ''), label, result: 'nominated' });
const titles = { 1: { t: 'One Battle After Another', p: '/o.jpg' }, 2: { t: 'Sinners', p: '/s.jpg' }, 3: { t: 'Anora', p: '/a.jpg' }, 4: { t: 'The Brutalist', p: null } };
const matt = { name: 'Matt', ceremony: 'The Groskers', titles, awards: {
  1: [won(2025, 'Best Picture'), won(2025, 'Best Director', 'Paul Thomas Anderson'), won(2025, 'Best Supporting Actor', 'Benicio del Toro')],
  2: [won(2025, 'Best Actor', 'Michael B. Jordan'), nom(2025, 'Best Picture')],
  4: [won(2024, 'Best Picture')]
} };
const brian = { name: 'Brian', ceremony: 'Goegan Globes', titles, awards: {
  1: [won(2025, 'Best Picture', 'Adam Somner'), won(2025, 'Best Picture', 'Sara Murphy'), won(2025, 'Best Director', 'Paul Thomas Anderson'), won(2025, 'Best Supporting Actor', 'Sean Penn')],
  2: [won(2025, 'Best Actor', 'Michael B. Jordan')],
  3: [won(2024, 'Best Picture')]
} };
const academy = [
  { year: 2025, category: 'Best Picture', isWinner: true, tmdb: '1', title: 'One Battle After Another' },
  { year: 2025, category: 'Best Picture', isWinner: false, tmdb: '2', title: 'Sinners' },
  { year: 2024, category: 'Best Picture', isWinner: true, tmdb: '3', title: 'Anora' }
];

describe('agreementStats', () => {
  it('counts only contested categories, and finds the most agreeable year', () => {
    const stats = agreementStats([matt, brian]);
    expect(stats.years).toEqual([{ year: 2025, categories: 4, agreed: 3 }, { year: 2024, categories: 1, agreed: 0 }]);
    expect(stats).toMatchObject({ categories: 5, agreed: 3, rate: 0.6 });
    expect(stats.bestYear).toEqual({ year: 2025, categories: 4, agreed: 3 });
    expect(agreementStats([matt]).categories).toBe(0);
  });
});

describe('mostDecoratedFilms', () => {
  it('totals wins across ceremonies, one per member per category, producers notwithstanding', () => {
    const [top, second] = mostDecoratedFilms([matt, brian]);
    expect(top).toMatchObject({ movieId: 1, title: 'One Battle After Another', wins: 6, by: [{ ceremony: 'Goegan Globes', wins: 3 }, { ceremony: 'The Groskers', wins: 3 }] });
    expect(second).toMatchObject({ movieId: 2, wins: 2 });
  });
});

describe('mostHonouredPeople', () => {
  it('counts person awards only, across members', () => {
    const people = mostHonouredPeople([matt, brian]);
    expect(people.find((p) => p.name === 'Paul Thomas Anderson')).toMatchObject({ wins: 2, films: [{ movieId: 1, title: 'One Battle After Another' }], by: [{ ceremony: 'Goegan Globes', wins: 1 }, { ceremony: 'The Groskers', wins: 1 }] });
    expect(people.map((p) => p.name)).toEqual(['Michael B. Jordan', 'Paul Thomas Anderson', 'Benicio del Toro', 'Sean Penn']);
    expect(people.find((p) => p.name === 'Adam Somner')).toBeUndefined();
  });
});

describe('academyAlignment', () => {
  it('scores each member\'s Best Picture against the Oscars, most aligned first', () => {
    const rows = academyAlignment([matt, brian], academy);
    expect(rows[0]).toMatchObject({ who: 'Brian', years: 2, matches: 2, rate: 1, agreedYears: [2024, 2025], latestMiss: null });
    expect(rows[1]).toMatchObject({ who: 'Matt', years: 2, matches: 1, rate: 0.5, agreedYears: [2025] });
    expect(rows[1].latestMiss).toEqual({ year: 2024, theirs: { movieId: 4, title: 'The Brutalist' }, academy: { movieId: 3, title: 'Anora' } });
    expect(academyAlignment([matt], [])).toEqual([]);
  });
});
