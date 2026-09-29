<template>
  <section v-if="standoutList.length" class="ds-section standouts-section">
    <h2 class="ds-section-title">Standouts</h2>
    <p class="ds-section-caption">
      The corners of your library you rate unusually well, ranked against each other — genres,
      keywords, directors, actors, studios, decades. The number is how far above your own average
      each one sits, pulled back toward that average when there's little evidence, so eight films
      can beat four hundred but one lucky film can't beat anything.
    </p>
    <div class="standouts">
      <div v-for="standout in standoutList" :key="`${standout.facet}-${standout.value}`" class="standout">
        <div class="standout-head">
          <span class="standout-facet">{{ standout.facet }}</span>
          <span class="standout-value">{{ standout.value }}</span>
          <span class="standout-score" :class="{ gold: standout.lift > 0 }">
            {{ standout.lift > 0 ? '+' : '' }}{{ standout.lift.toFixed(2) }}
          </span>
        </div>
        <p class="standout-detail">
          {{ standout.count }} rated · {{ standout.mean.toFixed(2) }} average · {{ standout.score }} log score
        </p>
        <div class="ds-poster-row">
          <div
            v-for="film in standout.top"
            :key="`${standout.value}-${film.dbKey}`"
            class="ds-poster-card"
            role="button"
            :aria-label="film.movie.title"
            @click="goToMovie(film)"
          >
            <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
            <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script>
// Ratings tab: what you rate unusually well, ranked across every facet.
import { standouts } from '../../assets/javascript/deepStats.js';
import statsSection, { libraryMemo } from './statsSection.js';

const standoutsMemo = libraryMemo(standouts);

export default {
  name: 'StandoutsSection',
  mixins: [statsSection],
  computed: {
    standoutList () {
      return standoutsMemo(this.library, this.weights);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.standouts {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.standout-head {
  align-items: baseline;
  display: flex;
  gap: 0.4rem;
}

.standout-facet {
  /* #9a9a9a on this background is ~7:1. */
  color: #9a9a9a;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.standout-value {
  color: #fff;
  flex: 1 1 auto;
  font-size: 0.95rem;
  font-weight: 700;
  min-width: 0;
}

.standout-score {
  color: #b9b9b9;
  font-size: 0.95rem;
  font-weight: 700;
}

.standout-score.gold { color: var(--accent, #ffc107); }

.standout-detail {
  color: #b9b9b9;
  font-size: 0.72rem;
  margin: 0.1rem 0 0.3rem;
}
</style>
