<template>
  <div class="stamp-game">
    <BackLink/>
    <GameHowTo/>

    <div v-if="!round" class="not-enough-tags">
      <p v-if="eligibleGameEntries.length < 5">Rate a few more movies before there's enough to work with.</p>
      <p v-else>Nothing to sweep right now — no keyword sits on enough movies yet.</p>
      <NewRatingSearch v-if="eligibleGameEntries.length < 5" value="" :suggestionsMode="true"/>
    </div>

    <!-- Round finished -->
    <template v-else-if="finished">
      <p class="summary-keyword">{{ round.keyword }}</p>
      <p class="summary-headline">{{ summaryHeadline }}</p>

      <!-- Bug report + feedback iteration: the movies that fell into each
           category, shown DIRECTLY as poster clumps — no tapping, no
           titles, posters just big enough to discern. -->
      <div v-for="clump in outcomeClumps" :key="clump.key" class="stamp-clump">
        <p class="clump-label" :class="clump.key">{{ clump.label }} · {{ clump.items.length }}</p>
        <div class="clump-posters">
          <img
            v-for="item in clump.items"
            :key="entryKey(item.card.entry)"
            :src="gamePosterUrl(item.card.entry, 'w154')"
            :alt="item.card.entry.movie.title"
            :title="item.card.entry.movie.title"
            class="clump-poster"
          >
        </div>
      </div>
      <div class="end-actions">
        <button type="button" class="btn-game btn-game-primary cta-btn" @click="startRound()">Next Keyword</button>
        <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
      </div>
    </template>

    <!-- Playing -->
    <template v-else>
      <p class="game-subtitle">
        Is this <strong>{{ round.keyword }}</strong>?
      </p>
      <p class="progress-line">{{ currentIndex + 1 }} of {{ round.cards.length }}</p>

      <!-- A real stack: the next few posters are rendered behind the top one,
           already loaded. That's both the look ("you can only see the top
           one") and the fix for the pause that used to sit between swiping and
           the next poster appearing — that pause was the next image being
           fetched. -->
      <div class="card-area">
        <!-- Always visible, so the meaning of each direction is legible before
             you commit to a swipe — not just while one is under way. They also
             brighten and grow as the card moves toward them, which is the live
             feedback the on-card stamps used to provide. -->
        <div class="swipe-hint no">
          <div class="swipe-hint-inner" :style="hintStyle(-1)">
            <i class="bi bi-x-lg"></i>
            <span>No</span>
          </div>
        </div>
        <div class="swipe-hint yes">
          <div class="swipe-hint-inner" :style="hintStyle(1)">
            <i class="bi bi-check-lg"></i>
            <span>Yes</span>
          </div>
        </div>

        <div
          v-for="item in visibleStack"
          :key="entryKey(item.card.entry)"
          class="stamp-card"
          :class="{ top: item.isTop, dragging: item.isTop && dragging, flying: item.isTop && flyVerdict !== null }"
          :style="item.isTop ? topCardStyle : null"
          @pointerdown="onPointerDown($event, item.isTop)"
          @pointermove="onPointerMove($event, item.isTop)"
          @pointerup="onPointerUp($event, item.isTop)"
          @pointercancel="onPointerUp($event, item.isTop)"
        >
          <!-- Deliberately no "already has it" marker. Knowing anchors the
               judgement, and the point is to decide blind and see what falls
               out at the end: "we don't want to know. We just have to be able
               to see what comes out." `hasTag` is still tracked internally to
               work out whether a swipe is a real change. -->
          <img v-if="gamePosterUrl(item.card.entry)" :src="gamePosterUrl(item.card.entry, 'w342')" :alt="item.card.entry.movie.title" draggable="false">
        </div>
      </div>

      <p class="card-title">{{ currentCard ? currentCard.entry.movie.title : '' }}</p>

      <div class="decide-actions">
        <button type="button" class="btn-game btn-game-secondary decide-btn" @click="decide('no')">
          <i class="bi bi-x-lg"></i> No
        </button>
        <button type="button" class="btn-game btn-game-primary decide-btn" @click="decide('yes')">
          <i class="bi bi-check-lg"></i> Yes
        </button>
      </div>

      <!-- Deliberately its own row rather than a third button between No and
           Yes: it's the safe answer, and a mis-tap between three adjacent
           buttons is exactly what it exists to prevent. -->
      <button type="button" class="btn-game pass-btn" @click="decide('pass')">
        Not sure — skip this one
      </button>

      <div class="secondary-actions">
        <button v-if="history.length" type="button" class="text-action undo-btn" @click="undo">
          <i class="bi bi-arrow-counterclockwise"></i> Undo {{ lastActionLabel }}
        </button>
        <button type="button" class="text-action skip-keyword-btn" @click="startRound()">Different keyword</button>
      </div>
    </template>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import GameHowTo from './GameHowTo.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { entryKey } from '../../assets/javascript/games/gameUtils.js';
