<template>
  <div class="trivia-game">
    <BackLink/>

    <div v-if="eligibleGameEntries.length < 5" class="not-enough-movies">
      <p>Rate a few more movies before there's enough to quiz you on.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <template v-else>
      <p class="game-subtitle">Real trivia, hardest fact first. You get ONE guess — reveal as many facts as you need before you take it.</p>

      <div class="score-row">
        <span>Facts used: <strong>{{ revealedCount }}</strong></span>
        <span>Best: <strong>{{ bestFactsUsed != null ? bestFactsUsed : '—' }}</strong></span>
      </div>

      <p v-if="loading" class="status-line">Digging up trivia&hellip;</p>

      <div v-else-if="loadError" class="load-error">
        <p>Couldn't load trivia for this movie right now.</p>
        <div class="error-actions">
          <button type="button" class="btn-game btn-game-secondary btn-game-sm" @click="fetchFacts(target)">Try Again</button>
          <button type="button" class="btn-game btn-game-secondary btn-game-sm" @click="startNewRound">New Movie</button>
        </div>
      </div>

      <template v-else>
        <ul class="fact-list">
          <li
            v-for="(fact, index) in visibleFacts"
            :key="index"
            class="fact-row"
            :class="{ current: index === visibleFacts.length - 1 && status === 'playing' }"
          >
            <span class="fact-number">{{ index + 1 }}</span>
            <span class="fact-text">{{ fact }}</span>
          </li>
        </ul>

        <div v-if="status === 'playing'" class="guess-form">
          <input
            v-model="guessInput"
            type="text"
            class="game-input"
            placeholder="Guess the movie…"
            @input="onInput"
          >
          <ul v-if="suggestions.length" class="suggestions">
            <li v-for="entry in suggestions" :key="entryKeyFor(entry)">
              <button type="button" class="suggestion-item" @click="submitGuess(entry)">
                {{ entry.movie.title }} <span class="suggestion-year">({{ suggestionYear(entry) }})</span>
              </button>
            </li>
          </ul>

          <div class="playing-actions">
            <button
              type="button"
              class="btn-game btn-game-secondary btn-game-sm"
              :disabled="revealedCount >= facts.length"
              @click="revealNextFact"
            >
              Next Clue
            </button>
            <button type="button" class="btn-game btn-game-secondary btn-game-sm" @click="giveUp">Reveal Answer</button>
          </div>
        </div>

        <div v-else class="result-banner" :class="status">
          <p v-if="status === 'won'">Got it — <strong>{{ target.movie.title }}</strong>! Solved in {{ revealedCount }} fact{{ revealedCount === 1 ? '' : 's' }}.</p>
          <p v-else-if="status === 'lost'">Not quite — it was <strong>{{ target.movie.title }}</strong>.</p>
          <p v-else>It was <strong>{{ target.movie.title }}</strong>.</p>
          <button v-if="gamePosterUrl(target)" type="button" class="reveal-poster-btn" @click="goToMovie(target)">
            <img :src="gamePosterUrl(target, 'w342')" :alt="target.movie.title" class="reveal-poster">
          </button>
          <div class="end-actions">
            <button type="button" class="btn-game btn-game-primary btn-game-sm" @click="startNewRound">New Round</button>
            <button type="button" class="btn-game btn-game-secondary btn-game-sm" @click="$router.push('/games')">Back to Games</button>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { postToAi } from '../../utils/aiRequest.js';
import { entryKey, rankTitleMatches } from '../../assets/javascript/games/gameUtils.js';
import { pickTriviaTarget, clampRevealedCount, isNewBestScore } from '../../assets/javascript/games/trivia.js';
import triviaBanner from '../../assets/images/games/trivia-banner.jpg';

// Bug report: "started the trivia game and then went to the home screen
// and then came back it reset" - Trivia never persisted progress at all
// (unlike Reel Wordle/Six Degrees/Connections/Timeline, which all follow
// this same localStorage pattern), so leaving and returning always looked
// like a full reset because it WAS one - a brand new round every time.
const STORAGE_KEY = 'cinemaRoll.trivia.current';

