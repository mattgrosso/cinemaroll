import { describe, it, expect } from 'vitest';
import { buildPushDigest } from '@/assets/javascript/pushDigest.js';
import { appBadgeCount } from '@/assets/javascript/appBadge.js';
import { chorePauseEnd, chorePausedUntil } from '@/assets/javascript/chorePause.js';

// Report (Matt, 2026-10-30): the X on a stickiness card hid it, "but now I
// still have a red dot on my icon". Putting a chore away must take it off the
// badge (and out of the pushes, which read the same eligibleAt) until
// tomorrow, then let it come back on its own.

const ONE_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 30, 15, 11).getTime(); // 3:11pm local
const getRating = () => ({ calculatedTotal: 8 });

const waiting = [
  { movie: { id: 1, title: 'Waiting', release_date: '2020-01-01', runtime: 120 }, ratings: [{ date: NOW - 10 * ONE_DAY }] },
  { movie: { id: 2, title: 'Also waiting', release_date: '2021-01-01', runtime: 120 }, ratings: [{ date: NOW - 12 * ONE_DAY }] }
];

const badgeAt = (settings, at) => appBadgeCount(buildPushDigest({ entries: waiting, settings, getRating, now: NOW }), {}, at);

describe('a chore put away with the X', () => {
  it('ends at the next local midnight', () => {
    expect(chorePauseEnd(NOW)).toBe(new Date(2026, 9, 31).getTime());
  });

  it('counts on the badge until it is put away', () => {
    expect(badgeAt({}, NOW)).toBe(2);
  });

  it('drops off the badge for the rest of the day', () => {
    const settings = { choresPausedUntil: { stickiness: chorePauseEnd(NOW) } };
    expect(badgeAt(settings, NOW)).toBe(0);
    expect(badgeAt(settings, chorePauseEnd(NOW) - 1)).toBe(0);
  });

  it('comes back on its own after midnight', () => {
    const settings = { choresPausedUntil: { stickiness: chorePauseEnd(NOW) } };
    expect(badgeAt(settings, chorePauseEnd(NOW) + 1)).toBe(2);
  });

  it('a pause that has run out counts for nothing', () => {
    expect(chorePausedUntil({ choresPausedUntil: { stickiness: NOW - 1 } }, 'stickiness', NOW)).toBe(0);
    expect(chorePausedUntil({ choresPausedUntil: { stickiness: null } }, 'stickiness', NOW)).toBe(0);
  });

  it('pauses only the chore that was put away', () => {
    const digest = buildPushDigest({ entries: waiting, settings: { choresPausedUntil: { awards: chorePauseEnd(NOW) } }, getRating, now: NOW });
    expect(digest.awards.eligibleAt).toBe(chorePauseEnd(NOW));
    expect(digest.stickiness.eligibleAt).toBe(0);
  });

  it('pushes the tiebreak gate out too', () => {
    const settings = { lastTweak: NOW - 2 * ONE_DAY, choresPausedUntil: { tieBreak: chorePauseEnd(NOW) } };
    const digest = buildPushDigest({ entries: waiting, settings, getRating, now: NOW });
    expect(digest.tiebreak.eligibleAt).toBe(chorePauseEnd(NOW));
  });
});
