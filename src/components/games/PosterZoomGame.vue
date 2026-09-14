<template>
  <div ref="root" class="poster-zoom-game">
    <BackLink/>

    <div v-if="zoomablePool.length < 5" class="not-enough-movies">
      <p>Rate a few more movies (with posters) before there's enough to zoom into.</p>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <template v-else>
      <p class="game-subtitle">Name it from a close-up — every zoom-out costs a point.</p>

      <!-- The stage takes whatever vertical space is left over, and the
           poster fills it. That's what makes the game fit on a phone
           without scrolling regardless of how tall the header banner is —
           sizing the poster as a fixed fraction of the viewport can't
           account for that. -->
      <div ref="stage" class="zoom-stage">
        <!-- The crop is done by scaling the image inside a clipped window
             rather than by resizing anything, so the box never moves on the
             page as the zoom changes. -->
        <!-- The poster IS the zoom-out control: it's the biggest target on
             screen and the only action the round needs, which beats a small
             button at the bottom of the page. Kept a div rather than a
             <button> deliberately — this box's sizing was hard-won (see
             the CSS below) and buttons bring their own intrinsic-sizing
             quirks, so the semantics are added by hand instead. -->
        <div
          class="zoom-viewport"
          :class="{ tappable: canZoomOut }"
          :role="canZoomOut ? 'button' : null"
          :tabindex="canZoomOut ? 0 : null"
          :aria-label="canZoomOut ? 'Zoom out' : null"
          @click="zoomOut"
          @keydown.enter.prevent="zoomOut"
          @keydown.space.prevent="zoomOut"
        >
          <img
            v-if="posterUrl"
            :key="posterUrl"
            :src="posterUrl"
            :alt="status === 'playing' ? 'A close-up of a movie poster' : target.movie.title"
            class="zoom-image"
            :class="{ ready: posterReady }"
            :style="zoomStyle"
            crossorigin="anonymous"
            @load="onPosterLoad"
            @error="onPosterError"
          >
          <span v-if="!posterReady" class="zoom-loading">Focusing&hellip;</span>
          <!-- After a win, marks out exactly how much of the poster you were
               actually looking at when you called it. Appears after the
               zoom-out settles, so it reads as a reveal rather than
               competing with it. -->
          <span v-if="showWinningCrop" class="crop-outline" :style="winningCropStyle"></span>
          <!-- On the poster rather than in their own row: a separate score
               row cost a full line of the one thing in short supply here. -->
          <span class="zoom-stat">{{ zoomOuts }} out{{ zoomOuts === 1 ? '' : 's' }}<span v-if="bestZoomOuts != null"> · best {{ bestZoomOuts }}</span></span>
          <span v-if="status === 'playing' && !isFullyOut" class="zoom-badge">{{ currentZoomLabel }}</span>
        </div>
      </div>

      <p class="status-line">{{ statusMessage }}</p>

      <div v-if="status === 'playing'" class="guess-form">
        <input
          v-model="guessInput"
          type="text"
          class="game-input"
          placeholder="Name the movie…"
          @input="onInput"
        >
        <ul v-if="suggestions.length" class="suggestions">
          <li v-for="entry in suggestions" :key="entryKeyFor(entry)">
            <button type="button" class="suggestion-item" @click="submitGuess(entry)">
              {{ entry.movie.title }} <span class="suggestion-year">({{ suggestionYear(entry) }})</span>
            </button>
          </li>
        </ul>

        <!-- Understated, like Reel Wordle's own give-up link: it throws the
             round away, so it shouldn't sit under your thumb as a button. -->
        <button type="button" class="give-up" @click="giveUp">Give up</button>
      </div>

      <div v-else class="result-banner" :class="status">
        <button type="button" class="reveal-title" @click="goToMovie(target)">
          {{ target.movie.title }} <span class="reveal-year">({{ suggestionYear(target) }})</span>
        </button>
        <div class="end-actions">
          <button type="button" class="btn-game btn-game-primary cta-btn" @click="startNewRound">New Poster</button>
          <button type="button" class="btn-game btn-game-secondary cta-btn" @click="$router.push('/games')">Back to Games</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { entryKey, rankTitleMatches } from '../../assets/javascript/games/gameUtils.js';
