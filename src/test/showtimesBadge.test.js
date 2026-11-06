import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { showtimesWaiting, resolveShowtimesSeenAt, hasUnseenShowtimes, dismissedFilms, dismissedAtRank, titleKey } from '../assets/javascript/showtimesUnread.js';
import { appBadgeCount } from '../assets/javascript/appBadge.js';
import { PUSH_PREF_DEFAULTS, pushPrefsWithDefaults } from '../assets/javascript/pushPrefs.js';
import { showtimesWaiting as lambdaShowtimesWaiting, dismissedFilms as lambdaDismissedFilms, dismissedAtRank as lambdaDismissedAtRank, titleKey as lambdaTitleKey, badgeSeenAt as lambdaBadgeSeenAt } from '../../aws-lambda/pushCadence.js';

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

// 2026-10-06, twice. Morning: "At the Udvar-Hazy IMAX, I keep getting
// notifications for the same movie over and over again" - films dismissed at
// one theater kept coming back from another. Afternoon: "I would may dismiss a
// movie from a lesser theater but would still want to see it at like my home
// Alamo". A dismissal covers that theater and every worse one, never a better.
describe('a dismissal covers the film at that theater and worse ones', () => {
  const board = {
    theaters: [
      { key: 'alamo', listings: [{ slug: 'a1', title: 'Hubble', firstSeenAt: 5 }] },
      { key: 'imax', listings: [{ slug: '105761', title: 'To Fly!' }, { slug: '131404', title: 'Hubble', coveredBy: 'alamo' }, { slug: '9', title: 'Interstellar' }] },
      { key: 'regal', listings: [{ slug: '7', title: 'TO FLY! (in 35mm)', firstSeenAt: 5 }, { slug: '8', title: 'Interstellar', coveredBy: 'imax' }] }
    ]
  };
  // Dismissed at the middle theater.
  const atImax = { imax: { 105761: 1, 131404: 1 } };

  it('still shows the film at a better theater', () => {
    // Hubble at Alamo and Interstellar at the IMAX are still waiting.
    expect(showtimesWaiting({ board, dismissed: atImax })).toBe(2);
    expect(lambdaShowtimesWaiting(board, atImax, null)).toBe(2);
    expect(hasUnseenShowtimes({ board, dismissed: atImax, seenAt: 1 })).toBe(true);
  });

  it('hides it at a worse theater', () => {
    const toFlyOnly = { imax: { 105761: 1 } };
    // Regal's 35mm To Fly! is not counted; Alamo's Hubble and Interstellar are.
    expect(showtimesWaiting({ board, dismissed: toFlyOnly })).toBe(2);
    expect(lambdaShowtimesWaiting(board, toFlyOnly, null)).toBe(2);
    const onlyRegalNew = { theaters: [board.theaters[1], board.theaters[2]] };
    expect(hasUnseenShowtimes({ board: onlyRegalNew, dismissed: toFlyOnly, seenAt: 1 })).toBe(false);
    expect(hasUnseenShowtimes({ board: onlyRegalNew, dismissed: {}, seenAt: 1 })).toBe(true);
  });

  it('dismissed at the best theater, it is gone everywhere', () => {
    const atAlamo = { alamo: { a1: 1 } };
    const gone = dismissedFilms(board.theaters, atAlamo);
    [0, 1, 2].forEach((rank) => expect(dismissedAtRank(gone, 'Hubble', rank)).toBe(true));
  });

  it('knows each film by its best dismissal, the same way in the app and the Lambda', () => {
    const both = { imax: { 105761: 1 }, regal: { 7: 1 } };
    expect([...dismissedFilms(board.theaters, both)]).toEqual([['to fly', 1]]);
    expect([...lambdaDismissedFilms(board.theaters, both)]).toEqual([['to fly', 1]]);
    const gone = dismissedFilms(board.theaters, both);
    [0, 1, 2].forEach((rank) => expect(lambdaDismissedAtRank(gone, 'To Fly!', rank)).toBe(dismissedAtRank(gone, 'To Fly!', rank)));
    expect(dismissedAtRank(gone, 'To Fly!', 0)).toBe(false);
    expect(dismissedFilms(board.theaters, null).size).toBe(0);
    ['To Fly!', 'HUBBLE (in 35mm)', 'Dune: Part Three (Advance Screening)', "Pan's Labyrinth", 'Ozzy & Black Sabbath', 'WILDWOOD in 35mm', '']
      .forEach((t) => expect(titleKey(t)).toBe(lambdaTitleKey(t)));
  });

  it('keeps the sweep from announcing a film dismissed here or at a better theater only', () => {
    const lambda = readFileSync(resolve(__dirname, '../../aws-lambda/push-notify.js'), 'utf8');
    const body = lambda.slice(lambda.indexOf('const notifyAccountListings'), lambda.indexOf('// --- Reminders'));
    expect(body).toContain('`${topKey}/theaters/dismissed`');
    expect(body).toMatch(/const keep = open\.filter\(\(l\) => !dismissedAtRank\(gone, l\.title, i\)\)/);
  });

  it('brings a film back by lifting dismissals here and above, not below', () => {
    const screen = readFileSync(resolve(__dirname, '../components/ShowtimesScreen.vue'), 'utf8');
    expect(screen).toMatch(/dismissedAtRank\(this\.dismissedTitles, l\.title, rank\)/);
    expect(screen).toMatch(/rank > here/);
  });
});

