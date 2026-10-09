<template>
  <div class="cineplexity-game">
    <BackLink/>
    <GameHowTo/>

    <div v-if="!round" class="not-enough">
      <p>Rate a few more movies before there's enough overlap to play with.</p>
    </div>

    <template v-else>
      <p class="trait-line">
        <span class="trait">{{ round.traitA.label }}</span>
        <span class="trait-plus">+</span>
        <span class="trait">{{ round.traitB.label }}</span>
      </p>
      <p class="progress-line">
        {{ found.length }} of {{ round.matches.length }} found
        <span v-if="misses" class="miss-count">· {{ misses }} miss{{ misses === 1 ? '' : 'es' }}</span>
      </p>

      <!-- One slot per matching movie: found ones show their poster,
           unfound stay as dark placeholders (posters over text, always). -->
      <div class="slot-grid">
        <div v-for="entry in round.matches" :key="entry.dbKey" class="slot" :class="{ found: isFound(entry) }">
          <img
            v-if="isFound(entry)"
            :src="gamePosterUrl(entry, 'w185')"
            :alt="entry.movie.title"
            :title="entry.movie.title"
            class="slot-poster"
          >
          <span v-else-if="finished" class="slot-missed" :title="entry.movie.title">
            <img :src="gamePosterUrl(entry, 'w185')" :alt="entry.movie.title" class="slot-poster missed">
          </span>
          <span v-else class="slot-blank"><i class="bi bi-question-lg"></i></span>
        </div>
      </div>

      <template v-if="!finished">
        <div class="guess-wrap">
          <input
            ref="guessInput"
            v-model="guess"
            type="search"
            class="form-control guess-input"
            placeholder="Name a movie that fits both…"
            autocomplete="off"
            @keydown.enter.prevent="submitGuess"
          >
          <!-- Typeahead over the WHOLE library (not just the answers —
               the dropdown must not be an answer key). -->
          <div v-if="suggestions.length" class="suggestions">
            <button
              v-for="title in suggestions"
              :key="title"
              type="button"
              class="suggestion-row"
              @click="chooseSuggestion(title)"
            >
              {{ title }}
            </button>
          </div>
        </div>
        <div class="guess-actions">
          <button type="button" class="btn-game btn-game-primary" @click="submitGuess">Guess</button>
          <button type="button" class="btn-game btn-game-secondary" @click="giveUp">Reveal the rest</button>
        </div>
        <p v-if="feedback" class="guess-feedback" :class="feedbackKind">{{ feedback }}</p>
      </template>

      <template v-else>
        <p class="summary-line">
          {{ found.length === round.matches.length ? 'Clean sweep — every match found.' : `You found ${found.length} of ${round.matches.length}.` }}
        </p>
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary" @click="startRound">New Pair</button>
          <button type="button" class="btn-game btn-game-secondary" @click="$router.push('/games')">Back to Games</button>
        </div>
      </template>
    </template>
  </div>
</template>

<script>
// Cineplexity (Brian-survey F5, approved): draw a pair of movie traits and
// name every movie in your library matching both. Round logic is pure
// (games/cineplexity.js); this component owns input and reveal state.
import BackLink from './BackLink.vue';
import GameHowTo from './GameHowTo.vue';
import gameData from '../../mixins/gameData.js';
import { buildCineplexityRound, matchGuess } from '../../assets/javascript/games/cineplexity.js';
import cineplexityBanner from '../../assets/images/games/cineplexity-banner.svg';

const STORAGE_KEY = 'cinemaRoll.cineplexity.current';

