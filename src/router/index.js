import { createRouter, createWebHashHistory } from 'vue-router';
import store from "../store";
import { appScrollBehavior, rememberNavigationSource } from "./scrollBehavior.js";
import { handleRouterChunkError } from "../utils/staleChunkReload.js";

const Home = () => import(/* webpackChunkName: "home" */ "../components/Home.vue");
const Login = () => import(/* webpackChunkName: "login" */ "../components/Login.vue");
const PickMedia = () => import(/* webpackChunkName: "pick-media" */ "../components/PickMedia.vue");
const RateMovie = () => import(/* webpackChunkName: "rate-movie" */ "../components/RateMovie.vue");
const ReconcilePlaceholder = () => import(/* webpackChunkName: "reconcile-placeholder" */ "../components/ReconcilePlaceholder.vue");
const Insights = () => import(/* webpackChunkName: "insights" */ "../components/Insights.vue");
const WebScreen = () => import(/* webpackChunkName: "web" */ "../components/WebScreen.vue");
const NewsletterScreen = () => import(/* webpackChunkName: "newsletter" */ "../components/NewsletterScreen.vue");
const ShareDBResults = () => import(/* webpackChunkName: "share-db-results" */ "../components/ShareDBResults.vue");
const MovieDetail = () => import(/* webpackChunkName: "movie-detail" */ "../components/MovieDetail.vue");
const YearInReview = () => import(/* webpackChunkName: "year-in-review" */ "../components/YearInReview.vue");
const TrophyCase = () => import(/* webpackChunkName: "trophy-case" */ "../components/TrophyCase.vue");
const GamesHub = () => import(/* webpackChunkName: "games" */ "../components/games/GamesHub.vue");
const HigherLowerGame = () => import(/* webpackChunkName: "games" */ "../components/games/HigherLowerGame.vue");
const ReelWordleGame = () => import(/* webpackChunkName: "games" */ "../components/games/ReelWordleGame.vue");
const ConnectionsGame = () => import(/* webpackChunkName: "games" */ "../components/games/ConnectionsGame.vue");
const SixDegreesGame = () => import(/* webpackChunkName: "games" */ "../components/games/SixDegreesGame.vue");
const TimelineGame = () => import(/* webpackChunkName: "games" */ "../components/games/TimelineGame.vue");
const ClueBudgetGame = () => import(/* webpackChunkName: "games" */ "../components/games/ClueBudgetGame.vue");
const TaglineQuizGame = () => import(/* webpackChunkName: "games" */ "../components/games/TaglineQuizGame.vue");
const TriviaGame = () => import(/* webpackChunkName: "games" */ "../components/games/TriviaGame.vue");
const PosterZoomGame = () => import(/* webpackChunkName: "games" */ "../components/games/PosterZoomGame.vue");
const StampGame = () => import(/* webpackChunkName: "games" */ "../components/games/StampGame.vue");
const CineplexityGame = () => import(/* webpackChunkName: "games" */ "../components/games/CineplexityGame.vue");
const GameStatsScreen = () => import(/* webpackChunkName: "games" */ "../components/games/GameStatsScreen.vue");
const WatchlistScreen = () => import(/* webpackChunkName: "watchlist" */ "../components/WatchlistScreen.vue");
const LibraryPoster = () => import(/* webpackChunkName: "library-poster" */ "../components/LibraryPoster.vue");
const PersonalAwardsScreen = () => import(/* webpackChunkName: "awards" */ "../components/PersonalAwardsScreen.vue");
const DeepStats = () => import(/* webpackChunkName: "deep-stats" */ "../components/DeepStats.vue");
const FilmClubScreen = () => import(/* webpackChunkName: "film-club" */ "../components/FilmClubScreen.vue");
const FriendComparison = () => import(/* webpackChunkName: "film-club" */ "../components/FriendComparison.vue");
const ClubCharts = () => import(/* webpackChunkName: "film-club" */ "../components/ClubCharts.vue");

// Router
const loggedIn = () => {
  const databaseTopKeyFromLocalStorage = window.localStorage.getItem('databaseTopKey');

  if (store.getters.databaseTopKey) {
    store.dispatch('initializeDB');
    return true;
  } else if (databaseTopKeyFromLocalStorage) {
    store.commit('setDatabaseTopKey', databaseTopKeyFromLocalStorage);
    // The sanitized key can't be turned back into an address, so the raw
    // email is stored separately purely so the settings panel can show who
    // you're signed in as after a reload.
    const userEmailFromLocalStorage = window.localStorage.getItem('userEmail');
    if (userEmailFromLocalStorage) {
      store.commit('setUserEmail', userEmailFromLocalStorage);
    }
    store.dispatch('initializeDB');
    return true;
  } else {
    return false;
  }
}

