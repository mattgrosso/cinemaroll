import { describe, it, expect } from 'vitest';
import { rewatchCandidates, rewatchCycleYears, anotherShotCandidates, nearThresholdYears, favoritePeople, rankWatchlistCandidates, dailyPick, ratedTmdbIds, tasteProfile, tasteBonus, nextPunt, isPunted, puntKeyFor , peopleYouRateHigher } from '@/assets/javascript/discover.js';

const NOW = new Date('2026-08-15T00:00:00Z').getTime();
const yearsAgo = (years) => NOW - years * 365.25 * 24 * 3600 * 1000;

function entry (id, title, { rating = 8, watched = yearsAgo(3), crew = [], cast = [] } = {}) {
  return {
    dbKey: `key-${id}`,
    movie: { id, title, poster_path: '/p.jpg', crew, cast },
    ratings: [{ calculatedTotal: rating, date: watched }]
  };
}
const ratingOf = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal });

describe('rewatchCandidates (cycle-based, feedback 2026-08-15)', () => {
  it('gives more-loved movies shorter due cycles', () => {
    expect(rewatchCycleYears(9.7)).toBe(2);
    expect(rewatchCycleYears(9.2)).toBe(3);
    expect(rewatchCycleYears(8.4)).toBe(5);
    expect(rewatchCycleYears(7.1)).toBe(8);
    expect(rewatchCycleYears(6.9)).toBeNull();
  });

  it('only surfaces movies at or past their own cycle, most overdue first', () => {
    const entries = [
      entry(1, 'Favorite, due', { rating: 9.6, watched: yearsAgo(2.5) }), // cycle 2 -> 1.25 overdue
      entry(2, 'Favorite, not yet', { rating: 9.6, watched: yearsAgo(1) }), // 0.5 -> hidden
      entry(3, 'Eight, overdue', { rating: 8.2, watched: yearsAgo(10) }), // cycle 5 -> 2.0
      entry(4, 'Seven, not yet', { rating: 7.2, watched: yearsAgo(4) }) // cycle 8 -> 0.5 -> hidden
    ];

    const list = rewatchCandidates(entries, ratingOf, NOW);

    expect(list.map((c) => c.entry.movie.title)).toEqual(['Eight, overdue', 'Favorite, due']);
    expect(list[0].cycle).toBe(5);
  });

  it('caps overdueness so ancient mid-tier movies cannot bury recently-due favorites', () => {
    const entries = [
      entry(1, 'Ancient seven', { rating: 7.1, watched: yearsAgo(40) }), // ratio capped at 3
      entry(2, 'Very overdue favorite', { rating: 9.8, watched: yearsAgo(6.5) }) // 3.25 -> capped 3, higher rating wins tie
    ];
    const list = rewatchCandidates(entries, ratingOf, NOW);
    expect(list[0].entry.movie.title).toBe('Very overdue favorite');
  });

  it('skips unrated/undated entries and respects the cap', () => {
    const entries = [
      { dbKey: 'broken', movie: { id: 99, title: 'No ratings' }, ratings: [] },
      ...Array.from({ length: 30 }, (_, i) => entry(i, `M${i}`, { rating: 8, watched: yearsAgo(6 + i * 0.1) }))
    ];
    const list = rewatchCandidates(entries, (e) => ({ calculatedTotal: e.ratings[0]?.calculatedTotal }), NOW);
    expect(list).toHaveLength(24);
  });

  it('accepts string dates as well as epoch numbers', () => {
    const stringDated = entry(1, 'String date', { rating: 9.5 });
    stringDated.ratings[0].date = '2020-06-15T12:00:00Z';
    const list = rewatchCandidates([stringDated], ratingOf, NOW);
    expect(list).toHaveLength(1);
  });
});

