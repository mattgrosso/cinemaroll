// The Letterboxd export → library import (2026-11-14). The zip is inflated
// by the platform's DecompressionStream; jsdom has none, so Node's stands in.
import { describe, it, expect } from 'vitest';
import { DecompressionStream as NodeDecompressionStream } from 'node:stream/web';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readZipTextFiles, isZip } from '../utils/zipReader.js';
import { parseCsv } from '../assets/javascript/letterboxdFormat.js';
import { ratingBreakdown } from '../assets/javascript/ratingMath.js';
import {
  starsToCriteria, buildFilmList, pickTmdbMatch, viewingToRating, missingViewings,
  mergeRatings, planImportBatch, importedViewingIndex, withoutImportMarks,
  exportFileKind, csvKind, dayToEpoch, epochToDay
} from '../assets/javascript/letterboxdImport.js';

if (typeof globalThis.DecompressionStream === 'undefined') globalThis.DecompressionStream = NodeDecompressionStream;

// The app's weights (store state `weights`).
const WEIGHTS = { love: 2.8, overall: 2, story: 1.25, direction: 1.1, imagery: 0.9, stickiness: 1.9, performance: 0.7, soundtrack: 0.3 };
const scoreOf = (rating) => ratingBreakdown(rating, (name) => WEIGHTS[name]).score;

