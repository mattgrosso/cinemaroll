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

import { friendCeremony, stripCeremony, categoryMatchKey } from '@/assets/javascript/awardsShare.js';

// Movie Log as shipped (2026-10-07): no awardsName, labels "Goegan Globes: Best Picture".
describe('friendCeremony', () => {
  const movieLog = { ratings: { 11: { a: [{ year: 1977, category: 'i-1', label: 'Goegan Globes: Best Picture', result: 'won' }] }, 12: { a: [{ year: 1980, category: 'i-2', label: 'Goegan Globes: Best Director', result: 'won', name: 'Irvin Kershner' }] } } };
  it('reads the ceremony off a shared label prefix when no name was published', () => {
    expect(friendCeremony(movieLog, 'Brian')).toBe('Goegan Globes');
    expect(stripCeremony('Goegan Globes: Best Picture', 'Goegan Globes')).toBe('Best Picture');
    expect(stripCeremony('Best Picture', 'Goegan Globes')).toBe('Best Picture');
  });
  it('prefers a published name, and falls back to the friend when labels disagree', () => {
    expect(friendCeremony({ awardsName: 'Gogan Globes', ...movieLog }, 'Brian')).toBe('Gogan Globes');
    expect(friendCeremony({ ratings: { 1: { a: [{ label: 'A: X' }] }, 2: { a: [{ label: 'B: Y' }] } } }, 'Brian')).toBe("Brian's awards");
    expect(friendCeremony({ ratings: { 1: { a: [{ label: 'Best Picture' }] } } }, 'Brian')).toBe("Brian's awards");
    expect(friendCeremony({ ratings: {} }, 'Brian')).toBe("Brian's awards");
  });
  it('shows up on a film page and in the club view with the prefix gone', () => {
    const groups = friendAwardsForMovie([{ name: 'Brian', profile: movieLog }], 11);
    expect(groups[0]).toMatchObject({ ceremony: 'Goegan Globes', won: [{ label: 'Best Picture' }] });
    const member = memberFromProfile('Brian', movieLog);
    expect(member.ceremony).toBe('Goegan Globes');
    expect(member.awards[12][0].label).toBe('Best Director');
  });
  it('lines up differently worded categories across members', () => {
    const matt = { name: 'Matt', ceremony: 'The Groskers', awards: { 550: [{ year: 2015, category: 'bestScreenplay', label: 'Best Screenplay or Writing', result: 'won' }] }, titles: {} };
    const brian = { name: 'Brian', ceremony: 'Goegan Globes', awards: { 680: [{ year: 2015, category: 'x', label: 'Best Screenplay', result: 'won' }] }, titles: {} };
    const [y2015] = clubAwardsByYear([matt, brian]);
    expect(y2015.categories).toHaveLength(1);
    expect(y2015.categories[0].picks.map((p) => p.who)).toEqual(['Brian', 'Matt']);
    expect(categoryMatchKey('Best Film Editing')).toBe('best editing');
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

import { clubAwardsByYear, memberFromProfile } from '@/assets/javascript/awardsShare.js';

// Matt, 2026-10-07: the club's awards, year by year — everyone's winners
// side by side, where the club agreed.
describe('clubAwardsByYear', () => {
  const won = (year, label, name) => ({ year, category: label.toLowerCase().replace(/ /g, ''), label, result: 'won', ...(name ? { name } : {}) });
  const matt = { name: 'Matt', ceremony: 'The Groskers', awards: { 550: [won(2015, 'Best Picture'), won(2015, 'Best Director', 'David Fincher')], 680: [won(2014, 'Best Picture')] }, titles: { 550: { t: 'Fight Club', p: '/fc.jpg' }, 680: { t: 'Pulp Fiction', p: null } } };
  const brian = memberFromProfile('Brian', { awardsName: 'Gogan Globes', ratings: { 550: { r: 9, t: 'Fight Club', p: '/fc.jpg', a: [{ year: 2015, category: 'bp', label: 'Best picture', result: 'won' }, { year: 2015, category: 'bs', label: 'Best Score', result: 'nominated' }] }, 949: { r: 8, t: 'Heat', p: '/h.jpg', a: [{ year: 2015, category: 'bd', label: 'Best Director', result: 'won', name: 'Michael Mann' }] } } });
  const quiet = memberFromProfile('Carrie', { ratings: { 550: { r: 7, t: 'Fight Club' } } });

  it('lines categories up across members by label, newest year first, and marks agreement', () => {
    const years = clubAwardsByYear([matt, brian, quiet]);
    expect(years.map((y) => y.year)).toEqual([2015, 2014]);
    const [y2015] = years;
    expect(y2015.categories.map((c) => c.label)).toEqual(['Best Picture', 'Best Director']);
    const picture = y2015.categories[0];
    expect(picture.agreed).toBe(true);
    expect(picture.picks).toEqual([
      { who: 'Brian', ceremony: 'Gogan Globes', movieId: 550, title: 'Fight Club', poster: '/fc.jpg' },
      { who: 'Matt', ceremony: 'The Groskers', movieId: 550, title: 'Fight Club', poster: '/fc.jpg' }
    ]);
    const director = y2015.categories[1];
    expect(director.agreed).toBe(false);
    expect(director.picks.map((p) => `${p.who}: ${p.name}`)).toEqual(['Brian: Michael Mann', 'Matt: David Fincher']);
    expect(years[1].categories[0].picks).toEqual([{ who: 'Matt', ceremony: 'The Groskers', movieId: 680, title: 'Pulp Fiction', poster: null }]);
  });

  // Matt, 2026-10-07: Brian's Best Supporting Actor was Sean Penn, mine was
  // Benicio del Toro, both in One Battle After Another — not an agreement.
  // And Movie Log's producers and co-editors fold into one pick per film.
  it('judges agreement by the person for person categories, and folds a member\'s co-winners', () => {
    const won = (year, label, name) => ({ year, category: label.toLowerCase().replace(/ /g, ''), label, result: 'won', ...(name ? { name } : {}) });
    const matt = { name: 'Matt', ceremony: 'The Groskers', awards: { 1054867: [won(2025, 'Best Supporting Actor', 'Benicio del Toro'), won(2025, 'Best Picture')] }, titles: { 1054867: { t: 'One Battle After Another', p: '/obaa.jpg' } } };
    const brian = { name: 'Brian', ceremony: 'Goegan Globes', awards: { 1054867: [won(2025, 'Best Supporting Actor', 'Sean Penn'), won(2025, 'Best Picture', 'Adam Somner'), won(2025, 'Best Picture', 'Sara Murphy'), won(2025, 'Best Editing', 'Andy Jurgensen'), won(2025, 'Best Editing', 'Someone Else')] }, titles: { 1054867: { t: 'One Battle After Another', p: '/obaa.jpg' } } };
    const [y2025] = clubAwardsByYear([matt, brian]);
    const by = (label) => y2025.categories.find((c) => c.label === label);
    expect(by('Best Supporting Actor').agreed).toBe(false);
    expect(by('Best Supporting Actor').picks.map((p) => `${p.who}: ${p.name}`)).toEqual(['Brian: Sean Penn', 'Matt: Benicio del Toro']);
    expect(by('Best Picture').agreed).toBe(true);
    expect(by('Best Picture').picks).toEqual([
      { who: 'Brian', ceremony: 'Goegan Globes', movieId: 1054867, title: 'One Battle After Another', poster: '/obaa.jpg' },
      { who: 'Matt', ceremony: 'The Groskers', movieId: 1054867, title: 'One Battle After Another', poster: '/obaa.jpg' }
    ]);
    // One row per choice, shared choices first naming everyone who made them.
    expect(by('Best Picture').choices).toEqual([{ movieId: 1054867, title: 'One Battle After Another', poster: '/obaa.jpg', who: ['Brian', 'Matt'], ceremonies: ['Goegan Globes', 'The Groskers'] }]);
    expect(by('Best Supporting Actor').choices.map((c) => `${c.name}: ${c.who.join('+')}`)).toEqual(['Sean Penn: Brian', 'Benicio del Toro: Matt']);
    expect(by('Best Editing').picks).toHaveLength(1);
    expect(by('Best Editing').picks[0].name).toBeUndefined();
    expect(y2025.categories.map((c) => c.label)).toEqual(['Best Picture', 'Best Supporting Actor', 'Best Editing']);
  });

  // Brian's 2018 Best Director went to Free Solo's directors as three
  // entries; that is one pick with the names run together.
  it('runs co-winners of a person award together as one pick', () => {
    const won = (year, label, name) => ({ year, category: 'bd', label, result: 'won', name });
    const brian = { name: 'Brian', ceremony: 'Goegan Globes', awards: { 515042: [won(2018, 'Best Director', 'Jimmy Chin'), won(2018, 'Best Director', 'Elizabeth Chai Vasarhelyi')] }, titles: { 515042: { t: 'Free Solo', p: '/fs.jpg' } } };
    const matt = { name: 'Matt', ceremony: 'The Groskers', awards: { 515042: [won(2018, 'Best Director', 'Jimmy Chin')] }, titles: { 515042: { t: 'Free Solo', p: '/fs.jpg' } } };
    const [y] = clubAwardsByYear([brian, matt]);
    expect(y.categories[0].picks.map((p) => `${p.who}: ${p.name}`)).toEqual(['Brian: Jimmy Chin, Elizabeth Chai Vasarhelyi', 'Matt: Jimmy Chin']);
    expect(y.categories[0].choices).toHaveLength(2);
    expect(y.categories[0].agreed).toBe(true);
    const alone = clubAwardsByYear([brian])[0].categories[0];
    expect(alone.choices).toEqual([{ movieId: 515042, title: 'Free Solo', poster: '/fs.jpg', name: 'Jimmy Chin, Elizabeth Chai Vasarhelyi', who: ['Brian'], ceremonies: ['Goegan Globes'] }]);
  });

  it('ignores nominations, members without awards, and empty input', () => {
    expect(clubAwardsByYear([quiet])).toEqual([]);
    expect(clubAwardsByYear([])).toEqual([]);
    expect(brian.ceremony).toBe('Gogan Globes');
    expect(Object.keys(brian.awards)).toEqual(['550', '949']);
  });
});
