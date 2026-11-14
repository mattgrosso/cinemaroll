// A first look at the app for a new account (2026-11-14, Matt: "do we have any
// kind of onboarding, like introduction or tutorial that shows people settings
// they can do and what the app can do? It would be cool to build something
// like that"). Two halves:
//
//   - the tour: a few cards, one idea each, shown once on a brand-new
//     account's first open and replayed from Settings → Tutorial (never from
//     the header: "I like our headers the way they are");
//   - the setup list: a Home notice naming the settings worth a minute, each
//     one ticking itself off as it gets done.
//
// Both belong to accounts that START here: `settings/onboarding.startedAt` is
// stamped the first time a brand-new (0-film) account opens Home, and
// existing users never get the stamp, so neither half appears for them
// unasked. Pure: Home gathers the facts and does the writes.

export const ONBOARDING_PATH = 'settings/onboarding';

// The rainbow bar's chips, in order, with the colour each one wears on Home
// (Home.vue's `.chip-*` rules). The tour draws them, so a new user learns the
// bar from a picture of the bar.
export const RAINBOW_CHIPS = [
  { key: 'settings', icon: 'bi-gear', colour: '#E71D36', ink: '#fff', label: 'Settings' },
  { key: 'games', icon: 'bi-dice-5', colour: '#FF9F1C', ink: '#000', label: 'Games' },
  { key: 'count', text: '12', colour: '#FFD700', ink: '#000', label: 'Count · average · views' },
  { key: 'insights', icon: 'bi-lightbulb', colour: '#24d776', ink: '#000', label: 'Insights' },
  { key: 'club', icon: 'bi-suit-club', colour: '#1D8BF1', ink: '#000', label: 'Film Club' },
  { key: 'watchlist', icon: 'bi-binoculars', colour: '#5A189A', ink: '#fff', label: 'Watchlist' },
  { key: 'sort', icon: 'bi-123', colour: '#cd7fe8', ink: '#fff', label: 'Sort' }
];

// The eight things a film is rated on, as the rating screen names them.
export const RATING_PARTS = ['Direction', 'Imagery', 'Story', 'Performance', 'Soundtrack', 'Love', 'Overall', 'Stickiness'];

export const TOUR_CARDS = [
  {
    key: 'rate',
    title: 'Rate what you watch',
    lines: [
      'Search for a film above and tap it to rate it.',
      'You score eight things, from Direction to Soundtrack. Love and Overall count most.',
      'Cinema Roll turns them into one score out of 10.'
    ],
    picture: 'parts'
  },
  {
    key: 'library',
    title: 'Your library',
    lines: [
      'Every film you rate lands on Home, best first.',
      'Search finds titles, people, years and genres.',
      'The lightning bolt in the search box has quick filters.'
    ],
    picture: 'search'
  },
  {
    key: 'rainbow',
    title: 'The rainbow bar',
    lines: ['Under the search box. Each color opens one part of the app.'],
    picture: 'rainbow'
  },
  {
    key: 'insights',
    title: 'Insights',
    lines: [
      'Your favorite directors, actors and composers, worked out from your scores.',
      'Your eras, your busiest months, and your own awards for every year.'
    ],
    picture: 'insights'
  },
  {
    key: 'club',
    title: 'The Film Club',
    lines: [
      'Add friends to see what they watch and how they rated it.',
      'Ratings stay private until you both accept.'
    ],
    picture: 'club'
  },
  {
    key: 'more',
    title: 'And more',
    lines: [
      'Watchlist: films to see, with ideas when you\'re stuck.',
      'Showtimes: new listings at theaters you pick.',
      'Games: ten daily movie games.',
      'A newsletter every Friday, picked for your taste.'
    ],
    picture: 'more'
  }
];

// Putting the app on the Home Screen (Matt, 2026-11-14: "make sure that the
// tour at the beginning includes how to add the app to your home screen",
// then "Apple does make this sort of a moving target ... make sure that the
// info we share is correct for that person's system").
//
// Every set of steps below is copied from the vendor's own help page, read
// 2026-11-14, and each person gets only the steps for their device:
//   iPhone, iOS 27  support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/27/ios/27
//     Page Menu button (three lines) > Share > Add to Home Screen > Open as Web App > Add
//   iPhone, iOS 26  .../26/ios/26: the More button (three dots) instead of Page Menu
//     Both: "If your Tabs layout is Bottom or Top, tap [Share]"; if Add to Home
//     Screen is missing, Edit Actions at the bottom of the list adds it.
//   iPhone, iOS 18  .../bookmark-a-website-iph42ab2f3a7/18.0/ios/18.0
//     Share in the menu bar > Add to Home Screen (no Open as Web App switch)
//   iPad, iPadOS 27 support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/27/ipados/27
//     Share > View More > Add to Home Screen > Open as Web App > Add
//   iPad, iPadOS 26 .../26/ipados/26: Share > More (three dots) > Add to Home Screen
//   Chrome on iPhone/iPad support.google.com/chrome/answer/15085120 (iOS)
//     Share, right of the address bar > Add to Home Screen > Add
//   Chrome on Android support.google.com/chrome/answer/9658361 (Android)
//     More (three dots) > Install and create shortcut > Install. Chrome 150
//     (June 2026) renamed "Add to Home screen"; the rollout is server-side, so
//     some 150+ phones still show the old name, and older Chrome always does
//     (developer.chrome.com: More > Add to Home screen > Install app).
// Anything else (an app's built-in browser, Firefox, Edge, Samsung Internet)
// is sent to Safari or Chrome rather than given steps nobody checked.
//
// Safari's version comes from `Version/NN`: since Safari 26 the "OS 18_x" part
// of the user agent is frozen, but Version/ still says the real major release
// (webkit.org bug 298260). Safari has no other way to ask.

