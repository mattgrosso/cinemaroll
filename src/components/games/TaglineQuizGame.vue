<template>
  <div class="tagline-quiz-game">
    <BackLink/>
    <GameHowTo/>

    <div v-if="eligibleGameEntries.length < 4" class="not-enough-movies">
      <p>Rate a few more movies before there's enough to build a round with.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <template v-else>
      <p class="game-subtitle">See the tagline, guess the poster.</p>

      <p class="status-line">{{ statusMessage }}</p>
      <p class="streak-line">Streak {{ streak }} · Best {{ bestStreak }}</p>

      <p v-if="tagline" class="tagline-text">&ldquo;{{ tagline }}&rdquo;</p>

      <div v-if="options.length" class="tq-options-grid">
        <button
          v-for="entry in options"
          :key="entryKey(entry)"
          type="button"
          class="tq-option"
          :class="{ tappable: !revealed && !loading }"
          :disabled="revealed || loading"
          @click="guess(entry)"
        >
          <div class="tq-poster-wrap">
            <img v-if="gamePosterUrl(entry)" :src="gamePosterUrl(entry, 'w342')" :alt="entry.movie.title">
            <div v-if="badgeFor(entry)" class="tq-guess-badge" :class="badgeFor(entry)">
              <i :class="badgeFor(entry) === 'correct' ? 'bi bi-check-lg' : 'bi bi-x-lg'"></i>
            </div>
          </div>
        </button>
      </div>

      <div v-if="gameOver || noTaglineFound" class="game-over">
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary cta-btn" @click="playAgain">{{ gameOver ? 'Play Again' : 'Try Again' }}</button>
          <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import axios from 'axios';
import BackLink from './BackLink.vue';
import GameHowTo from './GameHowTo.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { entryKey } from '../../assets/javascript/games/gameUtils.js';
import { buildRoundOptions } from '../../assets/javascript/games/taglineQuiz.js';
import tagBanner from '../../assets/images/games/tag-banner.jpg';

