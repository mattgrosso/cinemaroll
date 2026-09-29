<template>
  <!-- "Would be cool if I could see how many ties there are in the whole
       database" (2026-09-06). Exact equality at the fourth decimal, the
       tournament's own definition (deepStats.tieStats). -->
  <section v-if="ties" class="ds-section ties">
    <h2 class="ds-section-title">Ties</h2>
    <p class="ds-section-caption">
      Films whose scores match exactly, to the fourth decimal — the ties the tiebreak tournament
      settles, one group at a time, starting from the top.
    </p>
    <div class="ds-strip">
      <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.tiedFilms }}</span><span class="ds-strip-label">films tied</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.groups }}</span><span class="ds-strip-label">tied groups</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.largest }}</span><span class="ds-strip-label">biggest tie</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ Math.round(ties.share * 100) }}%</span><span class="ds-strip-label">of the library</span></div>
    </div>
    <h3 class="pantheon-label">
      Next up for the tournament
      <span class="pantheon-count">{{ ties.next.films.length }} at {{ formatScore(ties.next.score) }}</span>
    </h3>
    <div class="ds-poster-row">
      <div v-for="film in ties.next.films" :key="`tie-next-${film.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.movie.title" @click="goToMovie(film)">
        <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
        <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
      </div>
    </div>
    <template v-if="biggestTies.length">
      <h3 class="pantheon-label">Biggest ties</h3>
      <div v-for="group in biggestTies" :key="`tie-${group.score}`" class="pantheon-category tie-group">
        <h3 class="pantheon-label">
          {{ group.films.length }} films at {{ formatScore(group.score) }}
        </h3>
        <div class="ds-poster-row">
          <div v-for="film in group.films" :key="`tie-${group.score}-${film.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.movie.title" @click="goToMovie(film)">
            <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
            <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<script>
// Ratings tab: how much of the library the tiebreak tournament still has
// to settle.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { tieStats } from '../../assets/javascript/deepStats.js';
import statsSection from './statsSection.js';

const tiesMemo = memoByIdentity((library) => tieStats(library, getRating));

export default {
  name: 'TiesSection',
  mixins: [statsSection],
  computed: {
    ties () {
      return tiesMemo(this.library);
    },
    // The next-up group already has its own row; don't show it twice.
    biggestTies () {
      return (this.ties?.biggest || []).filter((group) => group.score !== this.ties.next.score);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';
</style>
