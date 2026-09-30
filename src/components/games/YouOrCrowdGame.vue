<template>
  <div class="you-or-crowd-game">
    <BackLink/>

    <div v-if="!current" class="setup">
      <p>See a film from your library, then guess who scored it higher: you, or the Letterboxd crowd.</p>
      <button type="button" class="btn-game btn-game-primary cta-btn" :disabled="deckSize < 10" @click="start">
        {{ deckSize < 10 ? 'Letterboxd ratings still loading' : 'Start' }}
      </button>
    </div>

    <template v-else>
      <div class="streak-row">
        <span>Streak: <strong>{{ streak }}</strong></span>
        <span>Best: <strong>{{ bestStreak }}</strong></span>
      </div>

      <p class="status-line">{{ statusMessage }}</p>

      <div class="yc-card">
        <img v-if="gamePosterUrl(current.entry)" :src="gamePosterUrl(current.entry, 'w342')" :alt="current.entry.movie.title">
        <div v-if="guessed" class="yc-guess-badge" :class="lastGuessCorrect ? 'correct' : 'incorrect'">
          <i :class="lastGuessCorrect ? 'bi bi-check-lg' : 'bi bi-x-lg'"></i>
        </div>
      </div>

      <!-- Two columns, one per side: the number (a '?' until you guess,
           the same big score Higher or Lower reveals) over its button. -->
      <div class="yc-sides">
        <div class="yc-side">
          <p class="yc-score">{{ guessed ? starLabel(current.mine, 1) : '?' }}</p>
          <button type="button" class="btn-game btn-game-secondary yc-choice" :class="{ 'is-tapped': tapped === 'you' }" :disabled="guessed || gameOver" @click="guess('you')">I scored it higher</button>
        </div>
        <div class="yc-side">
          <p class="yc-score">{{ guessed ? starLabel(current.crowd, 2) : '?' }}</p>
          <button type="button" class="btn-game btn-game-secondary yc-choice" :class="{ 'is-tapped': tapped === 'crowd' }" :disabled="guessed || gameOver" @click="guess('crowd')">The crowd did</button>
        </div>
      </div>

      <div v-if="gameOver" class="game-over">
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary cta-btn" @click="start">Play Again</button>
          <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
// You or the Crowd? — a streak game on the Letterboxd data (2026-09-29).
// Rules in games/youOrCrowd.js; the crowd's ratings come from the shared
// letterboxdFilms cache (store: ensureLetterboxdData), so the Start button
// waits until a balanced run of at least ten films can be dealt.
// Restyled 2026-09-30 on Higher or Lower's layout (bug report: "look at the
// other games, make this one match their styles"): a check/X badge on the
// poster, the scores revealed big, and a right answer moves on by itself.
import BackLink from './BackLink.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { shuffle } from '../../assets/javascript/games/gameUtils.js';
import { youOrCrowdRounds, answerFor, balancedDeck, starLabel } from '../../assets/javascript/games/youOrCrowd.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import banner from '../../assets/images/games/you-or-crowd-banner.jpg';

// Long enough to read both scores, the same pause Higher or Lower and Tag use.
const ADVANCE_MS = 900;

