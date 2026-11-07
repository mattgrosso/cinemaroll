import { describe, expect, it } from 'vitest';
import { musicSheets, enrichMusic, musicPicks, soundtrackWiki, flatten, sitsSheets, onThisDaySheet, monthSheet, milestoneSheets, unfinishedSheet, anniversariesSheet, numbersSheet, dueSheets, storyItem, writeStory } from './logPaper.js';

const t = (s) => Date.parse(s);
const spielberg = { job: 'Director', name: 'Steven Spielberg', filmography: [{ id: 1, title: 'Jaws', release_date: '1975-06-20', popularity: 50 }, { id: 2, title: 'E.T.', release_date: '1982-06-11', popularity: 40 }, { id: 3, title: 'Hook', release_date: '1991-12-11', popularity: 20 }, { id: 4, title: 'Lincoln', release_date: '2012-11-09', popularity: 15 }, { id: 9, title: 'Short Thing', release_date: '1970-01-01', popularity: 0.5 }, { id: 10, title: 'Spielberg: The Complete Collection', release_date: '2001-01-01', popularity: 30 }] };
const film = (id, title, year, extra = {}) => ({ id, title, release_date: `${year}-06-01`, runtime: 120, genres: [{ name: 'Drama' }], production_countries: [{ name: 'United States of America' }], cast: [{ name: 'Tom Hanks' }], crew: [spielberg], ...extra });
const log = {
  a: { movie: film(1, 'Jaws', 1975), ratings: [{ date: t('2024-10-28T20:00:00-04:00'), rating: 8.1, medium: 'Theater' }] },
  b: { movie: film(2, 'E.T.', 1982), ratings: [{ date: t('2025-03-02T20:00:00-05:00'), rating: '7.2', medium: 'Streaming' }, { date: t('2026-10-27T21:00:00-04:00'), rating: 9.0, medium: 'Theater' }] },
  c: { movie: film(3, 'Hook', 1991, { production_countries: [{ name: 'Japan' }] }), ratings: [{ date: t('2026-09-10T20:00:00-04:00'), rating: 5.5, medium: 'Hulu' }] },
  junk: { movie: film(5, 'Broken', 2000, { crew: [] }), ratings: [{ date: t('2026-09-11T20:00:00-04:00'), rating: { odd: true } }] }
};
const now = t('2026-10-28T10:30:00-04:00');

describe('the log, flattened', () => {
  it('turns ratings into rows, oldest first, skipping ones that are not numbers', () => {
    const rows = flatten(log);
    expect(rows.map((r) => r.title)).toEqual(['Jaws', 'E.T.', 'Hook', 'E.T.']);
    expect(rows[1].rating).toBe(7.2);
    expect(rows[3].prior).toEqual([7.2]);
  });

  it('reads the score the app saves today, an object with calculatedTotal', () => {
    const rows = flatten({ k: { movie: film(24, 'Kill Bill: Vol. 1', 2003), ratings: [{ date: t('2026-11-01T21:28:00-04:00'), rating: { calculatedTotal: 8.52, normalizedRating: 9, soundtrack: 9 }, soundtrack: '9', medium: 'Theater' }] } });
    expect(rows.map((r) => [r.title, r.rating, r.soundtrack])).toEqual([['Kill Bill: Vol. 1', 8.52, 9]]);
  });
});

describe('where this sits', () => {
  it('places last night\'s film among the director\'s, the year\'s and the rest', () => {
    const [sheet] = sitsSheets(flatten(log), t('2026-10-27T06:00:00-04:00'), now);
    expect(sheet.kind).toBe('sits');
    expect(sheet.facts.film).toMatchObject({ title: 'E.T.', rating: 9, medium: 'Theater' });
    expect(sheet.facts.rewatch).toEqual({ timesBefore: 1, previousRatings: [7.2], change: 1.8 });
    expect(sheet.facts.directors[0]).toMatchObject({ name: 'Steven Spielberg', filmsSeenBefore: 2, thisRanks: '1 of 3', theirBest: { title: 'Jaws', rating: 8.1 } });
    expect(sheet.facts.counts).toMatchObject({ filmsLoggedAllTime: 3, thisYearSoFar: 2, theaterVisitNumber: 2 });
    expect(sheet.factLine).toContain('ranks 1 of 3 of theirs');
    expect(sitsSheets(flatten(log), now, now)).toHaveLength(0);
  });
  it('notices a first country', () => {
    const [sheet] = sitsSheets(flatten(log), t('2026-09-09T00:00:00-04:00'), t('2026-09-11T00:00:00-04:00'));
    expect(sheet.facts.firsts.newCountry).toEqual(['Japan']);
  });
});

