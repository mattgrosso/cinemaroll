import { getRating } from '../assets/javascript/GetRating.js';
import { getEligibleEntries, ratingFor } from '../assets/javascript/games/gameUtils.js';
import { appendRound } from '../assets/javascript/games/gameHistory.js';

// localStorage key recording whichever individual game route was last
// visited (NOT the hub itself — see created() below) — Home.vue's
// goToGames() reads this so the controller-icon entry point jumps back into
// the game you were actually playing instead of always landing on the hub.
export const LAST_PLAYED_KEY = 'cinemaRoll.games.lastPlayed';

/**
 * The stored last-played game path, but ONLY if that route still exists.
 *
 * Games do get removed (Rate-Off and Taste Quiz both were), and a stored path
 * pointing at a deleted one used to make Home's Games button navigate to a
 * blank page — and because the key is only ever overwritten by successfully
 * visiting another game, which that button is how you'd reach, it could not
 * heal on its own. So a stale value is cleared here on the way out.
 *
 * Checks getRoutes() for an exact path rather than router.resolve(), which
 * now always matches thanks to the catch-all route.
 */
export function lastPlayedGamePath (router) {
  let stored = null;
  try {
    stored = window.localStorage.getItem(LAST_PLAYED_KEY);
  } catch {
    // localStorage can throw in private-browsing/quota-exceeded situations.
  }

  if (!stored || !stored.startsWith('/games/')) return null;

  const stillExists = (router?.getRoutes?.() || []).some((route) => route.path === stored);
  if (stillExists) return stored;

  try {
    window.localStorage.removeItem(LAST_PLAYED_KEY);
  } catch {
    // Nothing to do — the caller falls back to the hub either way.
  }
  return null;
}

// Single source of truth for each game's icon — shared by GamesHub's tile
// grid and Home.vue's Games entry-point button, which shows whichever
// game's icon LAST_PLAYED_KEY points back to (falling back to a generic
// controller icon when nothing specific is stored).
// Display names by route, sharing GAME_ICONS' keys — used by the Game
// Stats screen, which deliberately does NOT mix in gameData (the mixin's
// created() records a play session for any /games/* route, and a stats
// visit is not a play).
export const GAME_NAMES = {
  '/games/higher-lower': 'Higher or Lower',
  '/games/wordle': 'Reel Wordle',
  '/games/connections': 'Connections',
  '/games/six-degrees': 'Six Degrees',
  '/games/timeline': 'Timeline',
  '/games/clue-budget': 'Clue Budget',
  '/games/tagline': 'Tag',
  '/games/trivia': 'Trivia',
  '/games/poster-zoom': 'Poster Zoom',
  '/games/stamp': 'Stamp',
  '/games/cineplexity': 'Cineplexity'
};

export const GAME_ICONS = {
  '/games/higher-lower': 'bi-arrow-down-up',
  '/games/wordle': 'bi-grid-3x3-gap-fill',
  '/games/connections': 'bi-grid-fill',
  '/games/six-degrees': 'bi-diagram-3-fill',
  '/games/timeline': 'bi-clock-history',
  '/games/clue-budget': 'bi-cash-coin',
  '/games/tagline': 'bi-chat-quote-fill',
  '/games/trivia': 'bi-question-circle-fill',
  '/games/poster-zoom': 'bi-zoom-in',
  '/games/stamp': 'bi-bookmark-check-fill',
  '/games/cineplexity': 'bi-intersect'
};

// Feature request: "I don't want to limit the number of times I can play a
// game in one day but it would be nice to have a checkmark on the game if
// I've won a game of that today. Then I'll be able to play each one each
// day and feel satisfied." Wins are recorded per game at
// settings/games/wins/<key> = a toDateString() stamp (the same
// today-stamp convention settings/dailyAwardsYearDate already uses), so a
// stamp that isn't today's simply reads as "not won today" with nothing to
// clear or expire. The key is the route's last segment, derived by this one
// helper on BOTH sides (the game recording a win, and GamesHub reading it
// back) so the two can't drift apart.
export function gameWinKey (routePath) {
  if (!routePath || !routePath.startsWith('/games/')) return null;
  return routePath.slice('/games/'.length);
}

export function todayStamp () {
  return new Date().toDateString();
}

