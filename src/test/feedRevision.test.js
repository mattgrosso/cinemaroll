import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { contentRevision, revisionUrlFor, REVISION_PATTERN } from '@/assets/javascript/feedRevision.js';
import { toInterchange, profileFromFeed } from '@/assets/javascript/interchange.js';
import { externalSyncDue, feedBodyNeeded, EXTERNAL_FEED_MAX_AGE_MS } from '@/assets/javascript/social.js';

const require = createRequire(import.meta.url);
const lambda = require('../../aws-lambda/feedRevision.js');
const cadence = require('../../aws-lambda/pushCadence.js');

// Brian's Movie Log sync guide (2026-10-06), the small half: a revision on
// the feed, a preflight before the body — because every refresh of his feed
// is a download billed to his Firebase project.
const entry = (id, title, total, date) => ({
  movie: { id, title, poster_path: `/${id}.jpg`, release_date: '1995-12-15' },
  ratings: [{ calculatedTotal: total, normalizedRating: total, date, medium: 'Theater' }]
});
const getRating = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal, normalizedRating: e.ratings[0].normalizedRating });

describe('feed revision', () => {
  it('is 32 lowercase hex, stable for the same body, and moves with the body but not the marker', () => {
    const a = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matt', now: 1 });
    const b = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matt', now: 2 });
    const c = toInterchange([entry(949, 'Heat', 8.6, 1000)], getRating, { name: 'Matt', now: 1 });
    expect(a.revision).toMatch(REVISION_PATTERN);
    expect(a.revision).toBe(b.revision);
    expect(a.revision).not.toBe(c.revision);
    expect(toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matthew', now: 1 }).revision).not.toBe(a.revision);
  });

  it('moves with the ceremony name, and a feed without one keeps the token it always had (2026-10-08)', () => {
    const plain = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matt', now: 1 });
    const named = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matt', now: 1, awardsName: 'The Groskers' });
    const renamed = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Matt', now: 1, awardsName: 'The Grossies' });
    expect(named.revision).not.toBe(plain.revision);
    expect(renamed.revision).not.toBe(named.revision);
    expect(lambda.contentRevision(named)).toBe(named.revision);
    expect(lambda.revisionSubject(plain)).toBe(JSON.stringify({ source: plain.source, name: plain.name, movies: plain.movies }));
  });

  it('the Lambda twin computes the same token, and the end-of-day copy gets its own', () => {
    const feed = toInterchange([entry(949, 'Heat', 8.5, 1000), entry(550, 'Fight Club', 7, 5000)], getRating, { name: 'Matt', now: 1 });
    expect(lambda.contentRevision(feed)).toBe(feed.revision);
    const copy = cadence.dayFeedFrom(feed, { cutoff: 3000, tz: 'America/New_York', marker: 3000 });
    expect(copy.revision).toMatch(REVISION_PATTERN);
    expect(copy.revision).not.toBe(feed.revision);
    expect(copy.revision).toBe(contentRevision(copy));
  });

  it('a reader keeps the feed revision on the profile it builds, only when well-formed', () => {
    const feed = toInterchange([entry(949, 'Heat', 8.5, 1000)], getRating, { name: 'Brian' });
    expect(profileFromFeed(feed).revision).toBe(feed.revision);
    expect(profileFromFeed({ ...feed, revision: 'nope' }).revision).toBeNull();
    expect(profileFromFeed({ ...feed, revision: undefined }).revision).toBeNull();
  });

  it('derives the revision URL from a Firebase .json capability URL, query kept', () => {
    expect(revisionUrlFor('https://x-default-rtdb.firebaseio.com/clubFeed/brian/abc123.json'))
      .toBe('https://x-default-rtdb.firebaseio.com/clubFeed/brian/abc123/revision.json');
    expect(revisionUrlFor('https://x.firebasedatabase.app/clubFeed/b/s.json?print=silent'))
      .toBe('https://x.firebasedatabase.app/clubFeed/b/s/revision.json?print=silent');
    expect(revisionUrlFor('https://example.com/feed')).toBeNull();
    expect(revisionUrlFor('')).toBeNull();
  });
});

describe('external sync policy', () => {
  const friends = { b: { feedUrl: 'https://db/clubFeed/b/s.json' } };
  it('runs when a friend has no profile yet, when forced, or once the hour is up — and never with no friends', () => {
    expect(externalSyncDue({ friends: {}, force: true })).toBe(false);
    expect(externalSyncDue({ friends, profiles: {}, syncedAt: Date.now() })).toBe(true);
    const fresh = { friends, profiles: { b: { name: 'Brian' } }, syncedAt: 1000, now: 1000 + EXTERNAL_FEED_MAX_AGE_MS - 1 };
    expect(externalSyncDue(fresh)).toBe(false);
    expect(externalSyncDue({ ...fresh, force: true })).toBe(true);
    expect(externalSyncDue({ ...fresh, now: 1000 + EXTERNAL_FEED_MAX_AGE_MS + 1 })).toBe(true);
  });

  it('downloads the body only when the revision moved, could not be read, or was never known', () => {
    const cached = { revision: 'a'.repeat(32) };
    expect(feedBodyNeeded({ cached, headRevision: 'a'.repeat(32) })).toBe(false);
    expect(feedBodyNeeded({ cached, headRevision: 'b'.repeat(32) })).toBe(true);
    expect(feedBodyNeeded({ cached, headRevision: null })).toBe(true);
    expect(feedBodyNeeded({ cached: { revision: null }, headRevision: 'a'.repeat(32) })).toBe(true);
    expect(feedBodyNeeded({})).toBe(true);
  });
});
