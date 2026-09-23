<template>
  <div class="header col-12" :class="{'d-none': !$store.state.showHeader}">
    <div class="overflow-wrapper">
      <!-- Clickable straight to home, same destination as the "Cinema Roll"
           title below - matters most when hideHeaderLogo hides that title
           (e.g. Six Degrees' custom banner), leaving the banner itself as
           the only tap-to-home affordance left in the header. -->
      <div class="random-banner" @click="goHome">
        <img v-if="bannerUrl" :src="bannerUrl">
      </div>
      <div class="top-posters">
        <img v-for="(poster, index) in topTenPosters" :src="poster" :key="index">
      </div>
      <div v-if="devMode" class="dev-mode-flag">
        Dev Mode!
      </div>
      <div v-if="!$store.state.hideHeaderLogo" class="home-link tap-feedback" @click="goHome">
        <span class="app-title">Cinema Roll</span>
        <span class="version">{{version}}</span>
      </div>
      <!-- hideHeaderLogo (a game's custom banner) hides the "Cinema Roll"
           title, but the version number should stay visible in the same
           corner regardless — bug report: "the version number... doesn't
           appear with our new game headers... just the exact same spot...
           over the new banner image." -->
      <div v-else class="version-only" @click="goHome">
        <span class="version">{{version}}</span>
      </div>
    </div>
  </div>
</template>

<script>
import { getRating } from "../assets/javascript/GetRating.js";
import { versionLabel } from "../assets/javascript/buildStamp.js";

export default {
  name: "AppHeader",
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
    async goHome () {
      await this.$store.commit("setGoHome", true);
      this.$router.push("/");
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
        white-space: nowrap;

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