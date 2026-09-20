import { describe, it, expect } from 'vitest';
import { buildNewsletterProfile, shrunkAverage, MIN_FILMS } from '@/assets/javascript/newsletterProfile.js';

// Scores live only where getRating runs — calculatedTotal is never persisted —
// so the tests inject it exactly as the store does.
const getRating = (entry) => ({ calculatedTotal: entry.score });

const film = ({ id, title, score, year = 2020, crew = [], genres = [], date = '2026-01-01' }) => ({
  score,
  ratings: [{ date }],
  movie: {
    id,
    title,
    release_date: `${year}-05-01`,
    crew,
    genres: genres.map((name) => ({ name }))
  }
});

const byDirector = (name, count, score, startId = 1) =>
  Array.from({ length: count }, (_, i) =>
    film({ id: startId + i, title: `${name} ${i}`, score, crew: [{ name, job: 'Director' }] }));

describe('shrunkAverage', () => {
  // Without the shrink, whoever holds the single highest-rated film tops
  // every list, which is not what "favourite director" means.
  it('pulls a one-film average toward the library average', () => {
    expect(shrunkAverage([9.6], 6)).toBeLessThan(9.6);
  });

  it('barely moves an average built on many films', () => {
    const many = Array.from({ length: 30 }, () => 8.9);
    expect(shrunkAverage(many, 6)).toBeGreaterThan(8.6);
  });
});

describe('buildNewsletterProfile', () => {
  // The whole point of the shrink: eight films at 8.9 is a stronger statement
  // of taste than three at 9.6, so the body of work wins. A raw average would
  // put the higher number on top, which is what this guards against.
  it('a deep body of work outranks a higher average on fewer films', () => {
    const entries = [
      ...byDirector('Steady Hand', 8, 8.9, 100),
      ...byDirector('One Hit', 3, 9.6, 200),
      // Library ballast, so the library average sits well below both.
      ...byDirector('Nobody', 10, 4.0, 300)
    ];
    const profile = buildNewsletterProfile({ entries, getRating });
    expect(profile.directors.map((d) => d.name).slice(0, 2)).toEqual(['Steady Hand', 'One Hit']);
    // Both are pulled down toward the library average, so neither shows its
    // raw score — the ranking is the output, not the number.
    expect(profile.directors[0].average).toBeLessThan(8.9);
    expect(profile.directors[1].average).toBeLessThan(9.6);
  });

  it('leaves out anyone below the film minimum', () => {
    const entries = [
      ...byDirector('Barely Known', MIN_FILMS - 1, 9.9, 1),
      ...byDirector('Known', MIN_FILMS, 7.0, 50)
    ];
    const names = buildNewsletterProfile({ entries, getRating }).directors.map((d) => d.name);
    expect(names).not.toContain('Barely Known');
    expect(names).toContain('Known');
  });

  // Same rule personCredits.js enforces for the Favorite sections, where
  // double-counting actually moved the ranking.
  it('counts a writer credited twice on one film once', () => {
    const entries = Array.from({ length: 3 }, (_, i) => film({
      id: i,
      title: `Adapted ${i}`,
      score: 8,
      crew: [
        { name: 'Michael Crichton', job: 'Novel' },
        { name: 'Michael Crichton', job: 'Screenplay' }
      ]
    }));
    const profile = buildNewsletterProfile({ entries, getRating });
    expect(profile.writers[0]).toMatchObject({ name: 'Michael Crichton', films: 3 });
  });

  it('treats Screenplay and Story as writing credits', () => {
    const entries = [
      film({ id: 1, score: 9, crew: [{ name: 'A Writer', job: 'Screenplay' }] }),
      film({ id: 2, score: 9, crew: [{ name: 'A Writer', job: 'Story' }] }),
      film({ id: 3, score: 9, crew: [{ name: 'A Writer', job: 'Writer' }] })
    ];
    expect(buildNewsletterProfile({ entries, getRating }).writers[0].films).toBe(3);
  });

  it('separates genres he loves from ones he is cool on', () => {
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => film({ id: i, score: 9, genres: ['Drama'] })),
      ...Array.from({ length: 4 }, (_, i) => film({ id: 10 + i, score: 3, genres: ['Horror'] }))
    ];
    const { genres } = buildNewsletterProfile({ entries, getRating });
    expect(genres.loved[0].name).toBe('Drama');
    expect(genres.coolOn[0].name).toBe('Horror');
  });

  // A profile built only from all-time favourites describes who he was. The
  // count window alone doesn't achieve that in a small library — this is the
  // case that made the age window necessary.
  it('recent highs come from recent ratings, not the all-time best', () => {
    const entries = [
      film({ id: 1, title: 'Old Masterpiece', score: 9.9, date: '2015-01-01' }),
      film({ id: 2, title: 'Recent Favourite', score: 8.6, date: '2026-09-01' })
    ];
    const titles = buildNewsletterProfile({
      entries, getRating, now: Date.UTC(2026, 8, 20)
    }).recentHighs.map((r) => r.title);
    expect(titles).toEqual(['Recent Favourite']);
  });

  it('drops a high rating that has aged out of the window', () => {
    const entries = [film({ id: 1, title: 'Two Years Ago', score: 9.4, date: '2024-01-01' })];
    expect(buildNewsletterProfile({ entries, getRating, now: Date.UTC(2026, 8, 20) }).recentHighs)
      .toEqual([]);
  });

  it('leaves a recent dud out of the highs', () => {
    const entries = [film({ id: 1, title: 'Recent Dud', score: 3.2, date: '2026-09-01' })];
    expect(buildNewsletterProfile({ entries, getRating }).recentHighs).toEqual([]);
  });

  // Ids only: a membership test, not the library.
  it('publishes seen ids so the Lambda can exclude them, and nothing heavier', () => {
    const entries = [film({ id: 42, title: 'Seen', score: 8 })];
    const profile = buildNewsletterProfile({ entries, getRating });
    expect(profile.seenIds).toEqual([42]);
    expect(JSON.stringify(profile)).not.toContain('release_date');
  });

  it('survives an empty library without dividing by zero', () => {
    const profile = buildNewsletterProfile({ entries: [], getRating });
    expect(profile.libraryCount).toBe(0);
    expect(Number.isFinite(profile.libraryAverage)).toBe(true);
    expect(profile.directors).toEqual([]);
  });

  it('ignores an entry getRating cannot score', () => {
    const entries = [film({ id: 1, score: 8 }), { movie: { id: 2, crew: [], genres: [] }, ratings: [] }];
    const profile = buildNewsletterProfile({ entries, getRating: (e) => ({ calculatedTotal: e.score }) });
    expect(profile.libraryCount).toBe(2);
    expect(Number.isFinite(profile.libraryAverage)).toBe(true);
  });
});