const zipBuffer = () => {
  const bytes = readFileSync(join(__dirname, 'fixtures/letterboxd-export.zip'));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const readExport = async () => {
  const files = await readZipTextFiles(zipBuffer(), (name) => Boolean(exportFileKind(name)));
  const found = {};
  for (const { name, text } of files) found[exportFileKind(name)] = parseCsv(text);
  return found;
};

describe('reading the export zip', () => {
  it('reads deflated and stored entries, and skips the deleted/ folder', async () => {
    expect(isZip(zipBuffer())).toBe(true);
    const all = await readZipTextFiles(zipBuffer());
    expect(all.map((file) => file.name).sort()).toEqual(['deleted/diary.csv', 'diary.csv', 'profile.csv', 'ratings.csv', 'reviews.csv']);
    expect(all.find((file) => file.name === 'profile.csv').text).toContain('Date Joined'); // stored, not deflated

    const found = await readExport();
    expect(Object.keys(found).sort()).toEqual(['diary', 'ratings', 'reviews']);
    expect(found.diary.map((row) => row.Name)).not.toContain('Deleted Film');
    expect(found.reviews[0].Review).toBe('The diner scene.\n\nStill.');
  });

  it('refuses a file that is not a zip', async () => {
    const text = new TextEncoder().encode('Name,Year\nHeat,1995\n').buffer;
    expect(isZip(text)).toBe(false);
    await expect(readZipTextFiles(text)).rejects.toThrow(/zip/);
  });

  it('tells a lone CSV apart by its columns', async () => {
    const found = await readExport();
    expect(csvKind(found.diary)).toBe('diary');
    expect(csvKind(found.ratings)).toBe('ratings');
    expect(csvKind(found.reviews)).toBe('reviews');
    expect(csvKind([{ Username: 'x' }])).toBe(null);
  });
});

describe('stars to a score', () => {
  it('scores exactly twice the stars, so the library ranks as Letterboxd did', () => {
    for (const stars of [0.5, 1, 2.5, 3.5, 4, 4.5, 5]) {
      expect(scoreOf(starsToCriteria(stars))).toBe(stars * 2);
    }
  });

  it('keeps every criterion on its own scale', () => {
    expect(starsToCriteria(4)).toEqual({ direction: 8, imagery: 8, story: 8, performance: 8, soundtrack: 8, love: 8, overall: 8, stickiness: 4 });
  });
});

describe('buildFilmList', () => {
  it('groups diary viewings per film and fills unrated ones from the film rating', async () => {
    const films = buildFilmList(await readExport());
    const heat = films.find((film) => film.title === 'Heat');
    expect(heat.year).toBe(1995);
    expect(heat.viewings).toEqual([
      { day: '2024-01-02', stars: 4.5 }, // its own diary stars
      { day: '2024-03-09', stars: 5 } // unrated rewatch: the film's rating
    ]);
  });

  it('brings in a rated film that was never diaried, on the day it was rated', async () => {
    const films = buildFilmList(await readExport());
    expect(films.find((film) => film.title === 'Paddington 2').viewings).toEqual([{ day: '2023-06-01', stars: 4.5 }]);
  });

  it('leaves a film with no stars anywhere unrated', async () => {
    const films = buildFilmList(await readExport());
    expect(films.find((film) => film.title === 'Some Obscure Short').viewings).toEqual([{ day: '2024-02-05', stars: null }]);
  });

  it('keeps titles with commas whole', async () => {
    const films = buildFilmList(await readExport());
    expect(films.map((film) => film.title)).toContain('Crouching Tiger, Hidden Dragon');
  });
});

describe('pickTmdbMatch', () => {
  const heat95 = { id: 949, title: 'Heat', release_date: '1995-12-15', popularity: 40 };
  const heat86 = { id: 11000, title: 'Heat', release_date: '1986-03-14', popularity: 5 };

  it('is sure only when title and year agree', () => {
    expect(pickTmdbMatch([heat86, heat95], 'Heat', 1995)).toEqual({ tmdbId: 949, sure: true });
  });

  it('suggests, never writes, a title a year apart', () => {
    const pick = pickTmdbMatch([{ ...heat95, release_date: '1996-01-01' }], 'Heat', 1995);
    expect(pick.sure).toBe(false);
    expect(pick.suggestion.id).toBe(949);
  });

  it('suggests a same-year film with another title (a translated title)', () => {
    const pick = pickTmdbMatch([{ id: 146, title: 'Crouching Tiger, Hidden Dragon', original_title: '臥虎藏龍', release_date: '2000-07-06' }], 'Wo hu cang long', 2000);
    expect(pick.sure).toBe(false);
    expect(pick.suggestion.id).toBe(146);
  });

  it('matches on the original title too', () => {
    expect(pickTmdbMatch([{ id: 1, title: 'Amélie', original_title: "Le Fabuleux Destin d'Amélie Poulain", release_date: '2001-04-25' }], "Le Fabuleux Destin d'Amélie Poulain", 2001).sure).toBe(true);
  });

  it('has nothing to suggest when nothing came back', () => {
    expect(pickTmdbMatch([], 'Heat', 1995)).toEqual({ tmdbId: null, sure: false, suggestion: null });
  });
});

describe('viewings', () => {
  const film = { tmdbId: 949, title: 'Heat', year: 1995 };

  it('is marked as imported, with its stars, on the right day', () => {
    const rating = viewingToRating({ day: '2024-01-02', stars: 4.5 }, film);
    expect(rating).toMatchObject({ id: 949, title: 'Heat', year: '1995', medium: 'Other', importedFrom: 'letterboxd', letterboxdStars: 4.5 });
    expect(epochToDay(rating.date)).toBe('2024-01-02');
    expect(scoreOf(rating)).toBe(9);
  });

  it('marks a viewing with no stars, and puts it in the middle', () => {
    const rating = viewingToRating({ day: '2024-02-05', stars: null }, film);
    expect(rating.letterboxdUnrated).toBe(true);
    expect(rating.letterboxdStars).toBeUndefined();
    expect(scoreOf(rating)).toBe(5);
  });

  it('adds only the days the library does not have', () => {
    const existing = [{ date: dayToEpoch('2024-01-02') + 7 * 3600 * 1000, overall: 9 }];
    const viewings = [{ day: '2024-01-02', stars: 4.5 }, { day: '2024-03-09', stars: 5 }];
    expect(missingViewings(existing, viewings)).toEqual([{ day: '2024-03-09', stars: 5 }]);
    const merged = mergeRatings(existing, viewings, film);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(existing[0]);
    expect(merged[1].importedFrom).toBe('letterboxd');
  });

  it('finds the newest imported viewing, and a re-rate drops the marks', () => {
    const ratings = [{ overall: 7 }, viewingToRating({ day: '2024-01-02', stars: 4 }, film), { overall: 8 }];
    expect(importedViewingIndex(ratings)).toBe(1);
    expect(importedViewingIndex([{ overall: 7 }])).toBe(-1);
    const cleaned = withoutImportMarks(ratings[1]);
    expect(cleaned.importedFrom).toBeUndefined();
    expect(cleaned.letterboxdStars).toBeUndefined();
    expect(cleaned.overall).toBe(8);
  });
});

describe('exportFileKind', () => {
  it('reads the top-level files, or one folder down, but never deleted/ or likes/', () => {
    expect(exportFileKind('diary.csv')).toBe('diary');
    expect(exportFileKind('letterboxd-me-2026/ratings.csv')).toBe('ratings');
    expect(exportFileKind('deleted/diary.csv')).toBe(null);
    expect(exportFileKind('likes/reviews.csv')).toBe(null);
    expect(exportFileKind('__MACOSX/diary.csv')).toBe(null);
    expect(exportFileKind('watched.csv')).toBe(null);
  });
});

describe('planImportBatch', () => {
  const heatFilm = { key: 'heat|1995', title: 'Heat', year: 1995, viewings: [{ day: '2024-01-02', stars: 4.5 }] };
  const movie = { id: 949, title: 'Heat', release_date: '1995-12-15' };
  let counter = 0;
  const makeKey = (title) => `k${(counter += 1)}-${title}`;

  it('writes a new film as a whole entry, with every viewing', () => {
    const { entries, updates, outcomes } = planImportBatch([{ film: heatFilm, kind: 'new', tmdbId: 949, movie }], { movieLog: {}, makeKey });
    expect(entries).toHaveLength(1);
    const [path] = Object.keys(updates);
    expect(path).toMatch(/^movieLog\/k\d+-Heat$/);
    expect(updates[path].movie).toBe(movie);
    expect(Array.isArray(updates[path].ratings)).toBe(true);
    expect(updates[path].ratings[0].letterboxdStars).toBe(4.5);
    expect(outcomes['heat|1995']).toMatchObject({ status: 'done', created: true, added: 1 });
  });

  it('adds missing viewings to a film already in the library, writing only its ratings', () => {
    const movieLog = { existing: { movie, ratings: [{ date: dayToEpoch('2023-05-05'), overall: 9 }] } };
    const { updates, outcomes } = planImportBatch([{ film: heatFilm, kind: 'new', tmdbId: 949, movie }], { movieLog, makeKey });
    expect(Object.keys(updates)).toEqual(['movieLog/existing/ratings']);
    expect(updates['movieLog/existing/ratings']).toHaveLength(2);
    expect(outcomes['heat|1995']).toMatchObject({ created: false, added: 1, dbKey: 'existing' });
  });

  it('writes nothing for a film whose viewings are all there (a resumed run)', () => {
    const movieLog = { existing: { movie, ratings: [viewingToRating({ day: '2024-01-02', stars: 4.5 }, { tmdbId: 949, title: 'Heat', year: 1995 })] } };
    const { entries, updates, outcomes } = planImportBatch([{ film: heatFilm, kind: 'merge', tmdbId: 949 }], { movieLog, makeKey });
    expect(entries).toEqual([]);
    expect(updates).toEqual({});
    expect(outcomes['heat|1995']).toMatchObject({ status: 'done', added: 0 });
  });

  it('makes one entry when two titles in a batch are the same TMDB film', () => {
    const other = { key: 'heat|1996', title: 'Heat', year: 1996, viewings: [{ day: '2024-05-05', stars: 4 }] };
    const { entries, updates } = planImportBatch([
      { film: heatFilm, kind: 'new', tmdbId: 949, movie },
      { film: other, kind: 'new', tmdbId: 949, movie }
    ], { movieLog: {}, makeKey });
    expect(entries).toHaveLength(1);
    const [path] = Object.keys(updates);
    expect(Object.keys(updates)).toHaveLength(1);
    expect(updates[path].ratings.map((rating) => epochToDay(rating.date))).toEqual(['2024-01-02', '2024-05-05']);
  });

  it('records a doubtful film with its suggestion and writes nothing', () => {
    const { updates, outcomes } = planImportBatch([{ film: heatFilm, kind: 'doubtful', suggestion: { id: 949, title: 'Heat', release_date: '1996-01-01', poster_path: '/p.jpg', overview: 'long' } }], { movieLog: {}, makeKey });
    expect(updates).toEqual({});
    expect(outcomes['heat|1995']).toEqual({ status: 'doubtful', suggestion: { id: 949, title: 'Heat', release_date: '1996-01-01', poster_path: '/p.jpg' } });
  });
});