describe('the calendar kinds', () => {
  it('on this day finds earlier years only', () => {
    const sheet = onThisDaySheet(flatten(log), now);
    expect(sheet.facts.watched).toEqual([{ yearsAgo: 2, title: 'Jaws', year: 1975, rating: 8.1, medium: 'Theater', director: 'Steven Spielberg', rewatch: false }]);
    expect(onThisDaySheet(flatten(log), t('2026-10-29T10:30:00-04:00'))).toBeNull();
  });
  it('month in review covers last month against the year before', () => {
    const sheet = monthSheet(flatten(log), t('2026-10-01T07:00:00-04:00'));
    expect(sheet.key).toBe('2026-09');
    expect(sheet.facts.lastMonth).toMatchObject({ month: 'September 2026', films: 1, theater: 0, hours: 2 });
    expect(sheet.facts.sameMonthLastYear).toBeNull();
  });
  it('anniversaries: a favourite turning a round age this week', () => {
    expect(anniversariesSheet(flatten(log), t('2026-05-30T08:00:00-04:00'))).toBeNull();
    const soon = anniversariesSheet(flatten({ ...log, b: { ...log.b, movie: film(2, 'E.T.', 1976) } }), t('2026-05-30T08:00:00-04:00'));
    expect(soon.facts.thisWeek[0]).toMatchObject({ title: 'E.T.', turns: 50, on: 'June 1', yourRating: 9 });
  });
});

describe('milestones and unfinished business', () => {
  it('fires once per round number, naming the film that crossed it', () => {
    const rows = flatten(log);
    const big = Array.from({ length: 101 }, (_, i) => ({ ...rows[0], film: 1000 + i, title: `Film ${i}`, medium: 'Streaming', date: t('2026-01-01T00:00:00-05:00') + i * 3600e3 }));
    const sheets = milestoneSheets([...rows, ...big], {}, now);
    const films = sheets.find((s) => s.facts.measure === 'films');
    expect(films.facts.reached).toBe(100);
    expect(films.facts.crossedBy.title).toBe('Film 97');
    expect(milestoneSheets([...rows, ...big], { 'films-100': true, 'ratings-100': true, 'year-2026-100': true }, now).map((s) => s.facts.measure)).toEqual([]);
  });
  it('lists directors with one or two features left, ignoring shorts and compilations', () => {
    const sheet = unfinishedSheet(log, flatten(log), now);
    expect(sheet.facts.directors).toEqual([{ director: 'Steven Spielberg', seen: 3, average: 7.23, best: { title: 'Jaws', rating: 8.1 }, left: [{ title: 'Lincoln', year: '2012' }] }]);
  });
});

describe('the numbers and what is due', () => {
  it('a pattern per month, groups of ten or more', () => {
    const rows = flatten(log);
    const many = Array.from({ length: 12 }, (_, i) => ({ ...rows[0], film: 500 + i, medium: 'Theater' }));
    const sheet = numbersSheet([...rows, ...many], now, 'medium');
    expect(sheet.facts.groups).toEqual([{ group: 'Theater', films: 14, average: 8.16 }]);
    expect(numbersSheet(rows, now).facts.pattern).toBe('weekday');
  });
  it('dueSheets picks today\'s kinds and skips what was written', () => {
    const due = dueSheets(log, { lastRatingAt: t('2026-10-27T06:00:00-04:00'), written: ['on-this-day-2026-10-28'] }, now);
    expect(due.sheets.map((s) => s.kind)).toEqual(['sits']);
    expect(due.lastRatingAt).toBe(t('2026-10-27T21:00:00-04:00'));
    const forced = dueSheets(log, {}, now, { force: true });
    expect(forced.sheets.map((s) => s.kind)).toEqual(expect.arrayContaining(['sits', 'on-this-day', 'month', 'unfinished', 'numbers']));
  });
  it('a story becomes a feed item with the fact line under it', () => {
    const [sheet] = sitsSheets(flatten(log), t('2026-10-27T06:00:00-04:00'), now);
    const item = storyItem(sheet, { headline: 'E.T. comes home at a nine', angle: 'a rewatch that moved', paragraphs: ['One.', 'Two & three.'] }, now);
    expect(item.id).toBe('log-sits-2-2026-10-27');
    expect(item.url).toBe('https://www.cinemaroll.org/movie/2');
    expect(item.content_html).toBe('<p>One.</p><p>Two &amp; three.</p><p><small>E.T. (1982) · 9 · Theater · Steven Spielberg: ranks 1 of 3 of theirs</small></p>');
    expect(item._newsprinted.expires).toBe(new Date(now + 3 * 864e5).toISOString());
  });
});

