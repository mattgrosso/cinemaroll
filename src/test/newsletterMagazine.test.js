import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  pickStills, storyPictures, verifiedPullQuote, previouslySpotlighted, chooseSpotlight,
  spotlightBrief, spotlightFilm, latestWeekend, boxOfficeBrief, logColumnBrief, logColumnFilm
} from '../../aws-lambda/newsletterMagazine.js';
import { ISSUE_TOOL } from '../../aws-lambda/newsletterCompose.js';

// The newsletter as a magazine (Matt, 2026-11-20): pictures, and more than
// one story. Every decision is made here, from facts, never by the model.

const still = (file_path, over = {}) => ({ file_path, iso_639_1: null, width: 1920, vote_average: 5, vote_count: 3, ...over });

describe('pickStills', () => {
  it('takes textless, wide stills, best first, without the hero', () => {
    const images = { backdrops: [
      still('/hero.jpg', { vote_average: 9 }),
      still('/title-card.jpg', { iso_639_1: 'en', vote_average: 8 }),
      still('/small.jpg', { width: 780, vote_average: 7 }),
      still('/b.jpg', { vote_average: 6 }),
      still('/a.jpg', { vote_average: 6.5 })
    ] };
    expect(pickStills(images, { exclude: ['/hero.jpg'] })).toEqual(['/a.jpg', '/b.jpg']);
  });

  it('promotes the best still to the hero when the film has no backdrop', () => {
    const images = { backdrops: [still('/a.jpg', { vote_average: 7 }), still('/b.jpg')] };
    expect(storyPictures(null, images)).toEqual({ hero: '/a.jpg', stills: ['/b.jpg'] });
    expect(storyPictures('/own.jpg', images, { stills: 1 })).toEqual({ hero: '/own.jpg', stills: ['/a.jpg'] });
    expect(storyPictures(null, null)).toEqual({ hero: null, stills: [] });
  });
});

describe('verifiedPullQuote', () => {
  const article = 'It opened quietly.\n\nNobody expected a film about waiting to feel this urgent, and yet it does.';

  it('keeps a line that is really in the article, curly quotes and spacing folded', () => {
    expect(verifiedPullQuote(article, '“Nobody expected a film about waiting   to feel this urgent”'))
      .toBe('Nobody expected a film about waiting   to feel this urgent');
  });

  // A "pull quote" the article doesn't contain is an invented quotation in big type.
  it('drops one the article does not contain, or one too short or long to set', () => {
    expect(verifiedPullQuote(article, 'Nobody expected a film about waiting to feel so alive')).toBe(null);
    expect(verifiedPullQuote(article, 'It opened quietly.')).toBe(null);
    expect(verifiedPullQuote(article, null)).toBe(null);
  });
});

describe('chooseSpotlight', () => {
  const now = Date.parse('2026-11-20T13:00:00Z');
  const actors = [
    { name: 'Frances McDormand', films: 9, average: 8.4 },
    { name: 'Oscar Isaac', films: 7, average: 8.1 },
    { name: 'Penélope Cruz', films: 4, average: 7.9 }
  ];

  it('first, an actor the reader rates who is in one of this week’s releases', () => {
    const choice = chooseSpotlight({
      actors,
      releaseCasts: [{ id: 5, title: 'New Film', year: 2026, cast: [{ id: 20, name: 'Somebody' }, { id: 30, name: 'Penelope Cruz', character: 'Ana' }] }],
      now
    });
    expect(choice).toMatchObject({ personId: 30, reason: 'new-release', inRelease: { id: 5, title: 'New Film', character: 'Ana' }, reader: { films: 4 } });
  });

  it('then a birthday this week, best-ranked first', () => {
    const people = [
      { id: 1, name: 'Frances McDormand', birthday: '1957-06-23' },
      { id: 2, name: 'Oscar Isaac', birthday: '1979-03-09' },
      { id: 3, name: 'Penélope Cruz', birthday: '1974-11-24' }
    ];
    expect(chooseSpotlight({ actors, people, now })).toMatchObject({ personId: 3, reason: 'birthday', years: 52 });
  });

  it('a death anniversary only at a multiple of five, and no birthdays for the dead', () => {
    const people = [
      { id: 1, name: 'Frances McDormand', birthday: '1930-11-21', deathday: '2019-11-22' },
      { id: 2, name: 'Oscar Isaac', birthday: '1930-11-21', deathday: '2016-11-23' }
    ];
    expect(chooseSpotlight({ actors, people, now })).toMatchObject({ personId: 2, reason: 'death', years: 10 });
  });

  it('otherwise a favourite, skipping anyone spotlighted lately', () => {
    const people = [
      { id: 1, name: 'Frances McDormand', birthday: '1957-06-23' },
      { id: 2, name: 'Oscar Isaac', birthday: '1979-03-09' }
    ];
    expect(chooseSpotlight({ actors, people, recent: new Set([1]), now })).toMatchObject({ personId: 2, reason: 'favourite' });
    expect(chooseSpotlight({ actors: [], people, now })).toBe(null);
  });

  it('remembers who it featured for half a year, not counting the issue being rebuilt', () => {
    const issues = {
      '2026-11-20': { builtAt: now, spotlight: { personId: 9 } },
      '2026-11-13': { builtAt: now - 7 * 86400000, spotlight: { personId: 8 } },
      '2025-11-14': { builtAt: now - 371 * 86400000, spotlight: { personId: 7 } }
    };
    expect([...previouslySpotlighted(issues, '2026-11-20', now)]).toEqual([8]);
  });
});