export default {
  name: 'CineplexityGame',
  components: { BackLink, GameHowTo },
  mixins: [gameData],
  data () {
    return {
      round: null,
      found: [],
      misses: 0,
      guess: '',
      feedback: '',
      feedbackKind: 'neutral',
      gaveUp: false
    };
  },
  computed: {
    finished () {
      return Boolean(this.round) && (this.gaveUp || this.found.length === this.round.matches.length);
    },
    remaining () {
      return (this.round?.matches || []).filter((entry) => !this.isFound(entry));
    },
    suggestions () {
      const needle = this.guess.trim().toLowerCase();
      if (needle.length < 2) return [];
      const seen = new Set();
      const titles = [];
      for (const entry of this.eligibleGameEntries) {
        const title = entry?.movie?.title;
        if (!title) continue;
        const lower = title.toLowerCase();
        if (lower === needle) continue;
        if (lower.includes(needle) && !seen.has(lower)) {
          seen.add(lower);
          titles.push(title);
          if (titles.length >= 7) break;
        }
      }
      return titles;
    }
  },
  created () {
    // House banner contract: swap in the game's art, restore on leave.
    this.previousBannerUrl = this.$store?.state?.bannerUrl || null;
    this.$store.commit?.('setBannerUrl', cineplexityBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  watch: {
    // House rule: wait for the library, don't read it once — a deep-link
    // mount happens before Firebase data arrives.
    eligibleGameEntries: {
      immediate: true,
      handler () {
        if (!this.round && this.eligibleGameEntries.length) {
          // House persistence rule: restore the in-flight round by entry
          // KEYS (re-resolved against the live library); a finished round
          // is never resumed; anything unresolvable means a fresh round.
          if (!this.restoreRound()) this.startRound();
        }
      }
    }
  },
  methods: {
    startRound () {
      this.round = buildCineplexityRound(this.eligibleGameEntries, Math.random);
      this.found = [];
      this.misses = 0;
      this.guess = '';
      this.feedback = '';
      this.gaveUp = false;
      this.persistRound();
      this.$nextTick(() => this.$refs.guessInput?.focus?.());
    },
    persistRound () {
      try {
        if (!this.round || this.finished) {
          localStorage.removeItem(STORAGE_KEY);
          return;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          traitA: this.round.traitA,
          traitB: this.round.traitB,
          matchKeys: this.round.matches.map((entry) => entry.dbKey),
          found: this.found,
          misses: this.misses
        }));
      } catch { /* storage unavailable: the round just won't survive a reload */ }
    },
    restoreRound () {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        if (!saved?.matchKeys?.length || !saved.traitA || !saved.traitB) return false;
        const byKey = new Map(this.eligibleGameEntries.map((entry) => [entry.dbKey, entry]));
        const matches = saved.matchKeys.map((key) => byKey.get(key));
        if (matches.some((entry) => !entry)) return false; // library changed: fresh round
        this.round = { traitA: saved.traitA, traitB: saved.traitB, matches };
        this.found = (saved.found || []).filter((key) => byKey.has(key));
        this.misses = Number.isFinite(saved.misses) ? saved.misses : 0;
        this.gaveUp = false;
        return true;
      } catch {
        return false;
      }
    },
    isFound (entry) {
      return this.found.includes(entry.dbKey);
    },
    chooseSuggestion (title) {
      this.guess = title;
      this.submitGuess();
      this.$refs.guessInput?.focus?.();
    },
    submitGuess () {
      if (!this.guess.trim() || this.finished) return;
      const hit = matchGuess(this.guess, this.remaining);
      if (hit) {
        this.found = [...this.found, hit.dbKey];
        this.feedback = hit.movie.title;
        this.feedbackKind = 'hit';
        this.guess = '';
        if (this.found.length === this.round.matches.length) this.completeRound(true);
        else this.persistRound();
      } else {
        this.misses += 1;
        this.feedback = 'Not a match (or already found).';
        this.feedbackKind = 'miss';
        // Bug report: a wrong guess should clear the input the same way a
        // hit does, so the next attempt doesn't start with stale text.
        this.guess = '';
        this.persistRound();
      }
    },
    giveUp () {
      this.gaveUp = true;
      this.completeRound(false);
    },
    completeRound (swept) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* fine */ }
      this.recordGameRound({
        found: this.found.length,
        total: this.round.matches.length,
        misses: this.misses,
        swept
      });
      if (swept) this.recordGameWin();
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.cineplexity-game {
  color: #eee;
  padding: 2.5rem 1rem 2rem;
  text-align: center;
}

.not-enough { color: #ccc; padding-top: 2rem; }

.trait-line {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
  margin: 0.5rem 0 0.25rem;
}

.trait {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  color: #ffc107;
  font-size: 1rem;
  font-weight: 700;
  padding: 0.35rem 0.9rem;
}

.trait-plus { color: #ccc; font-weight: 700; }

.progress-line { color: #ccc; font-size: 0.85rem; margin-bottom: 0.75rem; }
.miss-count { color: #999; }

.slot-grid {
  /* One sideways-scrolling row (QA): keeps the whole game on one screen
     regardless of how many movies the trait pair matches. */
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
}

.slot {
  border-radius: 6px;
  flex: 0 0 92px;
  height: 138px;
  overflow: hidden;
  width: 92px;
}

.slot-blank {
  align-items: center;
  background: #161616;
  border: 1px dashed #3a3a3a;
  border-radius: 6px;
  color: #555;
  display: flex;
  font-size: 1.4rem;
  height: 100%;
  justify-content: center;
  width: 100%;
}

.slot-poster { display: block; height: 100%; object-fit: cover; width: 100%; }
.slot-poster.missed { filter: grayscale(1); opacity: 0.55; }

.guess-wrap {
  margin: 0 auto;
  max-width: 420px;
  position: relative;
}

.suggestions {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  /* Above the input (QA): on a phone the keyboard owns everything below. */
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  max-height: 220px;
  overflow-y: auto;
  position: absolute;
  right: 0;
  z-index: 10;
}

.suggestion-row {
  background: none;
  border: none;
  color: #eee;
  display: block;
  font-size: 0.85rem;
  min-height: 40px;
  padding: 0.4rem 0.8rem;
  text-align: left;
  width: 100%;

  &:active {
    background: #1f1f1f;
  }
}

.guess-input {
  background: #101010;
  border-color: #3a3a3a;
  color: #eee;
  margin-bottom: 0.6rem;
  min-width: 0;

  &::placeholder { color: #888; }
  &:focus { background: #101010; border-color: #666; box-shadow: none; color: #eee; }
}

.guess-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: center;
  margin-bottom: 0.5rem;
}

.guess-feedback {
  font-size: 0.85rem;
  min-height: 1.2em;

  &.hit { color: #ffc107; }
  &.miss { color: #999; }
}

.summary-line { color: #eee; font-size: 1rem; margin: 0.5rem 0 1rem; }

.end-actions {
  display: flex;
  gap: 0.6rem;
  justify-content: center;
}
</style>
