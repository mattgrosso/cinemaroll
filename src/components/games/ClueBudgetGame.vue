<template>
  <div class="clue-budget-game">
    <BackLink/>

    <div v-if="eligibleGameEntries.length < 5" class="not-enough-movies">
      <p>Rate a few more movies before there's enough to quiz you on.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <template v-else>
      <!-- Deliberately short: the budget row directly below already shows the
           amount, and at phone width a longer line wrapped to three. -->
      <p class="game-subtitle">Buy clues, then name the movie.</p>

      <div class="budget-row">
        <span>Budget: <strong :class="{ low: budget <= 20 }">${{ budget }}</strong></span>
        <span>Best: <strong>{{ bestSavings != null ? `$${bestSavings} saved` : '—' }}</strong></span>
      </div>

      <div v-if="status === 'playing'" class="guess-form">
        <input
          v-model="guessInput"
          type="text"
          class="game-input"
          placeholder="Guess the movie (wrong = −$10)…"
          @input="onInput"
        >
        <ul v-if="suggestions.length" class="suggestions">
          <li v-for="entry in suggestions" :key="entryKeyFor(entry)">
            <button type="button" class="suggestion-item" @click="submitGuess(entry)">
              {{ entry.movie.title }} <span class="suggestion-year">({{ suggestionYear(entry) }})</span>
            </button>
          </li>
        </ul>

        <!-- Always rendered (visibility, not v-if) so the message appearing
             can never reflow the clue shop below it — same anti-layout-jump
             convention Connections' guess feedback already uses. -->
        <p class="guess-feedback" :class="{ visible: lastGuessFeedback }">{{ lastGuessFeedback || '&nbsp;' }}</p>
      </div>

      <div v-else class="result-banner" :class="status">
        <p v-if="status === 'won'">Got it — <strong>{{ target.movie.title }}</strong>! ${{ budget }} left over.</p>
        <p v-else>Out of budget — it was <strong>{{ target.movie.title }}</strong>.</p>
        <img v-if="gamePosterUrl(target)" :src="gamePosterUrl(target, 'w342')" :alt="target.movie.title" class="reveal-poster">
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary btn-game-sm" @click="startNewRound">New Round</button>
          <button type="button" class="btn-game btn-game-secondary btn-game-sm" @click="$router.push('/games')">Back to Games</button>
        </div>
      </div>

      <!-- Bug report: "as the clues are revealed we should have a nicer
           place to put them." Cards echoing the shop chips below (label on
           top, value beneath), rather than the old bulleted list — a bought
           clue reads as the chip it was, flipped over. -->
      <ul v-if="purchasedClues.length" class="purchased-clues">
        <li v-for="clue in purchasedClues" :key="clue.key" class="purchased-clue" :class="{ wide: isWideClue(clue) }">
          <span class="purchased-clue-label">{{ clue.label }} <span class="purchased-clue-cost">${{ clue.cost }}</span></span>
          <span class="purchased-clue-value">{{ clue.value }}</span>
        </li>
      </ul>

      <div v-if="status === 'playing'" class="clue-shop">
        <button
          v-for="clue in availableClues"
          :key="clue.key"
          type="button"
          class="clue-chip"
          :disabled="clue.cost > budget"
          @click="buyClue(clue)"
        >
          <span class="clue-chip-label" :title="clue.label">{{ clue.label }}</span>
          <span class="clue-chip-cost">${{ clue.cost }}</span>
        </button>

      </div>

      <!-- Out of the shop grid: it isn't a purchase, it ends the round. Same
           understated treatment as Reel Wordle's and Poster Zoom's give-up. -->
      <button v-if="status === 'playing'" type="button" class="give-up-clue" @click="revealPoster">
        Reveal poster &amp; give up (costs your last ${{ budget }})
      </button>
    </template>
  </div>
</template>

<script>
import axios from 'axios';
import BackLink from './BackLink.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { entryKey, rankTitleMatches } from '../../assets/javascript/games/gameUtils.js';
import { buildClueDeck, STARTING_BUDGET } from '../../assets/javascript/games/clueBudget.js';
import clueBudgetBanner from '../../assets/images/games/clue-budget-banner.jpg';

const STORAGE_KEY = 'cinemaRoll.clueBudget.current';

// Bug report: "let's allow unlimited guesses but each wrong guess costs
// $10." Guesses were unlimited-and-free before; now they're unlimited but
// spend down the same budget the clues do, so brute-forcing the
// suggestions list has a price.
const WRONG_GUESS_COST = 10;

