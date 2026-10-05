import { describe, it, expect } from 'vitest';
import { showtimesWaiting } from '../assets/javascript/showtimesUnread.js';
import { appBadgeCount } from '../assets/javascript/appBadge.js';
import { PUSH_PREF_DEFAULTS, pushPrefsWithDefaults } from '../assets/javascript/pushPrefs.js';
import { showtimesWaiting as lambdaShowtimesWaiting } from '../../aws-lambda/pushCadence.js';

// Matt, 2026-10-05: films on the Showtimes screen he hasn't dismissed or
// snoozed should count on the icon badge, behind a switch that's off by
// default.

const board = {
  theaters: [
    { key: 'alamo', listings: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }, { slug: 'd' }] },
    // 'a2' is the same film as alamo's 'a': a better theater has it.
    { key: 'afi', listings: [{ slug: 'a2', coveredBy: 'alamo' }, { slug: 'e' }] }
  ]
};
const dismissed = { alamo: { b: 1_700_000_000_000 } };
const reminders = {
  alamo: {
    c: { remindAt: 2_000_000_000_000 },
    // Already sent: the card is back on the screen, so it counts.
    d: { remindAt: 1_700_000_000_000, sentAt: 1_700_000_000_001 }
  }
};

const NOW = 1_800_000_000_000;
const noChores = {
  stickiness: { count: 0, dueTimes: [], eligibleAt: 0 },
  tiebreak: { due: false, eligibleAt: 0 },
  awards: { years: [], eligibleAt: 0 }
};

describe('showtimesWaiting', () => {
  it('counts films not dismissed, not snoozed, and not covered by a better theater', () => {
    // a, d (reminder already sent), e.
    expect(showtimesWaiting({ board, dismissed, reminders })).toBe(3);
  });

  it('counts every film on a board nobody has touched', () => {
    expect(showtimesWaiting({ board })).toBe(5);
  });

  it('is zero with no board', () => {
    expect(showtimesWaiting({ board: null })).toBe(0);
    expect(showtimesWaiting({ board: { theaters: [{ key: 'x' }] } })).toBe(0);
  });

  it('matches the push Lambda count', () => {
    const cases = [
      [board, dismissed, reminders],
      [board, {}, {}],
      [board, null, null],
      [null, {}, {}]
    ];
    cases.forEach(([b, d, r]) => {
      expect(showtimesWaiting({ board: b, dismissed: d || undefined, reminders: r || undefined }))
        .toBe(lambdaShowtimesWaiting(b, d, r));
    });
  });
});

describe('the icon badge with Showtimes', () => {
  it('is off by default', () => {
    expect(PUSH_PREF_DEFAULTS.showtimes).toBe(false);
    expect(appBadgeCount(noChores, pushPrefsWithDefaults(null), NOW, 3)).toBe(0);
    // Prefs saved before the switch existed don't have the key at all.
    expect(appBadgeCount(noChores, {}, NOW, 3)).toBe(0);
  });

  it('adds every waiting film when switched on', () => {
    expect(appBadgeCount(noChores, { showtimes: true }, NOW, 3)).toBe(3);
    const chores = { ...noChores, awards: { years: [2021], eligibleAt: 0 } };
    expect(appBadgeCount(chores, { showtimes: true }, NOW, 3)).toBe(4);
  });
});
