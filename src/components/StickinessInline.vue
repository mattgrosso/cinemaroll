<template>
  <div v-if="showStickinessModal && resultsThatNeedStickiness.length" class="stickiness-inline">
    <!-- Single container that changes its content -->
    <Transition name="stickiness-expand" mode="out-in">
      <!-- Prompt -->
      <div v-if="!showStickinessInline" key="notice" class="prompt-card" @click="toggleStickinessInline">
        <span class="prompt-badge prompt-badge-stickiness"><i class="bi bi-sticky-fill"></i></span>
        <span class="prompt-body">
          <span class="prompt-label">Stickiness</span>
          <p class="prompt-text">{{ stickinessPromptText }}</p>
          <a class="prompt-action prompt-action-stickiness" @click.stop="toggleStickinessInline">Add stickiness</a>
        </span>
      </div>

      <!-- Inline Content -->
      <div v-else key="form" class="stickiness-container p-3">
        <!-- Top section: Centered poster -->
        <div class="text-center mb-3">
          <img
            class="rounded"
            :src="`https://image.tmdb.org/t/p/w500${topStructure(firstStickinessResult).poster_path}`"
            :alt="topStructure(firstStickinessResult).title"
            style="width: 120px; height: 180px; object-fit: cover;"
          >
        </div>

        <!-- Description text with conditional wording -->
        <div class="mb-3">
          <p v-if="!showSixMonthMessage" class="text-light mb-0">Rate how much you've been thinking and talking about {{ topStructure(firstStickinessResult).title }} since you watched it.</p>
          <p v-else class="text-light mb-0">Rate how much you've been thinking and talking about {{ topStructure(firstStickinessResult).title }} in the past 6 months.</p>
        </div>

        <!-- Rating change preview (always takes space) -->
        <div class="rating-preview alert py-2 mb-3 text-center"
             :class="{
               invisible: !stickinessRating || !ratingWithStickiness,
               'alert-success': stickinessRating && ratingWithStickiness && ratingWithStickiness > ratingWithoutStickiness,
               'alert-danger': stickinessRating && ratingWithStickiness && ratingWithStickiness < ratingWithoutStickiness,
               'alert-info': stickinessRating && ratingWithStickiness && ratingWithStickiness === ratingWithoutStickiness
             }">
          <small>
            <span v-if="ratingWithoutStickiness === ratingWithStickiness">Your rating won't change.</span>
            <span v-else>
              Rating: {{ ratingWithoutStickiness }} → <strong>{{ ratingWithStickiness }}</strong>
              <span v-if="rankWithoutStickiness !== rankWithStickiness" class="ms-2">
                (Rank: {{ rankWithoutStickiness }} → {{ rankWithStickiness }})
              </span>
            </span>
          </small>
        </div>

        <!-- Form section -->
        <div class="rating-interface">
          <!-- Stickiness selector -->
          <select class="form-select mb-3 stickiness-select" name="stickiness-inline" id="stickiness-inline" v-model="stickinessRating">
            <option value="">Rate Stickiness</option>
            <option value="0">
              <span v-if="showSixMonthMessage">0 - Are you sure I watched that?</span>
              <span v-else>0 - I told people to avoid it</span>
            </option>
            <option value="1">
              <span v-if="showSixMonthMessage">1 - I basically forgot about this movie</span>
              <span v-else>1 - I forgot it immediately</span>
            </option>
            <option value="2">
              <span v-if="showSixMonthMessage">2 - Good or bad, it comes to mind</span>
              <span v-else>2 - I've been thinking about it and mentioning it</span>
            </option>
            <option value="3">
              <span v-if="showSixMonthMessage">3 - I think about it often</span>
              <span v-else>3 - I remember it often</span>
            </option>
            <option value="4">
              <span v-if="showSixMonthMessage">4 - I reference it and think about it a lot</span>
              <span v-else>4 - I can't seem to stop thinking about it</span>
            </option>
            <option value="5">
              <span v-if="showSixMonthMessage">5 - It expanded my idea of what movies can be</span>
              <span v-else>5 - It expanded my idea of what movies can be</span>
            </option>
          </select>

          <!-- Action buttons -->
          <div class="d-flex justify-content-end gap-2">
            <button type="button" class="btn btn-secondary" @click="closeStickinessInline">Close</button>
            <button v-if="submittingStickiness" type="button" class="btn btn-primary" disabled>
              <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            </button>
            <button v-else-if="resultsThatNeedStickiness[1]" type="button" class="btn btn-primary" :disabled="!stickinessRating" @click="addStickinessRating">
              Add Rating and Next
            </button>
            <button v-else type="button" class="btn btn-primary" :disabled="!stickinessRating" @click="addStickinessRating">
              Add Rating
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script>
import { getRating } from "../assets/javascript/GetRating.js";
import { stickinessCandidates } from "../assets/javascript/stickinessCandidates.js";
import cloneDeep from 'lodash/cloneDeep';

