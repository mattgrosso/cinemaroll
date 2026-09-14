<template>
  <div v-if="showTweakModal && (currentTournament || tiedGroupDbKeys.length >= 2)" class="tweak-inline">
    <!-- Single container that changes its content -->
    <Transition name="tweak-expand" mode="out-in">
      <!-- Prompt -->
      <div v-if="!showTweakInline" key="notice" class="prompt-card" @click="toggleTweakInline">
        <span class="prompt-badge prompt-badge-tiebreak"><i class="bi bi-signpost-split-fill"></i></span>
        <span class="prompt-body">
          <span class="prompt-label">Tiebreak</span>
          <p class="prompt-text">{{ tiedPromptText }}</p>
          <a class="prompt-action prompt-action-tiebreak" @click.stop="toggleTweakInline">Break the tie</a>
        </span>
      </div>

      <!-- Tournament just completed: show final standings -->
      <div v-else-if="tournamentIsComplete" key="results" class="tweak-container p-3">
        <div class="text-center mb-3">
          <h5 class="text-light mb-0">Tournament Complete!</h5>
          <p class="text-light small mb-0">Final standings for this tie</p>
        </div>
        <ol class="tournament-results list-unstyled mb-3">
          <li v-for="entry in resultsForDisplay" :key="entry.dbKey" class="d-flex align-items-center gap-2 mb-2">
            <span class="result-rank">{{ entry.rank + 1 }}</span>
            <img
              class="rounded result-thumb"
              :src="`https://image.tmdb.org/t/p/w92${topStructure(entry.movie).poster_path}`"
              :alt="topStructure(entry.movie).title"
            >
            <span class="text-light result-title">{{ topStructure(entry.movie).title }}</span>
            <span class="result-wins small ms-auto">{{ entry.wins }} win{{ entry.wins === 1 ? '' : 's' }}</span>
          </li>
        </ol>
        <!-- Bug report: a large tournament's final scores take a real,
             noticeable moment to save (one Firebase write per adjusted
             contestant) and the screen gave no indication anything was
             still happening - it just "seemed frozen". submitting now stays
             true until those writes actually resolve (see chooseWinner).

             Bug report (2026-08-24): "there's a spinner that says saving
             scores and there's a button that says done. The spinner should be
             in the button and should disable the button until we're done and
             then I can click done." The button WAS already disabled while
             saving, but with the spinner sitting above it as a separate line
             the two read as unrelated - a dead button next to a message,
             rather than one control that is busy. One element now says both
             things. -->
        <div class="text-center">
          <button
            type="button"
            class="btn btn-sm btn-outline-light tournament-done"
            :disabled="submitting"
            @click="acknowledgeResults"
          >
            <span
              v-if="submitting"
              class="spinner-border spinner-border-sm me-2"
              role="status"
              aria-hidden="true"
            ></span>
            {{ submitting ? 'Saving scores…' : 'Done' }}
          </button>
        </div>
      </div>

      <!-- Current match (guarded so a momentary null pair can never throw
           trying to render a poster for a movie that isn't there) -->
      <div v-else-if="firstResult && secondResult" key="form" class="tweak-container p-3">
        <!-- Title. Bug report: with a 2-way tie, progressLabel is empty (no
             subtitle line), which left the posters "pulled too tight" right
             under the header - mb-3 (was mb-2) gives consistent breathing
             room whether or not the subtitle is there. -->
        <div class="text-center mb-3">
          <h5 class="text-light mb-0">Break the Tie</h5>
          <p v-if="progressLabel" class="text-light small mb-0">{{ progressLabel }}</p>
        </div>

        <!-- The pair and its swapping indicator occupy the SAME box, one
             stacked over the other, so nothing on this card moves as a
             matchup swaps. Bug report, 2026-08-20: "The new loading state on
             the tie breaker is forcing the two empty poster spots down and
             then popping them back up. It's broken." — the two were siblings
             in normal flow, and `v-show` never hid the row: Bootstrap's
             .d-flex is `display: flex !important`, which beats the inline
             `display: none` v-show sets. So the spinner's 180px sat ABOVE a
             row that was still fully laid out. -->
        <div class="poster-stage">
          <!-- Shown until BOTH posters for this matchup have loaded, so a
               half-swapped pair is never tappable. -->
          <div v-if="!postersReady" class="posters-swapping text-center">
            <span class="spinner-border spinner-border-sm text-light" role="status" aria-hidden="true"></span>
            <span class="text-light ms-2">Loading the next pair&hellip;</span>
          </div>

          <!-- Two posters side by side. Hidden with `visibility`, not v-if or
               v-show: the <img> elements have to stay in the DOM and loading
               for their load events to be what lifts the gate, the row has to
               keep reserving its height (fixed 120x180 posters, so it is
               exactly right even before an image arrives), and a hidden row
               takes no taps. -->
          <div class="poster-row d-flex justify-content-center gap-4" :class="{ 'posters-hidden': !postersReady }">
            <div class="poster-container text-center" @click="chooseWinner(firstResult)">
              <div class="poster-wrapper">
                <img
                  :key="`first-${firstResult.dbKey}`"
                  ref="firstPoster"
                  class="rounded poster-image"
                  :src="`https://image.tmdb.org/t/p/w500${topStructure(firstResult).poster_path}`"
                  :alt="topStructure(firstResult).title"
                  @load="markPosterLoaded(firstResult.dbKey)"
                  @error="markPosterLoaded(firstResult.dbKey)"
                >
                <!-- Bug report: a stuck :hover on iOS (no real mouse to leave)
                     made the tapped poster look like it "got a little larger"
                     after selection, read as unwanted/confusing - :hover is
                     gone (see below), replaced with this deliberate checkmark
                     so there's still a clear "you picked this one" signal. -->
                <div v-if="selectedDbKey === firstResult.dbKey" class="selected-checkmark">
                  <i class="bi bi-check-lg"></i>
                </div>
              </div>
            </div>

            <div class="vs-divider d-flex align-items-center">
              <span class="text-light">vs</span>
            </div>

            <div class="poster-container text-center" @click="chooseWinner(secondResult)">
              <div class="poster-wrapper">
                <img
                  :key="`second-${secondResult.dbKey}`"
                  ref="secondPoster"
                  class="rounded poster-image"
                  :src="`https://image.tmdb.org/t/p/w500${topStructure(secondResult).poster_path}`"
                  :alt="topStructure(secondResult).title"
                  @load="markPosterLoaded(secondResult.dbKey)"
                  @error="markPosterLoaded(secondResult.dbKey)"
                >
                <div v-if="selectedDbKey === secondResult.dbKey" class="selected-checkmark">
                  <i class="bi bi-check-lg"></i>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="submitting" class="text-center">
          <span class="spinner-border spinner-border-sm text-light" role="status" aria-hidden="true"></span>
          <span class="text-light ms-2">Processing...</span>
        </div>

        <!-- Only for a real multi-match tournament — a 2-way tie is one pick
             and done, nothing to "save" partway through. Bug report: needed
             a bit more space above this button (mt-2 → mt-3). -->
        <div v-if="canSaveForLater" class="text-center mt-3">
          <button type="button" class="btn btn-sm btn-outline-light save-for-later-btn" @click="saveForLater">Save for later</button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script>
import { getRating } from "../assets/javascript/GetRating.js";
import { sortResultsFast } from "../assets/javascript/searchFiltering.js";
import {
  findTiedGroup,
  tiedContestantCount,
  countWord,
  createRoundRobinTournament,
  currentMatch,
  isComplete,
  recordMatchResult,
  progress,
  tweakDeltaForRank
} from "../assets/javascript/tieBreakTournament.js";

export default {
  name: "TweakInline",
  props: {
    allEntriesWithFlatKeywordsAdded: {
      type: Array,
      required: true
    },
    showTweakModal: {
      type: Boolean,
      required: true
    },
    // Open the tournament as soon as the prompt has a tie to show, instead
    // of waiting for a tap on the card — Home sets it when the app was
    // opened from a chore notification.
    autoOpen: {
      type: Boolean,
      default: false
    }
  },
  emits: ['tweak-updated'],
  data () {
    return {
      showTweakInline: false,
      submitting: false,
      // dbKey of whichever poster was just tapped - drives the checkmark
      // badge (see the template). Cleared once submitting flips back off,
      // so a repeat matchup later in the same tournament never shows a
      // stale checkmark on a poster that hasn't actually been picked yet.
      selectedDbKey: null,
      // Optimistic local copy of the tournament, set whenever this component
      // creates/updates it — Firebase's realtime round-trip back into
      // $store.state.settings.tieBreakTournament isn't synchronous, so
      // without this the UI would flash back to a stale state between
      // dispatch and the listener catching up. A fresh mount (no local copy
      // yet) just reads straight from the store, which is how a
      // days-spanning tournament survives across sessions.
      localTournament: null,
      // dbKeys whose poster has finished loading (or failed) for the match
      // currently on screen. Reset on every change of matchup — see
      // postersReady, and the bug report behind it.
      loadedPosterKeys: [],
      // Set when a tournament is acknowledged with "Done" in ordinary
      // (non-forced) mode, and cleared once the prompt has actually closed.
      // It stops needsNewTournament from self-starting the next tied group in
      // the window between "Done" and Home re-evaluating the daily quota —
      // see acknowledgeResults. Not something flush ordering should decide.
      justAcknowledged: false
    }
  },
  computed: {
    promptOnScreen () {
      return this.showTweakModal && (Boolean(this.currentTournament) || this.tiedGroupDbKeys.length >= 2);
    },
    currentLogIsTVLog () {
      return this.$store.state.currentLog === "tvLog";
    },
    // Bug report: with a large tournament (e.g. 33 contestants), the final
    // match felt "frozen for 5-6 seconds" after tapping the last poster.
    // Root cause: this used to be movies.sort(this.sortByRating), a naive
    // comparator calling the moderately-expensive getRating() up to twice
    // PER COMPARISON over the full library - and applyTournamentResults
    // fires up to N Firebase writes, each of which can re-trigger this
    // computed as movieLog updates land back. sortResultsFast (the same
    // decorate-sort-undecorate fix already applied to Home.vue's search/sort
    // path - see CLAUDE.md's "Search Recompute Performance") computes
    // getRating() ONCE per item instead, with identical resulting order.
    allMoviesRanked () {
      return sortResultsFast(this.$store.getters.allMoviesAsArray, {
        sortValue: 'rating',
        sortOrder: 'bestOrNewestOnTop',
        getRating
      });
    },
    // The full contiguous group of movies tied on rating score right now —
    // only relevant when there's no tournament already in progress (a
    // tournament's contestantIds are frozen at creation, see
    // tieBreakTournament.js, so this must never override an active one).
    tiedGroupDbKeys () {
      return findTiedGroup(this.allMoviesRanked, (movie) => getRating(movie).calculatedTotal)
        .map((movie) => movie.dbKey);
    },
    currentTournament () {
      return this.localTournament || this.$store.state.settings?.tieBreakTournament || null;
    },
    // The "force tiebreak to show" testing toggle (Home's settings pane).
    // Read straight from the store rather than taken as a prop: showTweakModal
    // is already true in both the forced and the ordinary case, so it can't
    // tell them apart, and acknowledgeResults needs to.
    tieBreakForced () {
      return this.$store.state.settings?.tieBreakPromptState === 'forced';
    },
    tournamentIsComplete () {
      return Boolean(this.currentTournament && isComplete(this.currentTournament));
    },
    currentMatchup () {
      if (!this.currentTournament || this.tournamentIsComplete) return null;
      return currentMatch(this.currentTournament);
    },
    firstResult () {
      if (!this.currentMatchup) return null;
      return this.allMoviesRanked.find((movie) => movie.dbKey === this.currentMatchup.a) || null;
    },
    secondResult () {
      if (!this.currentMatchup) return null;
      return this.allMoviesRanked.find((movie) => movie.dbKey === this.currentMatchup.b) || null;
    },
    // How many films this prompt is really about — the frozen contestant
    // list if a tournament is already under way, otherwise the tied group
    // that tapping through would enter.
    tiedCount () {
      return tiedContestantCount(this.currentTournament, this.tiedGroupDbKeys);
    },
    tiedPromptText () {
      // Was a fixed "Two films are sitting on the same score", which was
      // wrong every time a tie ran deeper than two (report
      // -P-FN61DdMmTJ0J9XJWy).
      return `${countWord(this.tiedCount)} films are sitting on the same score.`;
    },
    progressLabel () {
      if (!this.currentTournament) return '';
      const p = progress(this.currentTournament);
      // A 2-way tie is exactly one match (round-robin on 2 contestants) — not
      // really a "tournament", so don't narrate a contestant count/match
      // progress for what's just a single pick.
      if (p.total <= 1) return '';
      return `${p.contestants} contestants · match ${p.current} of ${p.total}`;
    },
    // Same "is this actually a multi-match tournament" check progressLabel
    // uses — "Save for later" only makes sense when there's more than one
    // match to walk away from.
    canSaveForLater () {
      if (!this.currentTournament) return false;
      return progress(this.currentTournament).total > 1;
    },
    resultsForDisplay () {
      if (!this.tournamentIsComplete) return [];
      return this.currentTournament.finalRanking
        .map((entry) => ({ ...entry, movie: this.allMoviesRanked.find((movie) => movie.dbKey === entry.dbKey) }))
        .filter((entry) => entry.movie);
    },
    // True exactly when this is visible, nothing is currently in progress,
    // and there's a fresh group to start one for.
    needsNewTournament () {
      if (this.justAcknowledged) return false;
      return this.showTweakModal && !this.currentTournament && this.tiedGroupDbKeys.length >= 2;
    },
    // Identifies the matchup on screen. Changing it is what resets the
    // loading gate below.
    matchKey () {
      return `${this.firstResult?.dbKey || ''}|${this.secondResult?.dbKey || ''}`;
    },
    /**
     * Both posters for the CURRENT match have finished (or failed) loading.
     *
     * Bug report, 2026-08-19: "the posters are a little bit slow to load and
     * so sometimes while I'm trying to go through the rounds quickly a poster
     * won't seem to swap, but then it suddenly changes something else and
     * it's awkward. We need to make some kind of indication that we're
     * swapping and then only show both posters when both posters are fully
     * loaded."
     *
     * Showing one new poster beside one stale one is what makes a fast tap
     * land on the wrong film. Until both are ready the pair is hidden behind
     * a swapping indicator and taps are refused outright, so there is no
     * window in which the screen is lying about what it is asking.
     */
    postersReady () {
      const first = this.firstResult?.dbKey;
      const second = this.secondResult?.dbKey;
      if (!first || !second) return false;
      return this.loadedPosterKeys.includes(first) && this.loadedPosterKeys.includes(second);
    }
  },
  created () {
    // Bug report: "swaps out one of the posters, but not the other one...
    // some way we can pre-cache the next setup." A resumed (page-reload)
    // mid-tournament session has a tournament record already but this
    // component's own prefetch (see ensureTournamentStarted) never ran for
    // it - warm the cache for it here too.
    if (this.currentTournament) this.prefetchTournamentPosters(this.currentTournament);
  },
  watch: {
    // Both immediate — see StickinessInline for why the order of the two
    // can go either way.
    autoOpen: { immediate: true, handler: 'maybeAutoOpen' },
    promptOnScreen: { immediate: true, handler: 'maybeAutoOpen' },
    // Every new matchup re-closes the loading gate, then re-opens it as each
    // poster reports in. `immediate` covers the first match of a tournament
    // and a resumed mid-tournament mount alike.
    matchKey: {
      immediate: true,
      handler () {
        this.loadedPosterKeys = [];
        this.$nextTick(() => this.syncLoadedFromDom());
      }
    },
    // Reacts to the STATE, not to showTweakModal merely changing value — with
    // "force tiebreak to show" enabled in settings, showTweakModal is pinned
    // true throughout, so a watcher on showTweakModal itself only ever fires
    // once (on mount) and never again once a tournament completes and
    // clears, leaving the next tied group undetected (reported bug: forcing
    // a tiebreak, finishing it, then tapping the next "you have a tie"
    // notice rendered nothing because no tournament existed for it to show).
    // Watching this computed instead re-fires whenever currentTournament
    // drops back to null while there's still something to start.
    needsNewTournament: {
      immediate: true,
      handler (needsOne) {
        if (needsOne) this.ensureTournamentStarted();
      }
    },
    // The prompt genuinely closing is the signal that the post-"Done" window
    // is over: Home has re-evaluated and decided this isn't due right now.
    // Whenever it next decides it IS due, the watcher above is free to start
    // the tournament for it.
    showTweakModal (isShowing) {
      if (!isShowing) this.justAcknowledged = false;
    }
  },
  methods: {
    maybeAutoOpen () {
      if (this.autoOpen && this.promptOnScreen) this.showTweakInline = true;
    },
    toggleTweakInline () {
      this.showTweakInline = true;
    },
    closeTweakInline () {
      this.showTweakInline = false;
    },
    topStructure (result) {
      if (this.currentLogIsTVLog) {
        return result.tvShow;
      } else {
        return result.movie;
      }
    },
    mostRecentRatingIndex (result) {
      let mostRecentRating = result.ratings[0];
      let mostRecentRatingIndex = 0;

      result.ratings.forEach((rating, index) => {
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
    // Every write in this component goes through writeDurably (not
    // setDBValue) — bug report: tiebreaker picks should work offline and
    // sync once back online, same guarantee AddRating.js's ratings already
    // have. writeDurably commits locally (via applyDbPathLocally) before
    // durably queuing, so localTournament here is now belt-and-suspenders
    // rather than the only thing standing between a pick and a stale UI —
    // still kept as-is since Firebase's own onValue listener update is a
    // separate, slightly-later event either way. See CLAUDE.md's Offline
    // Support Extension section.
    //
    // Returns true if a tournament is (now) in progress, false if there was
    // nothing left to start it for — callers use this to decide whether to
    // keep the panel open on the next match or collapse it.
    ensureTournamentStarted () {
      if (this.currentTournament) return true;
      if (this.tiedGroupDbKeys.length < 2) return false;

      // Random match order per user feedback — otherwise every one of one
      // contestant's matches plays before the next contestant's begin.
      const tournament = createRoundRobinTournament(this.tiedGroupDbKeys, Math.random);
      this.localTournament = tournament;
      this.$store.dispatch('writeDurably', { path: 'settings/tieBreakTournament', value: tournament });
      // Every contestant in a round-robin tournament is known upfront - warm
      // the browser's image cache for all of them now rather than letting
      // each match's poster load cold, staggered by individual network/
      // decode time (see the bug report on prefetchTournamentPosters).
      this.prefetchTournamentPosters(tournament);
      return true;
    },
    // Kicks off a fetch for every contestant's poster without rendering
    // anything - purely to populate the browser's HTTP cache ahead of time,
    // so that by the time a match involving a given poster is actually
    // shown, the image paints immediately instead of arriving late.
    prefetchTournamentPosters (tournament) {
      (tournament?.contestantIds || []).forEach((dbKey) => {
        const movie = this.allMoviesRanked.find((m) => m.dbKey === dbKey);
        const posterPath = movie ? this.topStructure(movie)?.poster_path : null;
        if (!posterPath) return;
        const img = new Image();
        img.src = `https://image.tmdb.org/t/p/w500${posterPath}`;
      });
    },
    clearCompletedTournament () {
      this.localTournament = null;
      this.$store.dispatch('writeDurably', { path: 'settings/tieBreakTournament', value: null });
    },
    markPosterLoaded (dbKey) {
      if (!dbKey || this.loadedPosterKeys.includes(dbKey)) return;
      this.loadedPosterKeys = [...this.loadedPosterKeys, dbKey];
    },
    // A poster already in the browser cache can finish loading before Vue
    // attaches the load listener, and then the event never comes and the gate
    // never lifts. `complete` is the state, not the event, so checking it
    // after the swap catches exactly that case — which is the COMMON one
    // here, since prefetchTournamentPosters deliberately warms every
    // contestant's poster upfront.
    syncLoadedFromDom () {
      [['firstPoster', this.firstResult], ['secondPoster', this.secondResult]]
        .forEach(([ref, result]) => {
          const img = this.$refs[ref];
          if (img && img.complete && result?.dbKey) this.markPosterLoaded(result.dbKey);
        });
    },
    async chooseWinner (winnerResult) {
      if (!winnerResult || !this.currentTournament) return;
      // Refuse a tap aimed at a pair that isn't fully on screen yet.
      if (!this.postersReady) return;
      this.submitting = true;
      this.selectedDbKey = winnerResult.dbKey;

      const updatedTournament = recordMatchResult(this.currentTournament, winnerResult.dbKey);
      this.localTournament = updatedTournament;
      this.$store.dispatch('writeDurably', { path: 'settings/tieBreakTournament', value: updatedTournament });
      // NOT stamping settings/lastTweak here unconditionally anymore — that
      // used to reset the daily-quota clock after EVERY match, which made
      // shouldShowTieBreakModal (Home.vue) go false and hide this whole
      // component right after the first pick of any multi-match tournament.
      // Per feedback ("I wanna do a few in a row, especially when there's a
      // bigger tournament"), the default is now to keep walking through
      // every match of the CURRENT tournament in one sitting; the quota
      // clock only resets at an actual stopping point — see the two branches
      // below, acknowledgeResults, and saveForLater.

      // Resolves once every score-adjustment write has actually landed (see
      // applyTournamentResults) - awaited below so `submitting` reflects the
      // real save time instead of flipping back to false the instant these
      // fire-and-forget dispatches are merely KICKED OFF. Local UI
      // transitions (fast-path close/next-tournament, below) still happen
      // immediately - only the spinner/Done-button wait on this.
      let resultsSaved = Promise.resolve();

      if (isComplete(updatedTournament)) {
        resultsSaved = this.applyTournamentResults(updatedTournament);

        // A 2-way tie completes in exactly one match — showing the
        // "Tournament Complete!" standings screen (which needs an explicit
        // "Done" tap) is needless ceremony for what's really just picking a
        // winner. Skip straight past it: clear this tournament, collapse
        // the panel, and reset the quota clock.
        //
        // Bug report ("I was presented with a new tiebreaker... after doing
        // the first round it didn't actually close... if it's just an
        // individual matchup, that should count as my tiebreak for this
        // time"): this used to immediately chain into ANOTHER tied group's
        // first match, still inside this same open panel, if one existed
        // elsewhere in the library - with no visual break, that read as
        // "it never closes." The daily-quota setting exists to rate-limit
        // how often tie-breaking interrupts the user; silently chaining
        // into an unrelated group defeats that, even though resolving
        // multiple matches WITHIN one already-started tournament (the
        // 3+-contestant case, or a bigger one you keep tapping through) is
        // still fine to do in one sitting - that's a different thing from
        // auto-starting a brand new, unrelated one. Now this always closes
        // and stamps lastTweak here, exactly like a 3+-contestant
        // tournament's "Done" tap already does; the next scan (whenever the
        // quota next allows) picks up any other tied group fresh at that
        // later point.
        if (updatedTournament.contestantIds.length <= 2) {
          this.clearCompletedTournament();
          this.closeTweakInline();
          this.$store.dispatch('writeDurably', { path: 'settings/lastTweak', value: Date.now() });
        }
        // 3+-contestant completion falls through to the "Tournament
        // Complete!" screen — acknowledgeResults stamps lastTweak once the
        // user taps "Done" there, not here.
      }

      // Emit event to parent to update data
      this.$emit('tweak-updated');

      await resultsSaved;
      this.submitting = false;
      this.selectedDbKey = null;
    },
    // Applies the rank-based score adjustment to every contestant in one
    // batch, once the tournament's last match has been decided. The top
    // rank (0) is left untouched, matching the old single-pair tiebreak's
    // "winner untouched, loser penalized" behavior. Returns a Promise that
    // resolves once every write has landed (see chooseWinner).
    applyTournamentResults (tournament) {
      // Each contestant's write is isolated in its own try/catch — bug
      // report: "tie break tournaments are only adjusting the score of one
      // movie... a tournament with 5 contestants... then it gives me a
      // tournament with 4 of those same 5. And then 3." That's the
      // signature of ONE contestant's entry throwing mid-batch (this used
      // to be a single .map with no guards, so the first throw silently
      // abandoned every write after it). The known way a real entry
      // throws here: `ratings` arriving as {0:…,1:…} instead of an array
      // (the documented {...someArray} local-commit mangling), which made
      // .slice() blow up. Both are handled: object-shaped ratings are
      // normalized, and any other per-entry failure skips that one
      // contestant loudly instead of aborting the rest.
      const writes = tournament.finalRanking.map((entry) => {
        try {
          const delta = tweakDeltaForRank(entry.rank);
          if (delta === 0) return null;

          const movie = this.allMoviesRanked.find((m) => m.dbKey === entry.dbKey);
          if (!movie) {
            console.error('applyTournamentResults: contestant missing from library, skipping:', entry.dbKey);
            return null;
          }

          const ratings = Array.isArray(movie.ratings) ? movie.ratings : Object.values(movie.ratings || {});
          if (!ratings.length) return null;

          const ratingIndex = this.mostRecentRatingIndex({ ratings });
          const currentTweakValue = ratings[ratingIndex].tweakValue || 0;

          const movieWithRating = {
            ...movie,
            ratings: ratings.map((rating, index) => {
              if (index === ratingIndex) {
                return { ...rating, tweakValue: currentTweakValue + delta, userTweaked: true };
              }
              return rating;
            })
          };

          return this.$store.dispatch('writeDurably', { path: `movieLog/${movie.dbKey}`, value: movieWithRating });
        } catch (error) {
          console.error('applyTournamentResults: failed for one contestant, applying the rest anyway:', entry.dbKey, error);
          return null;
        }
      }).filter(Boolean);

      return Promise.all(writes);
    },
    acknowledgeResults () {
      this.clearCompletedTournament();
      this.closeTweakInline();
      // The multi-match-tournament equivalent of the 2-way fast path's
      // session-end stamp above — this tournament is fully done and
      // acknowledged, so reset the daily-quota clock now.
      this.$store.dispatch('writeDurably', { path: 'settings/lastTweak', value: Date.now() });
      // Bug report, 2026-08-20: "I just finished a tie break tournament and
      // it is immediately offering me another one. There is supposed to be a
      // delay between prompts."
      //
      // Stamping lastTweak above is not enough on its own, because Home's
      // activeModalType pins the prompt open for as long as a tournament
      // RECORD exists — deliberately, so nothing can steal the screen
      // mid-tournament — and checks the daily quota only when there is no
      // record. Creating the next tournament here therefore walked straight
      // past the delay that had just been set.
      //
      // The eager start only ever existed for the "force tiebreak" testing
      // toggle, where showTweakModal is pinned true and so the
      // needsNewTournament watcher never re-fires on its own. Keep it for
      // exactly that case; in normal use, leave the next tied group alone and
      // let the quota decide when to offer it.
      if (this.tieBreakForced) {
        this.ensureTournamentStarted();
      } else {
        // needsNewTournament would otherwise start it a tick later anyway,
        // while showTweakModal is still true and Home hasn't re-evaluated.
        this.justAcknowledged = true;
      }

      // Emit event to parent to update data
      this.$emit('tweak-updated');
    },
    // Explicit opt-out from "do the whole tournament in one sitting" — pauses
    // mid-tournament without losing progress (already persisted after every
    // pick) and resets the daily-quota clock so the panel doesn't immediately
    // reopen; it'll resume right where it was left, whenever it's next due.
    saveForLater () {
      this.$store.dispatch('writeDurably', { path: 'settings/lastTweak', value: Date.now() });
      this.closeTweakInline();
      this.$emit('tweak-updated');
    }
  }
}
</script>

<style lang="scss" scoped>
/* 44px, because this is a phone and a btn-sm is otherwise under the 40px
   minimum. A fixed min-width stops the button changing size when its label
   swaps between "Saving scores…" and "Done", which would make it jump under
   the finger at the exact moment it becomes tappable. */
.tournament-done {
  min-height: 44px;
  min-width: 11rem;
}

@import '@/assets/scss/prompt-card';

// Tweak inline animation
.tweak-expand-enter-active,
.tweak-expand-leave-active {
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.tweak-expand-enter-from {
  opacity: 0;
}

.tweak-expand-enter-to {
  opacity: 1;
}

.tweak-expand-leave-from {
  opacity: 1;
}

.tweak-expand-leave-to {
  opacity: 0;
}

// Tweak content styling
.tweak-inline {
  .tweak-container {
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

    .tweak-notice-content {
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
    &:has(.poster-container) {
      cursor: default;
    }
  }

  // The pair and its loading indicator share one box, stacked. The row's own
  // height (fixed 120x180 posters + 2px borders) is what the stage measures,
  // so the card is exactly as tall while loading as it is when loaded and
  // nothing shifts when the indicator goes away.
  .poster-stage {
    position: relative;
  }

  .posters-swapping {
    align-items: center;
    display: flex;
    inset: 0;
    justify-content: center;
    position: absolute;
  }

  // NOT `v-show` — Bootstrap's .d-flex on this same element is
  // `display: flex !important` and beats the inline `display: none` v-show
  // sets, so the row stayed laid out under the indicator and visibly dropped
  // 180px (bug report, 2026-08-20). `visibility` keeps the height reserved,
  // keeps the <img>s loading (which is what lifts the gate), and stops taps.
  .poster-row.posters-hidden {
    visibility: hidden;
  }

  .poster-container {
    cursor: pointer;
    transition: transform 0.2s ease;

    // Mobile-first: no :hover here anymore (bug report - a stuck :hover on
    // iOS, with no real mouse to trigger mouseleave, made a just-tapped
    // poster look like it "got a little larger" after selection, read as
    // an unwanted/confusing effect rather than intentional feedback). Only
    // :active fires reliably on tap AND always releases afterward; the
    // .selected-checkmark badge below is the actual "you picked this one"
    // signal now.
    &:active {
      transform: scale(0.95);
    }

    .poster-wrapper {
      position: relative;
      border: 2px solid rgba(255, 255, 255, 0.3);
      border-radius: 8px;
      overflow: hidden;
      transition: border-color 0.2s ease;
    }

    &:active .poster-wrapper {
      border-color: rgba(255, 255, 255, 0.8);
    }

    .poster-image {
      width: 120px;
      height: 180px;
      object-fit: cover;
      display: block;
    }
  }

  // Deliberate "you picked this one" indicator (bug report: "I do want an
  // indication that I have clicked on one... a little checkmark"), shown
  // only on the poster whose dbKey matches selectedDbKey, for the duration
  // of submitting.
  .selected-checkmark {
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

  .vs-divider {
    font-size: 1.2rem;
    font-weight: bold;
    opacity: 0.7;
  }

  .tournament-results {
    max-height: 260px;
    overflow-y: auto;

    .result-rank {
      color: #ccc;
      font-weight: bold;
      min-width: 1.2rem;
      text-align: center;
    }

    .result-thumb {
      width: 32px;
      height: 48px;
      object-fit: cover;
      flex-shrink: 0;
    }

    .result-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    // Bootstrap's .text-muted (~#6c757d) fails contrast against this card's
    // #4a4a4a background — matches .result-rank's lighter grey instead.
    .result-wins {
      color: #ccc;
      flex-shrink: 0;
    }
  }

  .btn {
    min-width: 120px;
  }
}
</style>