<template>
  <div class="cinema-roll">
    <!-- Invisible scroll-to-top trigger area -->
    <div class="scroll-to-top-trigger" @click.stop="scrollToTop"></div>
    <AppHeader/>
    <!-- UpdateAvailableBanner and BugResolutionNotice render inside Home's
         .home-notices section now — the one notification space — not here.
         The auto-update machinery below stays global; only the visible
         fallback moved. Offline and access banners remain global: they are
         states of the whole app, not notifications. -->
    <OfflineBanner/>
    <LibraryAccessBanner/>
    <!-- The routed page grows to fill whatever is left below the header, which
         is what keeps the footer at the bottom. Pages used to each declare
         `min-height: 100vh` for that, which made every page header + a FULL
         viewport + footer tall — so there was always a screenful of empty
         space to scroll through. -->
    <main class="app-main">
      <router-view></router-view>
    </main>
    <AppFooter v-if="$store.state.dbLoaded"/>
    <BugReportButton/>
  </div>
</template>

<script>
import AppFooter from "./components/Footer.vue";
import AppHeader from "./components/Header.vue";
import BugReportButton from "./components/BugReportButton.vue";
import OfflineBanner from "./components/OfflineBanner.vue";
import LibraryAccessBanner from "./components/LibraryAccessBanner.vue";
import { pickFallbackBanner } from "./assets/javascript/bannerFallback.js";
import { flushStashedBugReports } from "./utils/bugReports.js";
import { reloadForUpdate, isSafeMomentForReload, shouldAutoAttempt, markUpdateLanded, recordWorkerState } from "./utils/appUpdate.js";
import { refreshSubscriptionIfGranted } from "./utils/push.js";

