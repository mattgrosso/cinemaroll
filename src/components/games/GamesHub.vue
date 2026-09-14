<template>
  <div class="games-hub">
    <BackLink/>
    <div class="games-hub-header">
      <h1 class="games-hub-title">Games</h1>
      <button type="button" class="stats-link" @click="$router.push('/games/stats')">
        Game stats <i class="bi bi-chevron-right"></i>
      </button>
    </div>
    <p class="games-hub-subtitle">Little games built from your own rated library.</p>

    <!-- Bug report: a new user hits this wall with no way forward except
         leaving to go rate movies manually. Reuses the SAME "help me get
         started" quick-pick suggestions (popular TMDB movies, tap to rate)
         Home.vue's new-user onboarding already uses, right here instead. -->
    <div v-if="eligibleGameEntries.length < 4" class="not-enough-movies">
      <p>Rate at least a handful of movies (with posters) before these games have enough to work with.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <div v-else class="game-tile-grid">
      <button
        v-for="game in orderedGames"
        :key="game.path"
        type="button"
        class="game-tile"
        @click="selectGame(game.path)"
      >
        <!-- Each game already has bespoke banner art carrying its own name
             and palette, so the tile shows that rather than a generic icon.
             No name is overlaid on purpose — the artwork already has one,
             and a second would just be a duplicate sitting on top of it. -->
        <span class="game-tile-art">
          <img :src="game.banner" :alt="game.name" class="game-tile-image" loading="lazy">
          <!-- Feature request: "it would be nice to have a checkmark on the
               game if I've won a game of that today... then I'll be able to
               play each one each day and feel satisfied." Purely a marker —
               it never gates or limits play. -->
          <i v-if="wonToday(game.path)" class="bi bi-check-circle-fill won-today" title="Won today"></i>
        </span>
        <span class="game-tile-description">{{ game.description }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin, { LAST_PLAYED_KEY, gameWinKey, todayStamp } from '../../mixins/gameData.js';
// The same artwork each game swaps into the header banner on entry, reused
// here as tile art so the hub looks like the games it leads to.
import higherLowerBanner from '../../assets/images/games/higher-lower-banner.jpg';
import reelWordleBanner from '../../assets/images/games/reel-wordle-banner.jpg';
import connectionsBanner from '../../assets/images/games/connections-banner.jpg';
import sixDegreesBanner from '../../assets/images/games/six-degrees-banner.jpg';
import timelineBanner from '../../assets/images/games/timeline-banner.jpg';
import clueBudgetBanner from '../../assets/images/games/clue-budget-banner.jpg';
import tagBanner from '../../assets/images/games/tag-banner.jpg';
import triviaBanner from '../../assets/images/games/trivia-banner.jpg';
import stampBanner from '../../assets/images/games/stamp-banner.jpg';
import posterZoomBanner from '../../assets/images/games/poster-zoom-banner.jpg';
import cineplexityBanner from '../../assets/images/games/cineplexity-banner.svg';

export default {
  name: 'GamesHub',
  components: { BackLink, NewRatingSearch },
  mixins: [gameDataMixin],
  // Landing on the hub is the "let me pick again" signal — bug report: a
  // player who finished a Wordle round and deliberately tapped back to the
  // hub still got dropped straight back into that (completed) round the
  // next time they used Home's games shortcut, because LAST_PLAYED_KEY only
  // ever got overwritten by visiting ANOTHER game, never cleared. Mixin
  // hooks run before the component's own of the same name (Vue's merge
  // order), so this runs after gameDataMixin's created() — which itself
  // skips writing anything for the hub's own route — and clears whatever
  // the previous game left behind.
  created () {
    try {
      window.localStorage.removeItem(LAST_PLAYED_KEY);
    } catch {
      // localStorage can throw in private-browsing/quota-exceeded situations.
    }
  },
  data () {
    return {
      games: [
        {
          path: '/games/higher-lower',
          name: 'Higher or Lower',
          banner: higherLowerBanner,
          description: 'Which movie scored higher?'
        },
        {
          path: '/games/wordle',
          name: 'Reel Wordle',
          banner: reelWordleBanner,
          description: 'Guess it from year/genre clues.'
        },
        {
          path: '/games/connections',
          name: 'Connections',
          banner: connectionsBanner,
          description: 'Find four groups of four.'
        },
        {
          path: '/games/six-degrees',
          name: 'Six Degrees',
          banner: sixDegreesBanner,
          description: 'Link two movies by shared cast.'
        },
        {
          path: '/games/timeline',
          name: 'Timeline',
          banner: timelineBanner,
          description: 'Put movies in release order.'
        },
        {
          path: '/games/clue-budget',
          name: 'Clue Budget',
          banner: clueBudgetBanner,
          description: 'Buy clues, then name the movie.'
        },
        {
          path: '/games/tagline',
          name: 'Tag',
          banner: tagBanner,
          description: 'Match the tagline to its poster.'
        },
        {
          path: '/games/trivia',
          name: 'Trivia',
          banner: triviaBanner,
          description: 'Name it, hardest fact first.'
        },
        {
          path: '/games/poster-zoom',
          name: 'Poster Zoom',
          banner: posterZoomBanner,
          description: 'Name it from a close-up.'
        },
        {
          path: '/games/stamp',
          name: 'Stamp',
          banner: stampBanner,
          description: 'Sort which keywords fit.'
        },
        {
          path: '/games/cineplexity',
          name: 'Cineplexity',
          banner: cineplexityBanner,
          description: 'Name every movie fitting both traits.'
        }
      ]
    };
  },
  computed: {
    // Feature request: "the order of the games in the games menu should
    // change based on which games you've played the most... the ones you
    // played the most go to the top." Sorted by recorded play sessions
    // (gameData.recordGamePlay); ties keep the hand-curated order above.
    orderedGames () {
      const plays = this.$store.state?.settings?.games?.plays || {};
      return this.games
        .map((game, index) => ({ game, plays: plays[gameWinKey(game.path)] || 0, index }))
        .sort((a, b) => b.plays - a.plays || a.index - b.index)
        .map(({ game }) => game);
    }
  },
  methods: {
    // A stamp that isn't today's simply reads as "not won today" — nothing
    // ever needs clearing or expiring. See gameData.js's recordGameWin.
    wonToday (path) {
      const key = gameWinKey(path);
      if (!key) return false;
      return this.$store.state?.settings?.games?.wins?.[key] === todayStamp();
    },
    // Scroll-to-top on entering a game is handled by the router's
    // scrollBehavior now (see src/router/scrollBehavior.js) rather than
    // here. This used to call window.scrollTo itself, which fixed exactly
    // this one entry path and missed every other way into a game.
    selectGame (path) {
      this.$router.push(path);
    }
  }
};
</script>

<style scoped>
.games-hub {
  color: #eee;
  /* top padding is a safety margin, not decoration — BackLink is fixed at
     (6,6) of the viewport regardless of whether the global Header currently
     has any real height (e.g. a direct/fresh navigation before Home ever
     set a banner leaves it at 0px), so without this the back-link and this
     screen's own h1 can visually overlap. Same fix in the 4 game components. */
  padding: 2.5rem 0 2rem;
}

.games-hub-title {
  margin: 0.5rem 1rem 0;
}

.games-hub-subtitle {
  color: #adb5bd;
  margin: 0.25rem 1rem 1.5rem;
}

/* Its own place in the title row rather than trailing the subtitle as an
   underlined afterthought (bug report), matching the "Deep Stats ›"
   treatment on Insights. */
.games-hub-header {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
  margin-right: 1rem;
}

.stats-link {
  background: none;
  border: none;
  color: #ffc107;
  flex: 0 0 auto;
  font-size: 0.85rem;
  font-weight: 600;
  min-height: 40px;
  padding: 0.15rem 0.3rem;
  white-space: nowrap;
}

/* Mobile-first: press state only, no :hover. */
.stats-link:active {
  opacity: 0.6;
}

.not-enough-movies {
  color: #adb5bd;
  margin: 2rem;
  text-align: center;
}

.game-tile-grid {
  display: grid;
  gap: 0.75rem;
  /* Two across even on a phone. Nine stacked full-width tiles was the bulk
     of the old page's height; the art is legible at half-width. */
  grid-template-columns: 1fr 1fr;
  margin: 0 1rem;
}

@media (min-width: 600px) {
  .game-tile-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 900px) {
  .game-tile-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.game-tile {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 0.5rem;
  color: #eee;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  /* The art goes edge to edge; only the caption below it is inset. */
  overflow: hidden;
  padding: 0;
  text-align: left;
}

/* Mobile-first: press state only, no :hover — a tapped tile would otherwise
   stay stuck in its hover look on iOS, with no mouse to leave it. */
.game-tile:active {
  border-color: #666;
}

.game-tile:active .game-tile-image {
  transform: scale(0.97);
}

.game-tile-art {
  aspect-ratio: 16 / 9;
  display: block;
  overflow: hidden;
  position: relative;
  width: 100%;
}

.game-tile-image {
  display: block;
  height: 100%;
  object-fit: cover;
  transition: transform 0.15s ease;
  width: 100%;
}

/* Green (not the amber used across the banners) so "done today" reads as its
   own signal rather than blending into the artwork it sits on. Sits on the
   art, so it needs a dark disc behind it to stay legible over any banner. */
.game-tile .won-today {
  background: rgba(0, 0, 0, 0.65);
  border-radius: 50%;
  color: #4caf50;
  font-size: 1.05rem;
  line-height: 1;
  padding: 2px;
  position: absolute;
  right: 4px;
  top: 4px;
}

.game-tile-description {
  color: #adb5bd;
  font-size: 0.75rem;
  line-height: 1.25;
  padding: 0.45rem 0.55rem 0.55rem;
  /* Captions are written to fit one line at phone width, which keeps every
     tile the same height. The clamp is a safety net for very narrow screens:
     a long caption wraps to a second line rather than an unbounded number,
     so at worst one grid row is slightly taller. Reserving two lines up
     front was tried and left visible dead space under every caption. */
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  display: -webkit-box;
  overflow: hidden;
}
</style>