export default {
  name: 'TaglineQuizGame',
  components: { BackLink, GameHowTo, NewRatingSearch },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "TAG / Cinema Roll Games" branding
  // baked in) in place of the usual movie-backdrop banner, and hides the
  // "Cinema Roll" title overlay so it doesn't compete with that baked-in
  // branding - same pattern as every other game, see CLAUDE.md. This game
  // previously had no banner at all; merged into the existing created()
  // hook rather than adding a second one (not valid on one component).
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      target: null,
      tagline: null,
      options: [],
      loading: false,
      revealed: false,
      selectedKey: null,
      lastGuessCorrect: null,
      streak: 0,
      gameOver: false,
      noTaglineFound: false,
      // Bumped at the start of every startNewRound() call and captured
      // locally as roundId — the sequential retry loop inside checks this
      // after each await and bails if a NEWER round has since started (e.g.
      // the player double-tapped "Try Again"), so two overlapping rounds
      // can never both try to finish setting up state.
      roundId: 0
    };
  },
  computed: {
    bestStreak () {
      return this.$store.state.settings?.games?.taglineQuizBestStreak || 0;
    },
    statusMessage () {
      if (this.loading) return 'Loading a tagline...';
      if (this.noTaglineFound) {
        // Offline audit 2026-08-15: taglines aren't stored locally, so this
        // game genuinely needs a connection — say THAT, not "your library
        // has no taglines" (which reads as a data problem).
        if (this.$store.state.isOnline === false) return "Tag Lines needs a connection to fetch taglines — you're offline right now.";
        return "Couldn't find a movie with a tagline in your library — try again.";
      }
      if (!this.revealed) return 'Which movie has this tagline?';
      if (this.lastGuessCorrect) return 'Correct!';
      return `Not quite — final streak: ${this.streak}.`;
    }
  },
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', tagBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
    this.startNewRound();
  },
  methods: {
    entryKey,
    // "Play Again"/"Try Again" — the ONLY path that resets the streak.
    // startNewRound() itself deliberately does NOT touch streak, since it's
    // also what advances to the NEXT round after a correct guess (where the
    // streak needs to carry forward, not reset).
    playAgain () {
      this.streak = 0;
      this.startNewRound();
    },
    badgeFor (entry) {
      if (!this.revealed) return null;
      const isSelected = entryKey(entry) === this.selectedKey;
      const isTarget = entryKey(entry) === entryKey(this.target);
      if (isSelected) return this.lastGuessCorrect ? 'correct' : 'incorrect';
      // On a wrong guess, also mark the actual correct poster so the
      // player can see where it was — same "reveal the true answer"
      // convention used elsewhere in Games (e.g. Timeline's correctSlotOnLoss).
      if (isTarget && this.lastGuessCorrect === false) return 'correct';
      return null;
    },
    async fetchTagline (candidate) {
      // Stored tagline first (2026-08-15): entries rated/backfilled since
      // taglines became part of the stored shape carry movie.tagline —
      // '' means the movie genuinely has none (skip without a request),
      // a string plays offline, undefined is a legacy entry (fetch).
      const stored = candidate?.movie?.tagline;
      if (typeof stored === 'string') {
        return stored.trim() || null;
      }
      const movieId = candidate?.movie?.id;
      if (movieId == null) return null;
      try {
        const response = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US`);
        const tagline = response?.data?.tagline;
        return tagline && tagline.trim() ? tagline.trim() : null;
      } catch {
        return null;
      }
    },
    async startNewRound () {
      this.roundId += 1;
      const myRoundId = this.roundId;

      // Bug report (filed twice): "repeated the same tagline twice in a
      // row." attemptedKeys used to start fresh every round with no memory
      // of what the PREVIOUS round's target was, so a small library had a
      // real, non-negligible chance of drawing the same movie right back -
      // same fix Reel Wordle's startNewPuzzle already uses (excludeKey).
      const previousTargetKey = this.target ? entryKey(this.target) : null;

      this.loading = true;
      this.tagline = null;
      this.options = [];
      this.target = null;
      this.revealed = false;
      this.selectedKey = null;
      this.lastGuessCorrect = null;
      this.gameOver = false;
      this.noTaglineFound = false;

      const attemptedKeys = new Set();
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const notYetAttempted = this.eligibleGameEntries.filter((entry) => !attemptedKeys.has(entryKey(entry)));
        // Exclude the just-finished round's target - but only as long as
        // something else is actually available. A tiny library (or one
        // where every other candidate has already failed the tagline check
        // this round) falls back to allowing it again rather than dead-
        // ending on "no tagline found" when a perfectly good one exists.
        const excludingPrevious = notYetAttempted.filter((entry) => entryKey(entry) !== previousTargetKey);
        const candidates = excludingPrevious.length ? excludingPrevious : notYetAttempted;
        if (!candidates.length) break;
        const candidate = candidates[Math.floor(Math.random() * candidates.length)];
        attemptedKeys.add(entryKey(candidate));

        const tagline = await this.fetchTagline(candidate);
        if (myRoundId !== this.roundId) return; // a newer round has since started

        if (tagline) {
          this.target = candidate;
          this.tagline = tagline;
          this.options = buildRoundOptions(candidate, this.eligibleGameEntries, Math.random);
          this.loading = false;
          return;
        }
      }

      this.loading = false;
      this.noTaglineFound = true;
    },
    guess (entry) {
      if (this.revealed || this.gameOver || this.loading) return;

      this.revealed = true;
      this.selectedKey = entryKey(entry);
      const isCorrect = entryKey(entry) === entryKey(this.target);
      this.lastGuessCorrect = isCorrect;

      if (!isCorrect) {
        this.recordGameRound({ streak: this.streak });
        this.gameOver = true;
        return;
      }

      this.streak += 1;
      this.recordGameWin(); // one correct pick counts — see the mixin
      if (this.streak > this.bestStreak) {
        this.$store.dispatch('writeDurably', { path: 'settings/games/taglineQuizBestStreak', value: this.streak });
      }

      setTimeout(() => {
        this.startNewRound();
      }, 900);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.tagline-quiz-game {
  color: #eee;
  // Safety margin against BackLink overlapping this screen's own content
  // when the global Header happens to have zero height — trimmed from
  // 2.5rem, same tradeoff other games made, to help everything fit on one
  // screen (bug report: "all four posters show up on a single screen...
  // I don't have to scroll to see anything").
  padding: 1.75rem 0 1rem;
  text-align: center;
}

.not-enough-movies {
  color: #adb5bd;
  margin: 2rem 1.5rem;
}

.game-subtitle {
  color: #adb5bd;
  margin: 0.5rem 1rem 0;
}

.streak-line {
  color: #777;
  font-size: 0.8rem;
  margin: 0 0 0.5rem;
}

/* Always rendered so its text can swap in place without adding/removing an
   element — same anti-layout-jump convention used across every game here. */
.status-line {
  color: #adb5bd;
  text-align: center;
  min-height: 1.4rem;
  margin: 0.5rem 0.5rem 0.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tagline-text {
  color: #fff;
  font-size: 1.05rem;
  font-style: italic;
  font-weight: 600;
  margin: 0.35rem 1rem 1rem;
  min-height: 2.6rem;
}

/* Side by side across the screen, one row, no scrolling — bug report:
   "I think they could be side by side across the screen instead of being
   larger and two by two." A single row of 4 is naturally much SHORTER
   overall than a 2x2 grid was (one poster-height instead of two), which is
   what actually frees up enough room for the whole screen to fit without
   scrolling — not just the posters themselves. max-width keeps them from
   growing oversized on a wide viewport; 1fr columns share whatever width
   is actually available on a narrow phone. */
.tq-options-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  max-width: 380px;
  margin: 0 auto;
  padding: 0 0.5rem;
}

.tq-option {
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}

.tq-poster-wrap {
  position: relative;
}

.tq-option img {
  border-radius: 0.4rem;
  width: 100%;
  display: block;
}

/* Mobile-first: :active only, no :hover (this app has no reliable pointer
   device — see CLAUDE.md). */
.tq-option.tappable:active {
  opacity: 0.8;
  transform: scale(0.97);
}

.tq-guess-badge {
  align-items: center;
  background: #4caf50;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  color: #fff;
  display: flex;
  font-size: 1.1rem;
  height: 28px;
  justify-content: center;
  position: absolute;
  right: 6px;
  top: 6px;
  width: 28px;
}

.tq-guess-badge.incorrect {
  background: #ff6a6a;
}

.game-over {
  margin-top: 1.5rem;
  padding: 0 1.5rem;
}

.cta-btn {
  margin: 0 auto;
  max-width: 320px;
}
</style>