describe('asking the model', () => {
  // Sentry, 2026-10-28: forced tool choice ("tool"/"any") is a 400 on the current models,
  // so every story failed before a word was written.
  const fakeClient = (reply) => {
    const calls = [];
    return { calls, messages: { create: async (params) => { calls.push(params); return reply; } } };
  };
  const sheet = { kind: 'milestone', key: 'ratings-1500', facts: { count: 1500 } };
  const story = { type: 'tool_use', name: 'write_story', input: { angle: 'scale', headline: 'Fifteen hundred', paragraphs: ['One.', 'Two.'] } };

  it('never forces a tool call, and keeps the schema strict', async () => {
    const client = fakeClient({ stop_reason: 'tool_use', content: [story] });
    const out = await writeStory(client, sheet);
    expect(out.headline).toBe('Fifteen hundred');
    expect(client.calls).toHaveLength(1);
    expect(['tool', 'any']).not.toContain(client.calls[0].tool_choice?.type);
    expect(client.calls[0].tools[0].strict).toBe(true);
  });

  it('asks once more when the reply has no story, then gives up with the stop reason', async () => {
    const client = fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Here you go' }] });
    await expect(writeStory(client, sheet)).rejects.toThrow(/end_turn/);
    expect(client.calls).toHaveLength(2);
  });
});