const IPHONE_SHARE_FALLBACK = 'If your Share button is at the bottom or top of the screen, tap it directly.';
const MISSING_ACTION = 'No Add to Home Screen in the list? Scroll to the bottom, tap Edit Actions, and add it.';
const WEB_APP_ON = 'Leave Open as Web App on, then tap Add.';

const step = (icon, label) => ({ icon, label });
const SHARE = step('bi-box-arrow-up', 'Share');
const ADD = step('bi-plus-square', 'Add to Home Screen');

function safariMajor (userAgent) {
  const match = /Version\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

function chromeMajor (userAgent) {
  const match = /Chrome\/(\d+)/.exec(userAgent);
  return match ? Number(match[1]) : null;
}

/**
 * This device's install steps, or null where there is no Home Screen to add
 * to (a computer). { kind, lines, steps, oneTap }: `steps` draw the picture,
 * `oneTap` means Chrome may offer its own install sheet (installPrompt.js).
 * iPadOS asks for desktop sites, so an iPad says "Macintosh"; touch gives it away.
 */
export function installGuide (userAgent = '', maxTouchPoints = 0) {
  const ipad = /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const ios = ipad || /iPhone|iPod/.test(userAgent);

  if (ios) {
    if (/CriOS\//.test(userAgent)) {
      return {
        kind: 'ios-chrome',
        lines: ['Tap Share, to the right of the address bar, then Add to Home Screen, then Add.'],
        steps: [SHARE, ADD]
      };
    }
    // Firefox and Edge on iOS, and any app's built-in browser (Gmail,
    // Instagram, Messenger, the Google app...), which drop Safari's Version/.
    const otherBrowser = /FxiOS|EdgiOS|OPiOS/.test(userAgent);
    const inApp = /FBAN|FBAV|Instagram|GSA\/|LinkedInApp|Line\//.test(userAgent) || !/Version\/\d+.*Safari\//.test(userAgent);
    if (otherBrowser || inApp) {
      return {
        kind: 'ios-open-safari',
        lines: [
          otherBrowser
            ? 'This is easiest from Safari. Open cinemaroll.org in Safari and sign in there.'
            : 'You\'re in another app\'s built-in browser, which can\'t add to the Home Screen. Open cinemaroll.org in Safari and sign in there.',
          'Then replay this from Settings, Tutorial, for the steps.'
        ],
        steps: [step('bi-compass', 'Open in Safari'), SHARE, ADD]
      };
    }
    const version = safariMajor(userAgent);
    if (ipad) {
      if (version >= 27) {
        return {
          kind: 'ipad-27',
          lines: ['Tap Share, then View More, then Add to Home Screen.', WEB_APP_ON],
          steps: [SHARE, step('bi-three-dots', 'View More'), ADD]
        };
      }
      if (version === 26) {
        return {
          kind: 'ipad-26',
          lines: ['Tap Share, then the More button (three dots), then Add to Home Screen.', WEB_APP_ON],
          steps: [SHARE, step('bi-three-dots', 'More'), ADD]
        };
      }
      return {
        kind: 'ipad-18',
        lines: ['Tap Share, then Add to Home Screen, then Add.', MISSING_ACTION],
        steps: [SHARE, ADD]
      };
    }
    if (version >= 27) {
      return {
        kind: 'iphone-27',
        lines: ['Tap the menu button (three lines) next to the address, then Share, then Add to Home Screen.', IPHONE_SHARE_FALLBACK, WEB_APP_ON],
        steps: [step('bi-list', 'Menu'), SHARE, ADD]
      };
    }
    if (version === 26) {
      return {
        kind: 'iphone-26',
        lines: ['Tap the More button (three dots) next to the address, then Share, then Add to Home Screen.', IPHONE_SHARE_FALLBACK, WEB_APP_ON],
        steps: [step('bi-three-dots', 'More'), SHARE, ADD]
      };
    }
    return {
      kind: 'iphone-18',
      lines: ['Tap Share at the bottom of the screen, then Add to Home Screen, then Add.', MISSING_ACTION],
      steps: [SHARE, ADD]
    };
  }

  if (/Android/.test(userAgent)) {
    // Chrome itself, not a browser built on it (Samsung, Edge, Opera,
    // Firefox) and not an app's web view ("; wv)").
    const otherBrowser = /SamsungBrowser|EdgA|OPR|Firefox|; wv\)/.test(userAgent);
    const version = chromeMajor(userAgent);
    if (otherBrowser || version === null) {
      return {
        kind: 'android-open-chrome',
        lines: [
          'This is easiest from Chrome. Open cinemaroll.org in Chrome and sign in there.',
          'Then replay this from Settings, Tutorial, for the steps.'
        ],
        steps: [step('bi-browser-chrome', 'Open in Chrome'), step('bi-download', 'Install')],
        oneTap: true
      };
    }
    return {
      kind: version >= 150 ? 'android-chrome-150' : 'android-chrome',
      lines: version >= 150
        ? ['Tap the three-dot menu next to the address, then Install and create shortcut, then Install.', 'On some phones it\'s still called Add to Home screen.']
        : ['Tap the three-dot menu next to the address, then Add to Home screen, then Install.'],
      steps: [step('bi-three-dots-vertical', 'Menu'), step('bi-plus-square', version >= 150 ? 'Install and create shortcut' : 'Add to Home screen'), step('bi-download', 'Install')],
      oneTap: true
    };
  }

  return null;
}

