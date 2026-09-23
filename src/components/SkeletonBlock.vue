<template>
  <div class="skeleton-block" aria-hidden="true">
    <div v-for="row in rows" :key="row" class="skeleton-row" :style="{ width: widths[(row - 1) % widths.length] }"></div>
  </div>
</template>

<script>
// Grey placeholder rows in the shape of the content to come. The screens
// that use it render this for exactly one frame (see nextFrame.js) before
// their real, heavy content - so a tap on Watchlist or Film Club paints
// SOMETHING within a frame instead of a blank area for most of a second.
export default {
  name: 'SkeletonBlock',
  props: {
    rows: { type: Number, default: 6 }
  },
  data () {
    return { widths: ['92%', '68%', '84%', '55%', '76%', '62%'] };
  }
};
</script>

<style scoped>
.skeleton-block {
  padding: 0.25rem 0 1rem;
}

.skeleton-row {
  height: 14px;
  margin: 0 0 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.12) 50%, rgba(255, 255, 255, 0.06) 100%);
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.2s ease-in-out infinite;
}

.skeleton-row:first-child {
  height: 22px;
  margin-bottom: 16px;
}

@keyframes skeleton-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
</style>
