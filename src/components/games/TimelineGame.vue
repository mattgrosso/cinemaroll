<template>
  <div class="timeline-game" :style="started ? { '--step-duration': stepDurationMs + 'ms' } : {}">
    <BackLink/>
    <GameHowTo/>

    <div v-if="eligibleGameEntries.length < 5" class="not-enough-movies">
      <p>Rate a few more movies before there's enough to build a timeline with.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <div v-else-if="!started" class="setup">
      <p>Guess where each movie belongs, chronologically, among your own rated library — building a timeline one card at a time. Ties count either way.</p>
      <button type="button" class="btn-game btn-game-primary cta-btn full-width" @click="start">Start</button>
    </div>

    <template v-else>
      <p class="status-line">{{ statusMessage }}</p>
      <p class="streak-line">Streak {{ streak }} · Best {{ bestStreak }}</p>

      <div class="timeline-row">
        <template v-for="item in timelineDisplayItems">
          <!-- Placement in progress at this slot: the settling poster AND
               its two new flanking placeholder gaps all grow in TOGETHER
               (bug report: "have it expand and the plus sign gap markers
               also expand at the same time") -- see guess()/
               expandWithFlanks. The flanks are purely visual, not real
               timeline data yet; the real insertion (which creates the
               ACTUAL flanking gaps, already resting at this same size)
               only happens once everything here has finished animating,
               so the handoff to the real elements is invisible -- same
               trick the poster-in-gap -> real-card poster swap uses. -->
          <template v-if="item.type === 'gap' && item.slotIndex === placingGapIndex">
            <div
              v-if="showPlacingFlanks"
              :key="`${item.key}-flank-before`"
              class="timeline-gap placing-flank"
              :class="{ wide: placingFlanksWide }"
            ></div>
            <div :key="item.key" class="timeline-gap placing-gap" :class="{ wide: placingWide }">
              <img v-if="placingPosterUrl" :src="placingPosterUrl" alt="">
            </div>
            <div
              v-if="showPlacingFlanks"
              :key="`${item.key}-flank-after`"
              class="timeline-gap placing-flank"
              :class="{ wide: placingFlanksWide }"
            ></div>
          </template>
          <button
            v-else-if="item.type === 'gap'"
            :key="item.key"
            type="button"
            class="timeline-gap"
            :class="{ 'correct-gap': item.slotIndex === correctSlotOnLoss }"
            :disabled="revealed || !mysteryCard"
            @click="guess(item.slotIndex, $event)"
          >+</button>
          <div v-else :key="item.key" class="timeline-card" :data-card-key="item.key">
            <img v-if="gamePosterUrl(item.entry)" :src="gamePosterUrl(item.entry, 'w185')" :alt="item.entry.movie.title">
            <p class="timeline-year">{{ formatTimelineDate(item.entry, timeline) }}</p>
          </div>
        </template>
      </div>

      <!-- No title/year shown here — tap a gap directly; correct/incorrect
           feedback is a border-color change on the card itself instead of
           separate text, and the year appears once it joins the timeline.
           Hidden for the ENTIRE placement sequence (isPlacing), not just
           while the step-1 clone is mid-flight -- it starts pixel-aligned
           with the clone, so the swap is invisible, and it must stay
           hidden through the settle+expand step too or it'd reappear at
           the bottom while the poster is still settling into the
           timeline above. -->
      <!-- Wrapped in a Transition purely so the NEXT mystery card fades in
           softly instead of popping into existence (bug report: "make
           that fade in a little bit softer") — a plain CSS transition on
           the div itself wouldn't animate this, since v-if unmounts the
           old card and mounts a brand new element for the new one, not a
           property change on the same node. Only an enter transition is
           defined (see .mystery-fade-* below) — leaving is still
           instant, unchanged from before, since only the arrival was
           reported as abrupt. -->
      <Transition name="mystery-fade">
        <div
          v-if="mysteryCard && !isPlacing"
          ref="mysteryCardEl"
          class="mystery-card"
          :class="{ correct: revealed && lastGuessCorrect, incorrect: revealed && lastGuessCorrect === false }"
        >
          <img v-if="gamePosterUrl(mysteryCard)" :src="gamePosterUrl(mysteryCard, 'w342')" :alt="mysteryCard.movie.title">
        </div>
      </Transition>

      <!-- Step 1: the poster mid-flight from the mystery card's spot to
           the tapped gap's own (narrow) position — see guess()/
           flyToGap. position:fixed means its place in the template
           doesn't matter for layout. -->
      <img
        v-if="flyingCard"
        class="flying-card"
        :class="{ animating: flyingCardAnimating }"
        :src="flyingCard.posterUrl"
        :style="flyingCard.style"
        alt=""
      >

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
import GameHowTo from './GameHowTo.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { shuffle, entryKey, movieYear } from '../../assets/javascript/games/gameUtils.js';
import { isValidPlacement, insertAtSlot, correctSlotIndex, formatTimelineDate } from '../../assets/javascript/games/timeline.js';
import timelineBanner from '../../assets/images/games/timeline-banner.jpg';

export default {
  name: 'TimelineGame',
  components: { BackLink, GameHowTo, NewRatingSearch },
  mixins: [gameDataMixin],
  // Custom banner graphic (with its own "Timeline / Cinema Roll Games"
  // branding baked in) in place of the usual movie-backdrop banner, and
  // hides the "Cinema Roll" title overlay so it doesn't compete with that
  // baked-in branding — same pattern as the other 4 games, see CLAUDE.md.
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', timelineBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      started: false,
      pool: [],
      poolIndex: 0,
      timeline: [],
      mysteryCard: null,
      revealed: false,
      lastGuessCorrect: null,
      streak: 0,
      gameOver: false,
      ranOutOfMovies: false,
      // The placement animation's remaining steps are driven by this ONE
      // duration (bound to --step-duration on the root element so the
      // CSS transitions below and the JS `wait`s in guess() can never
      // drift out of sync with each other). Started at 2000ms ("make it
      // really slow... so that we can lock in the sequence") while the
      // sequence itself was being worked out; now tuning down in halving
      // steps once confirmed correct — 2000 -> 500 -> 250ms.
      stepDurationMs: 250,
      // Named/exposed (not just inlined in preloadImage) so it's a single
      // source of truth: production reads it there, and tests can
      // reference it symbolically instead of hardcoding "1500" — this is
      // a FIXED cap, deliberately NOT tied to stepDurationMs, so as
      // stepDurationMs gets tuned down it can end up being the longer of
      // the two (which is fine — it's a worst-case safety net, not
      // something that needs to shrink in lockstep).
      preloadCapMs: 1500,
      // True for the entire placement sequence (not just step 1) — gates
      // the real .mystery-card so it doesn't reappear at the bottom
      // mid-sequence once the step-1 clone hands off to the settle step.
      isPlacing: false,
      // Step 1: a position:fixed clone that slides+shrinks from the
      // mystery card's spot to the tapped gap's own (narrow) position.
      flyingCard: null,
      flyingCardAnimating: false,
      // Step 2 (settle+expand, merged — bug report: "have it expand and
      // the plus sign gap markers also expand at the same time"): the
      // clone is gone — the REAL tapped gap element now hosts the poster
      // (still narrow) and then widens to the final card size, WHILE its
      // two new flanking placeholder gaps (below) grow in alongside it on
      // the exact same timing. Using the real flex child for the poster
      // (not another fixed-position clone) means the row reflows around
      // it naturally via normal layout, no manual "where do the
      // neighbors end up" math needed.
      placingGapIndex: null,
      placingPosterUrl: null,
      placingWide: false,
      // Purely-visual placeholders for the two gaps that WILL flank the
      // placed card, rendered adjacent to placingGapIndex — not real
      // timeline data yet. They start collapsed and grow to their normal
      // resting size in lockstep with placingWide (same nextFrame flip,
      // same wait). The real insertion (which creates the ACTUAL
      // flanking gaps, already at this exact resting size) only happens
      // once these have finished, so swapping from the fake placeholders
      // to the real gaps is invisible — same trick the placing-gap's
      // poster -> real-card poster swap already relies on.
      showPlacingFlanks: false,
      placingFlanksWide: false
    };
  },
  computed: {
    bestStreak () {
      return this.$store.state.settings?.games?.timelineBestStreak || 0;
    },
    mysteryYearDisplay () {
      return movieYear(this.mysteryCard) ?? '?';
    },
    // The gap between two placed cards a wrong guess actually belonged in —
    // shown as a highlight on the loss screen so the player sees the near
    // miss instead of just "wrong." Only meaningful right after a loss (not
    // the ran-out-of-movies win state, which has no wrong guess to explain).
    correctSlotOnLoss () {
      if (!this.revealed || this.lastGuessCorrect !== false || !this.mysteryCard) return null;
      return correctSlotIndex(this.timeline, this.mysteryCard);
    },
    statusMessage () {
      if (this.ranOutOfMovies) return `You've placed your whole library! Final streak: ${this.streak}.`;
      if (!this.mysteryCard) return '';
      if (!this.revealed) return 'Where does this belong? Tap a gap in the timeline.';
      if (this.lastGuessCorrect) return `Correct — ${this.mysteryCard.movie.title} (${this.mysteryYearDisplay}).`;
      return `Not quite — ${this.mysteryCard.movie.title} was ${this.mysteryYearDisplay}. Final streak: ${this.streak}.`;
    },
    // Alternates gap/card/gap/card/.../gap so the template can render one
    // flat, horizontally-scrolling row (same pattern as Six Degrees'
    // .chain-row) — N placed cards always have exactly N+1 gaps around them.
    //
    // Gap keys are based on the card immediately BEFORE them (or
    // 'gap-start' for the very first one), NOT their raw array index.
    // Index-based keys are unstable across insertion — inserting a card
    // shifts every subsequent gap's index, so Vue's keyed diffing would
    // treat most gaps after the insertion point as "the same element,
    // just moved" rather than tracking real identity. That mismatch was
    // why the two gaps newly flanking a placed card didn't reliably grow
    // from a clean 0 width (bug report: "they aren't expanding from 0
    // width they pop in with some amount of width and border") — at
    // least one of the two was actually a REUSED, already-painted-at-
    // normal-size DOM node, not a fresh mount. Keying by neighboring card
    // identity means inserting a card only ever creates exactly one
    // genuinely NEW gap (the other flanking gap correctly continues the
    // identity of whichever old gap it's a continuation of) — gaps
    // elsewhere in the row, unrelated to this insertion, keep their exact
    // same DOM node.
    timelineDisplayItems () {
      const items = [];
      let previousCardKey = 'start';
      this.timeline.forEach((entry, index) => {
        items.push({ type: 'gap', key: `gap-after-${previousCardKey}`, slotIndex: index });
        const cardKey = entryKey(entry) || `card-${index}`;
        items.push({ type: 'card', key: cardKey, entry });
        previousCardKey = cardKey;
      });
      items.push({ type: 'gap', key: `gap-after-${previousCardKey}`, slotIndex: this.timeline.length });
      return items;
    }
  },
  methods: {
    movieYear,
    formatTimelineDate,
    start () {
      this.pool = shuffle(this.eligibleGameEntries, Math.random);
      this.timeline = [this.pool[0]];
      this.poolIndex = 1;
      this.mysteryCard = this.nextCard();
      this.revealed = false;
      this.lastGuessCorrect = null;
      this.streak = 0;
      this.gameOver = false;
      this.ranOutOfMovies = false;
      this.isPlacing = false;
      this.flyingCard = null;
      this.flyingCardAnimating = false;
      this.placingGapIndex = null;
      this.placingPosterUrl = null;
      this.placingWide = false;
      this.showPlacingFlanks = false;
      this.placingFlanksWide = false;
      this.started = true;
    },
    nextCard () {
      if (this.poolIndex >= this.pool.length) return null;
      const next = this.pool[this.poolIndex];
      this.poolIndex += 1;
      return next;
    },
    wait (ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    // Two animation frames, not one: a single forced-reflow isn't reliably
    // enough to make a transition actually play on a value that was just
    // set THIS SAME TICK — without a real committed paint of the "from"
    // state to transition away from, browsers can just jump straight to
    // the end state with no visible motion at all (this is what "there's
    // really no animation at all" turned out to be, the first time this
    // was attempted with a single `el.offsetHeight` reflow instead). Two
    // rAFs is the standard, reliable fix. vi.advanceTimersByTimeAsync
    // fakes requestAnimationFrame too, so this stays fully testable.
    nextFrame () {
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    },
    // Fully decodes an image before the promise resolves — not just
    // "loaded" (bytes fetched), DECODED (ready to paint with zero extra
    // work). Used to fully eliminate the flash between the flying/
    // placing-gap poster and the next element that takes over showing
    // the same artwork (bug report: "a flash between when the animated
    // poster gets in place and when it gets replaced with the real
    // poster"). Guessing/hoping the browser's HTTP cache makes a second
    // <img> with the same src "basically instant" isn't reliable enough
    // — decode is a real, sometimes-nontrivial step even for a cached
    // resource, especially on mobile.
    //
    // Raced against a generous timeout rather than awaited unconditionally
    // — decode()/onload are real browser APIs that never resolve at all in
    // jsdom (confirmed directly: an unbounded await here hung a test
    // indefinitely), and even in production a stuck/rejected decode should
    // never be able to block the placement sequence forever. Worst case
    // (decode genuinely slower than the cap, or fails) the swap just isn't
    // perfectly instant — never broken.
    preloadImage (url) {
      if (!url) return Promise.resolve();
      const img = new Image();
      img.src = url;
      const attempt = img.decode
        ? img.decode().catch(() => {})
        : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; });
      return Promise.race([attempt, this.wait(this.preloadCapMs)]);
    },
    // Step 1: slide + shrink a decoupled clone from the mystery card's own
    // spot to the tapped gap's position/size. Deliberately does NOT clear
    // flyingCard once the wait resolves — see expandWithFlanks, which
    // clears it in the SAME synchronous block as revealing the next
    // element, for the same "no intermediate blank frame" reason
    // documented there.
    async flyToGap (posterUrl, fromRect, toRect) {
      this.flyingCard = { posterUrl, style: { left: `${fromRect.left}px`, top: `${fromRect.top}px`, width: `${fromRect.width}px`, height: `${fromRect.height}px` } };
      this.flyingCardAnimating = false;
      await this.nextFrame();
      this.flyingCard = { posterUrl, style: { left: `${toRect.left}px`, top: `${toRect.top}px`, width: `${toRect.width}px`, height: `${toRect.height}px` } };
      this.flyingCardAnimating = true;
      await this.wait(this.stepDurationMs);
    },
    // Step 2 (settle+expand, merged — bug report: "have it expand and the
    // plus sign gap markers also expand at the same time"): the poster
    // now lives inside the REAL tapped gap element (already sitting at
    // that exact spot, so no jump from step 1) and widens to the final
    // card size, WHILE its two new flanking placeholder gaps (purely
    // visual — see showPlacingFlanks) appear alongside it and grow to
    // their resting size on the exact same timing. A plain CSS width
    // transition on a real layout element for the poster's own gap means
    // neighboring cards/gaps reflow around it naturally without any
    // manual position math.
    //
    // Clearing the flying clone AND revealing everything here is done
    // together, right here, as this function's own synchronous prefix
    // (not split across the await boundary between flyToGap returning and
    // this function being called) — same "batch it or Vue paints an
    // intermediate frame" reasoning as the placing overlay -> real-card
    // handoff below. By the time this runs, the caller has already
    // awaited the poster's decode (see guess()), so revealing it here is
    // guaranteed flash-free.
    //
    // Also deliberately does NOT clear placingGapIndex/placingPosterUrl/
    // placingWide/showPlacingFlanks/placingFlanksWide once the wait
    // resolves — that has to happen in the SAME synchronous block as the
    // real timeline insertion (see guess()), or the microtask boundary
    // introduced by awaiting this function's own return lets Vue paint an
    // intermediate "back to a blank + gap" frame before the real card
    // lands (bug report: "the poster disappears... then reappears").
    async expandWithFlanks (posterUrl, slotIndex) {
      this.flyingCard = null;
      this.flyingCardAnimating = false;
      this.placingPosterUrl = posterUrl;
      this.placingGapIndex = slotIndex;
      this.placingWide = false;
      this.showPlacingFlanks = true;
      this.placingFlanksWide = false;
      await this.nextFrame();
      this.placingWide = true;
      this.placingFlanksWide = true;
      await this.wait(this.stepDurationMs);
    },
    async guess (slotIndex, event) {
      if (this.revealed || this.gameOver || !this.mysteryCard) return;

      const correct = isValidPlacement(this.timeline, slotIndex, this.mysteryCard);
      this.revealed = true;
      this.lastGuessCorrect = correct;

      if (!correct) {
        this.recordGameRound({ streak: this.streak });
        this.gameOver = true;
        return;
      }

      const placedEntry = this.mysteryCard;
      const posterUrl = this.gamePosterUrl(placedEntry, 'w342');
      // The REAL timeline-card (mounted once the data actually lands)
      // uses a different, smaller size than the flying/placing poster —
      // a genuinely different URL, so preloading the large one doesn't
      // cover it. Both are kicked off together, below, as early as
      // possible.
      const finalPosterUrl = this.gamePosterUrl(placedEntry, 'w185');
      const fromRect = this.$refs.mysteryCardEl ? this.$refs.mysteryCardEl.getBoundingClientRect() : null;
      const gapEl = event && event.currentTarget ? event.currentTarget : null;
      const narrowRect = gapEl ? gapEl.getBoundingClientRect() : null;
      const canAnimate = !!(fromRect && fromRect.width && narrowRect && narrowRect.width);

      // Brief pause so the green border is actually readable before the
      // placement sequence begins — bug report: "when I click a slot, I
      // want it to look like the poster from the bottom slides up into
      // the slot I chose and the slot gets larger to accommodate it."
      await this.wait(400);

      if (canAnimate) {
        this.isPlacing = true;
        // Kicked off as early as possible so decoding happens IN
        // PARALLEL with the (multi-second) animation, not after it —
        // by the time either is actually needed, it's almost certainly
        // already resolved, so awaiting it below costs nothing in the
        // common case. Bug report: "there is often a flash between when
        // the animated poster gets in place and when it gets replaced
        // with the real poster... have the animated poster stay in
        // place for longer until we're certain the real poster is fully
        // loaded behind it" — that's exactly what awaiting these
        // immediately before each swap achieves: the outgoing visual
        // (flying clone, then the placing-gap poster) is only ever
        // cleared in the SAME synchronous step as revealing something
        // already guaranteed ready, never a step earlier.
        const decodeLarge = this.preloadImage(posterUrl);
        const decodeSmall = this.preloadImage(finalPosterUrl);
        await this.flyToGap(posterUrl, fromRect, narrowRect);
        await decodeLarge;
        await this.expandWithFlanks(posterUrl, slotIndex);
        await decodeSmall;
      }

      // Everything below is deliberately ONE synchronous block, with no
      // `await` between any of these statements: clearing every placing/
      // flank overlay flag AND committing the real timeline insertion
      // batch into a SINGLE Vue update/paint this way. Splitting them
      // across an await boundary (an earlier version) let Vue paint an
      // intermediate frame — poster gone, real card not yet inserted —
      // which is what previously read as "the poster disappears... then
      // reappears" (bug report). Since expandWithFlanks already grew the
      // fake flanking placeholders to their exact resting size, the real
      // gaps this insertion creates land at that same size — the swap
      // from fake to real is invisible.
      this.placingGapIndex = null;
      this.placingPosterUrl = null;
      this.placingWide = false;
      this.showPlacingFlanks = false;
      this.placingFlanksWide = false;

      this.timeline = insertAtSlot(this.timeline, slotIndex, placedEntry);
      this.streak += 1;
      this.recordGameWin(); // one correct placement counts — see the mixin
      if (this.streak > this.bestStreak) {
        this.$store.dispatch('writeDurably', { path: 'settings/games/timelineBestStreak', value: this.streak });
      }

      if (canAnimate) {
        this.isPlacing = false;
      }

      const next = this.nextCard();
      if (!next) {
        this.mysteryCard = null;
        this.ranOutOfMovies = true;
        // Placing the whole library is a run end too — arguably the best one.
        this.recordGameRound({ streak: this.streak });
        this.gameOver = true;
        return;
      }

      this.mysteryCard = next;
      this.revealed = false;
      this.lastGuessCorrect = null;
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.timeline-game {
  color: #eee;
  // Safety margin against BackLink overlapping this screen's own content
  // when the global Header happens to have zero height — same fix as the
  // other 4 game components. Trimmed from 2.5rem (bug report: "move the
  // whole thing up higher") — same tradeoff Six Degrees already made.
  padding: 1.75rem 1rem 2rem;
  text-align: center;
}

.not-enough-movies {
  color: #adb5bd;
  margin: 2rem 0;
}

.setup p {
  color: #adb5bd;
  margin: 0.75rem 0 1.5rem;
}

.cta-btn {
  margin: 0 auto;
  max-width: 320px;
}

// Always rendered so its text can swap in place without adding/removing an
// element (that add/remove is what caused a reported layout jump in Higher
// or Lower before it adopted this same pattern). Bug report: this used to
// sit BELOW a prominent streak/best row — now it's the top item, and the
// streak/best line below it is small/secondary instead.
.status-line {
  color: #adb5bd;
  text-align: center;
  min-height: 2.2rem;
  margin: 0 0.5rem 0.15rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.streak-line {
  color: #777;
  font-size: 0.8rem;
  margin: 0 0 1rem;
}

// Horizontally-scrolling row so a growing timeline never makes the page
// taller — same convention as Six Degrees' .chain-row. Bug report: this now
// sits ABOVE the mystery card.
.timeline-row {
  // Bug report: "the plus sign slots are shifted down relative to the
  // posters" — cards (poster + year label below) are taller than gaps
  // (a fixed-height box), so bottom-aligning (the old flex-end) left the
  // gap's TOP sitting lower than the poster's own top. Top-aligning makes
  // a gap's box and a card's poster image start at the same Y position —
  // required for the flying/placing animation below to land in the right
  // spot, not just a cosmetic nicety.
  align-items: flex-start;
  display: flex;
  flex-wrap: nowrap;
  gap: 0.3rem;
  // Bug report: "at the start of the game the timeline should be centered
  // horizontally, not off to the left." Plain `center` would make the FRONT
  // of a timeline that later grows wider than the screen unreachable by
  // scroll in some engines — `safe center` centers while it fits, then
  // falls back to start-alignment (still fully scrollable) once it doesn't.
  justify-content: safe center;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  margin: 0 -1rem 1.5rem;
  padding: 0 1rem 0.5rem;
}

// Sized back up to the original 84px (bug report: an earlier "make the
// already-placed cards a little smaller" pass shrunk this to 62px, then a
// LATER, unrelated request to shrink the mystery card down 25% got
// misremembered as having shrunk this too — regardless, "bigger than they
// are right now" is unambiguous, so back to 84px).
.timeline-card {
  flex-shrink: 0;
  width: 84px;
}

.timeline-card img {
  border-radius: 0.3rem;
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
}

// Can now show up to "Jun 12, 1994" (see formatTimelineDate) instead of
// just a year — bug report: "if you have two from the same year they
// should also include their month... same month... also include the day."
// Safety net against the narrow 84px card ever wrapping/overflowing, same
// convention as other tight fixed-width labels elsewhere in Games (e.g.
// Reel Wordle's .clue-value).
.timeline-year {
  color: #adb5bd;
  font-size: 0.7rem;
  font-weight: 600;
  margin: 0.2rem 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.timeline-gap {
  align-items: center;
  background: rgba(255, 255, 255, 0.04);
  border: 1.5px dashed rgba(255, 255, 255, 0.3);
  border-radius: 0.3rem;
  color: #adb5bd;
  cursor: pointer;
  display: flex;
  flex-shrink: 0;
  font-size: 1rem;
  // Matches .timeline-card's restored 84px width (2:3 poster aspect ratio).
  height: 126px;
  justify-content: center;
  overflow: hidden;
  padding: 0;
  width: 34px;
  // Flex items default to min-width: auto, meaning they refuse to shrink
  // below their own content's intrinsic size no matter what `width`
  // says — the classic flexbox min-width footgun. And a <button> has
  // real UA-default padding contributing to that intrinsic size too
  // (content-box: width + padding), which is why `padding: 0` is set
  // explicitly above rather than left at the browser default — the "+"
  // stays centered fine via flex align/justify, padding was never doing
  // anything for it. Without BOTH of these, .placing-flank's `width: 0`
  // only actually reached ~12px (0 content width + leftover default
  // button padding), a small but real visible sliver instead of a true 0.
  min-width: 0;
  // width/border-width/opacity duration comes from --step-duration (set
  // on the root element from stepDurationMs) so the placing-flank
  // grow-in can never drift out of sync with the JS `wait`s driving it.
  // width and border-width MUST both actually animate (not just visually scale a
  // constant-size box via transform — that was tried and reserves the
  // full 34px of LAYOUT SPACE the instant the element mounts, since
  // transforms don't affect layout, which is exactly what read as "the
  // space pops open, then the box grows into it" — the space itself
  // needs to grow, not just its visible content).
  transition: transform 0.1s ease, border-color 0.1s ease, background 0.1s ease, width var(--step-duration, 0.45s) ease, border-width var(--step-duration, 0.45s) ease, opacity var(--step-duration, 0.45s) ease;
}

// Step 2: the tapped gap itself hosts the settling poster — solid border,
// no "+", not interactive while it's mid-placement.
.timeline-gap.placing-gap {
  border-style: solid;
  cursor: default;
  padding: 0;
}

.timeline-gap.placing-gap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.timeline-gap.placing-gap.wide {
  width: 84px;
}

// Purely-visual placeholders for the two gaps that will flank the placed
// card once it's actually inserted (see showPlacingFlanks/
// placingFlanksWide) — start collapsed (0 width, no border, invisible)
// and grow to the normal resting gap size in lockstep with the poster's
// own widen (same shared stepDurationMs window — bug report: "have it
// expand and the plus sign gap markers also expand at the same time").
// Never render a "+": the swap to the real, "+"-bearing gap only happens
// once this has already finished growing (see guess()), so the glyph
// appears on an already-settled box instead of popping in mid-grow.
.timeline-gap.placing-flank {
  width: 0;
  border-width: 0;
  opacity: 0;
  pointer-events: none;
}

.timeline-gap.placing-flank.wide {
  width: 34px;
  border-width: 1.5px;
  opacity: 1;
}

// Step 1: the clone that travels from the mystery card's spot to the
// tapped gap's (narrow) position — position:fixed so its place in the
// DOM/template doesn't matter, purely driven by :style + this class.
.flying-card {
  position: fixed;
  z-index: 50;
  border-radius: 0.3rem;
  object-fit: cover;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
}

.flying-card.animating {
  transition: left var(--step-duration, 0.45s) cubic-bezier(0.22, 1, 0.36, 1), top var(--step-duration, 0.45s) cubic-bezier(0.22, 1, 0.36, 1), width var(--step-duration, 0.45s) cubic-bezier(0.22, 1, 0.36, 1), height var(--step-duration, 0.45s) cubic-bezier(0.22, 1, 0.36, 1);
}

// No title/year text below it anymore — just the poster; correct/incorrect
// feedback on reveal is this border color, and tapping a gap in the row
// above places it. (Drag-to-place was tried and removed — bug report: it
// was leaving visual trails on some devices — see CLAUDE.md.) Sized 25%
// smaller than the original 190px per follow-up feedback.
.mystery-card {
  margin: 0.5rem auto 0;
  max-width: 143px;
  border-radius: 0.4rem;
  border: 3px solid transparent;
  transition: border-color 0.15s ease;
}

.mystery-card img {
  border-radius: 0.3rem;
  width: 100%;
  display: block;
}

.mystery-card.correct {
  border-color: #4caf50;
}

.mystery-card.incorrect {
  border-color: #ff6a6a;
}

// A new mystery card fading softly into place instead of popping in (bug
// report: "make that fade in a little bit softer") — only the enter side;
// leaving stays instant (unchanged), only the arrival was reported as
// abrupt. A fixed, independent duration rather than --step-duration: this
// is about softening one specific pop, not part of the placement
// sequence's own choreography, so it shouldn't get faster/slower as
// stepDurationMs gets tuned.
.mystery-fade-enter-active {
  transition: opacity 0.4s ease;
}

.mystery-fade-enter-from {
  opacity: 0;
}

// Mobile-first: :active only, no :hover (this app has no reliable pointer
// device — see CLAUDE.md).
.timeline-gap:active:not(:disabled) {
  background: rgba(255, 255, 255, 0.14);
  transform: scale(0.94);
}

.timeline-gap:disabled {
  cursor: default;
  opacity: 0.35;
}

// Highlighted on a loss to show where the mystery card actually belonged.
.timeline-gap.correct-gap {
  border-color: #4caf50;
  border-style: solid;
  color: #4caf50;
  opacity: 1;
}

.game-over {
  margin-top: 1.5rem;
}
</style>