export default {
  name: 'ClueBudgetGame',
  components: { BackLink, NewRatingSearch },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "Clue Budget / Cinema Roll Games"
  // branding baked in) in place of the usual movie-backdrop banner, and
  // hides the "Cinema Roll" title overlay so it doesn't compete with that
  // baked-in branding — same pattern as the other 5 games, see CLAUDE.md.
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', clueBudgetBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      startingBudget: STARTING_BUDGET,
      target: null,
      budget: STARTING_BUDGET,
      clueDeck: [],
      // Full clue objects, snapshotted at the moment they're bought — NOT
      // derived from clueDeck by key. Dynamic pricing means a clue's cost
      // in clueDeck can change after purchase (once live TMDB data for a
      // LATER clue resolves and the deck is rebuilt) — snapshotting is
      // what guarantees the purchased list always shows what was actually
      // paid, never a since-updated live price for the same key.
      purchasedClues: [],
      // Accumulates tagline/peoplePopularity/keywordMovieCounts/
      // companyMovieCount as each live fetch resolves — see fetchLiveData.
      liveExtras: {},
      status: 'playing',
      guessInput: '',
      suggestions: [],
      lastGuessFeedback: null
    };
  },
  computed: {
    bestSavings () {
      return this.$store.state.settings?.games?.clueBudgetBestSavings ?? null;
    },
    availableClues () {
      const purchasedKeys = this.purchasedClues.map((clue) => clue.key);
      return this.clueDeck.filter((clue) => !purchasedKeys.includes(clue.key));
    }
  },
  watch: {
    // Same "wait for real data, only act if nothing's loaded yet" pattern
    // as Reel Wordle/Six Degrees — the library may still be loading when
    // this component mounts.
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
    // Feedback: a long value squashed into a half-width card reads squat.
    // Tagline is always a sentence, so it's always full width; anything
    // else earns full width only when its actual value runs long (a
    // multi-genre list, co-directors) — short facts stay compact.
    isWideClue (clue) {
      return clue.key === 'tagline' || String(clue.value ?? '').length > 24;
    },
    suggestionYear (entry) {
      const date = entry?.movie?.release_date;
      return date ? new Date(date).getFullYear() : 'Unknown';
    },
    onInput () {
      // Clear the previous wrong-guess message as soon as they start typing
      // a new one, so it can't linger past the guess it was about (same as
      // Connections clears its feedback on the next tile tap).
      this.lastGuessFeedback = null;
      // Shared ranking (gameUtils.rankTitleMatches): one character is
      // enough, and titles starting with what was typed come first.
      this.suggestions = rankTitleMatches(this.eligibleGameEntries, this.guessInput);
    },
    // A guess is always picked from the player's own library (via the
    // suggestions dropdown, never free text), so it's always a real movie
    // — comparing identity (dbKey/id) is simpler and more reliable than
    // fuzzy title matching (handles remakes/shared titles for free too).
    submitGuess (entry) {
      if (this.status !== 'playing' || !this.target) return;
      this.guessInput = '';
      this.suggestions = [];
      if (entryKey(entry) === entryKey(this.target)) {
        this.win();
        return;
      }
      // Two bug reports shaped this. First: "if I guess wrong it should say
      // so" — a wrong guess used to do nothing visible at all. Then:
      // "unlimited guesses but each wrong guess costs $10" — so guesses now
      // spend the same budget as clues (they were free between those two
      // reports). Same always-rendered/reserved-height treatment as
      // Connections' guess feedback so the message can't reflow the layout.
      this.lastGuessFeedback = `Not ${entry.movie.title}. That cost you $${WRONG_GUESS_COST}.`;
      this.budget = Math.max(0, this.budget - WRONG_GUESS_COST);
      if (this.budget <= 0) {
        this.lose(); // clears the save itself
        return;
      }
      this.persistState();
    },
    buyClue (clue) {
      if (this.status !== 'playing' || this.purchasedClues.some((p) => p.key === clue.key) || clue.cost > this.budget) return;
      this.budget -= clue.cost;
      this.purchasedClues.push(clue);
      if (this.budget <= 0) this.lose();
      this.persistState();
    },
    // The one rule handed down whole: revealing the poster always costs
    // whatever's left, in full — effectively "give up," available any time
    // regardless of how much budget remains.
    revealPoster () {
      if (this.status !== 'playing') return;
      this.budget = 0;
      this.lose();
    },
    lose () {
      this.status = 'lost';
      this.recordGameRound({ won: false, saved: 0, movie: entryKey(this.target) });
      this.persistState(); // no longer 'playing', so this clears the save
    },
    win () {
      this.status = 'won';
      this.recordGameWin();
      this.recordGameRound({ won: true, saved: this.budget, movie: entryKey(this.target) });
      if (this.bestSavings == null || this.budget > this.bestSavings) {
        this.$store.dispatch('writeDurably', { path: 'settings/games/clueBudgetBestSavings', value: this.budget });
      }
      this.persistState(); // no longer 'playing', so this clears the save
    },
    startNewRound () {
      const pool = this.eligibleGameEntries;
      if (!pool.length) return;
      const excludeKey = this.target ? entryKey(this.target) : null;
      const candidates = excludeKey ? pool.filter((entry) => entryKey(entry) !== excludeKey) : pool;
      const choices = candidates.length ? candidates : pool;
      this.target = choices[Math.floor(Math.random() * choices.length)];
      this.budget = STARTING_BUDGET;
      this.purchasedClues = [];
      this.status = 'playing';
      this.guessInput = '';
      this.suggestions = [];
      this.lastGuessFeedback = null;
      // yourRating is local (GetRating + Vuex weights), not fetched — seed
      // it into extras up front so the Your Rating clue is offered from the
      // very first render rather than waiting on any network round trip.
      this.liveExtras = { yourRating: this.gameRatingFor(this.target) };
      // Fallback-priced deck immediately — the round is fully playable
      // before any network request resolves. Each of the three live
      // fetches below independently refines whichever clues it covers.
      this.clueDeck = buildClueDeck(this.target, this.liveExtras);
      this.persistState();
      this.fetchLiveData(this.target);
    },
    // Bug report: "I was playing clue budget and when I jumped over to my
    // database and came back it reset the game." Same localStorage pattern
    // as Poster Zoom. The purchased clues are persisted as full snapshots,
    // not keys — their PAID price isn't re-derivable (dynamic pricing means
    // the same clue can cost differently next fetch), the same reason the
    // in-memory list snapshots them. That's the Trivia precedent: persist
    // derived data when re-deriving it wouldn't reproduce it.
    persistState () {
      try {
        if (this.status !== 'playing' || !this.target) {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          targetKey: entryKey(this.target),
          budget: this.budget,
          purchasedClues: this.purchasedClues
        }));
      } catch (error) {
        console.error('Failed to persist Clue Budget progress:', error);
      }
    },
    loadOrStart () {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const target = this.eligibleGameEntries.find((entry) => entryKey(entry) === saved?.targetKey);
          const budget = Number(saved?.budget);
          // A finished round is never resumed — persistState only writes
          // while playing (and a loss zeroes the budget), so anything valid
          // found here was genuinely in progress.
          if (target && Number.isFinite(budget) && budget > 0 && budget <= STARTING_BUDGET) {
            this.target = target;
            this.budget = budget;
            this.purchasedClues = Array.isArray(saved.purchasedClues)
              ? saved.purchasedClues.filter((clue) => clue && clue.key)
              : [];
            this.status = 'playing';
            this.liveExtras = { yourRating: this.gameRatingFor(target) };
            this.clueDeck = buildClueDeck(target, this.liveExtras);
            this.fetchLiveData(target);
            return;
          }
        }
      } catch (error) {
        console.error('Failed to load persisted Clue Budget progress:', error);
      }
      this.startNewRound();
    },
    // Merges a partial extras update and rebuilds the deck from it. Never
    // touches purchasedClues (see its own comment) — a clue's LIVE price
    // can keep changing after it's been bought, that's fine, only
    // availableClues (still-unpurchased) reflects it.
    mergeLiveExtras (patch) {
      this.liveExtras = { ...this.liveExtras, ...patch };
      this.clueDeck = buildClueDeck(this.target, this.liveExtras);
    },
    // Three independent, best-effort live TMDB lookups feeding the dynamic
    // pricing in clueBudget.js — none of this is persisted locally (see
    // CLAUDE.md), so it's fetched fresh once per round. Fired in parallel
    // (not awaited in sequence) so one slow endpoint doesn't hold back the
    // others; each guards against a stale response landing after "New
    // Round" already moved on to a different target.
    fetchLiveData (roundTarget) {
      // Stored tagline (2026-08-15): offer the Tagline clue offline for
      // entries that carry one; the live fetch below still refines pricing
      // and covers legacy entries.
      const storedTagline = typeof roundTarget?.movie?.tagline === 'string' ? roundTarget.movie.tagline.trim() : '';
      if (storedTagline) {
        this.mergeLiveExtras({ tagline: storedTagline, peoplePopularity: {} });
      }
      this.fetchTaglineAndPopularity(roundTarget);
      this.fetchKeywordRarity(roundTarget);
    },
    // Tagline + every cast/crew member's real TMDB popularity, in one
    // request (append_to_response=credits) — the same movie-details call
    // already needed for tagline also returns full credits with a
    // popularity score baked into every person.
    async fetchTaglineAndPopularity (roundTarget) {
      const movieId = roundTarget?.movie?.id;
      if (movieId == null) return;
      try {
        const response = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US&append_to_response=credits`);
        // Compare by identity KEY, not object reference — Vue wraps
        // this.target in a reactive proxy on read, so this.target !==
        // roundTarget (the raw object captured before assignment) never
        // matches. Confirmed via a real test while building Trivia: with a
        // plain (non-Vuex) mock store — the norm in this test suite — this
        // guard was ALWAYS true, silently discarding every live fetch and
        // leaving every clue on its fallback price. Real Vuex state is
        // already reactive-wrapped before it ever reaches here, so this is
        // less likely to bite in production, but the fix is correct either
        // way and makes the guard actually testable.
        if (entryKey(roundTarget) !== entryKey(this.target)) return;
        const data = response?.data || {};
        const peoplePopularity = {};
        [...(data.credits?.cast || []), ...(data.credits?.crew || [])].forEach((person) => {
          if (person?.name && typeof person.popularity === 'number') peoplePopularity[person.name] = person.popularity;
        });
        this.mergeLiveExtras({ tagline: data.tagline, peoplePopularity });
      } catch {
        // Best-effort — those clues just keep their fallback prices (and
        // Tagline isn't offered at all) this round.
      }
    },
    // How many movies share each offered keyword's TMDB id — only
    // resolvable for keywords that actually came from TMDB (movie.keywords
    // carries {id, name}; AI/custom keywords have no id and just keep
    // their fallback price). Looked up in parallel, one request per
    // keyword actually shown (at most 3).
    async fetchKeywordRarity (roundTarget) {
      const idByName = {};
      (roundTarget?.movie?.keywords || []).forEach((k) => {
        if (k?.name && k?.id != null) idByName[k.name] = k.id;
      });
      const offeredKeywords = (roundTarget?.movie?.flatKeywords || []).filter(Boolean).slice(0, 3);

      const lookups = offeredKeywords
        .filter((keyword) => idByName[keyword] != null)
        .map(async (keyword) => {
          try {
            const response = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${process.env.VUE_APP_TMDB_API_KEY}&with_keywords=${idByName[keyword]}`);
            return [keyword, response?.data?.total_results];
          } catch {
            return null;
          }
        });
      if (!lookups.length) return;

      const results = await Promise.all(lookups);
      if (entryKey(roundTarget) !== entryKey(this.target)) return;
      const keywordMovieCounts = {};
      results.filter(Boolean).forEach(([keyword, count]) => {
        if (typeof count === 'number') keywordMovieCounts[keyword] = count;
      });
      if (Object.keys(keywordMovieCounts).length) this.mergeLiveExtras({ keywordMovieCounts });
    },
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';
@import '@/assets/scss/game-inputs';

