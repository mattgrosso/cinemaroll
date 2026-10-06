import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { showtimesWaiting, hasUnseenShowtimes, dismissedFilms, titleKey } from '../assets/javascript/showtimesUnread.js';
import { appBadgeCount } from '../assets/javascript/appBadge.js';
import { PUSH_PREF_DEFAULTS, pushPrefsWithDefaults } from '../assets/javascript/pushPrefs.js';
import { showtimesWaiting as lambdaShowtimesWaiting, dismissedFilms as lambdaDismissedFilms, titleKey as lambdaTitleKey } from '../../aws-lambda/pushCadence.js';

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

// 2026-10-06: "At the Udvar-Hazy IMAX, I keep getting notifications for the
// same movie over and over again." He had dismissed To Fly! and Hubble at the
// Air and Space IMAX; the Udvar-Hazy copies were separate listings, so they
// stayed on the screen and the badge, and Hubble was pushed again from there.
describe('a dismissal covers the film at every theater', () => {
  const imax = {
    theaters: [
      { key: 'imax-udvar-hazy', listings: [{ slug: '105761', title: 'To Fly!' }, { slug: '131404', title: 'Hubble', firstSeenAt: 5 }, { slug: '9', title: 'Interstellar' }] },
      { key: 'imax-air-and-space', listings: [{ slug: '105761', title: 'To Fly!', coveredBy: 'imax-udvar-hazy' }, { slug: '131404', title: 'Hubble', coveredBy: 'imax-udvar-hazy' }] },
      { key: 'regal', listings: [{ slug: '7', title: 'HUBBLE (in 35mm)' }] }
    ]
  };
  const atAirAndSpace = { 'imax-air-and-space': { 105761: 1, 131404: 1 } };

  it('takes the same film off the badge at the better theater and any other', () => {
    // Only Interstellar is still waiting.
    expect(showtimesWaiting({ board: imax, dismissed: atAirAndSpace })).toBe(1);
    expect(lambdaShowtimesWaiting(imax, atAirAndSpace, null)).toBe(1);
  });

  it('is not "new" on the Watchlist card either', () => {
    expect(hasUnseenShowtimes({ board: imax, dismissed: atAirAndSpace, seenAt: 1 })).toBe(false);
    expect(hasUnseenShowtimes({ board: imax, dismissed: {}, seenAt: 1 })).toBe(true);
  });

  it('knows the dismissed films by title, the same way in the app and the Lambda', () => {
    expect([...dismissedFilms(imax.theaters, atAirAndSpace)].sort()).toEqual(['hubble', 'to fly']);
    expect([...lambdaDismissedFilms(imax.theaters, atAirAndSpace)].sort()).toEqual(['hubble', 'to fly']);
    expect(dismissedFilms(imax.theaters, null).size).toBe(0);
    ['To Fly!', 'HUBBLE (in 35mm)', 'Dune: Part Three (Advance Screening)', "Pan's Labyrinth", 'Ozzy & Black Sabbath', 'WILDWOOD in 35mm', '']
      .forEach((t) => expect(titleKey(t)).toBe(lambdaTitleKey(t)));
  });

  it('keeps the sweep from announcing a film dismissed at another theater', () => {
    const lambda = readFileSync(resolve(__dirname, '../../aws-lambda/push-notify.js'), 'utf8');
    const body = lambda.slice(lambda.indexOf('const notifyAccountListings'), lambda.indexOf('// --- Reminders'));
    expect(body).toContain('`${topKey}/theaters/dismissed`');
    expect(body).toMatch(/const keep = open\.filter\(\(l\) => !gone\.has\(titleKey\(l\.title\)\)\)/);
  });
});
