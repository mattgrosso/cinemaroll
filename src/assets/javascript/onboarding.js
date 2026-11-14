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
// tour at the beginning includes how to add the app to your home screen").
// First card, because everything after works better installed: on iPhone,
// notifications only exist for an installed app. Skipped where it already
// is installed, and on a computer, where there's no Home Screen to put it on.
const INSTALL_LINES = {
  ios: [
    'In Safari, tap Share, then Add to Home Screen, then Add. On newer iPhones Share is in the three-dot menu.',
    'It opens like an app, full screen, and can send you notifications.'
  ],
  // A link opened inside Gmail, Instagram, Messenger, Google's app…: their
  // built-in browsers have no Add to Home Screen at all.
  'ios-inapp': [
    'You\'re in another app\'s browser, which can\'t do this. Open cinemaroll.org in Safari first.',
    'Then tap Share, then Add to Home Screen, then Add.'
  ],
  android: [
    'In Chrome, tap the three-dot menu, then Add to Home screen (or Install app).',
    'It opens like an app, full screen, and can send you notifications.'
  ]
};

// iPadOS asks for desktop sites, so an iPad says "Macintosh"; touch gives it
// away. An app's own web view drops "Safari/" from the agent or names itself
// (FBAN/FBAV Facebook and Messenger, Instagram, GSA the Google app, LinkedIn).
// Chrome, Firefox and Edge on iOS (CriOS/FxiOS/EdgiOS) can add to the Home
// Screen through Share, so they count as ordinary iOS.
export function phonePlatform (userAgent = '', maxTouchPoints = 0) {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (ios) {
    const otherBrowser = /CriOS|FxiOS|EdgiOS/.test(userAgent);
    const inApp = /FBAN|FBAV|Instagram|GSA\/|LinkedInApp|Line\//.test(userAgent) || (!otherBrowser && !/Safari\//.test(userAgent));
    return inApp ? 'ios-inapp' : 'ios';
  }
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

export function installCard (platform) {
  return {
    key: 'install',
    title: 'Put it on your Home Screen',
    lines: INSTALL_LINES[platform] || INSTALL_LINES.ios,
    picture: platform === 'android' ? 'install-android' : 'install-ios',
    // Chrome can raise its own install sheet from a button (installPrompt.js).
    oneTap: platform === 'android'
  };
}

// The cards for this device: the Home Screen card first when it applies.
export function tourCards ({ platform = 'other', standalone = false } = {}) {
  if (standalone || !INSTALL_LINES[platform]) return TOUR_CARDS;
  return [installCard(platform), ...TOUR_CARDS];
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