describe('the music', () => {
  const zimmer = { job: 'Original Music Composer', name: 'Hans Zimmer' };
  const mlog = {
    a: { movie: film(11, 'Inception', 2010, { crew: [zimmer] }), ratings: [{ date: t('2025-01-02T20:00:00-05:00'), rating: 8.5, soundtrack: '9' }] },
    b: { movie: film(12, 'Dune: Part Two', 2024, { crew: [zimmer, spielberg] }), ratings: [{ date: t('2026-10-27T21:00:00-04:00'), rating: 9, soundtrack: '8', medium: 'Theater' }] },
    c: { movie: film(13, 'Quiet Film', 2020, { crew: [] }), ratings: [{ date: t('2026-10-27T22:00:00-04:00'), rating: 7, soundtrack: 6 }] },
    d: { movie: { title: 'No.Id Film', release_date: '2001-01-01' }, ratings: [{ date: t('2026-10-27T22:30:00-04:00'), rating: 7, soundtrack: 7 }] }
  };
  const since = t('2026-10-27T06:00:00-04:00');

  it('writes one for a 7+ soundtrack last night, with the composer and where the score sits', () => {
    const sheets = musicSheets(flatten(mlog), since, now);
    expect(sheets.map((s) => s.title)).toEqual(['Dune: Part Two', 'No.Id Film']);
    const [dune] = sheets;
    expect(dune.composers).toEqual(['Hans Zimmer']);
    expect(dune.facts.film).toMatchObject({ soundtrackScore: 8, medium: 'Theater' });
    expect(dune.facts.composers[0]).toMatchObject({ name: 'Hans Zimmer', otherFilmsYouHaveSeen: 1, theirBestByYourSoundtrackScore: [{ title: 'Inception', year: 2010, soundtrackScore: 9 }] });
    expect(dune.facts.yourSoundtrackScores).toEqual({ filmsScored: 4, filmsAtThisScoreOrHigher: 2, average: 7.5 });
    expect(sheets[1].key).toBe('No_Id Film');
  });

  it('never writes a film twice', () => {
    expect(musicSheets(flatten(mlog), since, now, { 12: 1, 'No_Id Film': 1 })).toEqual([]);
    expect(dueSheets(mlog, { lastRatingAt: since, music: { 12: 1 }, milestones: {} }, now).sheets.filter((s) => s.kind === 'music').map((s) => s.key)).toEqual(['No_Id Film']);
  });

  const sound = {
    found: true,
    album: { name: 'Dune: Part Two (Original Motion Picture Soundtrack)', artists: ['Hans Zimmer'], year: 2024, url: 'https://open.spotify.com/album/x', image: 'https://i.scdn.co/a.jpg' },
    tracks: [
      { number: 1, name: 'Beginnings Are Such Delicate Times', artists: ['Hans Zimmer'], minutes: 2.9, url: 'https://open.spotify.com/track/1', liked: false, rank: 500 },
      { number: 2, name: 'Eclipse', artists: ['Hans Zimmer'], minutes: 1.6, url: 'https://open.spotify.com/track/2', liked: true, rank: 900 },
      { number: 3, name: 'The Sietch', artists: ['Hans Zimmer'], minutes: 3.1, url: 'https://open.spotify.com/track/3', liked: false, rank: 800 },
      { number: 4, name: 'Water of Life', artists: ['Hans Zimmer'], minutes: 4, url: 'https://open.spotify.com/track/4', liked: false, rank: 100 }
    ],
    also: [],
    search: 'https://open.spotify.com/search/dune'
  };

  it('offers only tracks not yet liked, most played first, and holds the picks to them', () => {
    const [dune] = musicSheets(flatten(mlog), since, now);
    const sheet = enrichMusic(dune, sound, { title: 'Dune: Part Two (soundtrack)', url: 'https://en.wikipedia.org/wiki/Dune', extract: 'The score was composed by Hans Zimmer.' });
    expect(sheet.choices).toEqual(['The Sietch', 'Beginnings Are Such Delicate Times', 'Water of Life']);
    expect(sheet.facts.album.alreadyInYourLikedSongs).toEqual(['Eclipse']);
    expect(sheet.facts.aboutTheMusic.text).toContain('Zimmer');
    expect(musicPicks(sheet, ['water of life', 'Eclipse', 'Made Up Song'])).toEqual(['Water of Life', 'The Sietch']);
    const item = storyItem(sheet, { headline: 'H', angle: 'a', paragraphs: ['P'], picks: ['The Sietch'] }, now);
    expect(item.id).toBe('log-music-12');
    expect(item.image).toBe('https://i.scdn.co/a.jpg');
    expect(item.content_html).toContain('<a href="https://open.spotify.com/track/3">The Sietch</a>');
    expect(item.content_html).toContain('<a href="https://open.spotify.com/album/x">Open Dune: Part Two (Original Motion Picture Soundtrack) on Spotify</a>');
    expect(item.content_html).not.toContain('track/2');
  });

  it('falls back to a Spotify search when the album is not found', () => {
    const [dune] = musicSheets(flatten(mlog), since, now);
    const sheet = enrichMusic(dune, { found: false, search: 'https://open.spotify.com/search/dune' }, null);
    expect(sheet.facts.album).toEqual({ notFoundOnSpotify: true });
    expect(storyItem(sheet, { headline: 'H', angle: 'a', paragraphs: ['P'], picks: [] }, now).content_html).toContain('Look for the soundtrack on Spotify');
  });

  it('finds Wikipedia\'s soundtrack article and skips the film\'s own', async () => {
    const getJson = async (url) => url.includes('list=search')
      ? { query: { search: [{ title: 'Dune: Part Two' }, { title: 'Dune: Part Two (soundtrack)' }] } }
      : { query: { pages: { 1: { title: 'Dune: Part Two (soundtrack)', extract: 'Dune: Part Two (Original Motion Picture Soundtrack) is the film score composed by Hans Zimmer for the 2024 film.' } } } };
    const wiki = await soundtrackWiki(getJson, { title: 'Dune: Part Two', year: 2024 });
    expect(wiki.title).toBe('Dune: Part Two (soundtrack)');
    expect(wiki.url).toBe('https://en.wikipedia.org/wiki/Dune%3A_Part_Two_(soundtrack)');
  });
});