.clue-budget-game {
  color: #eee;
  // Safety margin against BackLink overlapping this screen's own content
  // when the global Header happens to have zero height — same fix as the
  // other 5 game components.
  padding: 1.25rem 1rem 0.75rem;
}

.game-subtitle {
  color: #adb5bd;
  /* Tight: this screen has ~19 clue chips to fit, and 1.75rem of combined
     margin on a single line was the last thing keeping it off one screen. */
  margin-top: 0.35rem;
  margin-bottom: 0.5rem;
}

.not-enough-movies {
  color: #adb5bd;
  text-align: center;
  margin-top: 2rem;
}

.budget-row {
  display: flex;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.budget-row strong {
  color: #4caf50;
}

.budget-row strong.low {
  color: #ff6a6a;
}

.guess-form {
  position: relative;
  /* Tight: the reserved feedback line inside already spaces this block, and
     the extra rem here was the reported "too much of a gap between the
     input and the clues." */
  margin-bottom: 0.25rem;
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

.guess-feedback {
  color: #ff6a6a;
  font-size: 0.85rem;
  margin: 0.25rem 0 0;
  min-height: 1.2rem;
  text-align: center;
  visibility: hidden;
}

.guess-feedback.visible {
  visibility: visible;
}

// Left-accent-bar callout, same treatment as Reel Wordle/Connections'
// result banners — a purpose-built look rather than a generic colored box.
.result-banner {
  background: #1a1a1a;
  border-left: 4px solid #4caf50;
  border-radius: 0.4rem;
  margin-bottom: 1rem;
  padding: 1rem;
  text-align: center;
}

.result-banner.lost {
  border-left-color: #ff6a6a;
}

.reveal-poster {
  border-radius: 0.35rem;
  max-width: 160px;
  margin: 0.5rem auto;
  display: block;
  width: 100%;
}

/* Same grid rhythm as the clue shop below, so a bought clue reads as its
   chip flipped over; amber-tinted where the shop chips are neutral. */
.purchased-clues {
  display: grid;
  gap: 0.4rem;
  grid-template-columns: repeat(2, 1fr);
  list-style: none;
  margin: 0 0 0.5rem;
  padding: 0;
}

.purchased-clue {
  background: rgba(255, 193, 7, 0.07);
  border: 1.5px solid rgba(255, 193, 7, 0.45);
  border-radius: 0.5rem;
  min-height: 46px;
  padding: 0.35rem 0.5rem;
  text-align: center;
}

/* Long-value clues (tagline always; genre lists, co-directors when they
   actually run long) span the full row and read left-aligned like a
   sentence rather than a squashed tile. */
.purchased-clue.wide {
  grid-column: 1 / -1;
  text-align: left;
}

.purchased-clue-label {
  color: #ffc107;
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  line-height: 1.15;
}

.purchased-clue-value {
  color: #eee;
  display: block;
  font-size: 0.85rem;
  line-height: 1.2;
  /* Long values (taglines, genre lists) wrap; the card grows to hold them. */
  overflow-wrap: break-word;
}

.purchased-clue-cost {
  color: #adb5bd;
  font-size: 0.9em;
  font-weight: 400;
}

.clue-shop {
  display: grid;
  /* Three across, not two: there can be 15 clues, and at two-up the shop ran
     well off a phone screen (bug report). Four once there's room for it. */
  gap: 0.4rem;
  /* Three across. Four fitted but the chips were too small to tap (bug
     report). The deck is capped at 15 rather than the original 20, which is
     five rows here — and note the typical round offers fewer, since tagline
     is often absent and crew credits are 85-96% complete. */
  grid-template-columns: repeat(3, 1fr);
}

@media (min-width: 600px) {
  .clue-shop {
    grid-template-columns: repeat(4, 1fr);
  }
}

.clue-chip {
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1.5px solid #333;
  border-radius: 0.5rem;
  color: #eee;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  justify-content: center;
  /* Fixed height so every chip matches regardless of whether its label
     wraps, which keeps the grid even. */
  /* Comfortably above the 40px minimum touch target. Five rows of these
     (the worst case, 15 clues) fits a real phone — the earlier 664px test
     viewport was a desktop window and about 90px pessimistic. */
  min-height: 46px;
  padding: 0.4rem 0.3rem;
  text-align: center;
  transition: transform 0.1s ease, border-color 0.1s ease;
}

// Mobile-first: :active only, no :hover (this app has no reliable pointer
// device — see CLAUDE.md).
.clue-chip:active:not(:disabled) {
  border-color: #ffb300;
  transform: scale(0.96);
}

.clue-chip:disabled {
  cursor: default;
  opacity: 0.35;
}

.clue-chip-label {
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.15;
  /* Wraps to two lines rather than ellipsing: the full word is more use
     than a truncated one, and min-height above absorbs the extra line.
     Longer labels still clamp instead of growing without bound. */
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  display: -webkit-box;
  overflow: hidden;
  width: 100%;
}

.clue-chip-cost {
  color: #4caf50;
  font-size: 0.82rem;
  font-weight: 700;
  line-height: 1.15;
}

.give-up-clue {
  background: none;
  border: none;
  color: #8a9199;
  display: block;
  font-size: 0.75rem;
  margin: 0.5rem auto 0;
  padding: 0.25rem 0.5rem;
  text-decoration: underline;
}

.give-up-clue:active {
  color: #e88;
}

.clue-chip:disabled .clue-chip-cost {
  color: #adb5bd;
}

// The one clue that always spends everything — visually distinct (a red
// tint) from the neutral cost-based chips above it, since it's a
// deliberate "give up," not a normal purchase.

</style>
