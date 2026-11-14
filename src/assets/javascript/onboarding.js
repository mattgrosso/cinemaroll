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

/**
 * What Home knows, in plain values:
 *   ratedCount, letterboxdLinked (username or an import), pushAvailable,
 *   pushOn, theatersChosen, clubProfile (sharing on with a name), awardsNamed
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