export default {
  name: 'TriviaGame',
  components: { BackLink, NewRatingSearch },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "Trivia / Cinema Roll Games"
  // branding baked in) in place of the usual movie-backdrop banner, and
  // hides the "Cinema Roll" title overlay so it doesn't compete with that
  // baked-in branding — same pattern as every other game, see CLAUDE.md.
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', triviaBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      target: null,
      facts: [],
      revealedCount: 1,
      status: 'playing',
      loading: false,
      loadError: false,
      guessInput: '',
      suggestions: []
    };
  },
  computed: {
    bestFactsUsed () {
      return this.$store.state.settings?.games?.triviaBestFactsUsed ?? null;
    },
    visibleFacts () {
      return this.facts.slice(0, this.revealedCount);
    }
  },
  // Same "wait for real data, only act if nothing's loaded yet" pattern as
  // Reel Wordle/Six Degrees/Clue Budget — the library may still be loading
  // when this component mounts.
  watch: {
    eligibleGameEntries: {
      immediate: true,
      handler (entries) {
        if (this.target || !entries.length) return;
        this.loadOrStart();
      }
    }
  },
  methods: {
    entryKeyFor: entryKey,
    // Bug report: "when you get the answer... you should be able to click
    // on the poster and go to facts about the movie" - same navigation
    // Six Degrees' chain-step tap already uses.
    goToMovie (entry) {
      // == null, not a bare falsy check - a real TMDB id is never 0, but
      // this guarded against it as if it were, same class of bug documented
      // elsewhere in this codebase (backfillBoxOffice's !movie.id typo).
      if (entry?.movie?.id == null) return;
      this.$router.push(`/movie/${entry.movie.id}`);
    },
    suggestionYear (entry) {
      const date = entry?.movie?.release_date;
      return date ? new Date(date).getFullYear() : 'Unknown';
    },
    // Shared ranking (gameUtils.rankTitleMatches): one character is enough,
    // and titles starting with what was typed come first.
    onInput () {
      this.suggestions = rankTitleMatches(this.eligibleGameEntries, this.guessInput);
    },
    // A guess is always picked from the player's own library (via the
    // suggestions dropdown, never free text), so it's always a real movie
    // — comparing identity is simpler and more reliable than fuzzy title
    // matching (handles remakes/shared titles for free too).
    //
    // Bug report: "it will be more fun if you only get one guess... that
    // way you can't guess every movie I've ever rated." The ORIGINAL design
    // let a wrong guess just cost a clue (unlimited guesses), which meant a
    // sufficiently patient/impatient player could brute-force through the
    // whole suggestions list without ever really using the trivia. Guessing
    // is now one-shot: "Next Clue" is still free and unlimited for BROWSING
    // (no penalty, no guess consumed), but submitGuess() itself always ends
    // the round, win or lose.
    submitGuess (entry) {
      if (this.status !== 'playing' || !this.target) return;
      this.guessInput = '';
      this.suggestions = [];
      if (entryKey(entry) === entryKey(this.target)) {
        this.win();
      } else {
        this.lose();
      }
    },
    revealNextFact () {
      if (this.status !== 'playing') return;
      this.revealedCount = clampRevealedCount(this.revealedCount + 1, this.facts.length);
      this.persistState();
    },
    // Always available while playing — ends the round without a score,
    // same "give up" convention as Clue Budget's Reveal Poster / Six
    // Degrees' Give Up. Distinct from lose() (a wrong GUESS) purely for
    // messaging — "It was X" vs "Not quite — it was X" — both are terminal,
    // non-winning, no-score outcomes.
    giveUp () {
      if (this.status !== 'playing') return;
      this.revealedCount = this.facts.length;
      this.status = 'revealed';
      this.persistState(); // status !== 'playing' now, so this clears the save
    },
    // The single wrong guess that ends the round — see submitGuess's own
    // comment for why guessing is one-shot now.
    lose () {
      this.revealedCount = this.facts.length;
      this.recordGameRound({ won: false, facts: this.revealedCount, movie: entryKey(this.target) });
      this.status = 'lost';
      this.persistState(); // status !== 'playing' now, so this clears the save
    },
    win () {
      this.status = 'won';
      this.recordGameWin();
      this.recordGameRound({ won: true, facts: this.revealedCount, movie: entryKey(this.target) });
      if (isNewBestScore(this.revealedCount, this.bestFactsUsed)) {
        this.$store.dispatch('writeDurably', { path: 'settings/games/triviaBestFactsUsed', value: this.revealedCount });
      }
      this.persistState(); // status !== 'playing' now, so this clears the save
    },
    startNewRound () {
      const pool = this.eligibleGameEntries;
      if (!pool.length) return;
      const excludeKey = this.target ? entryKey(this.target) : null;
      const nextTarget = pickTriviaTarget(pool, excludeKey, Math.random);
      this.target = nextTarget;
      this.facts = [];
      this.revealedCount = 1;
      this.status = 'playing';
      this.loadError = false;
      this.guessInput = '';
      this.suggestions = [];
      this.persistState(); // no facts loaded yet - clears whatever was previously saved
      this.fetchFacts(nextTarget);
    },
    // Progress is only meaningful to resume once real facts exist for the
    // CURRENT target - a round with nothing revealed yet, or one that's
    // already finished (won/revealed), is cleared instead of saved. Single
    // gate for every call site rather than special-casing win()/giveUp()
    // separately.
    persistState () {
      try {
        if (this.status !== 'playing' || !this.target || !this.facts.length) {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          targetKey: entryKey(this.target),
          facts: this.facts,
          revealedCount: this.revealedCount
        }));
      } catch (error) {
        // localStorage can throw in private-browsing/quota-exceeded situations;
        // the round still works for this session, it just won't persist.
        console.error('Failed to persist Trivia progress:', error);
      }
    },
    // Resumes an in-progress round from localStorage if one exists, its
    // target movie is still in the library, and it actually has facts to
    // show (the facts themselves are saved, not re-fetched — Claude's
    // output isn't deterministic, so re-fetching could hand back different
    // facts than the ones already seen). Falls back to a fresh round
    // otherwise, same "movie no longer eligible" convention every other
    // persisted game already follows.
    loadOrStart () {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const target = this.eligibleGameEntries.find((entry) => entryKey(entry) === saved?.targetKey);
          if (target && Array.isArray(saved.facts) && saved.facts.length) {
            this.target = target;
            this.facts = saved.facts;
            this.revealedCount = clampRevealedCount(saved.revealedCount || 1, saved.facts.length);
            this.status = 'playing';
            this.loading = false;
            this.loadError = false;
            return;
          }
        }
      } catch (error) {
        console.error('Failed to load persisted Trivia progress:', error);
      }
      this.startNewRound();
    },
    // Claude-backed AI lambda (see aws-lambda/claude-ai.js's /trivia route)
    // — real, hardest-to-easiest trivia about the movie, not just TMDB
    // fields (the same distinction Clue Budget's clues deliberately DON'T
    // make — this game exists specifically because that request wanted
    // "more trivia-like questions" than structured data can provide).
    async fetchFacts (roundTarget) {
      const title = roundTarget?.movie?.title;
      if (!title) return;
      // Compare by identity KEY, not object reference — Vue wraps this.target
      // in a reactive proxy on read, so `this.target !== roundTarget` (the raw
      // object captured before assignment) never matches, permanently
      // stalling this fetch. Same class of bug as ClueBudgetGame.vue's three
      // near-identical staleness guards, discovered here via a real test.
      const roundKey = entryKey(roundTarget);
      this.loading = true;
      this.loadError = false;
      try {
        const year = roundTarget.movie.release_date ? new Date(roundTarget.movie.release_date).getFullYear() : '';
        const response = await postToAi('/trivia', { title, year });
        if (entryKey(this.target) !== roundKey) return; // a newer round has since started
        const facts = Array.isArray(response?.data?.facts) ? response.data.facts.filter((fact) => typeof fact === 'string' && fact.trim()) : [];
        if (!facts.length) {
          this.loadError = true;
        } else {
          this.facts = facts;
          this.revealedCount = clampRevealedCount(this.revealedCount, facts.length);
          this.persistState();
        }
      } catch {
        if (entryKey(this.target) !== roundKey) return;
        this.loadError = true;
      } finally {
        if (entryKey(this.target) === roundKey) this.loading = false;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';
@import '@/assets/scss/game-inputs';

.trivia-game {
  color: #eee;
  // Safety margin against BackLink overlapping this screen's own content
  // when the global Header happens to have zero height — same fix as
  // every other game component.
  padding: 1.75rem 1rem 2rem;
}

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

.score-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.score-row strong {
  color: #4caf50;
}

/* Always rendered so its text can swap in place without adding/removing an
   element — same anti-layout-jump convention used across every game. */
.status-line {
  color: #adb5bd;
  text-align: center;
  margin: 1.5rem 0;
}

.load-error {
  color: #adb5bd;
  text-align: center;
  margin: 1.5rem 0;
}

.error-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-top: 0.75rem;
}

.fact-list {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
}

.fact-row {
  align-items: flex-start;
  background: #1a1a1a;
  border-left: 4px solid #333;
  border-radius: 0.4rem;
  display: flex;
  gap: 0.6rem;
  margin-bottom: 0.5rem;
  padding: 0.65rem 0.8rem;
}

.fact-row.current {
  border-left-color: #ffc107;
}

.fact-number {
  color: #777;
  flex-shrink: 0;
  font-weight: 700;
}

.fact-row.current .fact-number {
  color: #ffc107;
}

.fact-text {
  color: #eee;
  font-size: 0.95rem;
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

.playing-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.playing-actions .btn-game {
  flex: 1;
}

// Left-accent-bar callout, same treatment as Clue Budget/Reel
// Wordle/Connections' result banners — a purpose-built look rather than a
// generic colored box.
.result-banner {
  background: #1a1a1a;
  border-left: 4px solid #4caf50;
  border-radius: 0.4rem;
  margin-bottom: 1rem;
  padding: 1rem;
  text-align: center;
}

.result-banner.revealed,
.result-banner.lost {
  border-left-color: #ff6a6a;
}

.reveal-poster-btn {
  background: none;
  border: none;
  cursor: pointer;
  display: block;
  margin: 0.5rem auto;
  max-width: 160px;
  padding: 0;
  width: 100%;
}

/* Mobile-first: :active only, no :hover (this app has no reliable pointer
   device — see CLAUDE.md). */
.reveal-poster-btn:active .reveal-poster {
  opacity: 0.8;
  transform: scale(0.97);
}

.reveal-poster {
  border-radius: 0.35rem;
  display: block;
  width: 100%;
}
</style>