// Shared plumbing for every game in src/components/games/ — which library
// entries are usable (poster + release date + at least one rating) and how
// to read a numeric rating off one. Kept as a mixin (matching the
// favoriteTuning.js precedent) so each game's own file stays focused on its
// own rules/UI rather than re-deriving this every time.
export default {
  created () {
    // GamesHub also mixes this in (for the eligibleGameEntries gate check)
    // but visiting the hub itself shouldn't count as "the game you were
    // playing" — only record an actual individual game route.
    if (this.$route?.path && this.$route.path !== '/games') {
      try {
        window.localStorage.setItem(LAST_PLAYED_KEY, this.$route.path);
      } catch {
        // localStorage can throw in private-browsing/quota-exceeded situations;
        // harmless to skip, it just means goToGames falls back to the hub.
      }
      this.recordGamePlay();
    }
  },
  computed: {
    eligibleGameEntries () {
      // Same default-false-unless-explicitly-true convention as Home.vue's
      // own showShorts computed. Optional-chained on state itself too since
      // several game test mocks stub $store without a state object at all.
      const includeShorts = this.$store.state?.settings?.includeShorts === true;
      return getEligibleEntries(this.$store.getters.allMediaAsArray, includeShorts);
    }
  },
  methods: {
    // Feature request: "the order of the games in the games menu should
    // change based on which games you've played the most... it has to be
    // individual sessions." A session is one visit to a game screen (this
    // mixin's created() fires it), not each round within a visit —
    // settings/games/plays/<key> is a plain lifetime counter. Recorded here
    // in the shared mixin so no individual game can forget to. dispatch is
    // optional-chained because several test mocks stub $store without it.
    recordGamePlay () {
      const key = gameWinKey(this.$route?.path);
      if (!key) return;
      this.whenSettingsReady(() => {
        const current = this.$store.state?.settings?.games?.plays?.[key] || 0;
        this.$store.dispatch?.('writeDurably', { path: `settings/games/plays/${key}`, value: current + 1 });
      });
    },
    // Defers a settings read-modify-write until REAL settings have loaded.
    // A recorder firing at mount races initializeDB: its early commit used
    // to make the has-data guard believe settings were loaded (the
    // vanished-Insights-awards bug), and its read of a still-empty settings
    // object would compute counters from nothing. settingsLoaded === false
    // is the real store's explicit not-yet signal; mock stores without the
    // field record synchronously, as every existing test expects.
    whenSettingsReady (record) {
      if (this.$store.state?.settingsLoaded === false) {
        const unwatch = this.$watch(
          () => this.$store.state?.settingsLoaded,
          (loaded) => {
            if (loaded) {
              unwatch();
              record();
            }
          }
        );
        return;
      }
      record();
    },
    // Feature request: "add a history for each game with some good
    // statistics on how they've gone." Called by each game at ITS OWN
    // end-of-round moment with a small metrics object (a streak game passes
    // {streak}, Clue Budget passes {won, saved}, and so on — see
    // gameHistory.js's per-game summaries for what each shape feeds).
    // Appends to the capped per-game round list; timestamps use the device
    // clock, which is fine for display history (unlike sync stamps, where
    // clock skew genuinely matters). Same optional-chaining as the other
    // recorders — several test mocks stub $store without dispatch/$route.
    recordGameRound (metrics) {
      const key = gameWinKey(this.$route?.path);
      if (!key) return;
      this.whenSettingsReady(() => {
        const existing = this.$store.state?.settings?.games?.history?.[key];
        const history = appendRound(existing, { at: Date.now(), ...metrics });
        this.$store.dispatch?.('writeDurably', { path: `settings/games/history/${key}`, value: history });
      });
    },
    // Called by each game at ITS OWN definition of a win. For the games with
    // a discrete win state (Wordle/Connections/Six Degrees/Clue Budget/
    // Trivia) that's unambiguous; for the endless streak games (Higher or
    // Lower/Timeline/Tag) there's no "finish", so the judgment call is that
    // one correct answer counts — the point of the checkmark is "I played
    // this one today and did something," not a difficulty gate.
    // writeDurably (not setDBValue) so it works offline like everything else.
    recordGameWin () {
      const key = gameWinKey(this.$route?.path);
      if (!key) return;
      const today = todayStamp();
      // Already stamped today — skip the redundant write entirely rather
      // than re-writing the same value on every subsequent win.
      if (this.$store.state?.settings?.games?.wins?.[key] === today) return;
      this.$store.dispatch('writeDurably', { path: `settings/games/wins/${key}`, value: today });
    },
    gameRatingFor (entry) {
      return ratingFor(entry, getRating);
    },
    gamePosterUrl (entry, size = 'w342') {
      const path = entry?.movie?.poster_path;
      return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
    }
  }
};
