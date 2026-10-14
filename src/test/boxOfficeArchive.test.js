import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { archiveFacts, archiveSummary, weekendForDate, weekendLine, threeDayWeekends, archiveMovieUrl } from '@/assets/javascript/boxOfficeArchive.js';
import { fetchArchiveFilm, fetchArchiveCalendar } from '@/utils/boxOfficeArchiveRequest.js';

const darkKnight = {
  id: 'darkknight',
  title: 'The Dark Knight',
  year: 2008,
  domestic: 535234033,
  worldwide: 1004934033,
  opening: { gross: 158411483, theaters: 4366, rank: 1, average: 36283, weekendKey: '2008-29' },
  widest: 4366,
  inRelease: { days: 231 },
  weekends: [
    { start: '2008-08-29', end: '2008-09-01', days: 4, rank: 3, gross: 11127290, week: 7 },
    { start: '2008-07-18', end: '2008-07-20', days: 3, rank: 1, gross: 158411483, week: 1, weekendKey: '2008-29' },
    { start: '2008-07-25', end: '2008-07-27', days: 3, rank: 1, gross: 75166466, week: 2 },
    { start: '2008-08-01', end: '2008-08-03', days: 3, rank: 1, gross: 42664219, week: 3 },
    { start: '2008-08-08', end: '2008-08-10', days: 3, rank: 1, gross: 26117030, week: 4 },
    { start: '2008-08-15', end: '2008-08-17', days: 3, rank: 2, gross: 16379293, week: 5 },
    { start: '2008-08-29', end: '2008-08-31', days: 3, rank: 3, gross: 8622879, week: 7 },
    { start: '2008-09-05', end: '2008-09-07', days: 3, rank: 12, gross: 5515119, week: 8 }
  ]
};

describe('boxOfficeArchive — facts for the Box office tile', () => {
  it('drops the 4-day holiday twin and keeps the weekends in date order', () => {
    const w = threeDayWeekends(darkKnight);
    expect(w).toHaveLength(7);
    expect(w[0].start).toBe('2008-07-18');
    expect(w.every((x) => x.days === 3)).toBe(true);
  });

  it('counts weekends at #1 and in the top ten, and names the opening', () => {
    const f = archiveFacts(darkKnight);
    expect(f.atOne).toBe(4);
    expect(f.inTopTen).toBe(6);
    expect(f.opening).toMatchObject({ gross: 158411483, theaters: 4366, rank: 1, weekendKey: '2008-29' });
    expect(f.widest).toBe(4366);
    expect(f.days).toBe(231);
    expect(f.domesticToday).toBeGreaterThan(535234033);
    expect(f.url).toBe(archiveMovieUrl('darkknight'));
  });

  it('is null for a film the archive has no total for', () => {
    expect(archiveFacts(null)).toBeNull();
    expect(archiveFacts({ id: 'x', title: 'X', domestic: null, weekends: [] })).toBeNull();
  });

  it('writes the closed-tile summary', () => {
    expect(archiveSummary(archiveFacts(darkKnight))).toBe('$535M domestic · opened #1, $158M · 4 weekends at #1');
    expect(archiveSummary(archiveFacts({ ...darkKnight, opening: null, weekends: [] }))).toBe('$535M domestic');
  });
});

const calendar = {
  year: 2015,
  weekends: [
    { k: '2015-26', s: '2015-06-26', e: '2015-06-28', top: 'Jurassic World', id: 'jurassicpark4', g: 54530874 },
    { k: '2015-27', s: '2015-07-03', e: '2015-07-05', top: 'Inside Out', id: 'pixar2014', g: 29771224 },
    { k: '2015-28', s: '2015-07-10', e: '2015-07-12', top: 'Minions', id: 'minions', g: 115718405 }
  ]
};

describe('boxOfficeArchive — the weekend a viewing belongs to', () => {
  it('finds the weekend holding the date, else the one just gone', () => {
    expect(weekendForDate(calendar, '2015-07-04').k).toBe('2015-27');
    expect(weekendForDate(calendar, '2015-07-08').k).toBe('2015-27');
    expect(weekendForDate(calendar, '2015-07-10').k).toBe('2015-28');
  });
  it('gives up before the first weekend, on bad dates and empty files', () => {
    expect(weekendForDate(calendar, '2015-06-20')).toBeNull();
    expect(weekendForDate(calendar, 'yesterday')).toBeNull();
    expect(weekendForDate(null, '2015-07-04')).toBeNull();
  });
  it('writes the line', () => {
    expect(weekendLine(calendar.weekends[1])).toBe('#1 that weekend: Inside Out ($30M)');
    expect(weekendLine({ top: 'Jaws', g: 7061513 })).toBe('#1 that weekend: Jaws ($7.1M)');
    expect(weekendLine(null)).toBe('');
  });
});

describe('boxOfficeArchiveRequest — two hops, cached, never throws', () => {
  const json = (body, type = 'application/json') => ({ ok: true, headers: { get: () => type }, json: async () => body });
  let fetchMock;
  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('looks the TMDB id up, then the film, and caches the answer', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'darkknight', title: 'The Dark Knight', year: 2008, domestic: 535234033 }))
      .mockResolvedValueOnce(json(darkKnight));
    const film = await fetchArchiveFilm(155, { now: 1000 });
    expect(film.id).toBe('darkknight');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/lookup/tmdb/155.json');
    expect(fetchMock.mock.calls[1][0]).toContain('/api/v1/movies/darkknight.json');
    const again = await fetchArchiveFilm(155, { now: 2000 });
    expect(again.id).toBe('darkknight');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats the SPA fallback page as "not in the archive"', async () => {
    fetchMock.mockResolvedValueOnce(json('<!doctype html>', 'text/html'));
    expect(await fetchArchiveFilm(999999, { now: 1000 })).toBeNull();
  });

  it('answers null on a network failure and asks again later', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchArchiveFilm(155, { now: 1000 })).toBeNull();
    fetchMock.mockResolvedValueOnce(json(calendar));
    expect((await fetchArchiveCalendar(2015, { now: 1000 })).year).toBe(2015);
    expect(await fetchArchiveCalendar('not a year')).toBeNull();
  });
});
