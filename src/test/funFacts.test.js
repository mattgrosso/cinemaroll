import { describe, it, expect } from 'vitest';
import { totalWatchTime, decadeDna, busiestMonth, genreSplit, biggestDay, oldestMovie, leastSeenMovie, allFunFacts } from '@/assets/javascript/funFacts.js';

function entry ({ runtime = 120, release = '1994-06-15', genres = ['Drama'], rating = 8, watches = ['2024-06-15T12:00:00'] } = {}) {
  return {
    movie: { title: `Movie ${release}`, runtime, release_date: release, genres: genres.map((name) => ({ name })) },
    ratings: watches.map((date) => ({ calculatedTotal: rating, date }))
  };
}
const ratingOf = (e) => ({ calculatedTotal: e.ratings[0]?.calculatedTotal });

describe('funFacts', () => {
  it('totalWatchTime multiplies runtime by times logged and reports hours', () => {
    const fact = totalWatchTime([
      entry({ runtime: 120, watches: ['2024-06-15T12:00:00', '2025-06-15T12:00:00'] }),
      entry({ runtime: 60 })
    ]);
    expect(fact.value).toBe('5 hours'); // 120*2 + 60 = 300 min
  });

  it('decadeDna finds the dominant release decade with its share', () => {
    const fact = decadeDna([
      entry({ release: '1994-06-15' }),
      entry({ release: '1997-06-15' }),
      entry({ release: '2015-06-15' }),
      entry({ release: '1991-06-15' })
    ]);
    expect(fact.value).toBe('the 1990s');
    expect(fact.detail).toContain('75%');
  });

  it('busiestMonth counts every logged watch in a calendar month', () => {
    const fact = busiestMonth([
      entry({ watches: ['2024-03-01T12:00:00', '2024-03-10T12:00:00'] }),
      entry({ watches: ['2024-03-20T12:00:00'] }),
      entry({ watches: ['2024-04-01T12:00:00'] })
    ]);
    expect(fact.value).toBe('March 2024');
    expect(fact.detail).toBe('3 movies logged.');
  });

  it('genreSplit calls out when your most-watched genre is not your best-rated one', () => {
    const fact = genreSplit([
      ...Array.from({ length: 6 }, () => entry({ genres: ['Action'], rating: 6.5 })),
      ...Array.from({ length: 5 }, () => entry({ genres: ['Horror'], rating: 9 }))
    ], ratingOf);
    expect(fact.value).toBe('Action');
    expect(fact.detail).toContain('Horror');
  });

  it('biggestDay only reports a real pile-up, never a routine double feature', () => {
    expect(biggestDay([entry({ watches: ['2024-06-15T09:00:00', '2024-06-15T20:00:00'] })])).toBeNull();
    const fact = biggestDay([
      entry({ watches: ['2024-06-15T09:00:00', '2024-06-15T14:00:00', '2024-06-15T20:00:00'] })
    ]);
    expect(fact.value).toBe('3 in one day');
  });

  it('oldestMovie finds the earliest release', () => {
    const fact = oldestMovie([entry({ release: '1994-06-15' }), entry({ release: '1927-06-15' })]);
    expect(fact.label).toBe('Oldest film');
    expect(fact.detail).toBe('Released 1927.');
  });

  const voted = (votes, release = '1994-06-15') => {
    const e = entry({ release });
    e.movie.vote_count = votes;
    return e;
  };

  it('leastSeenMovie is the Deepest cut: fewest TMDB votes, not the oldest release', () => {
    const fact = leastSeenMovie([voted(30000, '1927-06-15'), voted(14, '2019-06-15'), voted(900, '1960-06-15')]);
    expect(fact.label).toBe('Deepest cut');
    expect(fact.value).toBe('Movie 2019-06-15');
    expect(fact.detail).toBe('Only 14 people have rated it on TMDB.');
  });

  it('leastSeenMovie skips entries missing a vote count rather than treating them as zero', () => {
    const fact = leastSeenMovie([entry({ release: '1950-06-15' }), voted(null, '1951-06-15'), voted(5000, '2001-06-15')]);
    expect(fact.value).toBe('Movie 2001-06-15');
    expect(leastSeenMovie([entry()])).toBeNull();
  });

  it('leastSeenMovie breaks ties toward the older release and words small counts', () => {
    expect(leastSeenMovie([voted(1, '2010-06-15'), voted(1, '1980-06-15')]).value).toBe('Movie 1980-06-15');
    expect(leastSeenMovie([voted(1)]).detail).toBe('Only 1 person has rated it on TMDB.');
    expect(leastSeenMovie([voted(0)]).detail).toBe('Nobody else has rated it on TMDB.');
  });

  it('allFunFacts drops facts an empty or sparse library cannot support', () => {
    expect(allFunFacts([], ratingOf)).toEqual([]);
    const sparse = allFunFacts([entry({ runtime: null, release: null, genres: [], watches: [] })], ratingOf);
    expect(sparse).toEqual([]);
  });
});