import {
  ZOOM_LEVELS,
  pickZoomOrigin,
  zoomOriginCandidates,
  pickMostInterestingOrigin,
  pickZoomTarget,
  clampZoomIndex,
  zoomLevelAt,
  isFullyZoomedOut,
  zoomStyleFor,
  cropRectFor,
  entriesWithPosters,
  isNewBestScore
} from '../../assets/javascript/games/posterZoom.js';
import posterZoomBanner from '../../assets/images/games/poster-zoom-banner.jpg';

const STORAGE_KEY = 'cinemaRoll.posterZoom.current';

// TMDB's largest poster size. This is the one screen that magnifies a poster
// sixteen times over, so every source pixel counts — the crop is upscaled
// from roughly a sixteenth of the image. Measured: `original` is 1000x1500
// for a typical poster against w780's 780x1170, for about 85KB more. One
// image per round, and the service worker's CacheFirst rule for
// image.tmdb.org keeps it after the first view.
const POSTER_SIZE = 'original';

export default {
  name: 'PosterZoomGame',
  components: { BackLink, NewRatingSearch },
  mixins: [gameDataMixin],
  // Custom banner + hidden logo, same pattern as every other game (see
  // CLAUDE.md) — the artwork carries its own branding.
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', posterZoomBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      posterSizeFallback: null, // per-round w500 retry before discarding a poster
      // The poster stays hidden until it has BOTH loaded and settled on its
      // focal point. Revealing it earlier lets you watch it zoom in from the
      // full image, or lets the crop jump once scoring resolves — either way
      // you see more of the poster than the round is supposed to show.
      imageLoaded: false,
      originSettled: false,
      // Movies whose poster URL is dead. TMDB paths do rot, and a broken one
      // rendered as a black square you were asked to identify (bug report).
      failedPosterKeys: [],
      target: null,
      zoomIndex: 0,
      origin: { x: 50, y: 50 },
      status: 'playing',
      guessInput: '',
      suggestions: [],
      lastWrongTitle: null
    };
  },
  computed: {
    // Caps the game at the space actually left below the header, which is
    // what lets the stage shrink the poster to fit. A CSS-only version of
    // this can't work: the header banner is 16:9 of the SCREEN WIDTH on a
    // phone (and hidden entirely above 600px), so its height isn't
    // expressible as a fraction of the viewport.
    posterReady () {
      return this.imageLoaded && this.originSettled;
    },
    // Only entries with a poster can be a target — the whole game is the
    // poster. Kept separate from eligibleGameEntries because the guess
    // typeahead can still legitimately offer anything in the library.
    zoomablePool () {
      const usable = entriesWithPosters(this.eligibleGameEntries);
      if (!this.failedPosterKeys.length) return usable;
      return usable.filter((entry) => !this.failedPosterKeys.includes(entryKey(entry)));
    },
    bestZoomOuts () {
      return this.$store.state.settings?.games?.posterZoomBestZoomOuts ?? null;
    },
    posterUrl () {
      // posterSizeFallback: offline, `original` is a size no other screen
      // ever requests, so it's never in the service worker cache — retry
      // the same poster at w500 (the banner/detail size, usually cached)
      // before giving up on the movie (2026-08-15 offline audit).
      return this.target ? this.gamePosterUrl(this.target, this.posterSizeFallback || POSTER_SIZE) : null;
    },
    // Once the round is over the poster is shown whole, however far in the
    // player had got.
    zoomStyle () {
      if (this.status !== 'playing') return zoomStyleFor(ZOOM_LEVELS.length - 1, this.origin);
      return zoomStyleFor(this.zoomIndex, this.origin);
    },
    zoomOuts () {
      return clampZoomIndex(this.zoomIndex);
    },
    isFullyOut () {
      return isFullyZoomedOut(this.zoomIndex);
    },
    // Only worth drawing if there's genuinely less than the whole poster to
    // outline — winning from fully zoomed out would just box the entire image.
    showWinningCrop () {
      return this.status === 'won' && this.posterReady && !this.isFullyOut;
    },
    winningCropStyle () {
      const rect = cropRectFor(this.zoomIndex, this.origin);
      return {
        left: `${rect.left}%`,
        top: `${rect.top}%`,
        width: `${rect.width}%`,
        height: `${rect.height}%`
      };
    },
    canZoomOut () {
      return this.status === 'playing' && !this.isFullyOut;
    },
    currentZoomLabel () {
      return `${zoomLevelAt(this.zoomIndex)}×`;
    },
    // One always-rendered line rather than blocks appearing and
    // disappearing, so the viewport above it never shifts on the page —
    // same reflow-avoidance as Higher or Lower's status line.
    statusMessage () {
      if (this.status === 'won') {
        if (this.zoomOuts === 0) return 'Got it from the tightest crop. Show-off.';
        const outs = `${this.zoomOuts} zoom-out${this.zoomOuts === 1 ? '' : 's'}`;
        return this.isFullyOut
          ? `Got it after ${outs}.`
          : `Got it after ${outs} — that box is all you saw.`;
      }
      if (this.status === 'revealed') return 'Gave up — here it is.';
      if (this.lastWrongTitle) return `Not ${this.lastWrongTitle}. Zoomed out a little.`;
      if (this.isFullyOut) return "That's the whole poster — last chance.";
      // Doubles as the discovery hint for tapping the poster, since there's
      // no longer a button spelling that out.
      return 'Tap the poster to zoom out.';
    }
  },
  // Same "wait for real data, only act once it's there" pattern the other
  // games use — the library may still be loading at mount.
  watch: {
    zoomablePool: {
      immediate: true,
      handler (pool) {
        if (this.target || !pool.length) return;
        this.loadOrStart();
      }
    }
  },
  methods: {
    entryKeyFor: entryKey,
    onPosterLoad () {
      this.imageLoaded = true;
    },
    // A dead poster URL used to render as a black square that you were then
    // asked to identify. Drop that movie from the pool for this session and
    // deal a different one. The pool is finite and each failure removes
    // exactly one entry, so this can't loop — if everything fails, the
    // not-enough-movies gate takes over, which is the honest outcome.
    onPosterError () {
      if (!this.posterSizeFallback) {
        this.posterSizeFallback = 'w500';
        return; // the img retries at the likely-cached size
      }
      const key = this.target ? entryKey(this.target) : null;
      if (key && !this.failedPosterKeys.includes(key)) {
        this.failedPosterKeys = [...this.failedPosterKeys, key];
      }
      if (this.zoomablePool.length) {
        this.startNewRound();
        return;
      }
      // Nothing left to deal — reveal what we have rather than hanging on
      // "Focusing…" forever.
      this.imageLoaded = true;
    },
    /**
     * Picks the focal point by looking at the poster itself.
     *
     * At 8x you're seeing an eighth of the poster, which lands on flat sky
     * or a black background often enough that a purely random point
     * regularly opens on a featureless rectangle — not hard, just empty.
     * Scoring candidates by local contrast keeps the opening crop hard but
     * actually about something.
     *
     * Entirely best-effort: any failure falls back to a random point, which
     * is what this used to do unconditionally.
     */
    async chooseOrigin (url) {
      const candidates = zoomOriginCandidates();
      try {
        const image = await Promise.race([
          this.loadImageForSampling(url),
          new Promise((resolve, reject) => setTimeout(() => reject(new Error('sampling timed out')), 2500))
        ]);
        const sample = this.buildVarianceSampler(image);
        if (!sample) return candidates[0];
        return pickMostInterestingOrigin(candidates, sample);
      } catch {
        // Most likely a CORS-mode cache miss against an entry stored by an
        // earlier no-cors request. Not worth surfacing — the fallback is fine.
        return candidates[0];
      }
    },
    loadImageForSampling (url) {
      return new Promise((resolve, reject) => {
        const image = new Image();
        // Required to read the pixels back; TMDB does send
        // access-control-allow-origin, and the display <img> sets this too so
        // both share one cache entry rather than fighting over CORS mode.
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
    },
    buildVarianceSampler (image) {
      // Scaled so the sampled crop stays a usable size no matter how tight
      // the opening zoom gets — at 16x a fixed 240px canvas would leave only
      // a 15px square to judge, which is too coarse to rank candidates.
      const width = Math.max(320, Math.round(24 * ZOOM_LEVELS[0]));
      const height = Math.round(width * (image.naturalHeight / image.naturalWidth || 1.5));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, width, height);

      // The crop the opening zoom would show, in this downscaled space.
      const cropW = Math.max(4, Math.round(width / ZOOM_LEVELS[0]));
      const cropH = Math.max(4, Math.round(height / ZOOM_LEVELS[0]));

      return ({ x, y }) => {
        const left = Math.min(Math.max(Math.round((x / 100) * width - cropW / 2), 0), width - cropW);
        const top = Math.min(Math.max(Math.round((y / 100) * height - cropH / 2), 0), height - cropH);
        const { data } = context.getImageData(left, top, cropW, cropH);
        let sum = 0;
        let sumSquares = 0;
        let count = 0;
        // Every 4th pixel is plenty to tell flat from textured.
        for (let i = 0; i < data.length; i += 16) {
          const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += luminance;
          sumSquares += luminance * luminance;
          count++;
        }
        if (!count) return 0;
        const mean = sum / count;
        return Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
      };
    },
    // A rotation doesn't land in one frame: the viewport, the header banner's
    // height and the browser chrome all settle over a few hundred ms. One
    // measurement at the event is measured mid-flight, so take several.
    goToMovie (entry) {
      // == null rather than a bare falsy check: a real TMDB id is never 0,
      // but treating it as missing is a bug this codebase has shipped before.
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
    // Guesses always come from the player's own library via the dropdown,
    // never free text, so comparing identity beats fuzzy title matching —
    // and handles remakes sharing a title for free.
    submitGuess (entry) {
      if (this.status !== 'playing' || !this.target) return;
      this.guessInput = '';
      this.suggestions = [];

      if (entryKey(entry) === entryKey(this.target)) {
        this.win();
        return;
      }

      // A wrong guess costs exactly what tapping "Zoom out" costs. Guessing
      // early is meant to be worth trying, not punished beyond the reveal
      // it buys you — and the score is zoom-outs either way.
      this.lastWrongTitle = entry?.movie?.title || null;
      this.revealNextStep();
    },
    zoomOut () {
      if (this.status !== 'playing') return;
      this.lastWrongTitle = null;
      this.revealNextStep();
    },
    revealNextStep () {
      if (this.isFullyOut) {
        this.persistState();
        return;
      }
      this.zoomIndex = clampZoomIndex(this.zoomIndex + 1);
      this.persistState();
    },
    giveUp () {
      if (this.status !== 'playing') return;
      this.recordGameRound({ won: false, zoomOuts: this.zoomOuts, movie: entryKey(this.target) });
      this.status = 'revealed';
      this.persistState(); // no longer 'playing', so this clears the save
    },
    win () {
      this.status = 'won';
      this.lastWrongTitle = null;
      this.recordGameWin();
      this.recordGameRound({ won: true, zoomOuts: this.zoomOuts, movie: entryKey(this.target) });
      if (isNewBestScore(this.zoomOuts, this.bestZoomOuts)) {
        this.$store.dispatch('writeDurably', {
          path: 'settings/games/posterZoomBestZoomOuts',
          value: this.zoomOuts
        });
      }
      this.persistState(); // no longer 'playing', so this clears the save
    },
    async startNewRound () {
      const pool = this.zoomablePool;
      if (!pool.length) return;

      const excludeKey = this.target ? entryKey(this.target) : null;
      const nextTarget = pickZoomTarget(pool, excludeKey, Math.random);

      this.imageLoaded = false;
      this.posterSizeFallback = null;
      this.originSettled = false;
      this.target = nextTarget;
      this.origin = pickZoomOrigin();
      this.zoomIndex = 0;
      this.status = 'playing';
      this.guessInput = '';
      this.suggestions = [];
      this.lastWrongTitle = null;
      this.persistState();

      const url = this.gamePosterUrl(nextTarget, POSTER_SIZE);
      if (!url) {
        this.originSettled = true;
        return;
      }
      const origin = await this.chooseOrigin(url);
      // Compare by identity key, not object reference: Vue wraps this.target
      // in a reactive proxy, so `!==` against the raw captured object never
      // matches and the guard would never fire. Same bug this codebase has
      // hit before in ClueBudget and Trivia.
      if (entryKey(this.target) !== entryKey(nextTarget)) return;
      this.origin = origin;
      this.originSettled = true;
      this.persistState();
    },
    persistState () {
      try {
        if (this.status !== 'playing' || !this.target) {
          window.localStorage.removeItem(STORAGE_KEY);
          return;
        }
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          targetKey: entryKey(this.target),
          zoomIndex: this.zoomIndex,
          // The focal point is random, so it has to be stored — recomputing
          // it would silently turn a resumed round into a different puzzle.
          origin: this.origin
        }));
      } catch (error) {
        console.error('Failed to persist Poster Zoom progress:', error);
      }
    },
    loadOrStart () {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          const target = this.zoomablePool.find((entry) => entryKey(entry) === saved?.targetKey);
          // A finished round is never resumed (same rule as every other
          // persisted game); persistState only ever writes while playing,
          // so anything found here was genuinely in progress.
          if (target) {
            this.imageLoaded = false;
            // A resumed round already has its focal point stored, so there's
            // nothing to score — only the image load is worth waiting for.
            this.originSettled = true;
            this.target = target;
            this.zoomIndex = clampZoomIndex(saved.zoomIndex);
            this.origin = saved.origin && Number.isFinite(saved.origin.x) && Number.isFinite(saved.origin.y)
              ? saved.origin
              : { x: 50, y: 50 };
            this.status = 'playing';
            return;
          }
        }
      } catch (error) {
        console.error('Failed to load persisted Poster Zoom progress:', error);
      }
      this.startNewRound();
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';
@import '@/assets/scss/game-inputs';