// Report 2026-11-04: "I just got a 53 on my notification. I thought we had
// cleared this up already." The badge counted every film still waiting on
// the board (~50), so it came back every morning or with one more film. It
// now counts only films found since this device last opened Showtimes, in
// the app and in the push Lambda alike.
describe('only films found since the last visit to Showtimes', () => {
  const SEEN = 1_000;
  const fresh = {
    theaters: [
      { key: 'alamo', listings: [
        { slug: 'old', title: 'Old', firstSeenAt: 500 },
        { slug: 'new', title: 'New', firstSeenAt: 2_000 },
        { slug: 'zero', title: 'Zero', firstSeenAt: 0 },
        { slug: 'bare', title: 'Bare' }
      ] },
      { key: 'afi', listings: [
        { slug: 'newer', title: 'Newer', firstSeenAt: 3_000 },
        { slug: 'new2', title: 'New', firstSeenAt: 2_500, coveredBy: 'alamo' }
      ] }
    ]
  };

  it('counts films first seen after the visit, and nothing older', () => {
    expect(showtimesWaiting({ board: fresh, seenAt: SEEN })).toBe(2);
    expect(showtimesWaiting({ board: fresh, seenAt: 2_000 })).toBe(1);
    expect(showtimesWaiting({ board: fresh, seenAt: 5_000 })).toBe(0);
  });

  it('counts the whole board when this device never opened Showtimes, or the digest is older', () => {
    expect(showtimesWaiting({ board: fresh, seenAt: 0 })).toBe(5);
    expect(showtimesWaiting({ board: fresh })).toBe(5);
    expect(lambdaShowtimesWaiting(fresh, {}, {})).toBe(5);
  });

  it('still leaves out dismissed and snoozed films that are new', () => {
    expect(showtimesWaiting({ board: fresh, dismissed: { afi: { newer: 1 } }, seenAt: SEEN })).toBe(1);
    expect(showtimesWaiting({ board: fresh, reminders: { alamo: { new: { remindAt: 9 } } }, seenAt: SEEN })).toBe(1);
  });

  it('gives the push Lambda the same answer as the app', () => {
    for (const seenAt of [undefined, null, 0, SEEN, 2_000, 2_500, 5_000]) {
      for (const dismissed of [{}, { afi: { newer: 1 } }]) {
        expect(lambdaShowtimesWaiting(fresh, dismissed, {}, seenAt), `seenAt ${seenAt}`)
          .toBe(showtimesWaiting({ board: fresh, dismissed, seenAt }));
      }
    }
  });

  it('rides in the push digest, so a push badge counts the same', async () => {
    const { buildPushDigest } = await import('../assets/javascript/pushDigest.js');
    const built = buildPushDigest({ entries: [], settings: {}, getRating: () => null, showtimesSeenAt: SEEN, now: NOW });
    expect(built.showtimesSeenAt).toBe(SEEN);
    expect('showtimesSeenAt' in buildPushDigest({ entries: [], settings: {}, getRating: () => null, now: NOW })).toBe(false);
  });

  it('is stamped through the store when the screen opens, which republishes the digest', () => {
    const screen = readFileSync(resolve(__dirname, '../components/ShowtimesScreen.vue'), 'utf8');
    expect(screen).toContain("this.$store.dispatch('markShowtimesSeen', Date.now())");
    expect(screen).toContain("this.$store.dispatch('publishPushDigest')");
    const storeSource = readFileSync(resolve(__dirname, '../store/index.js'), 'utf8');
    expect(storeSource).toContain('seenAt: state.showtimesSeenAt || 0');
    expect(storeSource).toContain('showtimesSeenAt: context.state.showtimesSeenAt || 0');
  });
});

// Report 2026-11-06: "I just had a 52 on my dot again." A device that had
// never opened Showtimes published 0, and 0 counts the whole board.
describe('last opened Showtimes, shared by the account', () => {
  it('takes the later of this device and the account', () => {
    expect(resolveShowtimesSeenAt({ local: 0, account: 500, now: 900 })).toEqual({ seenAt: 500, save: false });
    expect(resolveShowtimesSeenAt({ local: 700, account: 500, now: 900 })).toEqual({ seenAt: 700, save: true });
    expect(resolveShowtimesSeenAt({ local: 300, account: 500, now: 900 })).toEqual({ seenAt: 500, save: false });
  });

  it('counts never opened anywhere as opened now, and saves it', () => {
    expect(resolveShowtimesSeenAt({ local: 0, account: null, now: 900 })).toEqual({ seenAt: 900, save: true });
  });

  it('the push Lambda takes the later of the digest and the account too', () => {
    expect(lambdaBadgeSeenAt(0, 500)).toBe(500);
    expect(lambdaBadgeSeenAt(700, 500)).toBe(700);
    expect(lambdaBadgeSeenAt(undefined, null)).toBe(0);
    const big = { theaters: [{ key: 'alamo', listings: Array.from({ length: 52 }, (_, i) => ({ slug: `f${i}`, title: `Film ${i}`, firstSeenAt: 100 + i })) }] };
    // A never-opened device's digest (0) no longer brings the board back.
    expect(lambdaShowtimesWaiting(big, {}, {}, lambdaBadgeSeenAt(0, 1000))).toBe(0);
  });
});
