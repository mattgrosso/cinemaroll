import { describe, it, expect } from 'vitest';
import { awardsByMovie, validAwards, friendAwardsForMovie, friendAwardsSummary } from '@/assets/javascript/awardsShare.js';
import { toInterchange, profileFromFeed } from '@/assets/javascript/interchange.js';
import { buildSocialProfile } from '@/assets/javascript/social.js';

// Matt, 2026-10-06: "include his awards in our awards lists for the movies
// that we come across, and then make my award choices available to him" —
// for anybody's awards, in Movie Log or Cinema Roll.
const personalAwards = {
  2015: {
    completed: true,
    categories: {
      bestPicture: { winner: { movieId: 550 }, nominees: [{ movieId: 550 }, { movieId: 680 }] },
      bestDirector: { winner: { movieId: 550, name: 'David Fincher' }, nominees: [{ movieId: 550, name: 'David Fincher' }, { movieId: 680, name: 'Quentin Tarantino' }] },
      custom1: { winner: { movieId: 680 }, nominees: [] }
    },
    customCategories: { custom1: { name: 'Best Needle Drop', createdAt: 1 } }
  },
  2016: { categories: { bestPicture: { nominees: [{ movieId: 550 }] } } }
};

describe('awardsByMovie', () => {
  it('projects wins and nominations per film with labels, years, and the person for person awards', () => {
    const out = awardsByMovie(personalAwards);
    expect(out[550]).toEqual([
      { year: 2015, category: 'bestPicture', label: 'Best Picture', result: 'won' },
      { year: 2015, category: 'bestDirector', label: 'Best Director', result: 'won', name: 'David Fincher' },
      { year: 2016, category: 'bestPicture', label: 'Best Picture', result: 'nominated' }
    ]);
    expect(out[680]).toEqual([
      { year: 2015, category: 'bestPicture', label: 'Best Picture', result: 'nominated' },
      { year: 2015, category: 'bestDirector', label: 'Best Director', result: 'nominated', name: 'Quentin Tarantino' },
      { year: 2015, category: 'custom1', label: 'Best Needle Drop', result: 'won' }
    ]);
    expect(awardsByMovie(null)).toEqual({});
    expect(awardsByMovie({ null: { categories: {} } })).toEqual({});
  });

  it('keeps only well-formed awards from the wire', () => {
    expect(validAwards([{ year: 2015, category: 'x', label: 'X', result: 'won' }, { year: 'no' }, { year: 2015, category: 'y', label: 'Y', result: 'lost' }]))
      .toEqual([{ year: 2015, category: 'x', label: 'X', result: 'won' }]);
    expect(validAwards([])).toBeNull();
    expect(validAwards('nope')).toBeNull();
  });
});

describe('awards travel with ratings', () => {
  const entry = (id, title) => ({ movie: { id, title, poster_path: null, release_date: '1999-10-15' }, ratings: [{ calculatedTotal: 9, normalizedRating: 9, date: 1000 }] });
  const getRating = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal, normalizedRating: e.ratings[0].normalizedRating });

  it('in the Film Club feed: per movie, with the ceremony name, and back into a profile', () => {
    const feed = toInterchange([entry(550, 'Fight Club'), entry(949, 'Heat')], getRating, { name: 'Matt', awards: awardsByMovie(personalAwards), awardsName: 'The Groskers' });
    expect(feed.awardsName).toBe('The Groskers');
    expect(feed.movies.find((m) => m.tmdbId === 550).awards).toHaveLength(3);
    expect(feed.movies.find((m) => m.tmdbId === 949).awards).toBeUndefined();
    const profile = profileFromFeed(feed);
    expect(profile.awardsName).toBe('The Groskers');
    expect(profile.ratings[550].a).toHaveLength(3);
    expect(profile.ratings[949].a).toBeUndefined();
    // Without awards the feed is exactly as before.
    expect(toInterchange([entry(550, 'Fight Club')], getRating, { name: 'Matt' }).awardsName).toBeUndefined();
  });

  it('in the social profile, under the ratings switch only', () => {
    const shared = buildSocialProfile([entry(550, 'Fight Club')], getRating, { name: 'Matt', shareRatings: true, awards: awardsByMovie(personalAwards), awardsName: 'The Groskers' });
    expect(shared.awardsName).toBe('The Groskers');
    expect(shared.ratings[550].a[0]).toMatchObject({ label: 'Best Picture', result: 'won' });
    const quiet = buildSocialProfile([entry(550, 'Fight Club')], getRating, { name: 'Matt', shareRatings: false, awards: awardsByMovie(personalAwards), awardsName: 'The Groskers' });
    expect(quiet.awardsName).toBeUndefined();
    expect(quiet.ratings).toBeUndefined();
  });
});

describe("a film page's club awards", () => {
  const friends = [
    { name: 'Seth', profile: { awardsName: 'The Smithies', ratings: { 550: { r: 8, a: [{ year: 2015, category: 'bestPicture', label: 'Best Picture', result: 'nominated' }, { year: 2015, category: 'bestScore', label: 'Best Score', result: 'nominated' }] } } } },
    { name: 'Brian', profile: { awardsName: 'Gogan Globes', ratings: { 550: { r: 9, a: [{ year: 2015, category: 'bestPicture', label: 'Best Picture', result: 'won' }] } } } },
    { name: 'Carrie', profile: { ratings: { 550: { r: 7 } } } },
    { name: 'Nobody', profile: null }
  ];
  it('groups by friend, ceremony named, friends with nothing for this film left out', () => {
    const groups = friendAwardsForMovie(friends, 550);
    expect(groups.map((g) => g.friend)).toEqual(['Brian', 'Seth']);
    expect(groups[0]).toMatchObject({ ceremony: 'Gogan Globes', won: [{ label: 'Best Picture' }], nominated: [] });
    expect(groups[1].nominated).toHaveLength(2);
    expect(friendAwardsSummary(groups)).toBe('Gogan Globes (Brian): Best Picture · The Smithies (Seth): 2 nominations');
    expect(friendAwardsForMovie(friends, 999)).toEqual([]);
    expect(friendAwardsForMovie(friends, null)).toEqual([]);
  });
});
