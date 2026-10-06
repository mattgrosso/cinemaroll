<template>
  <sup v-if="tier" class="count-mark" :class="`count-mark--${tier}`" :aria-label="`${count} in your library`">{{ count }}</sup>
</template>

<script>
// The superscript film count beside a name. See countTier.js for the tiers
// and why a 1 is never shown.
import { countTier } from '../assets/javascript/countTier.js';

export default {
  name: 'CountMark',
  props: { count: { type: [Number, String], default: 0 } },
  computed: {
    tier () { return countTier(this.count); }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/detail-scale';
.count-mark {
  font-size: 0.62em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 0;
  margin-left: 2px;
  position: relative;
  top: -0.45em;
  vertical-align: baseline;
  white-space: nowrap;
}

/* Warmer as it climbs: lavender, the people purple, amber, coral. */
.count-mark--few { color: #b9a3cf; }
.count-mark--some { color: #cd7fe8; }
.count-mark--many { color: #ffc107; }
.count-mark--lots { color: #ff7b6b; }
</style>
