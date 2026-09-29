<template>
  <section v-if="crown.length" class="ds-section crown">
    <h2 class="ds-section-title">The Crown</h2>
    <p class="ds-section-caption">Starting from the oldest release you've rated, each new high score starts a reign.</p>
    <!-- Sideways: as a vertical list this was the tallest thing on the
         page by a distance, and it reads better as a succession anyway. -->
    <div class="ds-poster-row">
      <div
        v-for="reign in crown"
        :key="reign.entry.dbKey"
        class="ds-poster-card crown-card"
        :class="{ current: reign.current }"
        role="button"
        :aria-label="reign.entry.movie.title"
        @click="goToMovie(reign.entry)"
      >
        <img v-if="reign.entry.movie.poster_path" :src="poster(reign.entry)" :alt="reign.entry.movie.title" class="ds-poster">
        <div v-else class="ds-poster ds-poster-blank">{{ reign.entry.movie.title }}</div>
        <span class="crown-card-year">
          {{ reign.year }}
          <span v-if="reign.current" class="crown-current-tag">now</span>
        </span>
        <span class="ds-poster-note">{{ reign.rating.toFixed(2) }} · {{ reign.reignYears }}y</span>
      </div>
    </div>
  </section>
</template>

<script>
// Eras tab: the succession of all-time highs, by release year.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { crownTimeline } from '../../assets/javascript/deepStats.js';
import statsSection from './statsSection.js';

const crownMemo = memoByIdentity((library) => crownTimeline(library, getRating));

export default {
  name: 'CrownSection',
  mixins: [statsSection],
  computed: {
    crown () {
      return crownMemo(this.library);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.crown-card.current .crown-card-year { color: #ffd700; }

.crown-current-tag {
  background: #ffd700;
  border-radius: 3px;
  color: #000;
  font-size: 0.58rem;
  margin-left: 0.25rem;
  padding: 0 3px;
  text-transform: uppercase;
}
</style>
