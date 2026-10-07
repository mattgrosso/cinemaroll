<template>
  <div class="header col-12" :class="{'d-none': !$store.state.showHeader}">
    <div class="overflow-wrapper">
      <!-- Clickable straight to home, same destination as the "Cinema Roll"
           title below - matters most when hideHeaderLogo hides that title
           (e.g. Six Degrees' custom banner), leaving the banner itself as
           the only tap-to-home affordance left in the header. -->
      <div class="random-banner" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchCancel" @click="onClick">
        <img v-if="bannerUrl" :src="bannerUrl">
      </div>
      <div class="top-posters">
        <img v-for="(poster, index) in topTenPosters" :src="poster" :key="index">
      </div>
      <div v-if="devMode" class="dev-mode-flag">
        Dev Mode!
      </div>
      <!-- Goes home when the finger lifts, not on iOS's click, and dims
           without shrinking: see utils/headerTap.js for why. -->
      <div v-if="!$store.state.hideHeaderLogo" class="home-link" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchCancel" @click="onClick">
        <span class="app-title">Cinema Roll</span>
        <span class="version">{{version}}</span>
      </div>
      <!-- hideHeaderLogo (a game's custom banner) hides the "Cinema Roll"
           title, but the version number should stay visible in the same
           corner regardless — bug report: "the version number... doesn't
           appear with our new game headers... just the exact same spot...
           over the new banner image." -->
      <div v-else class="version-only" @touchstart.passive="onTouchStart" @touchmove.passive="onTouchMove" @touchend="onTouchEnd" @touchcancel="onTouchCancel" @click="onClick">
        <span class="version">{{version}}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { getRating } from "../assets/javascript/GetRating.js";
import { versionLabel } from "../assets/javascript/buildStamp.js";
import { TAP_SLOP_PX, isHeaderTap, recordHeaderTouch, trackTripHome } from "../utils/headerTap.js";

// How long after a touch has already gone home iOS's own click for that
// same touch may still arrive (and must not go home a second time).
const CLICK_AFTER_TOUCH_MS = 1000;

export default {
  name: "AppHeader",
  data () {
    return {
      touch: null,
      touchWentHomeAt: 0,
      lastTouchEntry: null
    };
  },
  computed: {
    // Home resolves the banner on arrival (context-aware) and stores the URL.
    // Header is now a pure renderer; the old 30s random-swap timer is gone.
    bannerUrl () {
      return this.$store.state.bannerUrl;
    },
    // Same source as the footer's full build stamp, in the standard's own
    // degraded "vX" form: this badge is 0.5rem of type tucked into the corner
    // of a banner photo, with no room for a timestamp. The full
    // "v1.96.4 · built Aug 22, 1:32 AM" line lives in the footer, which is on
    // screen at all times.
    version () {
      return versionLabel();
    },
    currentLogIsTVLog () {
      return this.$store.state.currentLog === "tvLog";
    },
    allPostersRanked () {
      const media = [...this.$store.getters.allMediaAsArray];
      return media.sort(this.sortByRating).map((media) => {
        const posterPath = media.customPosterPath || this.topStructure(media).poster_path;
        return `https://image.tmdb.org/t/p/w94_and_h141_bestv2${posterPath}`;
      });
    },
    devMode () {
      return this.$store.getters.devMode;
    },
    topTenPosters () {
      return this.allPostersRanked.slice(0, 10);
    }
  },
  methods: {
    mostRecentRating (media) {
      if (this.currentLogIsTVLog) {
        return media.ratings.tvShow;
      } else {
        return getRating(media);
      }
    },
    async sortByRating (a, b) {
      const aRating = this.mostRecentRating(a).calculatedTotal;
      const bRating = this.mostRecentRating(b).calculatedTotal;

      if (aRating < bRating) {
        return 1;
      }
      if (aRating > bRating) {
        return -1;
      }

      return 0;
    },
    onTouchStart (event) {
      const point = event.touches?.[0];
      this.touch = {
        startX: point?.clientX,
        startY: point?.clientY,
        startAt: Date.now(),
        movedPx: 0,
        entry: recordHeaderTouch({ route: this.$route?.fullPath || null })
      };
    },
    onTouchMove (event) {
      const point = event.touches?.[0];
      if (!this.touch || !point) return;
      const moved = Math.hypot(point.clientX - this.touch.startX, point.clientY - this.touch.startY);
      this.touch.movedPx = Math.max(this.touch.movedPx, Math.round(moved));
    },
    onTouchEnd (event) {
      const touch = this.touch;
      this.touch = null;
      if (!touch) return;
      const point = event.changedTouches?.[0];
      const endX = point?.clientX;
      const endY = point?.clientY;
      // A finger that wandered off and came back was dragging, not tapping.
      const tap = touch.movedPx <= TAP_SLOP_PX && isHeaderTap({ ...touch, endX, endY, endAt: Date.now() });
      touch.entry.lifted = tap ? 'tap' : 'drag';
      touch.entry.movedPx = Math.max(touch.movedPx, Math.round(Math.hypot((endX ?? touch.startX) - touch.startX, (endY ?? touch.startY) - touch.startY)));
      if (!tap) return;
      this.touchWentHomeAt = Date.now();
      this.goHome(touch.entry, 'touch');
    },
    onTouchCancel () {
      if (this.touch) this.touch.entry.lifted = 'cancelled by iOS';
      this.touch = null;
    },
    // iOS's own click for a touch that already went home just gets noted;
    // a click with no touch (a mouse, a keyboard) goes home the usual way.
    onClick () {
      if (Date.now() - this.touchWentHomeAt < CLICK_AFTER_TOUCH_MS) {
        const entry = this.lastTouchEntry;
        if (entry) entry.click = true;
        return;
      }
      const entry = recordHeaderTouch({ route: this.$route?.fullPath || null, landed: false });
      entry.click = true;
      this.goHome(entry, 'click');
    },
    goHome (entry, via) {
      this.lastTouchEntry = entry;
      this.$store.commit("setGoHome", true);
      trackTripHome(entry, this.$router.push("/"), { via });
    },
    topStructure (result) {
      if (this.currentLogIsTVLog) {
        return result.tvShow;
      } else {
        return result.movie;
      }
    }
  }
}
</script>

<style lang="scss">
  .header {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    position: relative;

    .overflow-wrapper {
      height: 100%;
      overflow: hidden;
      position: relative;
      width: 100%;

      .dev-mode-flag {
        background-color: #dc3545;
        border: 2px solid white;
        box-shadow: 0px 0px 9px 0px #424242;
        color: white;
        font-size: 1rem;
        left: 0;
        padding: 6px 64px;
        pointer-events: none;
        position: fixed;
        top: 0;
        transform: rotate(-45deg) translate(-55px, -33px);
        z-index: 1;
      }

      .home-link {
        background: rgba(0, 0, 0, 0.6);
        border-top-left-radius: 6px;
        bottom: -2px;
        color: white;
        cursor: pointer;
        font-family: "Lobster", sans-serif;
        font-size: 3rem;
        font-weight: 700;
        margin: 0;
        padding: 0 10px 0 16px;
        position: absolute;
        right: 0;
        // Press feedback dims only. The app-wide .tap-feedback also shrinks
        // 2%, and something moving under the finger is one way iOS can
        // decide a touch wasn't a tap (bug report 2026-10-07).
        transition: opacity 90ms ease-out;
        white-space: nowrap;

        &:active {
          opacity: 0.82;
        }

        .version {
          bottom: 0;
          font-family: "Roboto Condensed", sans-serif;
          font-size: 0.5rem;
          position: absolute;
          right: 3px;
        }
      }

      // Same bottom-right corner + dark pill treatment as .home-link, minus
      // the big "Cinema Roll" title text — shown instead of .home-link
      // whenever hideHeaderLogo hides that title (a game's custom banner
      // already has its own name baked in), so the version number still has
      // somewhere to render.
      .version-only {
        background: rgba(0, 0, 0, 0.6);
        border-top-left-radius: 6px;
        bottom: -2px;
        color: white;
        cursor: pointer;
        padding: 3px 8px;
        position: absolute;
        right: 0;

        .version {
          font-family: "Roboto Condensed", sans-serif;
          font-size: 0.65rem;
        }
      }
    }

    .random-banner {
      column-gap: 0;
      cursor: pointer;
      display: flex;
      flex-wrap: wrap;
      position: relative;
      row-gap: 0;
      align-content: center;

      img {
        width: 100%;
      }

      @media screen and (min-width: 600px) {
        display: none;
      }
    }

    .top-posters {
      display: none;

      @media screen and (min-width: 600px) {
        display: flex;

        img {
          width: 10%;
        }
      }
    }
  }
</style>