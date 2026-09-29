<template>
  <section v-if="genres.length" class="ds-section genres">
    <h2 class="ds-section-title">Genres</h2>
    <p class="ds-section-caption">Ranked by log score — favorites rewarded, small samples humbled.</p>
    <div v-for="(genre, index) in genres" :key="genre.name" class="pantheon-category">
      <h3 class="pantheon-label">
        <span class="genre-rank">#{{ index + 1 }}</span> {{ genre.name }}
        <span class="pantheon-count">{{ genre.count }} rated</span>
        <span class="genre-score">{{ genre.score }}</span>
      </h3>
      <div class="ds-poster-row">
        <div v-for="film in genre.top" :key="`${genre.name}-${film.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.movie.title" @click="goToMovie(film)">
          <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
          <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
// Ratings tab: every genre, ranked by Log Score.
import { genreStats } from '../../assets/javascript/deepStats.js';
import statsSection, { libraryMemo } from './statsSection.js';

const genresMemo = libraryMemo(genreStats);

export default {
  name: 'GenresSection',
  mixins: [statsSection],
  computed: {
    genres () {
      return genresMemo(this.library, this.weights);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.genre-rank { color: var(--accent, #ffc107); }
.genre-score { color: var(--accent, #ffc107); float: right; }
</style>