.poster-zoom-game {
  color: #eee;
  /* A flex column so the stage below can absorb the leftover height. The
     app shell already stretches a routed component to fill the space under
     the header (see App.vue's .app-main), so "leftover" is real here. */
  display: flex;
  flex-direction: column;
  /* Safety margin: BackLink is fixed at (6,6) of the viewport whether or not
     the global header currently has any height, so without this it can
     overlap this screen's own content. Same in every game component. */
  padding: 1.25rem 1rem 1rem;
}

.not-enough-movies {
  color: #adb5bd;
  margin: 2rem 0;
  text-align: center;
}

.game-subtitle {
  color: #adb5bd;
  font-size: 0.8rem;
  margin: 0.4rem 0;
  text-align: center;
}

/* Absorbs whatever height is left after the fixed chrome above and below.
   min-height: 0 is required — a flex item defaults to min-height: auto and
   would refuse to shrink below its content, which is exactly the overflow
   this exists to prevent. */
/* The stage is the sizing authority. It takes the leftover column space,
   and the poster is positioned against IT — so the poster's height is never
   derived from its own contents and can neither collapse nor overflow.
   min-height is a floor for the case where flex has nothing to give. */
.zoom-stage {
  display: flex;
  flex: 1 1 auto;
  justify-content: center;
  margin: 0.25rem 0;
  min-height: 45vh;
  position: relative;
}