export default {
  name: "Cinema-Roll",
  components: {
    AppFooter,
    AppHeader,
    BugReportButton,
    LibraryAccessBanner,
    OfflineBanner
  },
  data () {
    return {
      lastActivityAt: Date.now(),
      lastBecameVisibleAt: Date.now(),
      deployedBundleSeen: null,
      autoUpdateTimer: null,
      pushDigestTimer: null
    };
  },
  computed: {
    libraryCount () {
      return Object.keys(this.$store.state.movieLog || {}).length;
    }
  },
  watch: {
    // Auto-apply updates (bug report: "the user shouldn't have to take an
    // action... the banner could still be a fallback"). Immediately when
    // the update is spotted at a fresh moment (just launched/foregrounded —
    // nothing is in progress yet), otherwise after ~25s of no interaction —
    // and never while typing, mid-game, or in a modal (the July lesson:
    // an unconditional reload yanked the page out from under a backfill).
    '$store.state.updateAvailable' (available) {
      if (!available) return;
      this.armAutoUpdate();
    },
    // Cold boot on a non-home route: Home (the usual banner resolver) never
    // mounts, so once the library arrives, pick the fallback banner here.
    // Home still owns banner choice whenever it runs — this only fills a
    // banner nothing else has set.
    libraryCount (count) {
      if (!count || this.$store.state.bannerUrl) return;
      const url = pickFallbackBanner(this.$store.getters.allMoviesAsArray);
      if (url && !this.$store.state.bannerUrl) {
        this.$store.commit('setBannerUrl', url);
      }
    },
    // Push notifications: once the library is in, load prefs/subscriptions,
    // self-heal this device's subscription, and publish the first digest.
    '$store.state.dbLoaded' (loaded) {
      if (loaded) this.initializePush();
    },
    // Any library or settings change can change what the daily push should
    // say (a rating added, stickiness recorded, a tournament finished, a
    // prompt disabled) — republish the digest, debounced. Both mutations
    // replace the object reference, so shallow watchers are enough.
    '$store.state.movieLog' () {
      this.schedulePushDigest();
    },
    '$store.state.settings' () {
      this.schedulePushDigest();
    }
  },
  methods: {
    async initializePush () {
      // Opening the app clears the icon badge — whatever it was counting,
      // the user is now looking at it.
      navigator.clearAppBadge?.().catch(() => {});
      await this.$store.dispatch('loadPushState');
      await refreshSubscriptionIfGranted(this.$store);
      this.$store.dispatch('publishPushDigest');
    },
    schedulePushDigest () {
      // Trailing-edge debounce: a backfill or delta sync can replace the
      // library many times in a burst, and one digest at the end is worth
      // the same as fifty along the way.
      clearTimeout(this.pushDigestTimer);
      this.pushDigestTimer = setTimeout(() => {
        this.$store.dispatch('publishPushDigest');
      }, 5000);
    },
    scrollToTop () {
      window.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    },
    async checkForServiceWorkerUpdate () {
      if (!('serviceWorker' in navigator)) {
        return;
      }

      try {
        const registration = await navigator.serviceWorker.getRegistration();
        recordWorkerState(registration);
        if (registration) {
          await registration.update();
          recordWorkerState(registration);
        }
      } catch {
        // Best-effort - a failed check just means we try again on the next
        // trigger rather than blocking anything the user is doing.
      }

      await this.checkDeployedBundle();
    },
    /**
     * Notices a new deploy by comparing bundle filenames, independent of any
     * service worker state.
     *
     * Bug report: "I didn't get my refresh for new version banner." The
     * banner is driven by registerServiceWorker's `updated()` hook, which
     * only fires while a new worker sits in the `installed` state — but this
     * app builds with `skipWaiting: true` (vue.config.js), so a new worker
     * activates itself immediately instead of waiting. That makes the hook a
     * race the banner often loses: you get the new version, you just don't
     * get told. Comparing what the server serves against what this page
     * actually loaded doesn't depend on that timing at all.
     *
     * The cache-busting param matters: Workbox precaches index.html, and
     * only strips params matching `ignoreURLParametersMatching` (utm_,
     * fbclid). An arbitrary param therefore misses the precache entry and
     * goes to the network, which is the point.
     */
    async checkDeployedBundle () {
      if (this.$store.state.updateAvailable) {
        return;
      }

      const runningBundle = this.currentBundleName();
      if (!runningBundle) {
        return;
      }

      try {
        const response = await fetch(`${process.env.BASE_URL || '/'}index.html?updateCheck=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const deployedBundle = (await response.text()).match(/js\/app\.[a-z0-9]+\.js/);
        if (deployedBundle && deployedBundle[0] !== runningBundle) {
          this.deployedBundleSeen = deployedBundle[0];
          this.$store.commit('setUpdateTargetBundle', deployedBundle[0]);
          this.$store.commit('setUpdateAvailable', true);
        } else if (deployedBundle) {
          // Running what's deployed: any earlier reload attempt worked, so
          // the next update starts from a clean slate (appUpdate.js).
          markUpdateLanded();
        }
      } catch {
        // Offline, blocked, or the check simply failed - try again next time.
      }
    },
    /** The app bundle THIS page is running, read off its own script tags. */
    currentBundleName () {
      const scripts = Array.from(document.querySelectorAll('script[src]'));
      for (const script of scripts) {
        const match = (script.getAttribute('src') || '').match(/js\/app\.[a-z0-9]+\.js/);
        if (match) return match[0];
      }
      return null;
    },
    // Offline rating support: attempt a queue flush whenever we might have
    // just regained connectivity. Cheap/no-op if actually still offline
    // (flushPendingWrites checks navigator.onLine itself), so it's safe to
    // call from every trigger below rather than just the 'online' event -
    // same reasoning as checkForServiceWorkerUpdate needing four independent
    // triggers instead of trusting any single browser event.
    attemptPendingWritesFlush () {
      this.$store.dispatch('flushPendingWrites');
    },
    handleOnline () {
      this.$store.commit('setIsOnline', true);
      this.attemptPendingWritesFlush();
      // Bug reports live outside the account-scoped queue; drain their own
      // localStorage stash on reconnect (2026-08-15 offline audit).
      flushStashedBugReports().catch(() => {});
    },
    handleOffline () {
      this.$store.commit('setIsOnline', false);
    },
    noteActivity () {
      this.lastActivityAt = Date.now();
    },
    armAutoUpdate () {
      const target = this.deployedBundleSeen || 'unknown';
      if (!shouldAutoAttempt(target)) return; // once per version; banner remains

      // Fresh moment (just launched or just foregrounded): nothing is in
      // flight yet — apply right away.
      const fresh = Date.now() - (this.lastBecameVisibleAt || 0) < 5000;
      if (fresh && isSafeMomentForReload({ routePath: this.$route?.path || '' })) {
        reloadForUpdate({ target: this.deployedBundleSeen });
        return;
      }

      // Otherwise: poll for a quiet stretch.
      if (this.autoUpdateTimer) clearInterval(this.autoUpdateTimer);
      this.autoUpdateTimer = setInterval(() => {
        const quiet = Date.now() - this.lastActivityAt > 25000;
        if (quiet && isSafeMomentForReload({ routePath: this.$route?.path || '' })) {
          clearInterval(this.autoUpdateTimer);
          this.autoUpdateTimer = null;
          reloadForUpdate({ target: this.deployedBundleSeen });
        }
      }, 5000);
    }
  },
  async mounted () {
    // Reconcile the router's localStorage-based "you're signed in" assumption
    // against whether Firebase actually restored a session. Fire and forget —
    // it resolves itself once auth settles and must not delay first paint.
    this.$store.dispatch('verifyRestoredSession');

    // The dbLoaded watcher handles the normal boot order; this covers the
    // library having loaded before this component mounted.
    if (this.$store.state.dbLoaded) this.initializePush();

    // visibilitychange alone is unreliable on iOS, particularly for a
    // home-screen-installed PWA - it's a long-standing WebKit quirk that it
    // sometimes just doesn't fire when the app is brought back to the
    // foreground (varies by iOS version, which is why this can silently work
    // on one iPhone and never on another). pageshow and window focus are
    // more consistent there, and the interval is a backstop that doesn't
    // depend on any lifecycle event firing at all - between the three, an
    // update gets picked up even if any single trigger fails to fire.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.lastBecameVisibleAt = Date.now();
        this.checkForServiceWorkerUpdate();
        this.attemptPendingWritesFlush();
        // Foregrounding an installed PWA doesn't re-run initializePush, and
        // it's the most common way a badge gets looked at.
        navigator.clearAppBadge?.().catch(() => {});
      } else {
        // Going away: run any pending debounced profile publish before the
        // timer dies with the page. See scheduleSocialPublish — a backgrounded
        // PWA does not run setTimeout, so this is the difference between a
        // friend seeing today's rating and seeing it six hours from now.
        this.$store.dispatch('flushSocialPublish');
      }
    });
    // pagehide is the reliable half of this on iOS (same reasoning as the
    // comment above, in the other direction). Both are no-ops when nothing is
    // pending, so firing on both costs nothing.
    window.addEventListener('pagehide', () => {
      this.$store.dispatch('flushSocialPublish');
    });
    window.addEventListener('pageshow', () => {
      this.lastBecameVisibleAt = Date.now();
      this.checkForServiceWorkerUpdate();
      this.attemptPendingWritesFlush();
    });
    window.addEventListener('focus', () => {
      this.checkForServiceWorkerUpdate();
      this.attemptPendingWritesFlush();
    });
    // Activity signals for the auto-update quiet-moment detector. Passive:
    // these must never delay scrolling.
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((eventName) => {
      window.addEventListener(eventName, this.noteActivity, { passive: true });
    });
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    setInterval(() => {
      this.checkForServiceWorkerUpdate();
      this.attemptPendingWritesFlush();
    }, 30 * 60 * 1000);
  },
}
</script>

<style lang="scss">
  body {
    font-family: "Roboto Condensed", sans-serif;

    &.no-scroll {
      overflow: hidden;
    }
  }

  .cinema-roll {
    min-height: 100vh;
    width: 100%;
    max-width: 100%;
    // Clip any stray horizontal overflow so the page can never scroll sideways.
    // On the installed iOS PWA a brief horizontal overflow (e.g. an image
    // rendering at natural width before CSS constrains it) latches the layout
    // viewport wider than the screen; that stuck viewport then makes every
    // screen's 100vh-based vertical layout stop a few % short of the bottom
    // (cutting off the submit / poster buttons) until the app is force-quit.
    // Clipping here prevents the latch — fixes the sideways scroll AND the
    // cumulative bottom cut-off together. Must be clip, not hidden: hidden
    // forces overflow-y to compute to auto, which makes this wrapper the
    // sticky containing scrollport and silently breaks every position:sticky
    // descendant (the page scrolls, this element never does). clip clips
    // harder (no programmatic scroll either — better for the latch) without
    // creating a scroll container. hidden stays as an old-engine fallback.
    overflow-x: hidden;
    overflow-x: clip;
    display: flex;
    flex-direction: column;
  }

  /* This replaces a `.cinema-roll > router-view` rule that never matched
     anything: <router-view> renders the matched component IN ITS PLACE, so no
     `router-view` element exists in the DOM. */
  .app-main {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    width: 100%;
  }

  /* The page itself stretches to fill, rather than demanding a viewport of its
     own. Same visual result, no phantom scroll. */
  .app-main > * {
    flex: 1 1 auto;
  }

  .scroll-to-top-trigger {
    position: fixed;
    top: 0;
    left: 75px;
    right: 75px;
    height: 40px;
    z-index: 9999;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: rgba(255, 255, 255, 0.1);
    touch-action: manipulation;

    /* Only show on mobile devices */
    @media (min-width: 768px) {
      display: none;
    }
  }
</style>