export default {
  name: "StickinessInline",
  props: {
    allEntriesWithFlatKeywordsAdded: {
      type: Array,
      required: true
    },
    showStickinessModal: {
      type: Boolean,
      required: true
    },
    // Open the form as soon as the prompt has something to show, instead of
    // waiting for a tap on the card — Home sets it when the app was opened
    // from a chore notification.
    autoOpen: {
      type: Boolean,
      default: false
    },
    // The clock to judge candidacy against, owned by Home so this card and
    // the gate that decides whether to render it can never disagree about
    // what time it is. Never Date.now() in here: see
    // stickinessCandidates.js.
    now: {
      type: Number,
      required: true
    }
  },
  emits: ['stickiness-updated'],
  data () {
    return {
      showStickinessInline: false,
      stickinessRating: "",
      submittingStickiness: false
    }
  },
  watch: {
    // Both immediate: the request usually arrives before the library does
    // (autoOpen is set in Home's mounted, the films land from Firebase
    // later), but a hash navigation from another screen has them the other
    // way round.
    autoOpen: { immediate: true, handler: 'maybeAutoOpen' },
    promptOnScreen: { immediate: true, handler: 'maybeAutoOpen' }
  },
  computed: {
    promptOnScreen () {
      return this.showStickinessModal && this.resultsThatNeedStickiness.length > 0;
    },
    currentLogIsTVLog () {
      return this.$store.state.currentLog === "tvLog";
    },
    // Was "N movies you've had time to sit with." Bug report, 2026-08-20: "I
    // don't like the language on the stickiness prompt like 'you've had time
    // to sit with' isn't that great? Can you reword that to me a bit more
    // direct?" The other prompt cards state a plain fact and leave the verb
    // to the action link — "2021 has enough films to hand out awards", "Three
    // films are sitting on the same score" — so this does too, and says what
    // is actually wanted rather than describing the passage of time.
    stickinessPromptText () {
      const count = this.resultsThatNeedStickiness.length;
      return `${count} movie${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} ready for a stickiness score.`;
    },
    allMoviesRanked () {
      const movies = [...this.$store.getters.allMoviesAsArray];
      return movies.sort(this.sortByRating);
    },
    resultsThatNeedStickiness () {
      return stickinessCandidates(this.allEntriesWithFlatKeywordsAdded, {
        ratingOf: this.mostRecentRating,
        now: this.now
      });
    },
    firstStickinessResult () {
      return this.resultsThatNeedStickiness[0];
    },
    ratingWithoutStickiness () {
      if (!this.firstStickinessResult) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = null;
      return getRating(this.firstStickinessResult).calculatedTotal;
    },
    ratingWithStickiness () {
      if (!this.stickinessRating && this.stickinessRating !== 0 && this.stickinessRating !== "0") {
        return null;
      }
      if (!this.firstStickinessResult) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = parseFloat(this.stickinessRating);
      return getRating(tempResult).calculatedTotal;
    },
    rankWithoutStickiness () {
      if (!this.firstStickinessResult) return null;
      return this.allMoviesRanked.findIndex((movie) => movie.dbKey === this.firstStickinessResult.dbKey) + 1;
    },
    rankWithStickiness () {
      if (!this.stickinessRating || !this.firstStickinessResult) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = parseFloat(this.stickinessRating);
      const movies = [...this.$store.getters.allMoviesAsArray];
      const movieIndex = movies.findIndex((movie) => movie.dbKey === this.firstStickinessResult.dbKey);
      movies[movieIndex] = tempResult;
      const sortedMovies = movies.sort(this.sortByRating);
      return sortedMovies.findIndex((movie) => movie.dbKey === tempResult.dbKey) + 1;
    },
    mostRecentRatingIndex () {
      if (!this.firstStickinessResult) return 0;
      let mostRecentRating = this.firstStickinessResult.ratings[0];
      let mostRecentRatingIndex = 0;

      this.firstStickinessResult.ratings.forEach((rating, index) => {
        const ratingDate = rating.date ? new Date(rating.date).getTime() : 0;
        const mostRecentRatingDate = mostRecentRating.date ? new Date(mostRecentRating.date).getTime() : 0;

        if (!mostRecentRating.date) {
          mostRecentRating = rating;
          mostRecentRatingIndex = index;
        } else if (ratingDate && ratingDate > mostRecentRatingDate) {
          mostRecentRating = rating;
          mostRecentRatingIndex = index;
        }
      })

      return mostRecentRatingIndex;
    },
    showSixMonthMessage () {
      if (!this.firstStickinessResult) return false;
      return this.mostRecentRating(this.firstStickinessResult).userAddedStickiness;
    }
  },
  methods: {
    maybeAutoOpen () {
      if (this.autoOpen && this.promptOnScreen) this.showStickinessInline = true;
    },
    toggleStickinessInline () {
      this.showStickinessInline = true;
    },
    closeStickinessInline () {
      this.showStickinessInline = false;
      this.stickinessRating = "";
      // One sitting = one prompt, whether it ended because the queue ran dry
      // or because the user closed it. Only meaningful when a quota is set
      // (`settings/stickinessPromptsPerDay`, unlimited by default — see
      // promptQuota.js); stamping it unconditionally keeps the record honest
      // for the moment a quota IS set.
      this.$store.dispatch('writeDurably', {
        path: 'settings/lastStickinessPromptAt',
        value: Date.now()
      });
    },
    topStructure (result) {
      if (this.currentLogIsTVLog) {
        return result.tvShow;
      } else {
        return result.movie;
      }
    },
    sortByRating (a, b) {
      const aRating = getRating(a)?.calculatedTotal;
      const bRating = getRating(b)?.calculatedTotal;

      if (aRating < bRating) {
        return 1;
      }
      if (aRating > bRating) {
        return -1;
      }

      return 0;
    },
    addStickinessRating () {
      this.submittingStickiness = true;

      const ratingIndex = this.mostRecentRatingIndex;
      // Which of the two stickiness passes this is: the one-week prompt the
      // first time, the six-month one after that.
      const isFirstStickinessPass = !this.firstStickinessResult.ratings[ratingIndex].userAddedStickiness;

      // .map(), NOT an object spread. Both branches here used to build
      // `ratings: { ...this.firstStickinessResult.ratings, [i]: {...} }` —
      // and spreading an ARRAY into an object literal yields a plain object
      // ({0: …, 1: …}) with NO `length`. GetRating.js bails on
      // `!media?.ratings?.length` and falls back to `{calculatedTotal: 0}`,
      // so the moment a movie was saved this way it lost `date`,
      // `userAddedStickiness` and its real score locally — which put it
      // straight back into resultsThatNeedStickiness (undefined flag reads
      // as "hasn't rated", missing date defaults to 2021 = "more than a week
      // ago") and showed its rating as 0.
      //
      // This was latent for a long time because setDBValue never wrote to
      // local state at all — the object went to Firebase, which normalises
      // sequential numeric keys back into an array, and the corrected shape
      // came back via the onValue listener. Switching this component to
      // writeDurably (which commits locally first, by design) made the
      // broken intermediate shape visible, surfacing as "the stickiness
      // prompt is still showing up when I don't really have a stickiness".
      // Stored data was never affected — only the local copy.
      const updatedRatings = this.firstStickinessResult.ratings.map((rating, index) => {
        if (index !== ratingIndex) return rating;
        return {
          ...rating,
          rating: this.ratingWithStickiness,
          stickiness: parseFloat(this.stickinessRating),
          ...(isFirstStickinessPass ? { userAddedStickiness: true } : { userAddedSixMonthStickiness: true })
        };
      });

      const movieWithRating = { ...this.firstStickinessResult, ratings: updatedRatings };

      // Captured BEFORE the write: writeDurably commits to local state
      // synchronously, so the moment it's dispatched firstStickinessResult
      // already points at the NEXT movie in the queue.
      const dbEntry = {
        path: `movieLog/${this.firstStickinessResult.dbKey}`,
        value: movieWithRating
      };

      // writeDurably (not setDBValue): commits locally first, then
      // durably queues before attempting the network write, so this
      // survives being offline (bug report - see CLAUDE.md's Offline
      // Support Extension section).
      this.$store.dispatch('writeDurably', dbEntry);
      this.$store.commit('flashSaved', 'Stickiness saved');

      this.submittingStickiness = false;
      this.stickinessRating = "";

      // Emit event to parent to update data
      this.$emit('stickiness-updated');

      // Bug report: "after each one it should just immediately take me to
      // the next stickiness that is ready to go." Two things were in the
      // way. (1) This whole block used to sit behind a 2-SECOND setTimeout
      // - a holdover from when the save had to round-trip before local
      // state caught up. writeDurably commits locally first, so there's
      // nothing left to wait for and the delay was pure dead time between
      // each entry. (2) Advancing relied on showStickinessInline merely
      // never having been set false; anything that knocked it back (a
      // remount, a transient empty list) dumped the player on the notice
      // banner with no way forward but tapping it again. Now staying on
      // the form is asserted explicitly, and the panel only collapses once
      // the queue is genuinely empty.
      if (this.resultsThatNeedStickiness.length) {
        this.showStickinessInline = true;
      } else {
        this.closeStickinessInline();
      }
    },
    mostRecentRating (media) {
      return getRating(media);
    }
  }
}
</script>

