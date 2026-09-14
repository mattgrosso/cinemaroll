<template>
  <div class="reel-wordle-game">
    <BackLink/>
    <p class="game-subtitle">
      Guess the movie from your own library.
      {{ guesses.length }} guess{{ guesses.length === 1 ? '' : 'es' }}.
    </p>

    <div v-if="!target" class="not-enough-movies">
      <p>Not enough rated movies yet to build a puzzle.</p>
    </div>

    <template v-else>
      <div v-if="status === 'playing'" class="guess-form">
        <input
          v-model="guessInput"
          type="text"
          class="game-input"
          placeholder="Type a movie from your library…"
          @input="onInput"
        >
        <ul v-if="suggestions.length" class="suggestions">
          <li v-for="entry in suggestions" :key="entryKeyFor(entry)">
            <button type="button" class="suggestion-item" @click="submitGuess(entry)">
              {{ entry.movie.title }} <span class="suggestion-year">({{ suggestionYear(entry) }})</span>
            </button>
          </li>
        </ul>
      </div>

      <div v-else class="result-banner won">
        <p>You got it in {{ guesses.length }} guess{{ guesses.length === 1 ? '' : 'es' }}!</p>
        <img v-if="gamePosterUrl(target)" :src="gamePosterUrl(target, 'w342')" :alt="target.movie.title" class="reveal-poster">
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary cta-btn" @click="startNewPuzzle">New Puzzle</button>
          <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
        </div>
      </div>

      <button
        v-if="status === 'playing'"
        type="button"
        class="give-up-puzzle"
        @click="startNewPuzzle"
      >Give up on this one</button>

      <!-- Input pinned at the top (above); the guess list renders newest
           FIRST so each new guess appears right below the input and pushes
           older ones down — the "stack grows up" request. displayGuesses
           (a reversed copy) keeps the underlying guesses array itself
           append-only/chronological — only the DISPLAY order flips — so
           persistence and the status logic (which doesn't care about
           order) are untouched. -->
      <div v-if="guesses.length" class="clue-grid">
        <div v-for="clue in displayGuesses" :key="clue.entryKey" class="clue-row" :class="{ correct: clue.isCorrect }">
          <!-- Every cell shows the GUESS's own value beside its verdict —
               bug report: "actually give all the values of each of the
               guesses in line with the arrows or indicators... I should be
               able to see clearly what the values were, and then also the
               comparison to the correct values." The arrow IS the
               comparison (it points toward the target), and the winning
               row's matched cells reveal the correct values themselves.
               This replaces the old bare-arrow cells plus the year/rating
               tacked onto the title line. -->
          <p class="clue-title">{{ clue.title }}</p>
          <div class="clue-cells">
            <div class="clue-cell" :class="directionClass(clue.year)">
              <span class="clue-label">Year</span>
              <span class="clue-value">{{ valueWithArrow(clue.year) }}</span>
            </div>
            <div class="clue-cell" :class="clue.decade.match ? 'match' : 'no-match'">
              <span class="clue-label">Decade</span>
              <span class="clue-value">{{ clue.decade.value != null ? `${clue.decade.value}s ${clue.decade.match ? '✓' : '✗'}` : '—' }}</span>
            </div>
            <div class="clue-cell" :class="directionClass(clue.runtime)">
              <span class="clue-label">Runtime</span>
              <span class="clue-value">{{ valueWithArrow(clue.runtime, 'm') }}</span>
            </div>
            <div class="clue-cell" :class="directionClass(clue.yourRating)">
              <span class="clue-label">Rating</span>
              <span class="clue-value">{{ valueWithArrow(clue.yourRating, '', 2) }}</span>
            </div>
            <!-- The two TEXT cells get their own row at double width each, so
                 names and genre lists wrap instead of ellipsing — and the
                 numeric row above stays perfectly even (feedback). -->
            <div class="clue-cell text-cell" :class="clue.director.match ? 'match' : 'no-match'">
              <span class="clue-label">Director</span>
              <span class="clue-value wrap">{{ directorDisplay(clue.director) }}</span>
            </div>
            <div
              class="clue-cell text-cell"
              :class="clue.genres.allMatch ? 'match' : (clue.genres.shared.length ? 'partial' : 'no-match')"
            >
              <span class="clue-label">Genre</span>
              <!-- The (n/total) fraction is what distinguishes an exact match
                   (green) from a partial overlap (yellow). -->
              <span class="clue-value wrap">{{ genresDisplay(clue.genres) }}</span>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { entryKey, rankTitleMatches } from '../../assets/javascript/games/gameUtils.js';