.zoom-viewport {
  /* Pinned to the stage's top and bottom, so its height is DEFINITE —
     the stage's height, whatever that turns out to be — and the aspect
     ratio derives the width from it.

     This replaces a JS measurement loop (resize + orientationchange +
     focusout + two ResizeObservers) that tried to compute this height in
     pixels. Every bug that loop produced came from the same place: the
     poster's height was derived from the image inside it, whose own height
     was 100% of the poster — circular, so it could collapse to a thumbnail
     (and, once "fixed" with a min-height, overflow the page instead).
     Nothing here can collapse, and rotation and the keyboard need no
     special handling because there is nothing to re-measure. */
  aspect-ratio: 2 / 3;
  background: #000;
  border: 1px solid #333;
  border-radius: 0.5rem;
  bottom: 0;
  left: 50%;
  max-width: 100%;
  overflow: hidden;
  position: absolute;
  top: 0;
  translate: -50% 0;
}

.zoom-image {
  display: block;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  /* iOS long-press opens the image preview/save callout — which shows the
     ENTIRE poster, letting you peek past the crop (bug report). The image
     needs no pointer interaction of its own (taps land on the viewport
     div), so turn it all off. */
  pointer-events: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  /* No transition until it's revealed. Otherwise the jump from the previous
     round's fully-zoomed-out reveal to the new round's tight crop ANIMATES,
     showing the whole poster on the way in and giving the answer away. */
  transition: none;
  width: 100%;
}