describe('spotlightBrief', () => {
  it('lists their best-known films, marks the ones the reader has seen, and drops appearances as themselves', () => {
    const credits = { cast: [
      { id: 1, title: 'Fargo', release_date: '1996-03-08', character: 'Marge', vote_count: 9000, backdrop_path: '/f.jpg' },
      { id: 2, title: 'A Doc', release_date: '2010-01-01', character: 'Herself', vote_count: 9500 },
      { id: 3, title: 'Nomadland', release_date: '2020-09-11', character: 'Fern', vote_count: 5000, backdrop_path: '/n.jpg' }
    ] };
    const brief = spotlightBrief(
      { name: 'Frances McDormand', reason: 'favourite', reader: { films: 9, average: 8.4 } },
      { details: { birthday: '1957-06-23', biography: 'x'.repeat(2000) }, credits, seenIds: new Set([3]) }
    );
    expect(brief.bestKnownFilms.map((f) => f.title)).toEqual(['Fargo', 'Nomadland']);
    expect(brief.readerHasSeenOfThese).toBe(1);
    expect(brief.biography.length).toBe(900);
    expect(brief.readerRatesThem).toEqual({ films: 9, average: 8.4 });
    // The picture: a film the reader has seen beats a better-known one.
    expect(spotlightFilm(credits, new Set([3])).id).toBe(3);
    expect(spotlightFilm(credits, new Set()).id).toBe(1);
  });
});

