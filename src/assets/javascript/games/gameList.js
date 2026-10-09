// The games, in the hub's hand-curated order, each with the short how-to
// card GameHowTo shows the first time it's played on a device (and from the
// ? on the game screen after that). The how-to lives HERE, beside the name
// and tile description, so a new game can't join the hub without one —
// gameList.test.js fails on a game that's missing it.
//
// Keep each card to three or four short lines, one idea per line, each led
// by a bi-* icon: it teaches enough to take a first turn, and the game
// screen narrates the rest.
import higherLowerBanner from '../../images/games/higher-lower-banner.jpg';
import reelWordleBanner from '../../images/games/reel-wordle-banner.jpg';
import connectionsBanner from '../../images/games/connections-banner.jpg';
import sixDegreesBanner from '../../images/games/six-degrees-banner.jpg';
import timelineBanner from '../../images/games/timeline-banner.jpg';
import clueBudgetBanner from '../../images/games/clue-budget-banner.jpg';
import tagBanner from '../../images/games/tag-banner.jpg';
import triviaBanner from '../../images/games/trivia-banner.jpg';
import stampBanner from '../../images/games/stamp-banner.jpg';
import posterZoomBanner from '../../images/games/poster-zoom-banner.jpg';
import youOrCrowdBanner from '../../images/games/you-or-crowd-banner.jpg';
import cineplexityBanner from '../../images/games/cineplexity-banner.svg';

