<template>
  <section v-if="rewatches" class="ds-section rewatches">
    <h2 class="ds-section-title">Rewatches</h2>
    <p class="ds-section-caption">The films you keep returning to — and how long they make you wait.</p>
    <div class="ds-strip">
      <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.repeatViewings }}</span><span class="ds-strip-label">repeat viewings</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.filmsRevisited }}</span><span class="ds-strip-label">films revisited</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ Math.round(rewatches.rewatchRate * 100) }}%</span><span class="ds-strip-label">rewatch rate</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.medianReturnYears.toFixed(1) }}y</span><span class="ds-strip-label">median return</span></div>
    </div>
    <h3 class="pantheon-label">Most rewatched</h3>
    <div class="ds-poster-row">
      <div v-for="film in rewatches.mostRewatched" :key="film.entry.dbKey" class="ds-poster-card" role="button" :aria-label="film.entry.movie.title" @click="goToMovie(film.entry)">
        <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
        <div v-else class="ds-poster ds-poster-blank">{{ film.entry.movie.title }}</div>
        <span class="ds-poster-note gold">{{ film.viewings }} viewings</span>
      </div>
    </div>
    <h3 class="pantheon-label">Quickest returns</h3>
    <div class="ds-poster-row">
      <div v-for="film in rewatches.quickestReturns" :key="`q-${film.entry.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.entry.movie.title" @click="goToMovie(film.entry)">
        <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
        <div v-else class="ds-poster ds-poster-blank">{{ film.entry.movie.title }}</div>
        <span class="ds-poster-note gold">{{ gapLabel(film.gapDays) }}</span>
      </div>
    </div>

    <!-- The other end of the same list (2026-08-17). -->
    <template v-if="rewatches.longestReturns.length">
      <h3 class="pantheon-label">Longest waits</h3>
      <div class="ds-poster-row">
        <div v-for="film in rewatches.longestReturns" :key="`l-${film.entry.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.entry.movie.title" @click="goToMovie(film.entry)">
          <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
          <div v-else class="ds-poster ds-poster-blank">{{ film.entry.movie.title }}</div>
          <span class="ds-poster-note gold">{{ gapLabel(film.gapDays) }}</span>
        </div>
      </div>
    </template>
  </section>
</template>

<script>
// Activity tab: the films you go back to, and how long between visits.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { rewatchStats } from '../../assets/javascript/deepStats.js';
import statsSection from './statsSection.js';

const rewatchMemo = memoByIdentity((library) => rewatchStats(library));

export default {
  name: 'RewatchesSection',
  mixins: [statsSection],
  computed: {
    rewatches () {
      return rewatchMemo(this.library);
    }
  },
  methods: {
    gapLabel (days) {
      if (days < 1) return 'same day';
      if (days < 60) {
        const whole = Math.round(days);
        return `${whole} ${whole === 1 ? 'day' : 'days'}`;
      }
      if (days < 700) {
        const months = Math.round(days / 30.4);
        return `${months} ${months === 1 ? 'month' : 'months'}`;
      }
      return `${(days / 365.25).toFixed(1)} years`;
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';
</style>