<style lang="scss" scoped>
@import '@/assets/scss/prompt-card';

// Stickiness inline animation
.stickiness-expand-enter-active,
.stickiness-expand-leave-active {
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.stickiness-expand-enter-from {
  opacity: 0;
}

.stickiness-expand-enter-to {
  opacity: 1;
}

.stickiness-expand-leave-from {
  opacity: 1;
}

.stickiness-expand-leave-to {
  opacity: 0;
}

// Stickiness content styling
.stickiness-inline {
  .stickiness-container {
    /* Swapped in place of the prompt-card, so it keeps the card's page
       rhythm (see _prompt-card.scss). */
    margin-bottom: 0.5rem;
    margin-top: 0.25rem;

    /* Same surface as .prompt-card and every other panel in the app —
       #161616 on a #2e2e2e hairline. This used to be flat #4a4a4a with a
       #666 border, which is what the collapsed prompts looked like before
       they were reworked; the expanded forms have to move with them or the
       card changes colour the moment you tap it (2026-08-17).

       The class stays put rather than being swapped for .prompt-panel: a lot
       of form styling is nested under it, and .prompt-card's icon-plus-body
       flex row is the wrong layout for a form anyway. */
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.2s ease;

    .stickiness-notice-content {
      color: #fff;

      .alert-link {
        cursor: pointer;
        text-decoration: none;
        color: #fff;

        &:hover {
          text-decoration: underline;
        }
      }
    }

    // Remove cursor pointer when showing form
    &:has(.rating-interface) {
      cursor: default;
    }
  }

  .rating-preview {
    // Let Bootstrap alert classes handle colors
    small {
      font-weight: 500;
    }
  }
}

/* Stickiness form controls styling */
.stickiness-select {
  background-color: var(--bs-light) !important;
  border-color: var(--bs-secondary) !important;
  color: var(--bs-dark) !important;
}

.stickiness-select option {
  background-color: var(--bs-light) !important;
  color: var(--bs-dark) !important;
}
</style>