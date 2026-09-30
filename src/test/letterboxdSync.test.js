import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRss,
  reviewsUpdate,
  parseFilmPage,
  parseCompactCount,
  filmsDue,
  libraryTmdbIds,
  reviewFromDescription,
  FILM_MAX_AGE_MS,
  FILM_RETRY_MS
} from '../../aws-lambda/letterboxdSync.js';

// Trimmed from Matt's real feed on 2026-09-29: one review, one plain watch,
// one list, one rewatch review. Real markup, not a hand-written imitation.
const rss = readFileSync(join(__dirname, 'fixtures/letterboxd-rss.xml'), 'utf8');
const filmPage = readFileSync(join(__dirname, 'fixtures/letterboxd-film.html'), 'utf8');

describe('parseRss', () => {
  const items = parseRss(rss);

  it('keeps diary entries and drops lists', () => {
    expect(items.map((i) => i.kind).sort()).toEqual(['review', 'review', 'watch']);
    expect(items.every((i) => Number.isInteger(i.tmdbId) && i.tmdbId > 0)).toBe(true);
  });

  it('reads the review text as paragraphs, without the poster', () => {
    const primetime = items.find((i) => i.title === 'Primetime');
    expect(primetime.tmdbId).toBe(1375441);
    expect(primetime.rating).toBe(2.5);
    expect(primetime.watchedDate).toBe('2026-09-27');
    expect(primetime.rewatch).toBe(false);
    expect(primetime.review.startsWith('I see that this particular pop culture phenomenon')).toBe(true);
    expect(primetime.review).toContain('\n\n');
    expect(primetime.review).not.toContain('<');
    expect(primetime.review).toContain('a lot of directing'); // the <i> is unwrapped, not dropped
    expect(primetime.reviewId).toBe('review-1514099669');
    expect(primetime.url).toBe('https://letterboxd.com/mattgrosso/film/primetime-2026/');
    expect(typeof primetime.publishedAt).toBe('number');
  });

  it('a plain watch has no review text — its "Watched on …" boilerplate is not a review', () => {
    const watch = items.find((i) => i.kind === 'watch');
    expect(watch.review).toBe('');
    expect(watch.reviewId.startsWith('watch-')).toBe(true);
  });

  it('carries the rewatch flag', () => {
    expect(items.some((i) => i.rewatch)).toBe(true);
  });

  it('an unrated entry has a null rating, not zero', () => {
    const xml = rss.replace(/<letterboxd:memberRating>[^<]*<\/letterboxd:memberRating>/g, '');
    expect(parseRss(xml).every((i) => i.rating === null)).toBe(true);
  });
});

describe('reviewFromDescription', () => {
  it('flags and strips the spoiler notice', () => {
    const html = '<p><img src="x.jpg"/></p> <p><em>This review may contain spoilers.</em></p><p>He dies.</p>';
    expect(reviewFromDescription(html)).toEqual({ review: 'He dies.', spoilers: true });
  });

  it('decodes entities', () => {
    expect(reviewFromDescription('<p>Tom &amp; Jerry &#8217;s &quot;best&quot;</p>').review).toBe('Tom & Jerry ’s "best"');
  });
});

describe('reviewsUpdate', () => {
  it('keys by tmdbId/reviewId and omits empty fields', () => {
    const update = reviewsUpdate(parseRss(rss), 1000);
    const keys = Object.keys(update);
    expect(keys).toContain('1375441/review-1514099669');
    const primetime = update['1375441/review-1514099669'];
    expect(primetime.syncedAt).toBe(1000);
    expect(primetime.source).toBe('rss');
    expect(primetime).not.toHaveProperty('rewatch'); // false -> omitted
    expect(primetime).not.toHaveProperty('spoilers');
    const watch = update[keys.find((k) => k.includes('/watch-'))];
    expect(watch).not.toHaveProperty('review');
  });
});

describe('parseFilmPage', () => {
  it('reads slug, weighted rating, rating count and fans from a real page', () => {
    expect(parseFilmPage(filmPage)).toEqual({
      slug: 'heat-1995',
      title: 'Heat (1995)',
      rating: 4.32,
      ratingCount: 1307901,
      fans: 61000
    });
  });

  it('returns null for something that is not a film page', () => {
    expect(parseFilmPage('<html><title>Just a moment...</title></html>')).toBeNull();
    expect(parseFilmPage('')).toBeNull();
  });
});

describe('parseCompactCount', () => {
  it('expands K and M', () => {
    expect(parseCompactCount('61K')).toBe(61000);
    expect(parseCompactCount('1.3M')).toBe(1300000);
    expect(parseCompactCount('842')).toBe(842);
    expect(parseCompactCount('1,204')).toBe(1204);
    expect(parseCompactCount('lots')).toBeNull();
  });
});

describe('filmsDue', () => {
  const now = 10 * FILM_MAX_AGE_MS;

  it('never-fetched films come first, then the stalest, capped', () => {
    const existing = {
      1: { fetchedAt: now - FILM_MAX_AGE_MS - 1 },
      2: { fetchedAt: now - 1 },
      3: { fetchedAt: now - 2 * FILM_MAX_AGE_MS }
    };
    expect(filmsDue([1, 2, 3, 4, 4, '5'], existing, now, { cap: 3 })).toEqual([4, 5, 3]);
  });

  it('a recent failure is left alone; an old one is retried', () => {
    const existing = {
      7: { failedAt: now - 1 },
      8: { failedAt: now - FILM_RETRY_MS - 1 }
    };
    expect(filmsDue([7, 8], existing, now)).toEqual([8]);
  });

  it('ignores junk ids', () => {
    expect(filmsDue([0, null, 'abc', -4], {}, now)).toEqual([]);
  });
});

describe('libraryTmdbIds', () => {
  it('collects positive integer ids once each and skips placeholders', () => {
    const movieLog = {
      a: { movie: { id: 550 } },
      b: { movie: { id: 550 } },
      c: { movie: { id: -12 } },
      d: { movie: {} },
      e: null
    };
    expect(libraryTmdbIds(movieLog)).toEqual([550]);
  });
});