describe('anotherShotCandidates', () => {
  const withVotes = (id, title, opts, voteAverage, voteCount) => {
    const e = entry(id, title, opts);
    e.movie.vote_average = voteAverage;
    e.movie.vote_count = voteCount;
    return e;
  };

  it('surfaces movies the world loves more than you did, biggest gap first', () => {
    const entries = [
      withVotes(1, 'You 5, world 8.5', { rating: 5, watched: yearsAgo(3) }, 8.5, 5000),
      withVotes(2, 'You 6, world 7.8', { rating: 6, watched: yearsAgo(3) }, 7.8, 5000),
      withVotes(3, 'You loved it too', { rating: 9, watched: yearsAgo(3) }, 8.9, 5000),
      withVotes(4, 'World agrees it is meh', { rating: 5, watched: yearsAgo(3) }, 5.5, 5000)
    ];

    const list = anotherShotCandidates(entries, ratingOf, NOW);

    expect(list.map((c) => c.entry.movie.title)).toEqual(['You 5, world 8.5', 'You 6, world 7.8']);
    // The 3.5-point gap only counts 3/5ths, because the viewing is three
    // years into the five-year fade ramp.
    expect(list[0].score).toBeCloseTo(3.5 * 0.6, 5);
  });

  it('ignores low-vote-count community scores and entries without vote data', () => {
    const entries = [
      withVotes(1, 'Obscure but inflated', { rating: 5, watched: yearsAgo(3) }, 9.5, 40),
      entry(2, 'Legacy entry, no vote data', { rating: 5, watched: yearsAgo(3) })
    ];
    expect(anotherShotCandidates(entries, ratingOf, NOW)).toHaveLength(0);
  });

  // Report 2026-08-21: "if I watched it recently, I don't need to give it
  // another shot right away."
  it('waits at least two years since you watched it', () => {
    const entries = [
      withVotes(1, 'Too soon', { rating: 5, watched: yearsAgo(0.3) }, 8.5, 5000),
      withVotes(2, 'Still too soon', { rating: 5, watched: yearsAgo(1.5) }, 8.5, 5000)
    ];
    expect(anotherShotCandidates(entries, ratingOf, NOW)).toHaveLength(0);
  });

  it('a faded old miss outranks a fresher one with the same score gap', () => {
    const entries = [
      withVotes(1, 'Two years ago', { rating: 5, watched: yearsAgo(2.1) }, 8.5, 5000),
      withVotes(2, 'Eight years ago', { rating: 5, watched: yearsAgo(8) }, 8.5, 5000)
    ];

    const list = anotherShotCandidates(entries, ratingOf, NOW);

    expect(list.map((c) => c.entry.movie.title)).toEqual(['Eight years ago', 'Two years ago']);
    // Past the ramp the differential counts in full.
    expect(list[0].score).toBeCloseTo(3.5, 5);
  });
});

describe('favoritePeople', () => {
  const crewFor = (name) => [{ job: 'Director', name }];

  it('ranks directors by average rating weighted by how many of their movies you rated', () => {
    const entries = [
      entry(1, 'A', { rating: 9, crew: crewFor('Consistent Great') }),
      entry(2, 'B', { rating: 8.6, crew: crewFor('Consistent Great') }),
      entry(3, 'C', { rating: 8.8, crew: crewFor('Consistent Great') }),
      entry(4, 'D', { rating: 9.6, crew: crewFor('One Hit') }),
      entry(5, 'E', { rating: 9.5, crew: crewFor('One Hit') })
    ];

    const people = favoritePeople(entries, ratingOf, { role: 'director' });

    // One Hit's average is higher, but Consistent Great's three loved
    // movies outweigh via the log2(count+1) factor.
    expect(people[0].name).toBe('Consistent Great');
    expect(people[0].count).toBe(3);
  });

  it('requires a minimum body of work — a single rated movie is not a favorite yet', () => {
    const entries = [entry(1, 'A', { rating: 10, crew: crewFor('Once Only') })];
    expect(favoritePeople(entries, ratingOf, { role: 'director' })).toEqual([]);
  });

  it('actor mode reads top-billed cast only', () => {
    const bigCast = Array.from({ length: 12 }, (_, i) => ({ name: `Actor ${i}` }));
    const entries = [
      entry(1, 'A', { rating: 9, cast: bigCast }),
      entry(2, 'B', { rating: 9, cast: bigCast })
    ];
    const people = favoritePeople(entries, ratingOf, { role: 'actor', cap: 20 });
    expect(people.map((p) => p.name)).toContain('Actor 0');
    expect(people.map((p) => p.name)).not.toContain('Actor 11'); // beyond castDepth
  });

  it('counts a person once per movie even if credited twice', () => {
    const entries = [
      entry(1, 'A', { rating: 8, crew: [...crewFor('Double Credit'), ...crewFor('Double Credit')] }),
      entry(2, 'B', { rating: 8, crew: crewFor('Double Credit') })
    ];
    expect(favoritePeople(entries, ratingOf, { role: 'director' })[0].count).toBe(2);
  });
});

