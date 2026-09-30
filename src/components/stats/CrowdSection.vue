<template>
  <section v-if="result.ready" class="ds-section crowd-section">
    <h2 class="ds-section-title">You vs Letterboxd</h2>
    <p class="ds-section-caption">
      Across the {{ result.count }} films you and the Letterboxd crowd have both rated, your
      rankings are <strong>{{ result.label }}</strong> (rank correlation {{ result.spearman.toFixed(2) }}).
      Ranks, not scores — your weighted 0–10 and their 0.5–5 stars can't be subtracted, so a film
      counts as a disagreement when you place it far from where the crowd does.
    </p>
    <div class="crowd-lists">
      <div v-if="result.youLove.length" class="crowd-list">
        <p class="crowd-list-title">You rank these far above the crowd</p>
        <div v-for="row in result.youLove" :key="row.entry.dbKey" class="crowd-row" role="button" :aria-label="row.entry.movie.title" @click="goToMovie(row.entry)">
          <img v-if="row.entry.movie.poster_path" :src="poster(row.entry)" :alt="row.entry.movie.title" class="crowd-poster">
          <div v-else class="crowd-poster crowd-poster-blank"></div>
          <div class="crowd-row-body">
            <span class="crowd-title">{{ row.entry.movie.title }}</span>
            <span class="crowd-numbers">you {{ formatScore(row.mine) }} · <span class="crowd-star">★</span> {{ row.crowd.toFixed(2) }}<span v-if="compactCount(row.count)"> · {{ compactCount(row.count) }}</span></span>
          </div>
          <span class="crowd-gap gold">+{{ percentPoints(row.gap) }}</span>
        </div>
      </div>
      <div v-if="result.crowdLoves.length" class="crowd-list">
        <p class="crowd-list-title">The crowd ranks these far above you</p>
        <div v-for="row in result.crowdLoves" :key="row.entry.dbKey" class="crowd-row" role="button" :aria-label="row.entry.movie.title" @click="goToMovie(row.entry)">
          <img v-if="row.entry.movie.poster_path" :src="poster(row.entry)" :alt="row.entry.movie.title" class="crowd-poster">
          <div v-else class="crowd-poster crowd-poster-blank"></div>
          <div class="crowd-row-body">
            <span class="crowd-title">{{ row.entry.movie.title }}</span>
            <span class="crowd-numbers">you {{ formatScore(row.mine) }} · <span class="crowd-star">★</span> {{ row.crowd.toFixed(2) }}<span v-if="compactCount(row.count)"> · {{ compactCount(row.count) }}</span></span>
          </div>
          <span class="crowd-gap">−{{ percentPoints(-row.gap) }}</span>
        </div>
      </div>
    </div>
    <p class="crowd-footnote">The gap is in percentile points: +40 means a film sits 40 points higher in your ranking than in theirs.</p>
  </section>
</template>

<script>
// Ratings tab (2026-09-29): my ranking against the Letterboxd crowd's.
// Matt: "how do my ratings differ from Letterboxd ratings?" The public
// ratings come from the shared letterboxdFilms cache the sweep fills
// (store: ensureLetterboxdData); the section stays hidden until at least
// twenty of my films have one.
import { tasteVsCrowd } from '../../assets/javascript/letterboxdCompare.js';
import { compactCount } from '../../assets/javascript/letterboxdFormat.js';
import statsSection, { libraryMemo } from './statsSection.js';

const crowdMemo = libraryMemo((library, getRating, weights, films) => tasteVsCrowd(library, getRating, films));

export default {
  name: 'CrowdSection',
  mixins: [statsSection],
  created () {
    this.$store.dispatch('ensureLetterboxdData');
  },
  computed: {
    films () {
      return this.$store.state.letterboxdFilms || null;
    },
    result () {
      if (!this.films) return { ready: false, count: 0 };
      return crowdMemo(this.library, this.weights, this.films);
    }
  },
  methods: {
    compactCount,
    percentPoints (gap) {
      return Math.round(gap * 100);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.crowd-lists {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.crowd-list-title {
  color: #fff;
  font-size: 0.8rem;
  font-weight: 700;
  margin: 0 0 0.3rem;
}

.crowd-row {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-top: 1px solid rgba(255, 255, 255, 0.08);

  &:active { background: rgba(255, 255, 255, 0.06); }
}

.crowd-poster {
  border-radius: 3px;
  flex: 0 0 auto;
  height: 54px;
  object-fit: cover;
  width: 36px;
}

.crowd-poster-blank { background: #333; }

.crowd-row-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.crowd-title {
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.crowd-numbers {
  color: #b9b9b9;
  font-size: 0.72rem;
}

.crowd-star { color: #00e054; }

.crowd-gap {
  color: #b9b9b9;
  flex: 0 0 auto;
  font-size: 0.95rem;
  font-weight: 700;
}

.crowd-gap.gold { color: var(--accent, #ffc107); }

.crowd-footnote {
  color: #9a9a9a;
  font-size: 0.68rem;
  margin: 0.6rem 0 0;
}
</style>