const routes = [
  {
    path: '/',
    name: 'Home', // Added name for programmatic navigation
    component: Home,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Home',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      store.commit('setGoHome', false);

      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/login',
    component: Login,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Sign in',
      requiresLogin: false
    },
  },
  {
    path: '/rate-movie',
    component: RateMovie,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Rate a movie',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/reconcile/:dbKey',
    component: ReconcilePlaceholder,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Reconcile',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/insights',
    component: Insights,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Insights',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    // The Web: the library as one picture (Matt, 2026-09-08). `?movie=` or
    // `?person=` is the web around one node; bare, the whole library.
    path: '/web',
    component: WebScreen,
    meta: {
      title: 'Web',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    // The weekly newsletter (Matt, 2026-09-20). Its own screen rather than a
    // card on Home: it is a thing you sit down and read, and the push
    // notification lands you straight here.
    path: '/newsletter',
    component: NewsletterScreen,
    meta: {
      title: 'Newsletter',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/pick-media/:newEntrySearchResults',
    component: PickMedia,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Pick a movie',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/share/:userDBKey/:shareKey',
    component: ShareDBResults,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Shared list',
      parent: '/',
      requiresLogin: false
    }
  },
  {
    path: '/movie/:tmdbId',
    name: 'MovieDetail',
    component: MovieDetail,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Movie',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/year-in-review',
    name: 'YearInReview',
    component: YearInReview,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Year in Review',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/trophy-case',
    name: 'TrophyCase',
    component: TrophyCase,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Trophy Case',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games',
    name: 'GamesHub',
    component: GamesHub,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Games',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/higher-lower',
    name: 'HigherLowerGame',
    component: HigherLowerGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Higher or Lower',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/wordle',
    name: 'ReelWordleGame',
    component: ReelWordleGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Reel Wordle',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/connections',
    name: 'ConnectionsGame',
    component: ConnectionsGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Connections',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/six-degrees',
    name: 'SixDegreesGame',
    component: SixDegreesGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Six Degrees',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/timeline',
    name: 'TimelineGame',
    component: TimelineGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Timeline',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/clue-budget',
    name: 'ClueBudgetGame',
    component: ClueBudgetGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Clue Budget',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/tagline',
    name: 'TaglineQuizGame',
    component: TaglineQuizGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Tagline Quiz',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/awards',
    name: 'PersonalAwardsScreen',
    component: PersonalAwardsScreen,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Awards',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/library-poster',
    name: 'LibraryPoster',
    component: LibraryPoster,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Library Poster',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/watchlist',
    name: 'WatchlistScreen',
    component: WatchlistScreen,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Watchlist',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/film-club',
    name: 'FilmClubScreen',
    component: FilmClubScreen,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Film Club',
      parent: '/',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/club-charts',
    name: 'ClubCharts',
    component: ClubCharts,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Club Charts',
      parent: '/film-club',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    // The Venn lived here for a few hours on 2026-08-21 before moving into
    // Club Charts; keep the address working.
    path: '/club-venn',
    redirect: '/club-charts'
  },
  {
    path: '/film-club/:friendKey',
    name: 'FriendComparison',
    component: FriendComparison,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Friend',
      parent: '/film-club',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/stats',
    name: 'DeepStats',
    component: DeepStats,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Deep Stats',
      parent: '/insights',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/stats',
    name: 'GameStatsScreen',
    component: GameStatsScreen,
    meta: {
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Game Stats',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/stamp',
    name: 'StampGame',
    component: StampGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Stamp',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/cineplexity',
    name: 'CineplexityGame',
    component: CineplexityGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Cineplexity',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/trivia',
    name: 'TriviaGame',
    component: TriviaGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Trivia',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  {
    path: '/games/poster-zoom',
    name: 'PosterZoomGame',
    component: PosterZoomGame,
    meta: {
      // A game is entered from the hub, so the way out is the hub —
      // history-based back stranded you when you'd been elsewhere between.
      exitToParent: true,
      // Back-link identity: what this screen is called, and where back
      // goes when there is no history to go back to.
      title: 'Poster Zoom',
      parent: '/games',
      requiresLogin: true
    },
    beforeEnter: (to, from, next) => {
      if (!loggedIn()) {
        next('/login');
      } else {
        next();
      }
    }
  },
  // Catch-all. Without this, an unmatched path renders NOTHING — no error, no
  // redirect, just the header over a blank page (confirmed live against a
  // route that had been removed). Games that no longer exist are the way this
  // actually bit: /games/rate-off and /games/quiz were both deleted, and
  // anything still pointing at them led straight here.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // Blanket scroll-to-top on every navigation, with one exception for Home
  // returning from a movie detail page — see scrollBehavior.js.
  scrollBehavior: appScrollBehavior
})

// scrollBehavior runs AFTER the target component mounts, so it can't tell
// Home whether this was the one navigation that restores a scroll position.
// This guard runs before, and records it.
router.beforeEach((to, from) => {
  rememberNavigationSource(to, from);
  return true;
})

// Safety net for scroll-lock leaks. Modals/overlays across the app lock body
// scrolling via `body.no-scroll` (overflow:hidden) or `body.style.overflow`, and
// rely on their own close handler to undo it. When a route change happens while
// one is still open (e.g. tapping "Rate" from Home's movie-info modal), the close
// handler never runs and the lock sticks to <body> on every subsequent screen
// until a reload. Clearing it on each navigation guarantees no overlay can leave
// the page permanently unscrollable.
router.afterEach(() => {
  document.body.classList.remove('no-scroll');
  document.body.style.overflow = '';
})

// Mixed-version self-heal: after a deploy, the old app's lazy route chunks
// can vanish (new worker purges the old precache) and navigation dead-ends
// in a blank router-view. One guarded reload recovers onto the new build.
// See staleChunkReload.js for the full story.
router.onError((error, to) => {
  handleRouterChunkError(error, to);
})

export default router;