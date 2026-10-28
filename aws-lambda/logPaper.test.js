import { describe, expect, it } from 'vitest';
import { flatten, sitsSheets, onThisDaySheet, monthSheet, milestoneSheets, unfinishedSheet, anniversariesSheet, numbersSheet, dueSheets, storyItem } from './logPaper.js';

const t = (s) => Date.parse(s);
const spielberg = { job: 'Director', name: 'Steven Spielberg', filmography: [{ id: 1, title: 'Jaws', release_date: '1975-06-20', popularity: 50 }, { id: 2, title: 'E.T.', release_date: '1982-06-11', popularity: 40 }, { id: 3, title: 'Hook', release_date: '1991-12-11', popularity: 20 }, { id: 4, title: 'Lincoln', release_date: '2012-11-09', popularity: 15 }, { id: 9, title: 'Short Thing', release_date: '1970-01-01', popularity: 0.5 }] };
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
  it('lists directors with one or two features left, ignoring shorts', () => {
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
