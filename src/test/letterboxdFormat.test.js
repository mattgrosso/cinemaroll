import { describe, it, expect } from 'vitest';
import {
  starsFor,
  compactCount,
  reviewsFromNode,
  parseCsv,
  normalizeTitle,
  buildTitleIndex,
  matchTitle,
  reviewsCsvToUpdates,
  relativeTimeFrom
} from '@/assets/javascript/letterboxdFormat.js';

describe('starsFor', () => {
  it('renders Letterboxd half stars and nothing for unrated', () => {
    expect(starsFor(3.5)).toBe('★★★½');
    expect(starsFor(5)).toBe('★★★★★');
    expect(starsFor(0.5)).toBe('½');
    expect(starsFor(0)).toBeNull();
    expect(starsFor(null)).toBeNull();
  });
});

describe('compactCount', () => {
  it('rounds the way Letterboxd shows counts', () => {
    expect(compactCount(1307901)).toBe('1.3M');
    expect(compactCount(61000)).toBe('61K');
    expect(compactCount(1500)).toBe('1.5K');
    expect(compactCount(12000)).toBe('12K');
    expect(compactCount(842)).toBe('842');
    expect(compactCount(null)).toBeNull();
  });
});

describe('reviewsFromNode', () => {
  it('sorts newest viewing first and collapses the feed/CSV twin of one viewing', () => {
    const node = {
      'review-1': { source: 'rss', watchedDate: '2026-09-27', review: 'Great.', url: 'https://letterboxd.com/x' },
      'csv-abc': { source: 'csv', watchedDate: '2026-09-27', review: 'Great.' },
      'csv-old': { source: 'csv', watchedDate: '2020-01-01', review: 'First time.' },
      'watch-9': { source: 'rss', watchedDate: '2024-05-05' }
    };
    const list = reviewsFromNode(node);
    expect(list.map((r) => r.id)).toEqual(['review-1', 'watch-9', 'csv-old']);
    expect(list[0].url).toBe('https://letterboxd.com/x');
  });

  it('tolerates an empty node', () => {
    expect(reviewsFromNode(null)).toEqual([]);
  });
});

describe('parseCsv', () => {
  it('handles quoted fields with commas, doubled quotes and embedded newlines', () => {
    const text = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\r\n' +
      '2026-09-28,Primetime,2026,https://boxd.it/AbC1,2.5,No,"First line, with a comma.\n\nSecond ""quoted"" line.",,2026-09-27\r\n' +
      '2026-09-20,"Heat",1995,https://boxd.it/ZzZ9,4.5,Yes,,favorites,2026-09-19\r\n';
    const rows = parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe('Primetime');
    expect(rows[0].Review).toBe('First line, with a comma.\n\nSecond "quoted" line.');
    expect(rows[0]['Watched Date']).toBe('2026-09-27');
    expect(rows[1].Rewatch).toBe('Yes');
    expect(rows[1].Tags).toBe('favorites');
  });

  it('strips a BOM and returns nothing for an empty file', () => {
    expect(parseCsv('\uFEFFName,Year\nHeat,1995')).toEqual([{ Name: 'Heat', Year: '1995' }]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('title matching', () => {
  const entries = [
    { movie: { id: 949, title: 'Heat', release_date: '1995-12-15' } },
    { movie: { id: 101, title: 'Léon: The Professional', release_date: '1994-09-14' } },
    { movie: { id: 202, title: 'Anora', release_date: '2024-10-14' } },
    { movie: { id: -5, title: 'Placeholder', release_date: '2024-01-01' } }
  ];
  const index = buildTitleIndex(entries);

  it('normalizes accents, punctuation and case', () => {
    expect(normalizeTitle('Léon: The Professional')).toBe('leontheprofessional');
    expect(normalizeTitle('Fast & Furious')).toBe('fastandfurious');
  });

  it('matches exact year, then a neighbouring year, and skips placeholders', () => {
    expect(matchTitle(index, 'heat', 1995)).toBe(949);
    expect(matchTitle(index, 'Leon: The Professional', 1994)).toBe(101);
    expect(matchTitle(index, 'Anora', 2025)).toBe(202);
    expect(matchTitle(index, 'Placeholder', 2024)).toBeNull();
    expect(matchTitle(index, 'Heat', 2010)).toBeNull();
  });
});

describe('reviewsCsvToUpdates', () => {
  const entries = [{ movie: { id: 949, title: 'Heat', release_date: '1995-12-15' } }];

  it('builds the same review records the feed sync writes, keyed by the boxd.it code', () => {
    const rows = [
      { Date: '2026-09-20', Name: 'Heat', Year: '1995', 'Letterboxd URI': 'https://boxd.it/ZzZ9', Rating: '4.5', Rewatch: 'Yes', Review: 'Still great.\r\nReally.', Tags: '', 'Watched Date': '2026-09-19' },
      { Date: '2026-09-21', Name: 'Nobody Has This', Year: '2001', 'Letterboxd URI': 'https://boxd.it/Q', Rating: '', Rewatch: 'No', Review: '', Tags: '', 'Watched Date': '2026-09-21' }
    ];
    const { updates, matched, unmatched } = reviewsCsvToUpdates(rows, entries, 5000);
    expect(matched).toBe(1);
    expect(unmatched).toEqual([{ title: 'Nobody Has This', year: 2001 }]);
    expect(updates['949/csv-ZzZ9']).toEqual({
      source: 'csv',
      kind: 'review',
      title: 'Heat',
      year: 1995,
      rating: 4.5,
      watchedDate: '2026-09-19',
      rewatch: true,
      review: 'Still great.\nReally.',
      url: 'https://boxd.it/ZzZ9',
      publishedAt: Date.parse('2026-09-20T12:00:00'),
      syncedAt: 5000
    });
  });

  it('an unrated, unreviewed row is a plain watch with no rating field', () => {
    const rows = [{ Date: '2026-09-20', Name: 'Heat', Year: '1995', 'Letterboxd URI': '', Rating: '', Rewatch: 'No', Review: '', 'Watched Date': '2026-09-19' }];
    const { updates } = reviewsCsvToUpdates(rows, entries, 1);
    const [record] = Object.values(updates);
    expect(record.kind).toBe('watch');
    expect(record).not.toHaveProperty('rating');
    expect(record).not.toHaveProperty('review');
    expect(record).not.toHaveProperty('rewatch');
  });
});

describe('relativeTimeFrom', () => {
  it('speaks in the nearest unit', () => {
    const now = 1_000_000_000_000;
    expect(relativeTimeFrom(now - 30000, now)).toBe('just now');
    expect(relativeTimeFrom(now - 5 * 60000, now)).toBe('5 minutes ago');
    expect(relativeTimeFrom(now - 3 * 3600000, now)).toBe('3 hours ago');
    expect(relativeTimeFrom(now - 49 * 3600000, now)).toBe('2 days ago');
  });
});