import { compareGuessToTarget } from '../../assets/javascript/games/wordleClues.js';
import reelWordleBanner from '../../assets/images/games/reel-wordle-banner.jpg';

const STORAGE_KEY = 'cinemaRoll.reelWordle.current';

export default {
  name: 'ReelWordleGame',
  components: { BackLink },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "Reel Wordle / Cinema Roll Games"
  // branding baked in) in place of the usual movie-backdrop banner, and
  // hides the "Cinema Roll" title overlay so it doesn't compete with that
  // baked-in branding - same pattern as Six Degrees, see CLAUDE.md.
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', reelWordleBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      guessInput: '',
      suggestions: [],
      guesses: [],
      // No more "today's puzzle" — this is just whichever movie the current
      // round is testing you on, picked at random. Persisted (by key, not by
      // calendar day — see persistState) so a reload resumes the SAME
      // in-progress round rather than silently starting a new one.
      target: null
    };
  },
  computed: {
    status () {
      return this.guesses.some((clue) => clue.isCorrect) ? 'won' : 'playing';
    },
    // Newest-first for display only (see the template comment above the
    // clue-grid) — `guesses` itself stays append-only/chronological.
    displayGuesses () {
      return [...this.guesses].reverse();
    }
  },
  watch: {
    // status is a computed here (derived from the guess list), so there's no
    // single imperative "win moment" to hook — watch it instead. Same for
    // Connections and Six Degrees; the games that set status directly just
    // call recordGameWin() inline.
    status (newStatus) {
      if (newStatus === 'won') {
        this.recordGameWin();
        this.recordGameRound({ guesses: this.guesses.length, movie: entryKey(this.target) });
      }
    },
    // Fires once eligibleGameEntries has real data (it may be empty for a
    // tick while the library is still loading). Only initializes if nothing
    // is loaded yet — a later change to the library (e.g. rating a movie
    // mid-round) must not yank the current puzzle out from under the player.
    eligibleGameEntries: {
      immediate: true,
      handler (entries) {
        if (this.target || !entries.length) return;
        this.loadOrStartPuzzle();
      }
    }
  },
  methods: {
    entryKeyFor: entryKey,
    // Same simple release_date -> year extraction MovieDetail.vue's getYear
    // uses elsewhere in the app, for consistency.
    suggestionYear (entry) {
      const date = entry?.movie?.release_date;
      return date ? new Date(date).getFullYear() : 'Unknown';
    },
    // Shared ranking (gameUtils.rankTitleMatches): one character is enough,
    // and titles starting with what was typed come first.
    onInput () {
      const guessedKeys = new Set(this.guesses.map((clue) => clue.entryKey));
      this.suggestions = rankTitleMatches(
        this.eligibleGameEntries.filter((entry) => !guessedKeys.has(entryKey(entry))),
        this.guessInput
      );
    },
    submitGuess (entry) {
      if (this.status !== 'playing' || !this.target) return;
      const clue = compareGuessToTarget(entry, this.target, this.gameRatingFor);
      clue.entryKey = entryKey(entry);
      this.guesses.push(clue);
      this.guessInput = '';
      this.suggestions = [];
      this.persistState();
    },
    // Picks a fresh random target and resets progress — the only way to
    // move on, whether after a win or mid-round. No cooldown, no daily cap:
    // it's just Math.random() over the whole eligible library each time.
    startNewPuzzle () {
      const pool = this.eligibleGameEntries;
      if (!pool.length) return;
      const excludeKey = this.target ? entryKey(this.target) : null;
      const candidates = excludeKey ? pool.filter((entry) => entryKey(entry) !== excludeKey) : pool;
      const choices = candidates.length ? candidates : pool;
      this.target = choices[Math.floor(Math.random() * choices.length)];
      this.guesses = [];
      this.guessInput = '';
      this.suggestions = [];
      this.persistState();
    },
    persistState () {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          targetKey: entryKey(this.target),
          guessedKeys: this.guesses.map((clue) => clue.entryKey)
        }));
      } catch (error) {
        // localStorage can throw in private-browsing/quota-exceeded situations;
        // the puzzle still works for this session, it just won't persist.
        console.error('Failed to persist Reel Wordle progress:', error);
      }
    },
    // Resumes an in-progress round from localStorage if one exists and its
    // target is still in the library; otherwise starts a fresh one.
    loadOrStartPuzzle () {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          // Bug report (Six Degrees, applied here too): "you don't need to
          // save my result... the next time I return it should just be a
          // new game." A puzzle that was already solved isn't progress to
          // resume - guessedKeys containing the target's own key means one
          // of those guesses was correct. Fall through to a fresh puzzle
          // instead of restoring the finished one.
          const wasWon = (saved?.guessedKeys || []).includes(saved?.targetKey);
          const target = wasWon ? null : this.eligibleGameEntries.find((entry) => entryKey(entry) === saved?.targetKey);
          if (target) {
            this.target = target;
            this.guesses = (saved.guessedKeys || [])
              .map((key) => this.eligibleGameEntries.find((entry) => entryKey(entry) === key))
              .filter(Boolean)
              .map((entry) => {
                const clue = compareGuessToTarget(entry, target, this.gameRatingFor);
                clue.entryKey = entryKey(entry);
                return clue;
              });
            return;
          }
        }
      } catch (error) {
        console.error('Failed to load persisted Reel Wordle progress:', error);
      }
      this.startNewPuzzle();
    },
    directionClass (comparison) {
      if (!comparison.direction || comparison.direction === 'match') return 'match';
      return 'no-match';
    },
    arrowFor (comparison) {
      if (comparison.direction === 'match') return '✓';
      if (comparison.direction === 'up') return '↑';
      if (comparison.direction === 'down') return '↓';
      return '—';
    },
    // "1994 ↑", "128m ↓", "7.42 ✓" — the guess's own value plus which way
    // the target lies from it.
    valueWithArrow (comparison, suffix = '', decimals = null) {
      if (comparison.value == null) return '—';
      const value = decimals != null ? comparison.value.toFixed(decimals) : comparison.value;
      return `${value}${suffix} ${this.arrowFor(comparison)}`;
    },
    directorDisplay (director) {
      const names = director.match ? director.matchedNames : director.value;
      if (!names.length) return '—';
      return `${names.join(', ')} ${director.match ? '✓' : '✗'}`;
    },
    genresDisplay (genres) {
      if (genres.shared.length) return `${genres.shared.join(', ')} (${genres.shared.length}/${genres.total})`;
      if (!genres.value.length) return '—';
      return `${genres.value.join(', ')} ✗`;
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';
@import '@/assets/scss/game-inputs';

.reel-wordle-game {
  color: #eee;
  // See the identical comment in ConnectionsGame.vue — top padding is a
  // safety margin against BackLink overlapping this screen's own h1 when
  // the global Header happens to have zero height.
  padding: 2.5rem 1rem 2rem;
}

// No more <h1> (the banner graphic already carries the game's name) - this
// picks up the top spacing that used to come from .game-title's own margin.
.game-subtitle {
  color: #adb5bd;
  margin-top: 0.75rem;
  margin-bottom: 1rem;
}

.not-enough-movies {
  color: #adb5bd;
  text-align: center;
  margin-top: 2rem;
}

.guess-form {
  position: relative;
  margin-bottom: 1rem;
}

.suggestions {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 0.35rem;
  list-style: none;
  margin: 0.25rem 0 0;
  max-height: 220px;
  overflow-y: auto;
  padding: 0;
  position: absolute;
  width: 100%;
  z-index: 5;
}

.suggestion-item {
  background: transparent;
  border: none;
  color: #eee;
  display: block;
  padding: 0.5rem 0.75rem;
  text-align: left;
  width: 100%;
}

.suggestion-item:active {
  background: #333;
}

.suggestion-year {
  color: #adb5bd;
  font-size: 0.85em;
}

// A left accent bar on a neutral dark background instead of a uniformly-
// tinted box — reads as a purpose-built callout rather than a generic
// (Bootstrap-alert-shaped) colored rectangle. Same treatment as
// ConnectionsGame.vue's .result-banner.
.result-banner {
  background: #1a1a1a;
  border-left: 4px solid #4caf50;
  border-radius: 0.4rem;
  margin-bottom: 1rem;
  padding: 1rem;
  text-align: center;
}

.reveal-poster {
  border-radius: 0.35rem;
  max-width: 160px;
  margin-top: 0.5rem;
  width: 100%;
}


/* Deliberately understated and at the BOTTOM of the page. Bug report: "The
   new puzzle button in the Wordle game is too prominent. Once you started the
   game and I accidentally pressed it a couple of times." It used to be a
   full-width button at the very top, directly above the input — easy to hit by
   mistake, and hitting it silently throws the round away. The prominent
   "New Puzzle" now only appears once you've actually won. */
.give-up-puzzle {
  background: none;
  border: none;
  color: #777;
  display: block;
  font-size: 0.78rem;
  margin: 2rem auto 0;
  padding: 0.4rem 0.8rem;
  text-decoration: underline;

  &:active {
    opacity: 0.6;
  }
}

/* Two-tier grid per guess (feedback: director names ellipsed constantly
   and multi-genre lists broke the even layout). The four NUMERIC cells
   share a uniform 4-up row — their values are short and fixed-format, so
   the row is always even. The two TEXT cells (Director, Genre) sit below
   at double width each with wrapping allowed: likes sit with likes, so
   nothing truncates and nothing looks ragged. */
.clue-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.clue-row {
  background: #1a1a1a;
  border-radius: 0.35rem;
  padding: 0.5rem 0.4rem;
  text-align: left;
}

.clue-row.correct {
  outline: 2px solid #4caf50;
}

.clue-title {
  font-weight: 600;
  margin: 0 0 0.35rem;
  padding: 0 0.2rem;
}

.clue-cells {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.3rem 0.2rem;
}

.clue-cell.text-cell {
  grid-column: span 2;
}

.clue-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-width: 0;
  text-align: center;
}

.clue-label {
  color: #888;
  font-size: 0.55rem;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
}

.clue-value {
  font-size: 0.68rem;
  font-weight: 600;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Bug report: "when I get more than one genre I can't see most of the
   second word" - every other cell is a short, fixed-format value (a year,
   "1990s", an arrow), so the single-line truncation above never actually
   clips anything real. Genre is the one value that can genuinely run long
   (2+ shared genre names + a fraction) - let it wrap onto a second line
   instead of hiding real signal. .clue-cell's justify-content:center keeps
   the other 5 (unwrapped) cells in the same row visually centered once
   this one grows taller. */
.clue-value.wrap {
  overflow-wrap: break-word;
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
}

.match {
  color: #4caf50;
}

.partial {
  color: #ffc107;
}

.no-match {
  color: #ff6a6a;
}
</style>
