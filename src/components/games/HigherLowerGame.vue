<template>
  <div class="higher-lower-game">
    <BackLink/>

    <div v-if="!leftCard" class="setup">
      <p>See a movie's real Cinema Roll score, then guess whether the next one scored higher or lower.</p>
      <button type="button" class="btn-game btn-game-primary cta-btn" @click="start('score')">Start with my scores</button>
      <!-- The same game on the Letterboxd crowd's ratings (2026-09-29) — your
           library's films, their weighted averages. Needs the shared cache
           the sweep fills; until it holds enough of your films the button
           says so instead of starting a two-card game. -->
      <p class="setup-alt">Or guess how the Letterboxd crowd rated them.</p>
      <button type="button" class="btn-game cta-btn" :disabled="letterboxdPool.length < 10" @click="start('letterboxd')">
        {{ letterboxdPool.length < 10 ? 'Letterboxd ratings still loading' : 'Start with Letterboxd ratings' }}
      </button>
    </div>

    <template v-else>
      <div class="streak-row">
        <span>Streak: <strong>{{ streak }}</strong></span>
        <span>Best: <strong>{{ bestStreak }}</strong></span>
      </div>

      <p class="status-line">{{ statusMessage }}</p>

      <div class="cards-row">
        <div
          class="hl-card"
          :class="{ tappable: !guessed && !gameOver }"
          @click="guess('left')"
        >
          <div class="hl-card-poster">
            <img v-if="gamePosterUrl(leftCard)" :src="gamePosterUrl(leftCard, 'w342')" :alt="leftCard.movie.title">
            <div v-if="guessed && tappedSide === 'left'" class="hl-guess-badge" :class="resultClass">
              <i :class="lastGuessCorrect ? 'bi bi-check-lg' : 'bi bi-x-lg'"></i>
            </div>
          </div>
          <p class="hl-card-score">{{ scoreDisplay('left') }}</p>
        </div>

        <div
          class="hl-card"
          :class="{ tappable: !guessed && !gameOver }"
          @click="guess('right')"
        >
          <div class="hl-card-poster">
            <img v-if="gamePosterUrl(rightCard)" :src="gamePosterUrl(rightCard, 'w342')" :alt="rightCard.movie.title">
            <div v-if="guessed && tappedSide === 'right'" class="hl-guess-badge" :class="resultClass">
              <i :class="lastGuessCorrect ? 'bi bi-check-lg' : 'bi bi-x-lg'"></i>
            </div>
          </div>
          <p class="hl-card-score">{{ scoreDisplay('right') }}</p>
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
import BackLink from './BackLink.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { shuffle, entryKey, ratingFor } from '../../assets/javascript/games/gameUtils.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { crowdRating } from '../../assets/javascript/letterboxdCompare.js';
import higherLowerBanner from '../../assets/images/games/higher-lower-banner.jpg';

