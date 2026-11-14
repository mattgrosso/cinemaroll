import { describe, it, expect } from 'vitest';
import {
  stickinessCandidates,
  ratingNeedsStickiness,
  nextStickinessDueAt,
  passesAlreadyPast,
  isImportedViewing,
  ONE_WEEK_MS,
  SIX_MONTHS_MS
} from '@/assets/javascript/stickinessCandidates.js';
import { stickinessDigest } from '@/assets/javascript/pushDigest.js';
import { IMPORTED_FROM, viewingToRating } from '@/assets/javascript/letterboxdImport.js';
import { appBadgeCount } from '@/assets/javascript/appBadge.js';

// Report 2026-11-14 (Matt): someone who imports their whole Letterboxd
// library mustn't be "bombarded" a week later, or six months later, with a
// thousand stickiness checks. A viewing still marked as imported is never
// asked about — not by the Home prompt, not by the badge, not by a push.

const NOW = new Date('2026-11-14T12:00:00Z').getTime();
const ONE_DAY = 24 * 60 * 60 * 1000;

const importedEntry = (id, daysAgo) => {
  const when = new Date(NOW - daysAgo * ONE_DAY);
  const day = when.toISOString().slice(0, 10);
  return {
    movie: { id, title: `Imported ${id}` },
    ratings: [viewingToRating({ day, stars: 4 }, { tmdbId: id, title: `Imported ${id}`, year: 2000 })]
  };
};

// A thousand films, logged over the last six years, plus some fresh ones
// that will cross the week boundary soon.
const library = [
  ...Array.from({ length: 1000 }, (_, index) => importedEntry(index + 1, 10 + index * 2)),
  ...Array.from({ length: 20 }, (_, index) => importedEntry(5000 + index, 1 + (index % 5)))
];

const ratingOf = (entry) => entry.ratings[entry.ratings.length - 1];

describe('imported Letterboxd viewings and stickiness', () => {
  it('the mark this rule reads is the one the import writes', () => {
    expect(isImportedViewing({ importedFrom: IMPORTED_FROM })).toBe(true);
    expect(isImportedViewing({})).toBe(false);
  });

  it('an imported library puts nothing in the Home prompt', () => {
    expect(stickinessCandidates(library, { ratingOf, now: NOW })).toHaveLength(0);
    // Nor six months on, when every film is past both boundaries.
    expect(stickinessCandidates(library, { ratingOf, now: NOW + SIX_MONTHS_MS + ONE_WEEK_MS })).toHaveLength(0);
  });

  it('an imported viewing never becomes due later either', () => {
    const fresh = ratingOf(library[library.length - 1]);
    expect(ratingNeedsStickiness(fresh, NOW + 2 * SIX_MONTHS_MS)).toBe(false);
    expect(nextStickinessDueAt(fresh, NOW)).toBeNull();
  });

  it('the push digest counts zero now and schedules nothing for later', () => {
    const digest = stickinessDigest(library, {}, NOW);
    expect(digest.count).toBe(0);
    expect(digest.dueTimes).toEqual([]);
    expect(digest.nextTitle).toBeNull();
  });

  it('so the badge stays at zero', () => {
    const digest = { stickiness: stickinessDigest(library, {}, NOW) };
    expect(appBadgeCount(digest, {}, NOW)).toBe(0);
  });

  it('a film rated properly after import is asked about as normal', () => {
    const entry = importedEntry(1, 10);
    const { importedFrom, letterboxdStars, ...real } = entry.ratings[0];
    void importedFrom; void letterboxdStars;
    const rerated = { ...entry, ratings: [real] };
    expect(stickinessDigest([rerated], {}, NOW).count).toBe(1);
  });
});

describe('passesAlreadyPast', () => {
  it('an old viewing is past both passes', () => {
    expect(passesAlreadyPast({ date: NOW - 2 * SIX_MONTHS_MS }, NOW))
      .toEqual({ userAddedStickiness: true, userAddedSixMonthStickiness: true });
  });
  it('a month-old viewing is past only the week pass', () => {
    expect(passesAlreadyPast({ date: NOW - 30 * ONE_DAY }, NOW)).toEqual({ userAddedStickiness: true });
  });
  it('a days-old viewing keeps both', () => {
    expect(passesAlreadyPast({ date: NOW - 2 * ONE_DAY }, NOW)).toEqual({});
  });
});
