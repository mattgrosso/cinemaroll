<template>
  <!-- The edge-swipe gesture ("I should be able to swipe left from the left
       edge of the screen") is bound on the WINDOW, not on an element. It used
       to be a fixed, full-height, 20px-wide invisible strip at z-index 500 —
       which sat on top of anything within 20px of the left edge and silently
       ate taps on it, since the strip only responds to a swipe. With most game
       screens using 16px padding, that covered a few pixels of every
       left-hand button: "I tap them. Nothing happens. I have to tap them
       again." Filtering by where the touch STARTED gives the same gesture
       while covering nothing. -->
  <div class="back-link tap-feedback" @click="goBack" role="button" :aria-label="`Back to ${resolvedLabel}`">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-left-fill" viewBox="0 0 16 16">
      <path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
    </svg>
    <span>{{ resolvedLabel }}</span>
  </div>
</template>

<script>
// Every game screen (and the games hub) uses this as its sole top-of-page
// affordance, matching the "Home"/"Games" caret pattern MovieDetail/RateMovie/
// Insights use elsewhere. Unlike MovieDetail/RateMovie (which hide the global
// Header entirely), this follows Insights.vue's approach instead: the global
// Header stays visible, and the link is lifted up over it purely via CSS
// (position:absolute with no positioned ancestor anywhere up the tree — see
// Insights.vue's .home-link — escapes to the page's initial containing block
// rather than the component's own top of content, landing it up in the
// Header's space). No store interaction needed here at all.
import { navigationTarget } from '../../utils/navigationTarget.js';

export default {
  name: 'BackLink',
  props: {
    // Only for a screen that genuinely needs to override where back goes.
    // Left alone, the link works out its own destination and names it.
    label: { type: String, default: null },
    // For a screen with work to do on the way out (restoring the header,
    // saving a draft): the link emits its target and the screen navigates.
    // A prop rather than sniffing for a listener, because `click` is a
    // declared emit and so never appears in $attrs.
    deferNavigation: { type: Boolean, default: false }
  },
  emits: ['click'],
  data () {
    return {
      touchStartX: null,
      touchStartY: null,
      // How close to the left edge a touch must START to count as an edge
      // swipe. Same 20px the old strip was wide.
      edgeZone: 20
    };
  },
  mounted () {
    // Passive: this never calls preventDefault, so it must not be allowed to
    // block scrolling while the browser waits to find out.
    window.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
  },
  beforeUnmount () {
    window.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchend', this.onTouchEnd);
  },
  computed: {
    // Vue Router keeps the previous entry in history.state.back, including
    // across replaces — so there is no navigation stack to maintain here.
    // It is null on a cold start or a deep link, which is exactly when the
    // declared parent should take over.
    target () {
      return navigationTarget({
        backPath: this.$router?.options?.history?.state?.back,
        currentPath: this.$route?.fullPath,
        parentPath: this.$route?.meta?.parent || '/',
        titleFor: (path) => this.$router?.resolve?.(path)?.meta?.title,
        // Nobody wants "back" to mean "sign in again".
        avoid: ['/login'],
        // A game is somewhere you go INTO from the hub; the way out is the
        // hub however you got here. Without this, wandering off to Home and
        // coming back left no route to the games screen at all.
        preferParent: Boolean(this.$route?.meta?.exitToParent)
      });
    },
    resolvedLabel () {
      return this.label || this.target.label;
    }
  },
  methods: {
    goBack () {
      if (this.deferNavigation) {
        this.$emit('click', this.target);
        return;
      }
      if (this.target.useBack) {
        this.$router.back();
      } else {
        this.$router.push(this.target.path);
      }
    },
    onTouchStart (event) {
      const touch = event.touches[0];
      if (!touch || touch.clientX > this.edgeZone) {
        this.touchStartX = null;
        return;
      }
      this.touchStartX = touch.clientX;
      this.touchStartY = touch.clientY;
    },
    onTouchEnd (event) {
      if (this.touchStartX === null) return;
      const touch = event.changedTouches[0];
      if (!touch) {
        this.touchStartX = null;
        return;
      }
      const deltaX = touch.clientX - this.touchStartX;
      const deltaY = touch.clientY - this.touchStartY;
      this.touchStartX = null;
      this.touchStartY = null;

      // A real edge swipe: mostly horizontal (not a vertical scroll) and far
      // enough to be intentional (not a stray tap on the thin strip).
      if (deltaX > 60 && Math.abs(deltaY) < 50) {
        this.goBack();
      }
    }
  }
};
</script>

<style scoped>
.back-link {
  align-items: center;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 6px;
  color: #eee;
  column-gap: 4px;
  cursor: pointer;
  display: flex;
  left: 6px;
  /* Roomy enough to be a real touch target. Bug report: "I'm clicking the
     back to Games button in 6° and it's just sending me home" — this sits on
     top of the header banner, which is itself tap-to-home, so anything that
     misses the link lands on "go home" instead. A bigger target means far
     fewer near-misses. */
  min-height: 40px;
  padding: 8px 14px;
  position: absolute;
  top: 6px;
  /* Kept above the header banner underneath, which is itself tap-to-home, so
     a near-miss on this link doesn't navigate somewhere else. */
  z-index: 600;
}

.back-link:active {
  opacity: 0.7;
}
</style>
