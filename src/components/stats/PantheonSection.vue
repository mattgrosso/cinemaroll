<template>
  <section v-if="pantheonData.constellations.length" class="ds-section pantheon">
    <h2 class="ds-section-title">The Pantheon</h2>
    <p class="ds-section-caption">
      Perfection, category by category — {{ pantheonData.perfectFilms }} film{{ pantheonData.perfectFilms === 1 ? '' : 's' }},
      {{ pantheonData.totalMarks }} perfect marks.
    </p>
    <!-- The per-category lists are gone: with this many perfect marks in
         each one they were long without being interesting ("I have too many
         movies in each of these categories for it to be really
         fascinating"). Constellations survive because scoring perfectly in
         more than one category at once still means something. -->
    <div class="pantheon-category">
      <h3 class="pantheon-label">Constellations <span class="pantheon-count">{{ pantheonData.constellations.length }}</span></h3>
      <p class="ds-section-caption">Perfect in more than one category at once.</p>
      <div class="ds-poster-row">
        <div v-for="star in pantheonData.constellations" :key="star.entry.dbKey" class="ds-poster-card" role="button" :aria-label="star.entry.movie.title" @click="goToMovie(star.entry)">
          <img v-if="star.entry.movie.poster_path" :src="poster(star.entry)" :alt="star.entry.movie.title" class="ds-poster">
          <div v-else class="ds-poster ds-poster-blank">{{ star.entry.movie.title }}</div>
          <span class="ds-poster-note gold">{{ star.count }} perfect marks</span>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
// Ratings tab: films perfect in more than one criterion at once.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { pantheon } from '../../assets/javascript/deepStats.js';
import statsSection from './statsSection.js';

const pantheonMemo = memoByIdentity((library) => pantheon(library, getRating));

export default {
  name: 'PantheonSection',
  mixins: [statsSection],
  computed: {
    pantheonData () {
      return pantheonMemo(this.library);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';
</style>