.zoom-image.ready {
  opacity: 1;
  /* transform is composited, so the zoom stays smooth on a phone — the same
     reason Timeline's placement animation avoids layout properties. */
  transition: transform 0.45s ease, opacity 0.2s ease;
}

/* The dim outside the box is a huge spread shadow, clipped by the
   viewport's own overflow: hidden — cheaper and simpler than four
   separate overlay elements. Delayed past the 0.45s zoom-out so the
   poster resolves first and this lands as a second beat. */
.crop-outline {
  animation: crop-reveal 0.35s ease 0.5s both;
  border: 2px solid #ffc107;
  border-radius: 2px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  position: absolute;
}

@keyframes crop-reveal {
  from {
    opacity: 0;
    transform: scale(1.35);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.zoom-loading {
  color: #6c757d;
  font-size: 0.75rem;
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
}

.zoom-stat {
  background: rgba(0, 0, 0, 0.65);
  border-radius: 999px;
  color: #adb5bd;
  font-size: 0.7rem;
  left: 6px;
  padding: 2px 8px;
  position: absolute;
  top: 6px;
}

.zoom-badge {
  background: rgba(0, 0, 0, 0.65);
  border-radius: 999px;
  bottom: 6px;
  color: #ffc107;
  font-size: 0.75rem;
  padding: 2px 8px;
  position: absolute;
  right: 6px;
}

.status-line {
  color: #adb5bd;
  font-size: 0.85rem;
  margin: 0.5rem 0;
  /* Reserved so the message changing length never nudges the controls. */
  min-height: 1.3rem;
  text-align: center;
}

.guess-form {
  margin: 0 auto;
  max-width: 320px;
  /* Anchors the absolutely-positioned dropdown below the input. */
  position: relative;
}

/* One panel with rows inside it, matching the typeahead in every other
   game. Styling each row as its own bordered card instead reads as a stack
   of separate boxes rather than a dropdown. Absolute so opening it doesn't
   push the buttons down the page.

   Opens UPWARD (bottom: 100%), unlike the other games' typeaheads: this
   input sits at the very bottom of the screen because the poster stage
   absorbs all the leftover height, so a downward list lands squarely under
   the iOS keyboard (bug report). Above the input it covers the poster
   instead, which is fine while typing. */
.suggestions {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 0.35rem;
  bottom: calc(100% + 0.25rem);
  list-style: none;
  margin: 0;
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
  font-size: 0.8rem;
}

.zoom-viewport.tappable {
  cursor: pointer;
}

/* Press feedback only — no :hover. A tapped element keeps a hover state on
   iOS with no mouse to leave it, a bug this codebase has shipped before.
   Border only: a filter or transform here would fight the image's own zoom
   transform, which is what left visual trails in Timeline's drag. */
.zoom-viewport.tappable:active {
  border-color: #888;
}

.give-up {
  background: none;
  border: none;
  color: #8a9199;
  display: block;
  font-size: 0.8rem;
  margin: 0.75rem auto 0;
  padding: 0.35rem 0.5rem;
  text-decoration: underline;
}

.give-up:active {
  color: #e88;
}

.result-banner {
  margin: 0 auto;
  max-width: 320px;
  text-align: center;
}

.reveal-title {
  background: none;
  border: none;
  color: #ffc107;
  font-size: 1.15rem;
  font-weight: 600;
  padding: 0;
}

.reveal-title:active {
  opacity: 0.7;
}

.reveal-year {
  color: #adb5bd;
  font-size: 0.9rem;
  font-weight: 400;
}
</style>