export function installCard (guide) {
  return {
    key: 'install',
    title: 'Put it on your Home Screen',
    lines: [...guide.lines, 'It opens full screen like an app, and can send you notifications.'],
    picture: 'install',
    steps: guide.steps,
    oneTap: Boolean(guide.oneTap)
  };
}

// The cards for this device: the Home Screen card first when it applies.
export function tourCards ({ guide = null, standalone = false } = {}) {
  if (standalone || !guide) return TOUR_CARDS;
  return [installCard(guide), ...TOUR_CARDS];
}

/**
 * What Home knows, in plain values:
 *   ratedCount, letterboxdLinked (username or an import), pushAvailable,
 *   pushOn, theatersChosen, clubProfile (sharing on with a name), awardsNamed,
 *   phone (an iPhone, iPad or Android), standalone (running from the Home Screen)
 * Returns the setup list in order, each { id, label, hint, done }.
 */
export function setupItems (facts = {}) {
  const items = [
    {
      id: 'rate',
      label: 'Rate your first film',
      hint: 'Search for something you\'ve seen.',
      done: (facts.ratedCount || 0) > 0
    },
    facts.phone
      ? {
        id: 'install',
        label: 'Add Cinema Roll to your Home Screen',
        hint: 'It opens like an app.',
        done: Boolean(facts.standalone)
      }
      : null,
    {
      id: 'letterboxd',
      label: 'Bring in your Letterboxd history',
      hint: 'Or link your username.',
      done: Boolean(facts.letterboxdLinked)
    },
    facts.pushAvailable
      ? {
        id: 'notifications',
        label: 'Turn on notifications',
        hint: 'For friends\' films and your prompts.',
        done: Boolean(facts.pushOn)
      }
      : null,
    {
      id: 'club',
      label: 'Set up your Film Club profile',
      hint: 'A name friends will know you by.',
      done: Boolean(facts.clubProfile)
    },
    {
      id: 'theaters',
      label: 'Pick your theaters',
      hint: 'Hear when new films are listed.',
      done: Boolean(facts.theatersChosen)
    },
    {
      id: 'awards',
      label: 'Name your personal awards',
      hint: 'Your own Oscars, every year.',
      done: Boolean(facts.awardsNamed)
    }
  ];
  return items.filter(Boolean);
}

// The notice's signature: the items still to do, or null when none are (or
// the list was put away for good). A new item ticked off changes it, so the
// X ("until tomorrow") isn't undone by progress, only by tomorrow.
export function setupNoticeSignature (onboarding, items) {
  if (!onboarding?.startedAt || onboarding.setupDismissedAt) return null;
  const left = (items || []).filter((item) => !item.done).map((item) => item.id);
  return left.length ? left.join(',') : null;
}

// The tour opens by itself once: for an account that started here and hasn't
// closed it yet, on any device.
export function tourDue (onboarding) {
  return Boolean(onboarding?.startedAt) && !onboarding.tourSeenAt;
}

// Stamp an account as starting here: a brand-new account, settings loaded,
// and no onboarding record yet. Anything else (an established library, a
// record already there, settings not in yet) is not a start.
export function shouldStartOnboarding ({ settingsLoaded, brandNew, onboarding }) {
  return Boolean(settingsLoaded && brandNew && !onboarding);
}