describe('the box office', () => {
  const calendar = { year: 2026, weekends: [
    { k: '2026W45', s: '2026-11-06', e: '2026-11-08', top: 'Godzilla Minus Zero', g: 30637997, tg: 120999397 },
    { k: '2026W46', s: '2026-11-13', e: '2026-11-15', top: 'Ebenezer', g: 19012017, tg: 86702904 },
    { k: '2026W47', s: '2026-11-20', e: '2026-11-22' }
  ] };

  it('reads the latest finished weekend, never one still under way', () => {
    expect(latestWeekend(calendar, Date.parse('2026-11-20T13:00:00Z')).k).toBe('2026W46');
    expect(latestWeekend(calendar, Date.parse('2026-11-15T13:00:00Z')).k).toBe('2026W45');
    expect(latestWeekend(null)).toBe(null);
  });

  it('builds the chart, its openers and holds, and the same weekend in history', () => {
    const chart = {
      key: '2026W46', label: 'November 13-15', year: 2026, start: '2026-11-13', end: '2026-11-15', days: 3,
      total: { movies: 63, gross: 86702904, change: -28.3 },
      rows: [
        { rank: 1, lastRank: 'new', title: 'Ebenezer', id: 'e', gross: 19012017, change: null, theaters: 3535, week: 1, total: 19012017 },
        { rank: 2, lastRank: 2, title: 'The Cat in the Hat', id: 'c', gross: 11300531, change: -43.5, week: 2, total: 38065886 },
        { rank: 3, lastRank: 1, title: 'Godzilla Minus Zero', id: 'g', gross: 9000000, change: -70.6, week: 2, total: 50000000 },
        { rank: 4, lastRank: 3, title: 'Hold Steady', id: 'h', gross: 5000000, change: -12.0, week: 5, total: 90000000 }
      ]
    };
    const lastYear = { year: 2025, weekends: [{ k: '2025W46', s: '2025-11-14', e: '2025-11-16', top: 'Now You See Me 3', g: 21000000, tg: 80000000 }] };
    // Older calendars key weekends "2016-46", so history is matched by date.
    const tenYears = { year: 2016, weekends: [
      { k: '2016-45', s: '2016-11-04', e: '2016-11-06', top: 'Doctor Strange', g: 85000000, tg: 1 },
      { k: '2016-46', s: '2016-11-11', e: '2016-11-13', top: 'Doctor Strange', g: 42970065, tg: 158435311 }
    ] };
    const brief = boxOfficeBrief({ chart, pastCalendars: { 1: lastYear, 10: tenYears }, seenRows: new Set(['g']) });
    expect(brief.thisWeekendInHistory[1]).toMatchObject({ yearsAgo: 10, dates: '2016-11-11 to 2016-11-13', numberOneGross: 42970065 });
    expect(brief.weekend).toBe('November 13-15, 2026');
    expect(brief.openers).toEqual(['Ebenezer']);
    expect(brief.bestHold).toEqual({ title: 'Hold Steady', changePercent: -12 });
    expect(brief.steepestDrop).toEqual({ title: 'Godzilla Minus Zero', changePercent: -70.6 });
    expect(brief.top10[2].readerHasSeen).toBe(true);
    expect(brief.thisWeekendInHistory.slice(0, 1)).toEqual([{ yearsAgo: 1, year: 2025, dates: '2025-11-14 to 2025-11-16', numberOne: 'Now You See Me 3', numberOneGross: 21000000, wholeChartGross: 80000000 }]);
    expect(boxOfficeBrief({ chart: { rows: chart.rows.slice(0, 2) } })).toBe(null);
  });
});

describe('logColumnBrief', () => {
  const now = Date.parse('2026-11-20T13:00:00Z');
  const profile = {
    libraryAverage: 7.1,
    loggedThisYear: 140,
    recentLog: [
      { id: 1, title: 'Too Old', score: 9, date: '2026-11-10T20:00:00Z' },
      { id: 2, title: 'Good', score: 8.3, date: '2026-11-15T20:00:00Z', medium: 'Theater' },
      { id: 3, title: 'Better', score: 9.1, date: '2026-11-18T20:00:00Z', rewatch: true }
    ]
  };

  it('is the issue’s own seven days', () => {
    const brief = logColumnBrief(profile, now);
    expect(brief.viewings.map((v) => v.title)).toEqual(['Good', 'Better']);
    expect(brief).toMatchObject({ count: 2, averageScore: 8.7, best: 'Better', loggedThisYear: 140 });
    expect(logColumnFilm(profile, now).id).toBe(3);
  });

  // An empty week is not a column.
  it('is nothing when nothing was logged', () => {
    expect(logColumnBrief({ recentLog: [profile.recentLog[0]] }, now)).toBe(null);
    expect(logColumnBrief(null, now)).toBe(null);
  });
});

describe('wiring', () => {
  it('asks the model for every story, the new ones optional', () => {
    const props = ISSUE_TOOL.input_schema.properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['spotlight', 'boxOffice', 'fromYourLog']));
    expect(props.feature.properties.pullQuote).toBeTruthy();
    expect(ISSUE_TOOL.input_schema.required).toEqual(['intro', 'picks', 'feature']);
  });

  // A module the deploy leaves out of the zip is a Lambda that can't start.
  it('ships with the newsletter Lambda', () => {
    expect(readFileSync('scripts/deploy-lambda.mjs', 'utf8')).toContain("'aws-lambda/newsletterMagazine.js': 'newsletterMagazine.js'");
  });
});
