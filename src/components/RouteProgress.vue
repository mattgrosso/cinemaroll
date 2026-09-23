<template>
  <div class="route-progress" :class="{ active: pending }" aria-hidden="true"></div>
</template>

<script>
// A 2px bar under the header that creeps across while a screen is on its
// way (router guard sets routePending; see router/index.js). It only
// becomes visible after 90ms, so a screen that arrives at once never shows
// it - it exists for the 0.2-0.7s opens, so the tap is acknowledged the
// instant it lands instead of when the new screen finally paints.
export default {
  name: 'RouteProgress',
  computed: {
    pending () {
      return this.$store.state.routePending;
    }
  }
};
</script>

<style scoped>
.route-progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 2px;
  width: 0;
  background: #ffc107;
  opacity: 0;
  z-index: 2000;
  pointer-events: none;
  transition: opacity 120ms ease 90ms, width 0s linear 0s;
}

.route-progress.active {
  opacity: 0.9;
  width: 85%;
  transition: opacity 120ms ease 90ms, width 1.6s cubic-bezier(0.1, 0.7, 0.2, 1) 90ms;
}
</style>