describe('rankWatchlistCandidates', () => {
  const tmdb = (id, title, { votes = 1000, avg = 8, release = '2015-06-15', adult = false } = {}) =>
    ({ id, title, vote_count: votes, vote_average: avg, release_date: release, adult });

  it('drops already-rated, unreleased, low-vote and adult titles, and dedupes', () => {
    const rated = new Set([1]);
    const credits = [
      tmdb(1, 'Already seen'),
      tmdb(2, 'Good'),
      tmdb(2, 'Good duplicate'),
      tmdb(3, 'Unreleased', { release: '2030-01-01' }),
      tmdb(4, 'No date', { release: '' }),
      tmdb(5, 'Obscure', { votes: 3 }),
      tmdb(6, 'Adult', { adult: true })
    ];

    const list = rankWatchlistCandidates(credits, rated, NOW);

    expect(list.map((m) => m.id)).toEqual([2]);
  });

  it('vote volume weights the score: a well-loved popular film beats a slightly higher obscure one', () => {
    const credits = [
      tmdb(1, 'Popular', { votes: 12000, avg: 7.9 }),
      tmdb(2, 'Niche', { votes: 60, avg: 8.6 })
    ];
    const list = rankWatchlistCandidates(credits, new Set(), NOW);
    expect(list[0].title).toBe('Popular');
  });

  it('caps the list', () => {
    const credits = Array.from({ length: 40 }, (_, i) => tmdb(i, `M${i}`));
    expect(rankWatchlistCandidates(credits, new Set(), NOW)).toHaveLength(12);
  });

  // Bug report 2026-09-20: the directors row's whole top twelve were in a
  // hat, and hiding them AFTER the cap left the row empty for weeks.
  it('excludes before the cap, so a hidden film is replaced rather than leaving a gap', () => {
    const credits = Array.from({ length: 20 }, (_, i) => tmdb(i, `M${i}`, { votes: 10000 - i }));
    const hatted = new Set([0, 1, 2]);
    const list = rankWatchlistCandidates(credits, new Set(), NOW, { exclude: (movie) => hatted.has(movie.id) });

    expect(list).toHaveLength(12);
    expect(list.map((m) => m.id)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

describe('dailyPick', () => {
  const DAY = 24 * 3600 * 1000;
  const pool = (n) => Array.from({ length: n }, (_, i) => ({ id: i, title: `M${i}`, score: 100 - i }));

  it('shows a pool no bigger than the cap whole, in rank order', () => {
    expect(dailyPick(pool(5), NOW).map((m) => m.id)).toEqual([0, 1, 2, 3, 4]);
    expect(dailyPick(pool(12), NOW).map((m) => m.id)).toEqual(Array.from({ length: 12 }, (_, i) => i));
  });

  it('drops excluded films first, so hatting one promotes the next in line', () => {
    const hatted = new Set([0, 1]);
    const shown = dailyPick(pool(12), NOW, { exclude: (m) => hatted.has(m.id) });
    expect(shown.map((m) => m.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('picks the cap from within reach, keeps rank order, and holds still all day', () => {
    const shown = dailyPick(pool(36), NOW, { cap: 12, reach: 24 });
    const ids = shown.map((m) => m.id);

    expect(ids).toHaveLength(12);
    expect(ids.every((id) => id < 24)).toBe(true);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(dailyPick(pool(36), NOW + 20 * 3600 * 1000, { cap: 12, reach: 24 }).map((m) => m.id)).toEqual(ids);
  });

  it('turns over from one day to the next', () => {
    const days = Array.from({ length: 5 }, (_, d) => dailyPick(pool(36), NOW + d * DAY, { cap: 12, reach: 24 }).map((m) => m.id).join(','));
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('rescales match % to what is shown, so the top of the row reads 97', () => {
    const shown = dailyPick(pool(36), NOW, { cap: 12, reach: 24 });
    expect(shown[0].matchPct).toBe(97);
    expect(shown[shown.length - 1].matchPct).toBe(62);
  });
});

describe('ratedTmdbIds', () => {
  it('collects numeric TMDB ids and skips offline placeholders', () => {
    const ids = ratedTmdbIds([
      entry(550, 'Fight Club'),
      { dbKey: 'x', movie: { id: 'offline-abc', title: 'Placeholder' }, ratings: [] }
    ]);
    expect(ids.has(550)).toBe(true);
    expect(ids.size).toBe(1);
  });
});

describe('nearThresholdYears', () => {
  const yearEntry = (id, year, runtime = 100) => ({
    dbKey: `y${id}`,
    movie: { id, title: `M${id}`, release_date: `${year}-06-15`, runtime },
    ratings: [{ calculatedTotal: 7 }]
  })

  it('finds unfinished years, closest to done first', () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => yearEntry(i, 1997)), // 1 to go
      ...Array.from({ length: 7 }, (_, i) => yearEntry(20 + i, 2003)), // 3 to go
      ...Array.from({ length: 10 }, (_, i) => yearEntry(40 + i, 1999)), // complete: excluded
      ...Array.from({ length: 2 }, (_, i) => yearEntry(60 + i, 1988)) // 8 to go
    ]

    const years = nearThresholdYears(entries, 10)

    expect(years.map((y) => y.year)).toEqual([1997, 2003, 1988])
    expect(years[0].missing).toBe(1)
  })

  // Bug report, 2026-08-19: "How did you choose which years to include in the
  // get it to 10 watchlist... it seems like an arbitrary number of lists."
  // It was: the closest three within four of the threshold. Nothing is
  // dropped now — the picker shows them all and labels each one's distance.
  it('keeps every started-but-unfinished year, however far off it is', () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => yearEntry(i, 1997)), // 1 to go
      ...Array.from({ length: 8 }, (_, i) => yearEntry(20 + i, 2003)), // 2
      ...Array.from({ length: 7 }, (_, i) => yearEntry(40 + i, 2011)), // 3
      ...Array.from({ length: 6 }, (_, i) => yearEntry(60 + i, 1975)), // 4
      ...Array.from({ length: 1 }, (_, i) => yearEntry(80 + i, 1962)) // 9 — used to be cut
    ]

    const years = nearThresholdYears(entries, 10)

    expect(years.map((y) => y.year)).toEqual([1997, 2003, 2011, 1975, 1962])
    expect(years.map((y) => y.missing)).toEqual([1, 2, 3, 4, 9])
  })

  it('still narrows on request, for a caller that wants a short list', () => {
    const entries = [
      ...Array.from({ length: 9 }, (_, i) => yearEntry(i, 1997)), // 1 to go
      ...Array.from({ length: 8 }, (_, i) => yearEntry(20 + i, 2003)), // 2
      ...Array.from({ length: 1 }, (_, i) => yearEntry(40 + i, 1962)) // 9 — beyond reach
    ]

    expect(nearThresholdYears(entries, 10, { reach: 4, cap: 1 }).map((y) => y.year)).toEqual([1997])
    expect(nearThresholdYears(entries, 10, { reach: 4 }).map((y) => y.year)).toEqual([1997, 2003])
  })

  it('honours a custom threshold and ignores shorts', () => {
    const entries = [
      yearEntry(1, 2010), yearEntry(2, 2010),
      yearEntry(3, 2010, 30) // a short — must not count toward the year
    ]
    const years = nearThresholdYears(entries, 3)
    expect(years).toEqual([{ year: 2010, count: 2, missing: 1 }])
  })
})

describe('tasteProfile / tasteBonus', () => {
  const genreEntry = (id, rating, genres) => ({
    dbKey: `g${id}`,
    movie: { id, title: `M${id}`, genres: genres.map((gid) => ({ id: gid, name: `g${gid}` })) },
    ratings: [{ calculatedTotal: rating }]
  })

  it('learns genre affinities relative to your overall average, damped by sample size', () => {
    // Horror (id 27) consistently loved; comedy (35) consistently disliked.
    const entries = [
      ...Array.from({ length: 8 }, (_, i) => genreEntry(i, 9, [27])),
      ...Array.from({ length: 8 }, (_, i) => genreEntry(20 + i, 5, [35]))
    ]
    const profile = tasteProfile(entries, ratingOf)

    expect(profile[27]).toBeGreaterThan(1)
    expect(profile[35]).toBeLessThan(-1)
  })

  it('a small sample earns only a damped affinity', () => {
    const entries = [
      genreEntry(1, 10, [878]),
      ...Array.from({ length: 12 }, (_, i) => genreEntry(10 + i, 7, [18]))
    ]
    const profile = tasteProfile(entries, ratingOf)
    // One lucky sci-fi 10: raw delta ~+2.8 but confidence log2(2)/4 = 0.25.
    expect(profile[878]).toBeLessThan(1)
  })

  it('tasteBonus averages the affinities of a candidate movie genres', () => {
    const profile = { 27: 2, 35: -2 }
    expect(tasteBonus({ genre_ids: [27] }, profile)).toBe(2)
    expect(tasteBonus({ genre_ids: [27, 35] }, profile)).toBe(0)
    expect(tasteBonus({ genre_ids: [99] }, profile)).toBe(0)
  })

  it('rankWatchlistCandidates lets taste reorder near-equal candidates', () => {
    const NOW2 = Date.UTC(2026, 5, 15)
    const candidates = [
      { id: 1, title: 'Loved genre', vote_average: 7.5, vote_count: 1000, release_date: '2000-06-15', genre_ids: [27] },
      { id: 2, title: 'Disliked genre', vote_average: 7.8, vote_count: 1000, release_date: '2000-06-15', genre_ids: [35] }
    ]
    const withTaste = rankWatchlistCandidates(candidates, new Set(), NOW2, { profile: { 27: 2, 35: -2 } })
    expect(withTaste[0].title).toBe('Loved genre')
    const without = rankWatchlistCandidates(candidates, new Set(), NOW2)
    expect(without[0].title).toBe('Disliked genre')
  })
})

describe('watchlist punts', () => {
  const NOW3 = Date.UTC(2026, 7, 15)

  it('keys library entries and TMDB suggestions distinctly', () => {
    expect(puntKeyFor({ dbKey: 'abc' })).toBe('entry-abc')
    expect(puntKeyFor({ id: 42, title: 'X' })).toBe('tmdb-42')
    expect(puntKeyFor({})).toBeNull()
  })

  it('doubles the snooze on each repeat punt, capped at two years', () => {
    const first = nextPunt(undefined, NOW3)
    expect(first.count).toBe(1)
    expect(first.until - NOW3).toBe(60 * 24 * 60 * 60 * 1000)

    const second = nextPunt(first, NOW3)
    expect(second.count).toBe(2)
    expect(second.until - NOW3).toBe(120 * 24 * 60 * 60 * 1000)

    const sixth = nextPunt({ count: 8 }, NOW3)
    expect(sixth.until - NOW3).toBe(2 * 365.25 * 24 * 60 * 60 * 1000)
  })

  it('isPunted hides items until their snooze expires, then frees them', () => {
    const punts = { 'entry-abc': { until: NOW3 + 1000, count: 1 } }
    expect(isPunted({ dbKey: 'abc' }, punts, NOW3)).toBe(true)
    expect(isPunted({ dbKey: 'abc' }, punts, NOW3 + 2000)).toBe(false)
    expect(isPunted({ dbKey: 'other' }, punts, NOW3)).toBe(false)
  })
})

// "A third one for actors and actresses combined, who I like more than most
// people." (2026-08-17) A different question from favoritePeople, which finds
// who you rate highly outright and so fills with people in great films.
describe('peopleYouRateHigher', () => {
  const rating = (entry) => ({ calculatedTotal: entry.ratings[0].calculatedTotal });

  const film = (id, mine, world, cast) => ({
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: mine }],
    movie: { id, title: `Film ${id}`, vote_average: world, cast: cast.map((name) => ({ name })) }
  });

  it('ranks by how far above the consensus you rate them', () => {
    const entries = [
      // Underappreciated: world says 5, you say 9.
      film(1, 9, 5, ['Underrated']),
      film(2, 9, 5, ['Underrated']),
      film(3, 9, 5, ['Underrated']),
      // Beloved by everyone, so no lift at all.
      film(4, 9, 9, ['Consensus']),
      film(5, 9, 9, ['Consensus']),
      film(6, 9, 9, ['Consensus'])
    ];

    const people = peopleYouRateHigher(entries, rating);
    expect(people[0].name).toBe('Underrated');
    expect(people[0].avgLift).toBe(4);
    expect(people.some((p) => p.name === 'Consensus')).toBe(false);
  });

  it('leaves out anyone you rate below the consensus', () => {
    const entries = [
      film(1, 3, 8, ['Overrated']),
      film(2, 3, 8, ['Overrated']),
      film(3, 3, 8, ['Overrated'])
    ];

    expect(peopleYouRateHigher(entries, rating)).toEqual([]);
  });

  // A missing vote_average is unknown, not zero — treating it as zero would
  // invent an enormous lift.
  it('skips films with no world score rather than scoring them as zero', () => {
    const entries = [
      film(1, 9, 0, ['Ghost']),
      film(2, 9, null, ['Ghost']),
      film(3, 9, undefined, ['Ghost'])
    ];

    expect(peopleYouRateHigher(entries, rating)).toEqual([]);
  });

  it('needs a few films before it will name anyone', () => {
    expect(peopleYouRateHigher([film(1, 9, 4, ['Fluke'])], rating)).toEqual([]);
  });
});

// Bug report, 2026-08-19: "we have a method now for me to like hit the X and
// sort of punt on some, but I would've expected those to refill themselves,
// but my watchlist have just remained with fewer movies in them."
describe('punting refills the list rather than shrinking it', () => {
  // More candidates than the cap, so there is always someone waiting.
  const many = Array.from({ length: 30 }, (_, i) => entry(i + 1, `Film ${i + 1}`, { rating: 9, watched: yearsAgo(10) }));

  it('keeps a full list after punting, promoting the next candidate in', () => {
    const full = rewatchCandidates(many, ratingOf, NOW, { cap: 5 });
    expect(full).toHaveLength(5);

    const puntedKey = full[0].entry.dbKey;
    const after = rewatchCandidates(many, ratingOf, NOW, {
      cap: 5,
      exclude: (candidate) => candidate.dbKey === puntedKey
    });

    // Still five — not four.
    expect(after).toHaveLength(5);
    expect(after.map((c) => c.entry.dbKey)).not.toContain(puntedKey);
    // And the newcomer is one that the capped list didn't previously include.
    const before = new Set(full.map((c) => c.entry.dbKey));
    expect(after.some((c) => !before.has(c.entry.dbKey))).toBe(true);
  });

  it('shrinks only once the genuine candidates run out', () => {
    const three = many.slice(0, 3);
    const after = rewatchCandidates(three, ratingOf, NOW, {
      cap: 5,
      exclude: (candidate) => candidate.dbKey === three[0].dbKey
    });

    expect(after).toHaveLength(2);
  });

  it('applies to the second-look row too', () => {
    const shotEntries = Array.from({ length: 30 }, (_, i) => ({
      dbKey: `shot-${i + 1}`,
      movie: {
        id: 1000 + i, title: `Cool ${i}`, poster_path: '/p.jpg', vote_average: 8.5, vote_count: 5000, crew: [], cast: []
      },
      ratings: [{ calculatedTotal: 5, date: yearsAgo(4) }]
    }));

    const full = anotherShotCandidates(shotEntries, ratingOf, NOW, { cap: 5 });
    expect(full).toHaveLength(5);

    const after = anotherShotCandidates(shotEntries, ratingOf, NOW, {
      cap: 5,
      exclude: (candidate) => candidate.dbKey === full[0].entry.dbKey
    });

    expect(after).toHaveLength(5);
    expect(after.map((c) => c.entry.dbKey)).not.toContain(full[0].entry.dbKey);
  });
});
