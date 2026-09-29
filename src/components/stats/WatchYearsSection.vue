<template>
  <section v-if="years.length" class="ds-section watch-years">
    <h2 class="ds-section-title">Your Watching Years</h2>
    <p class="ds-section-caption">
      How good each year of watching was, by Log Score — quality and depth together, so a
      year of many good films beats a year of two great ones. The poster is that year's best.
    </p>
    <!-- "I should be able to sort it chronologically, which you already
         have, or I should be able to sort it by rank." (2026-08-17) -->
    <div class="ds-sort">
      <button
        type="button"
        class="ds-sort-btn"
        :class="{ active: yearSort === 'chronological' }"
        @click="yearSort = 'chronological'"
      >Chronological</button>
      <button
        type="button"
        class="ds-sort-btn"
        :class="{ active: yearSort === 'rank' }"
        @click="yearSort = 'rank'"
      >By rank</button>
    </div>
    <div class="ds-poster-row">
      <div
        v-for="year in years"
        :key="year.year"
        class="ds-poster-card"
        role="button"
        :aria-label="`${year.year}: ${year.watched} watched`"
        @click="year.top && goToMovie(year.top)"
      >
        <img v-if="year.top && year.top.movie.poster_path" :src="poster(year.top)" :alt="year.top.movie.title" class="ds-poster">
        <div v-else class="ds-poster ds-poster-blank">{{ year.year }}</div>
        <span class="crown-card-year">{{ year.year }}</span>
        <span class="ds-poster-note gold">{{ year.score ?? '—' }}</span>
        <span class="ds-poster-note">{{ year.watched }} watched</span>
      </div>
    </div>
  </section>
</template>

<script>
// Activity tab: each year of WATCHING, scored. Not the release years —
// those are on Eras, in YearlyAverage.
import { yearStats } from '../../assets/javascript/deepStats.js';
import statsSection, { libraryMemo } from './statsSection.js';

const yearsMemo = libraryMemo(yearStats);

export default {
  name: 'WatchYearsSection',
  mixins: [statsSection],
  data () {
    return { yearSort: 'chronological' };
  },
  computed: {
    years () {
      const stats = yearsMemo(this.library, this.weights);
      if (this.yearSort !== 'rank') return stats;
      // A year with no score sorts last rather than to the top on a null.
      return [...stats].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.ds-sort { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }

.ds-sort-btn {
  background: #101010;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  color: #ccc;
  font-size: 0.7rem;
  /* 40px minimum tap target. */
  min-height: 40px;
  padding: 0 0.85rem;
}

/* Black on every tab accent is legible (the rainbow bar's rule). */
.ds-sort-btn.active { background: var(--accent, #ffc107); border-color: var(--accent, #ffc107); color: #000; font-weight: 700; }
.ds-sort-btn:active { opacity: 0.75; }
</style>