export default {
  name: 'YouOrCrowdGame',
  components: { BackLink },
  mixins: [gameDataMixin],
  created () {
    this.$store.dispatch?.('ensureLetterboxdData');
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', banner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    clearTimeout(this.advanceTimer);
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      queue: [],
      current: null,
      guessed: false,
      tapped: null,
      lastGuessCorrect: null,
      streak: 0,
      gameOver: false
    };
  },
  computed: {
    films () {
      return this.$store.state?.letterboxdFilms || null;
    },
    rounds () {
      if (!this.films) return [];
      return youOrCrowdRounds(this.eligibleGameEntries, getRating, this.films);
    },
    deckSize () {
      const yours = this.rounds.filter((row) => answerFor(row) === 'you').length;
      return 2 * Math.min(yours, this.rounds.length - yours);
    },
    bestStreak () {
      return this.$store.state?.settings?.games?.youOrCrowdBestStreak || 0;
    },
    statusMessage () {
      if (this.gameOver && !this.queue.length && this.lastGuessCorrect) return "You've been through every film with an answer. Restart to shuffle a new run.";
      if (!this.guessed) return 'Who scored this one higher?';
      if (this.lastGuessCorrect) return 'Correct — on to the next one.';
      return `Streak over at ${this.streak}. ${answerFor(this.current) === 'you' ? 'You scored it higher.' : 'The crowd scored it higher.'}`;
    }
  },
  methods: {
    starLabel,
    start () {
      clearTimeout(this.advanceTimer);
      this.queue = balancedDeck(this.rounds, (list) => shuffle(list, Math.random));
      this.streak = 0;
      this.gameOver = false;
      this.lastGuessCorrect = null;
      this.next();
    },
    next () {
      this.guessed = false;
      this.tapped = null;
      const round = this.queue.shift();
      if (!round) {
        this.gameOver = true;
        return;
      }
      this.current = round;
    },
    guess (side) {
      if (this.guessed || this.gameOver || !this.current) return;
      this.guessed = true;
      this.tapped = side;
      this.lastGuessCorrect = answerFor(this.current) === side;
      if (!this.lastGuessCorrect) {
        this.recordGameRound({ streak: this.streak });
        this.gameOver = true;
        return;
      }
      this.streak += 1;
      this.recordGameWin(); // one correct guess counts — see the mixin
      if (this.streak > this.bestStreak) {
        this.$store.dispatch?.('writeDurably', { path: 'settings/games/youOrCrowdBestStreak', value: this.streak });
      }
      this.advanceTimer = setTimeout(() => this.next(), ADVANCE_MS);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

// Spacing, greys and sizes follow HigherLowerGame.vue on purpose — see the
// header comment.
.you-or-crowd-game {
  color: #eee;
  // Safety margin against BackLink, same as every game.
  padding: 1.75rem 0 2rem;
  text-align: center;
}

.setup {
  padding: 0 1.5rem;
}

.setup p {
  color: #adb5bd;
  margin: 0.75rem 0 1.5rem;
}

.cta-btn {
  margin: 0 auto;
  max-width: 320px;
  width: 100%;
}

.streak-row {
  display: flex;
  justify-content: center;
  gap: 2rem;
  margin-top: 0.75rem;
  margin-bottom: 1rem;
}

/* Always rendered so its text swaps in place without moving the poster. */
.status-line {
  color: #adb5bd;
  text-align: center;
  min-height: 2.6rem;
  margin: 0 0.5rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.yc-card {
  margin: 0 auto;
  max-width: 200px;
  position: relative;
  width: 45vw;

  img {
    border-radius: 0.35rem;
    display: block;
    width: 100%;
  }
}

// Same corner badge as Higher or Lower and Tag.
.yc-guess-badge {
  align-items: center;
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

  &.correct { background: #4caf50; }
  &.incorrect { background: #ff6a6a; }
}

.yc-sides {
  display: flex;
  gap: 0.75rem;
  margin: 0.25rem auto 0;
  max-width: 420px;
  padding: 0 1rem;
}

.yc-side {
  flex: 1 1 0;
  min-width: 0;
}

.yc-score {
  color: #adb5bd;
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0.4rem 0 0.4rem;
}

.yc-choice {
  min-height: 44px;
  // Half a phone's width each: tighter side padding keeps the labels on one
  // line, the same trade .end-actions makes.
  padding-left: 0.75rem;
  padding-right: 0.75rem;
  white-space: nowrap;
  width: 100%;

  // The button you pressed stays at full strength once both are disabled,
  // so the reveal still shows which side you picked.
  &.is-tapped:disabled { opacity: 1; }
}

.game-over {
  margin-top: 1.5rem;
  padding: 0 1.5rem;
}
</style>