export default {
  name: 'HigherLowerGame',
  components: { BackLink },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "Higher or Lower / Cinema Roll
  // Games" branding baked in) in place of the usual movie-backdrop banner,
  // and hides the "Cinema Roll" title overlay so it doesn't compete with
  // that baked-in branding - same pattern as Six Degrees, see CLAUDE.md.
  created () {
    this.$store.dispatch?.('ensureLetterboxdData');
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', higherLowerBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      pool: [],
      poolIndex: 0,
      // Two fixed screen slots, left/right, each independently holding
      // whatever card currently lives there. Per bug report (and its
      // immediate self-correction): a card must never visually "jump" from
      // one slot to the other — whichever slot a card occupies, it keeps
      // occupying that SAME slot for as long as it keeps winning; only the
      // slot that just lost its relevance gets replaced with a fresh
      // challenger. revealedSide tracks which slot currently shows a real
      // (already-confirmed) score; the other is the mystery/tap-to-guess one.
      leftCard: null,
      rightCard: null,
      revealedSide: 'left',
      streak: 0,
      guessed: false,
      lastGuessCorrect: null,
      // Which poster was actually TAPPED to submit the current guess — bug
      // report: "if I tapped on the correct one, I should get a checkmark,
      // and if I tapped on the wrong one, I get an X" — feedback belongs on
      // the poster the player touched, not tied to which side happens to be
      // the mystery/revealed one.
      tappedSide: null,
      gameOver: false,
      ranOutOfMovies: false,
      // 'score' (Cinema Roll) or 'letterboxd' (the crowd's rating).
      mode: 'score'
    };
  },
  computed: {
    bestStreak () {
      const key = this.mode === 'letterboxd' ? 'higherLowerLetterboxdBestStreak' : 'higherLowerBestStreak';
      return this.$store.state.settings?.games?.[key] || 0;
    },
    letterboxdFilms () {
      return this.$store.state?.letterboxdFilms || null;
    },
    letterboxdPool () {
      if (!this.letterboxdFilms) return [];
      return this.eligibleGameEntries.filter((entry) => crowdRating(this.letterboxdFilms, entry?.movie?.id) !== null);
    },
    mysterySide () {
      return this.revealedSide === 'left' ? 'right' : 'left';
    },
    revealedCard () {
      return this.revealedSide === 'left' ? this.leftCard : this.rightCard;
    },
    mysteryCard () {
      return this.mysterySide === 'left' ? this.leftCard : this.rightCard;
    },
    resultClass () {
      if (!this.guessed) return '';
      return this.lastGuessCorrect ? 'correct' : 'incorrect';
    },
    // A single always-rendered status line (see .status-line) instead of
    // separately mounting/unmounting a prompt above the cards and a result
    // message below them — that add/remove was the reported "jump" every
    // time you tapped a poster. Swapping this one line's text in place keeps
    // the cards themselves stationary.
    statusMessage () {
      if (this.ranOutOfMovies) return "You've compared your whole library! Restart to shuffle a new run.";
      if (!this.guessed) return this.mode === 'letterboxd' ? 'Tap the poster you think the crowd rated higher.' : 'Tap the poster you think scored higher.';
      if (this.lastGuessCorrect) return "Correct — that one's now the card to beat.";
      return `Streak over at ${this.streak}. Correct score was ${this.formattedRating(this.mysteryCard)}.`;
    }
  },
  methods: {
    formattedRating (entry) {
      // GetRating.js's calculatedTotal carries 2 decimal places (see
      // GetRating.js's toFixed(2)) — showing only 1 hid the difference
      // between genuinely-tied and merely-close scores.
      const value = this.gameRatingFor(entry);
      if (!Number.isFinite(value)) return '—';
      return this.mode === 'letterboxd' ? `★ ${value.toFixed(2)}` : value.toFixed(2);
    },
    // Overrides the mixin's: in Letterboxd mode the number on the card is
    // the crowd's rating, not mine.
    gameRatingFor (entry) {
      if (this.mode === 'letterboxd') return crowdRating(this.letterboxdFilms, entry?.movie?.id) ?? 0;
      return ratingFor(entry, getRating);
    },
    cardFor (side) {
      return side === 'left' ? this.leftCard : this.rightCard;
    },
    // Score text/color for a given slot — the revealed side always shows its
    // real score; the mystery side shows '?' until guessed, then reveals
    // with correct/incorrect coloring.
    scoreDisplay (side) {
      if (side !== this.mysterySide || this.guessed) return this.formattedRating(this.cardFor(side));
      return '?';
    },
    start (mode = 'score') {
      this.mode = mode;
      this.pool = shuffle(mode === 'letterboxd' ? this.letterboxdPool : this.eligibleGameEntries, Math.random);
      this.poolIndex = 2;
      this.leftCard = this.pool[0];
      this.rightCard = this.pool[1];
      this.revealedSide = 'left';
      this.streak = 0;
      this.guessed = false;
      this.tappedSide = null;
      this.gameOver = false;
      this.ranOutOfMovies = false;
    },
    nextChallenger (excludeKey) {
      while (this.poolIndex < this.pool.length) {
        const candidate = this.pool[this.poolIndex];
        this.poolIndex += 1;
        if (entryKey(candidate) !== excludeKey) return candidate;
      }
      return null;
    },
    // tappedSide is 'left' or 'right' — whichever poster was actually
    // tapped. Tapping the mystery card means "I think this one's higher";
    // tapping the already-revealed card means "I think the mystery one's
    // lower" — same tap semantics as before, just resolved against whichever
    // side is currently the mystery one instead of a fixed position.
    guess (tappedSide) {
      if (this.guessed || this.gameOver) return;

      const guessHigher = tappedSide === this.mysterySide;
      const revealedRating = this.gameRatingFor(this.revealedCard);
      const mysteryRating = this.gameRatingFor(this.mysteryCard);
      const isTie = mysteryRating === revealedRating;
      const isCorrect = isTie || (guessHigher ? mysteryRating > revealedRating : mysteryRating < revealedRating);

      this.guessed = true;
      this.tappedSide = tappedSide;
      this.lastGuessCorrect = isCorrect;

      if (!isCorrect) {
        this.recordGameRound({ streak: this.streak });
        this.gameOver = true;
        return;
      }

      this.streak += 1;
      this.recordGameWin(); // one correct guess counts — see the mixin
      if (this.streak > this.bestStreak) {
        const key = this.mode === 'letterboxd' ? 'higherLowerLetterboxdBestStreak' : 'higherLowerBestStreak';
        this.$store.dispatch('writeDurably', { path: `settings/games/${key}`, value: this.streak });
      }

      // The mystery card just proved itself and becomes the new reference
      // for next round — but it stays in its OWN slot (no cross-slot copy).
      // The OLD revealed slot is what gets replaced with a fresh challenger.
      const sideToReplace = this.revealedSide;
      const winnerKey = entryKey(this.mysteryCard);
      const newRevealedSide = this.mysterySide;

      setTimeout(() => {
        const next = this.nextChallenger(winnerKey);
        if (!next) {
          this.ranOutOfMovies = true;
          this.gameOver = true;
          return;
        }
        if (sideToReplace === 'left') {
          this.leftCard = next;
        } else {
          this.rightCard = next;
        }
        this.revealedSide = newRevealedSide;
        this.guessed = false;
        this.tappedSide = null;
      }, 900);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.setup-alt {
  color: #ccc;
  font-size: 0.85rem;
  margin: 1rem 0 0.25rem;
}

.higher-lower-game {
  color: #eee;
  // Top padding is a safety margin against BackLink overlapping this
  // screen's own content when the global Header happens to have zero
  // height (see the identical comment in ConnectionsGame.vue) — trimmed
  // from 2.5rem per bug report ("we don't really need all that space
  // above"), same tradeoff Six Degrees/Timeline already made.
  padding: 1.75rem 0 2rem;
  text-align: center;
}

.setup {
  padding: 0 1.5rem;
}

// No more <h1> (the banner graphic already carries the game's name) - this
// picks up the top spacing that used to come from .game-title's own margin.
.setup p {
  color: #adb5bd;
  margin: 0.75rem 0 1.5rem;
}

// Per follow-up bug report ("more of the buttons go full width") — capped
// at a sane max so it doesn't stretch edge-to-edge on a wide viewport.
.cta-btn {
  margin: 0 auto;
  max-width: 320px;
  width: 100%;
}

.streak-row {
  display: flex;
  justify-content: center;
  gap: 2rem;
  // No more <h1> above - same top-spacing reasoning as .setup p.
  margin-top: 0.75rem;
  margin-bottom: 1rem;
}

.cards-row {
  display: flex;
  gap: 1rem;
  justify-content: center;
  flex-wrap: wrap;
  padding: 0 0.5rem;
}

.hl-card {
  width: 45vw;
  max-width: 220px;
}

.hl-card-poster {
  position: relative;
}

.hl-card img {
  border-radius: 0.35rem;
  width: 100%;
  display: block;
}

// Bug report: "we don't need to have labels underneath the posters the
// posters already have the title of the movie... we don't need the
// labels" — .hl-card-title (a redundant duplicate of the poster's own
// title) is gone; the score's own top margin picks up the spacing that
// used to come from the title sitting above it. It no longer carries any
// correct/incorrect color either — that feedback moved to the checkmark/X
// badge below (bug report: "the new score comes in as Green, but it's a
// little bit confusing... if I tapped on the correct one I should get a
// checkmark, and if I tapped on the wrong one, an X").
.hl-card-score {
  color: #adb5bd;
  font-size: 1.4rem;
  font-weight: 700;
  margin: 0.4rem 0 0;
}

// Shown only on the poster the player actually TAPPED, once a guess has
// been made — same corner-badge convention as TweakInline's
// .selected-checkmark, extended here with a red "X" variant for a wrong
// guess (TweakInline only ever needed the one "you picked this" state).
.hl-guess-badge {
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
}

.hl-guess-badge.correct {
  background: #4caf50;
}

.hl-guess-badge.incorrect {
  background: #ff6a6a;
}

/* Always rendered (see statusMessage) so its text can swap in place without
   adding/removing an element — that reflow was the reported jump. min-height
   covers the longest message (2 lines on a narrow phone) so even that swap
   doesn't shift the cards below it. */
.status-line {
  color: #adb5bd;
  text-align: center;
  min-height: 2.6rem;
  margin: 0 0.5rem 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Tap-the-poster affordance, mobile-first: an :active press state only —
   no :hover, which is what left the previous button-based UI visibly
   "stuck" highlighted after a tap on iOS (no real mouse to leave). */
.hl-card.tappable {
  cursor: pointer;
  border-radius: 0.35rem;
  transition: transform 0.15s ease;
}

.hl-card.tappable:active {
  transform: scale(0.97);
  opacity: 0.85;
}

.game-over {
  margin-top: 1.5rem;
  padding: 0 1.5rem;
}
</style>