import {
  collectPlayableKeywords,
  pickKeyword,
  buildStampRound,
  resolveSwipe,
  keywordChangeFor
} from '../../assets/javascript/games/stamp.js';
import stampBanner from '../../assets/images/games/stamp-banner.jpg';

export default {
  name: 'StampGame',
  components: { BackLink, GameHowTo, NewRatingSearch },
  mixins: [gameDataMixin],
  data () {
    return {
      round: null,
      currentIndex: 0,
      // One entry per decided card, enough to undo it: { card, keep, outcome,
      // previousRatings }.
      history: [],
      dragging: false,
      dragX: 0,
      dragStartX: 0,
      pointerId: null,
      // A slow, deliberate drag commits on DISTANCE...
      swipeThreshold: 90,
      // ...and a quick flick commits on SPEED, because a fast swipe lifts off
      // long before it has travelled far. Distance alone meant exactly the
      // report: "if I go too quickly, it doesn't catch... it sort of snaps
      // back." In px/ms — roughly a third of a phone width in a tenth of a
      // second.
      flickVelocity: 0.45,
      // ...but still far enough that a tap or a jittery press can't count.
      flickMinDistance: 24,
      // Velocity is measured over the tail of the gesture, not the whole
      // thing, so a slow drag that ENDS in a flick still reads as a flick.
      velocityWindow: 120,
      // Recent { x, t } pointer samples, trimmed to velocityWindow.
      dragSamples: [],
      // How many posters are mounted at once. Three is enough for the stack to
      // read as a stack and for the next couple of images to be fetched before
      // they're needed.
      stackDepth: 3,
      // null while resting; 'yes' | 'no' | 'pass' while the top card is on its
      // way out. Kept separate from dragX so the exit is one clean committed
      // transition rather than a continuation of the drag.
      flyVerdict: null,
      // Must match the CSS transition on .stamp-card.top. In data so tests can
      // set it to 0 rather than waiting out real animations.
      flyDuration: 320
    };
  },
  computed: {
    playableKeywords () {
      return collectPlayableKeywords(this.eligibleGameEntries);
    },
    currentCard () {
      return this.round?.cards[this.currentIndex] || null;
    },
    // Deepest card FIRST, so the current one is painted last and therefore on
    // top — no z-index needed on every card.
    visibleStack () {
      if (!this.round) return [];
      return this.round.cards
        .slice(this.currentIndex, this.currentIndex + this.stackDepth)
        .map((card, offset) => ({ card, offset, isTop: offset === 0 }))
        .reverse();
    },
    finished () {
      return Boolean(this.round) && this.currentIndex >= this.round.cards.length;
    },
    tally () {
      const counts = { added: 0, removed: 0, confirmed: 0, declined: 0, passed: 0 };
      this.history.forEach((item) => { counts[item.outcome] += 1; });
      return counts;
    },
    // Non-empty outcome groups with their cards, in the order that tells
    // the round's story: what changed first, then the confirmations, with
    // "not sure" last since it's the pile worth coming back to.
    outcomeClumps () {
      const labels = [
        { key: 'added', label: 'Added' },
        { key: 'removed', label: 'Removed' },
        { key: 'confirmed', label: 'Kept' },
        { key: 'declined', label: 'Left off' },
        { key: 'passed', label: 'Not sure' }
      ];
      return labels
        .map(({ key, label }) => ({ key, label, items: this.history.filter((item) => item.outcome === key) }))
        .filter((clump) => clump.items.length);
    },
    // The changes are the point of the round; the confirmations are just the
    // cost of finding them.
    summaryHeadline () {
      const changed = this.tally.added + this.tally.removed;
      if (!changed) return 'Nothing needed changing.';
      return `${changed} change${changed === 1 ? '' : 's'} to your library.`;
    },
    lastActionLabel () {
      const outcome = this.history[this.history.length - 1]?.outcome;
      return {
        added: 'tagging', removed: 'removal', confirmed: 'keep', declined: 'skip', passed: 'pass'
      }[outcome] || '';
    },
    // How far the current drag has gone toward one side, 0..1.
    swipeProgress () {
      return (direction) => {
        const towards = direction > 0 ? this.dragX : -this.dragX;
        return Math.max(0, Math.min(towards / this.swipeThreshold, 1));
      };
    },
    hintStyle () {
      return (direction) => {
        const progress = this.swipeProgress(direction);
        return {
          opacity: 0.3 + progress * 0.7,
          transform: `scale(${1 + progress * 0.25})`
        };
      };
    },
    topCardStyle () {
      // translate3d + a rotation throughout, and deliberately NO
      // filter/drop-shadow. Timeline's drag-to-place was removed for leaving
      // visual trails on a real device, traced to drop-shadow being recomputed
      // on every pointermove. A composited transform alone doesn't do that.
      // A pass drops away in place rather than flying to one side — it isn't a
      // verdict in either direction, and throwing it left would read as "no".
      if (this.flyVerdict === 'pass') {
        return { transform: 'translate3d(0, 0, 0) scale(0.85)', opacity: 0 };
      }
      if (this.flyVerdict) {
        const direction = this.flyVerdict === 'yes' ? 1 : -1;
        // Far enough to clear any viewport, so the card genuinely leaves rather
        // than stopping at the edge.
        return {
          transform: `translate3d(${direction * 140}vw, 0, 0) rotate(${direction * 18}deg)`,
          opacity: 0
        };
      }
      if (!this.dragX) return {};
      return {
        transform: `translate3d(${this.dragX}px, 0, 0) rotate(${this.dragX / 22}deg)`
      };
    }
  },
  watch: {
    // Getting through a round is this game's "done". `finished` is a computed,
    // so there's no imperative win moment to hook — same reason Wordle,
    // Connections and Six Degrees watch their `status` instead.
    //
    // Guarded on history so an empty round (no cards to decide) can't stamp the
    // day as played. A round where nothing needed changing still counts: the
    // sweep is the accomplishment, and requiring a change would punish a
    // library that's already tidy.
    finished (isFinished) {
      if (isFinished && this.history.length) {
        this.recordGameWin();
        this.recordGameRound({
          decided: this.history.length,
          changes: this.tally.added + this.tally.removed
        });
      }
    }
  },
  created () {
    this.startRound();
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', stampBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  methods: {
    // No picker — a keyword is chosen for you and you just start swiping.
    // Passing the current one as `exclude` means "Different keyword" and
    // "Next Keyword" never hand back the one just finished.
    startRound () {
      const chosen = pickKeyword(this.playableKeywords, Math.random, this.round?.keyword);
      if (!chosen) {
        this.round = null;
        return;
      }

      this.round = buildStampRound(this.eligibleGameEntries, chosen.keyword);
      this.currentIndex = 0;
      this.history = [];
      this.resetDrag();
    },
    resetDrag () {
      this.dragging = false;
      this.dragX = 0;
      this.pointerId = null;
      this.dragSamples = [];
    },
    now () {
      return typeof performance !== 'undefined' ? performance.now() : Date.now();
    },
    trackSample (x) {
      const t = this.now();
      this.dragSamples.push({ x, t });

      // Drop anything older than the window, always keeping at least two points
      // to measure between. Velocity is then averaged across the window rather
      // than taken from the last two moves, which on a real device would let a
      // single jittery sample decide the whole gesture.
      const cutoff = t - this.velocityWindow;
      while (this.dragSamples.length > 2 && this.dragSamples[0].t < cutoff) {
        this.dragSamples.shift();
      }
    },
    // px/ms across the tail of the gesture. Positive is rightward.
    recentVelocity () {
      const samples = this.dragSamples;
      if (samples.length < 2) return 0;

      const last = samples[samples.length - 1];
      const first = samples[0];
      const elapsed = last.t - first.t;
      if (elapsed <= 0) return 0;

      return (last.x - first.x) / elapsed;
    },
    wait (ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },
    // `isTop` is passed rather than inferred: CSS pointer-events keeps a real
    // finger off the cards behind, but nothing stops a synthetic event, and a
    // drag on a buried card would be silently wrong.
    onPointerDown (event, isTop) {
      if (!isTop || !this.currentCard || this.flyVerdict) return;
      this.pointerId = event.pointerId;
      this.dragStartX = event.clientX;
      this.dragging = true;
      this.dragSamples = [];
      this.trackSample(event.clientX);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove (event, isTop) {
      if (!isTop || !this.dragging || event.pointerId !== this.pointerId) return;
      this.dragX = event.clientX - this.dragStartX;
      this.trackSample(event.clientX);
    },
    onPointerUp (event, isTop) {
      if (!isTop || !this.dragging) return;

      const travelled = this.dragX;
      const velocity = this.recentVelocity();
      // Direction comes from the FLICK when it's a flick — a gesture can
      // reverse near the end, and the last thing the thumb did is the intent.
      const flicked = Math.abs(velocity) >= this.flickVelocity &&
        Math.abs(travelled) >= this.flickMinDistance;

      event.currentTarget?.releasePointerCapture?.(this.pointerId);
      this.resetDrag();

      if (flicked) {
        this.decide(velocity > 0 ? 'yes' : 'no');
      } else if (Math.abs(travelled) >= this.swipeThreshold) {
        this.decide(travelled > 0 ? 'yes' : 'no');
      }
    },
    async decide (verdict) {
      const card = this.currentCard;
      // Ignore anything that arrives while a card is still flying off — a
      // second commit mid-flight would advance twice and skip a poster.
      if (!card || this.flyVerdict) return;

      const outcome = resolveSwipe({ hasTag: card.hasTag, verdict });
      // Read fresh from the store rather than the captured card — the entry may
      // have been touched since the round was built.
      const dbKey = card.entry.dbKey;
      const liveMovie = this.$store.state?.movieLog?.[dbKey]?.movie || card.entry.movie;
      const previous = {
        customKeywords: liveMovie.customKeywords || [],
        removedKeywords: liveMovie.removedKeywords || []
      };

      this.history = [...this.history, { card, verdict, outcome, previous }];

      // Send the top card out before advancing. Dragging stops, but the index
      // deliberately does NOT move yet — the card has to stay mounted to be
      // animated.
      this.dragging = false;
      this.pointerId = null;
      this.dragX = 0;
      this.dragSamples = [];
      this.flyVerdict = verdict;

      // The save doesn't wait for the animation; the animation doesn't wait for
      // the save. Only 'added' and 'removed' change anything — confirming,
      // declining and passing are all no-ops.
      if (outcome === 'added' || outcome === 'removed') {
        this.saveKeywords(dbKey, keywordChangeFor(liveMovie, this.round.keyword, verdict === 'yes'));
      }

      await this.wait(this.flyDuration);
      this.flyVerdict = null;
      this.currentIndex += 1;
    },
    async undo () {
      const last = this.history[this.history.length - 1];
      if (!last || this.flyVerdict) return;

      this.history = this.history.slice(0, -1);
      this.currentIndex = Math.max(0, this.currentIndex - 1);
      this.resetDrag();

      if (last.outcome === 'added' || last.outcome === 'removed') {
        await this.saveKeywords(last.card.entry.dbKey, last.previous);
      }
    },
    async saveKeywords (dbKey, { customKeywords, removedKeywords }) {
      try {
        // Leaf paths, not the whole entry — writing the entry would risk
        // clobbering siblings (and the store injects dbKey at read time, which
        // shouldn't be persisted).
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${dbKey}/movie/customKeywords`,
          value: customKeywords
        });
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${dbKey}/movie/removedKeywords`,
          value: removedKeywords
        });
      } catch (error) {
        console.error('Could not save keyword change:', error);
      }
    },
    entryKey
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

.stamp-game {
  color: #eee;
  padding: 1.75rem 1rem 2rem;
  text-align: center;
}

.not-enough-tags {
  color: #adb5bd;
  margin: 2rem 0.5rem;
}

.game-subtitle {
  color: #adb5bd;
  margin: 0.75rem 0;
}

.progress-line {
  color: #777;
  font-size: 0.8rem;
  margin: 0 0 0.75rem;
}

.card-area {
  align-items: center;
  display: flex;
  height: 270px;
  justify-content: center;
  // The cards stack on top of each other inside this box.
  position: relative;
}

.stamp-card {
  position: absolute;
  touch-action: pan-y;
  user-select: none;

  // will-change ONLY while the card is actually moving. Left on permanently it
  // promotes every card to its own compositor layer for the whole round, and a
  // promoted layer that outlives its element is a known way to end up with
  // stale hit-testing on iOS — taps landing on nothing.
  &.top.dragging,
  &.top.flying {
    will-change: transform;
  }

  // Only the top card takes input; the ones behind are scenery.
  &:not(.top) {
    pointer-events: none;
  }

  // Snapping back from a short drag, and the fly-out, share this transition —
  // flyDuration in data has to match it. Suppressed while actually dragging so
  // the card tracks the finger exactly.
  &.top:not(.dragging) {
    transition: transform 0.32s ease-out, opacity 0.32s ease-out;
  }

  img {
    border-radius: 8px;
    display: block;
    height: 270px;
    pointer-events: none;
    width: auto;
  }
}

.swipe-hint {
  align-items: center;
  bottom: 0;
  display: flex;
  pointer-events: none;
  position: absolute;
  top: 0;
  // Above the cards: the card slides TOWARD the hint it's activating, so
  // without this it covers the one you most need to see. Safe because the
  // hints never take pointer events.
  z-index: 2;
}

.swipe-hint.no { left: 0; }
.swipe-hint.yes { right: 0; }

.swipe-hint-inner {
  align-items: center;
  border: 2px solid;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  height: 52px;
  justify-content: center;
  transition: opacity 0.15s ease, transform 0.15s ease;
  width: 52px;

  i {
    font-size: 1.1rem;
    line-height: 1;
  }

  span {
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
}

.swipe-hint.no .swipe-hint-inner {
  border-color: #ff6a6a;
  color: #ff6a6a;
}

.swipe-hint.yes .swipe-hint-inner {
  border-color: #4caf50;
  color: #4caf50;
}

.card-title {
  color: #eee;
  font-size: 0.9rem;
  margin: 0.6rem 0 1rem;
  min-height: 1.2rem;
}

.decide-actions {
  display: flex;
  gap: 0.75rem;
  margin: 0 auto;
  max-width: 340px;
}

.decide-btn {
  flex: 1;
}

.pass-btn {
  background: none;
  border: 1px solid #444;
  color: #adb5bd;
  display: block;
  font-size: 0.82rem;
  margin: 0.5rem auto 0;
  max-width: 340px;
  padding: 0.55rem 1rem;
  width: 100%;
}

// Bug report (Matt, 2026-08-28): "if I had an undo button on the stamp game".
// There WAS one, and had been all along - it was just impossible to find.
// Stacked below the pass button at the very bottom, 12.5px, #777 on this
// page's near-black: about 3.9:1, under AA (see CLAUDE.md, "Always check
// contrast"). So the safety net for a mis-swipe read as fine print.
//
// Undo is now a real control - bordered, legible, a 40px tap target - and the
// two secondary actions sit on ONE row, which lifts both of them a line
// higher up a phone screen. It stays visually below Yes/No/skip, because it
// is still not what you press most of the time.
.secondary-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem 0.9rem;
  justify-content: center;
  margin-top: 1rem;
}

.text-action {
  background: none;
  border: none;
  // Was #777 (~3.9:1 here). #a9a9a9 is ~7.4:1 on #1a1a1a.
  color: #a9a9a9;
  font-size: 0.82rem;
  text-decoration: underline;

  &:active {
    opacity: 0.6;
  }
}

.undo-btn {
  align-items: center;
  border: 1px solid #4a4a4a;
  border-radius: 999px;
  color: #e8e8e8;
  display: inline-flex;
  font-size: 0.9rem;
  gap: 0.4rem;
  // The house tap-target floor. It was a bare text run before, which is both
  // hard to see and hard to hit.
  min-height: 40px;
  padding: 0 1rem;
  text-decoration: none;

  &:active {
    background: rgba(255, 255, 255, 0.08);
    opacity: 1;
  }
}

.summary-keyword {
  color: #eee;
  font-size: 1.35rem;
  font-weight: 700;
  margin: 0.5rem 0 0.15rem;
}

.summary-headline {
  color: #adb5bd;
  font-size: 0.85rem;
  margin: 0 0 1.25rem;
}

.stamp-clump {
  margin: 0 auto 1rem;
  max-width: 380px;
  text-align: left;
}

.clump-label {
  color: #adb5bd;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}

/* The two outcomes that changed the library get their color in the label
   text itself (no bars, no boxes). */
.clump-label.added { color: #4caf50; }
.clump-label.removed { color: #ff6a6a; }
.clump-label.passed { color: #6ec1e4; }

/* The house poster-row: the same 92×138 size the Trophy Case settled on,
   scrolling horizontally as needed, image edges aligned. */
.clump-posters {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
}

.clump-poster {
  border-radius: 0.35rem;
  flex: 0 0 auto;
  height: 138px;
  object-fit: cover;
  width: 92px;
}
</style>