export const GAMES = [
  {
    path: '/games/higher-lower',
    name: 'Higher or Lower',
    banner: higherLowerBanner,
    description: 'Which movie scored higher?',
    howTo: [
      { icon: 'bi-film', text: 'You see one film and its score.' },
      { icon: 'bi-arrow-down-up', text: 'Guess whether the next film scored higher or lower.' },
      { icon: 'bi-fire', text: 'Each right guess adds to your streak. One wrong guess ends it.' }
    ]
  },
  {
    path: '/games/wordle',
    name: 'Reel Wordle',
    banner: reelWordleBanner,
    description: 'Guess it from year/genre clues.',
    howTo: [
      { icon: 'bi-question-square', text: 'A film from your library is hidden. Guess any film you\'ve rated.' },
      { icon: 'bi-grid-3x3-gap-fill', text: 'Each guess shows clues. Green is a match, yellow is partly shared.' },
      { icon: 'bi-arrow-up', text: 'Arrows point toward the hidden film\'s year, runtime and score.' },
      { icon: 'bi-infinity', text: 'Guess as many times as you like.' }
    ]
  },
  {
    path: '/games/connections',
    name: 'Connections',
    banner: connectionsBanner,
    description: 'Find four groups of four.',
    howTo: [
      { icon: 'bi-grid-fill', text: 'Sixteen posters hide four groups of four.' },
      { icon: 'bi-hand-index', text: 'Tap four that share something, like a director, actor, genre or decade, then Submit.' },
      { icon: 'bi-check2-all', text: 'Find all four groups. A wrong guess only counts as a mistake.' }
    ]
  },
  {
    path: '/games/six-degrees',
    name: 'Six Degrees',
    banner: sixDegreesBanner,
    description: 'Link two movies by shared cast.',
    howTo: [
      { icon: 'bi-diagram-3-fill', text: 'Link the two posters through the people in them.' },
      { icon: 'bi-person', text: 'Name someone from the first film, then another film they were in. Repeat until you reach the second.' },
      { icon: 'bi-x-circle', text: 'The little x on a step removes it and everything after it.' },
      { icon: 'bi-lightbulb', text: 'Fewer hops is better. Stuck? "Give me one" shows the next step.' }
    ]
  },
  {
    path: '/games/timeline',
    name: 'Timeline',
    banner: timelineBanner,
    description: 'Put movies in release order.',
    howTo: [
      { icon: 'bi-clock-history', text: 'Build a timeline of your films in release order, one at a time.' },
      { icon: 'bi-hand-index', text: 'Tap the gap where the new film belongs.' },
      { icon: 'bi-fire', text: 'Ties count either way. One wrong placement ends the streak.' }
    ]
  },
  {
    path: '/games/clue-budget',
    name: 'Clue Budget',
    banner: clueBudgetBanner,
    description: 'Buy clues, then name the movie.',
    howTo: [
      { icon: 'bi-cash-coin', text: 'You start with $100 and a hidden film from your library.' },
      { icon: 'bi-tags', text: 'Buy clues. Vague ones are cheap, giveaways cost more.' },
      { icon: 'bi-pencil', text: 'Guess any time. A wrong guess costs $10.' },
      { icon: 'bi-trophy', text: 'Whatever money is left when you name it is your score.' }
    ]
  },
  {
    path: '/games/tagline',
    name: 'Tag',
    banner: tagBanner,
    description: 'Match the tagline to its poster.',
    howTo: [
      { icon: 'bi-chat-quote-fill', text: 'Read a film\'s tagline.' },
      { icon: 'bi-hand-index', text: 'Tap the one poster of the four it belongs to.' },
      { icon: 'bi-fire', text: 'Each right answer adds to your streak. One miss ends it.' }
    ]
  },
  {
    path: '/games/trivia',
    name: 'Trivia',
    banner: triviaBanner,
    description: 'Name it, hardest fact first.',
    howTo: [
      { icon: 'bi-question-circle-fill', text: 'Facts about a film from your library, hardest first.' },
      { icon: 'bi-eye', text: 'Reveal as many facts as you need.' },
      { icon: 'bi-1-circle', text: 'You get one guess, so take your time. Fewer facts is better.' }
    ]
  },
  {
    path: '/games/poster-zoom',
    name: 'Poster Zoom',
    banner: posterZoomBanner,
    description: 'Name it from a close-up.',
    howTo: [
      { icon: 'bi-zoom-in', text: 'You start on a close-up of a poster from your library.' },
      { icon: 'bi-hand-index', text: 'Tap the poster to zoom out. Each zoom-out costs a point, and so does a wrong guess.' },
      { icon: 'bi-trophy', text: 'Name it in as few points as you can.' }
    ]
  },
  {
    path: '/games/stamp',
    name: 'Stamp',
    banner: stampBanner,
    description: 'Sort which keywords fit.',
    howTo: [
      { icon: 'bi-bookmark-check-fill', text: 'A keyword appears with a stack of your films.' },
      { icon: 'bi-arrow-left-right', text: 'Swipe right or tap Yes if it fits. Swipe left or tap No if it doesn\'t. Not sure? Skip it.' },
      { icon: 'bi-pencil-square', text: 'Your answers change the films\' keywords: Yes adds it, No takes it off.' },
      { icon: 'bi-arrow-counterclockwise', text: 'Swiped the wrong way? Undo is under the buttons.' }
    ]
  },
  {
    path: '/games/you-or-crowd',
    name: 'You or the Crowd?',
    banner: youOrCrowdBanner,
    description: 'Who scored it higher — you or Letterboxd?',
    howTo: [
      { icon: 'bi-people-fill', text: 'A film you\'ve rated. Who placed it higher: you, or the Letterboxd crowd?' },
      { icon: 'bi-bar-chart', text: 'It goes by where the film ranks on each side, so the two scales don\'t matter.' },
      { icon: 'bi-fire', text: 'Each right answer adds to your streak. One miss ends it.' }
    ]
  },
  {
    path: '/games/cineplexity',
    name: 'Cineplexity',
    banner: cineplexityBanner,
    description: 'Name every movie fitting both traits.',
    howTo: [
      { icon: 'bi-intersect', text: 'Two traits appear, like a genre and a decade, or an actor and a director.' },
      { icon: 'bi-pencil', text: 'Name every film in your library that fits both.' },
      { icon: 'bi-eye', text: 'Misses are counted, nothing more. Tap Reveal the rest when you\'re done.' }
    ]
  }
];

export function gameForPath (path) {
  return GAMES.find((game) => game.path === path) || null;
}

// One flag per game, on this device only: enough to show the card once
// without a database write, and a second device showing it once more is
// harmless.
export const HOW_TO_SEEN_PREFIX = 'cinemaRoll.games.howToSeen:';

export function howToSeen (path, storage = window.localStorage) {
  try {
    return storage.getItem(HOW_TO_SEEN_PREFIX + path) === '1';
  } catch {
    // Private browsing / quota — treat as seen rather than nagging every visit.
    return true;
  }
}

export function markHowToSeen (path, storage = window.localStorage) {
  try {
    storage.setItem(HOW_TO_SEEN_PREFIX + path, '1');
  } catch {
    // Nothing to do — worst case the card shows again next visit.
  }
}
