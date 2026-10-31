import { describe, it, expect } from 'vitest';
import { appBadgeCount, badgeExtrasShown } from '../assets/javascript/appBadge.js';
import { noticeDay } from '../assets/javascript/homeNotices.js';
import { dueFromDigest } from '../../aws-lambda/pushCadence.js';

const NOW = 1_800_000_000_000;

function digest (overrides = {}) {
  return {
    stickiness: { count: 3, dueTimes: [NOW - 1000, NOW + 1000], eligibleAt: 0 },
    tiebreak: { due: true, count: 2, eligibleAt: 0, pinned: false },
    awards: { years: [2021, 2023], eligibleAt: 0 },
    ...overrides
  };
}

// The Lambda's badge arithmetic, exactly as push-notify.js writes it.
function lambdaBadge (d, prefs) {
  const due = dueFromDigest(d, prefs, NOW);
  return due.stickinessCount + (due.tiebreak ? 1 : 0) + due.awardYears.length;
}

describe('appBadgeCount', () => {
  it('counts stickiness films (including ones matured since publishing), a tiebreak, and award years', () => {
    expect(appBadgeCount(digest(), {}, NOW)).toBe(4 + 1 + 2);
  });

  it('is zero with nothing waiting, so the app clears the badge', () => {
    expect(appBadgeCount({
      stickiness: { count: 0, dueTimes: [], eligibleAt: 0 },
      tiebreak: { due: false, eligibleAt: 0 },
      awards: { years: [], eligibleAt: 0 }
    }, {}, NOW)).toBe(0);
    expect(appBadgeCount(null, {}, NOW)).toBe(0);
  });

  it('skips a prompt paused for the day', () => {
    const d = digest({ stickiness: { count: 3, dueTimes: [], eligibleAt: NOW + 60_000 } });
    expect(appBadgeCount(d, {}, NOW)).toBe(1 + 2);
  });

  it('a running tournament pins the screen, so only the tiebreak counts', () => {
    const d = digest({ tiebreak: { due: true, eligibleAt: 0, pinned: true } });
    expect(appBadgeCount(d, {}, NOW)).toBe(1);
  });

  it('honours the notification category switches', () => {
    expect(appBadgeCount(digest(), { stickiness: false, awards: false }, NOW)).toBe(1);
  });

  it('matches the Lambda badge for every case above', () => {
    const cases = [
      [digest(), {}],
      [digest({ stickiness: { count: 3, dueTimes: [], eligibleAt: NOW + 60_000 } }), {}],
      [digest({ tiebreak: { due: true, eligibleAt: 0, pinned: true } }), {}],
      [digest({ tiebreak: { due: true, eligibleAt: NOW + 1, pinned: false } }), {}],
      [digest(), { stickiness: false, awards: false }],
      [digest(), { tiebreak: false }]
    ];
    cases.forEach(([d, prefs]) => {
      expect(appBadgeCount(d, prefs, NOW)).toBe(lambdaBadge(d, prefs));
    });
  });

  // 2026-10-09: friends who had just joined never answered Matt's requests;
  // nothing outside the app said one was waiting.
  it('adds one for each friend request waiting, whatever the switches say', () => {
    const empty = { stickiness: { count: 0, dueTimes: [] }, tiebreak: {}, awards: { years: [] } };
    expect(appBadgeCount(empty, {}, NOW, 0, 2)).toBe(2);
    expect(appBadgeCount(digest(), { stickiness: false, tiebreak: false, awards: false }, NOW, 0, 1)).toBe(1);
  });
});

// Bug report (Matt, 2026-10-30): "I've got a red notification that's just
// been stuck here … and I don't know how to get rid of it." The X on the
// Showtimes or friend-request card, or "Not now" on a request, hid the card
// on Home while the icon kept counting it. Same rule as the cards now.
describe('badgeExtrasShown', () => {
  const today = noticeDay(NOW);
  const requests = [{ key: 'b', name: 'B' }, { key: 'a', name: 'A' }];

  it('counts everything when nothing has been put away', () => {
    expect(badgeExtrasShown({ films: 3, friendRequests: requests, now: NOW })).toEqual({ films: 3, friendRequests: 2 });
  });

  it('drops Showtimes films put away with the X today, until the count grows', () => {
    const dismissals = { showtimes: { signature: 3, day: today } };
    expect(badgeExtrasShown({ films: 3, dismissals, now: NOW }).films).toBe(0);
    expect(badgeExtrasShown({ films: 2, dismissals, now: NOW }).films).toBe(0);
    expect(badgeExtrasShown({ films: 4, dismissals, now: NOW }).films).toBe(4);
  });

  it('a dismissal from yesterday no longer hides anything', () => {
    const dismissals = { showtimes: { signature: 3, day: noticeDay(NOW - 86_400_000) } };
    expect(badgeExtrasShown({ films: 3, dismissals, now: NOW }).films).toBe(3);
  });

  it('drops friend requests put away with the X, until a new one arrives', () => {
    const dismissals = { friendRequest: { signature: 'a,b', day: today } };
    expect(badgeExtrasShown({ friendRequests: requests, dismissals, now: NOW }).friendRequests).toBe(0);
    const more = [...requests, { key: 'c', name: 'C' }];
    expect(badgeExtrasShown({ friendRequests: more, dismissals, now: NOW }).friendRequests).toBe(3);
  });

  it('drops a request snoozed with "Not now" while the snooze lasts', () => {
    const snoozes = { a: NOW + 1000 };
    expect(badgeExtrasShown({ friendRequests: requests, snoozes, now: NOW }).friendRequests).toBe(1);
    expect(badgeExtrasShown({ friendRequests: requests, snoozes, now: NOW + 2000 }).friendRequests).toBe(2);
  });
});
