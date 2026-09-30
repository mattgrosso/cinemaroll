<template>
  <div class="you-or-crowd-game">
    <BackLink/>
    <div v-if="!current" class="setup">
      <p>One film from your library at a time. Did you score it higher than the Letterboxd crowd did, or did they?</p>
      <p class="setup-note">Your score in stars, the way the star view shows it, against the crowd's average star rating.</p>
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
        <p class="yc-title">{{ current.entry.movie.title }}<span v-if="releaseYear"> ({{ releaseYear }})</span></p>
      </div>

      <div class="yc-choices">
        <button type="button" class="btn-game yc-choice" :class="choiceClass('you')" :disabled="guessed || gameOver" @click="guess('you')">
          <span class="yc-choice-label">I scored it higher</span>
          <span v-if="guessed" class="yc-choice-detail">You {{ starLabel(current.mine, 1) }}</span>
        </button>
        <button type="button" class="btn-game yc-choice" :class="choiceClass('crowd')" :disabled="guessed || gameOver" @click="guess('crowd')">
          <span class="yc-choice-label">The crowd did</span>
          <span v-if="guessed" class="yc-choice-detail">Crowd {{ starLabel(current.crowd, 2) }}</span>
        </button>
      </div>

      <div v-if="gameOver" class="end-actions">
        <button type="button" class="btn-game btn-game-primary cta-btn" @click="start">Play Again</button>
        <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
      </div>
      <button v-else-if="guessed" type="button" class="btn-game btn-game-primary cta-btn next-btn" @click="next">Next film</button>
    </template>
  </div>
</template>

<script>
// You or the Crowd? — a streak game on the Letterboxd data (2026-09-29).
// Rules in games/youOrCrowd.js; the crowd's ratings come from the shared
// letterboxdFilms cache (store: ensureLetterboxdData), so the Start button
// waits until a balanced run of at least ten films can be dealt.
import BackLink from './BackLink.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { shuffle } from '../../assets/javascript/games/gameUtils.js';
import { youOrCrowdRounds, answerFor, balancedDeck, starLabel } from '../../assets/javascript/games/youOrCrowd.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import banner from '../../assets/images/games/you-or-crowd-banner.svg';

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
    releaseYear () {
      const year = parseInt(String(this.current?.entry?.movie?.release_date || '').slice(0, 4), 10);
      return Number.isFinite(year) ? year : null;
    },
    statusMessage () {
      if (this.gameOver && !this.queue.length && this.lastGuessCorrect) return "You've been through every film with an answer. Restart to shuffle a new run.";
      if (!this.guessed) return 'Who scored this one higher?';
      if (this.lastGuessCorrect) return answerFor(this.current) === 'you' ? 'Right — you score it higher than the crowd does.' : 'Right — the crowd scores it higher than you do.';
      return `Streak over at ${this.streak}. ${answerFor(this.current) === 'you' ? 'You score it higher.' : 'The crowd scores it higher.'}`;
    }
  },
  methods: {
    starLabel,
    start () {
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
    },
    choiceClass (side) {
      if (!this.guessed) return '';
      const answer = answerFor(this.current);
      if (side === answer) return 'is-answer';
      return this.tapped === side ? 'is-wrong' : '';
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.you-or-crowd-game {
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 3rem 1rem 2rem;
  text-align: center;
}

.setup {
  max-width: 30rem;

  p { color: #fff; }
}

.setup-note {
  color: #ccc;
  font-size: 0.85rem;
}

.cta-btn {
  margin-top: 0.75rem;
}

.streak-row {
  display: flex;
  gap: 1.5rem;
  justify-content: center;
  margin-bottom: 0.5rem;
}

.status-line {
  color: #ccc;
  min-height: 1.5rem;
  margin: 0 0 0.75rem;
}

.yc-card {
  width: 55vw;
  max-width: 260px;

  img {
    border-radius: 0.35rem;
    display: block;
    width: 100%;
  }
}

.yc-title {
  color: #fff;
  font-weight: 700;
  margin: 0.5rem 0 0.75rem;
}

.yc-choices {
  display: flex;
  gap: 0.6rem;
  width: 100%;
  max-width: 30rem;
}

.yc-choice {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.7rem 0.5rem;
  min-width: 0;

  &:disabled { opacity: 1; }
  &.is-answer { border-color: #00e054; box-shadow: inset 0 0 0 2px #00e054; }
  &.is-wrong { border-color: #dc3545; box-shadow: inset 0 0 0 2px #dc3545; }
}

.yc-choice-label {
  font-weight: 700;
}

.yc-choice-detail {
  color: #ccc;
  font-size: 0.75rem;
}

.next-btn {
  margin-top: 1rem;
}

.end-actions {
  margin-top: 1rem;
}
</style>
