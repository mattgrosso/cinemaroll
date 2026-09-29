<template>
  <section v-if="marathon" class="ds-section marathon">
    <h2 class="ds-section-title">Marathon Club</h2>
    <p class="ds-section-caption">
      How much you've packed into a single stretch — the most films you've watched in one
      day, one week and one month, and how many days you've watched anything at all.
      Not consecutive days; the biggest ones.
    </p>
    <div class="ds-strip">
      <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.dayRecord.count }}</span><span class="ds-strip-label">day record · {{ duration(marathon.dayRecord.minutes) }}</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.weekRecord.count }}</span><span class="ds-strip-label">week record · {{ duration(marathon.weekRecord.minutes) }}</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.monthRecord.count }}</span><span class="ds-strip-label">month record · {{ duration(marathon.monthRecord.minutes) }}</span></div>
      <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.movieDays }}</span><span class="ds-strip-label">movie days</span></div>
    </div>
    <h3 class="pantheon-label">Biggest days</h3>
    <ol class="top-days">
      <li v-for="(dayEntry, index) in marathon.topDays" :key="dayEntry.day" class="top-day">
        <span class="top-day-rank">{{ index + 1 }}</span>
        <div class="top-day-info">
          <span class="top-day-date">{{ dayEntry.day }}</span>
          <span class="top-day-detail">{{ dayEntry.count }} movies · {{ duration(dayEntry.minutes) }}</span>
          <!-- "Should show the posters of the movies I watched on the
               longest days. Make sure [they] be pretty small though."
               (2026-08-17) -->
          <div class="day-posters">
            <template v-for="(watched, position) in dayEntry.entries" :key="`${dayEntry.day}-${watched.dbKey}-${position}`">
              <img
                v-if="watched.movie.poster_path"
                :src="poster(watched)"
                :alt="watched.movie.title"
                :title="watched.movie.title"
                class="day-poster"
                loading="lazy"
                @click="goToMovie(watched)"
              >
            </template>
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>

<script>
// Activity tab: the biggest single stretches of watching.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { marathonStats } from '../../assets/javascript/deepStats.js';
import statsSection from './statsSection.js';

const marathonMemo = memoByIdentity((library, includeShorts) => marathonStats(library, { includeShorts }));

export default {
  name: 'MarathonSection',
  mixins: [statsSection],
  computed: {
    marathon () {
      return marathonMemo(this.library, Boolean(this.$store.state.settings?.includeShorts));
    }
  },
  methods: {
    duration (minutes) {
      if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const mins = Math.round(minutes % 60);
      return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${mins}m`].filter(Boolean).join(' ');
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

.day-posters { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 0.3rem; }

/* Small on purpose — they're a reminder of the day, not the subject. */
.day-poster {
  border-radius: 3px;
  cursor: pointer;
  display: block;
  height: 45px;
  object-fit: cover;
  width: 30px;
}

.day-poster:active { opacity: 0.7; }

.top-days { list-style: none; margin: 0; padding: 0; }
.top-day { align-items: center; display: flex; gap: 0.75rem; padding: 0.35rem 0; }
.top-day-rank {
  align-items: center;
  background: #101010;
  border: 1px solid #3a3a3a;
  border-radius: 50%;
  color: var(--accent, #ffc107);
  display: flex;
  flex: 0 0 28px;
  font-size: 0.8rem;
  font-weight: 700;
  height: 28px;
  justify-content: center;
}
.top-day-info { display: flex; flex-direction: column; }
.top-day-date { font-size: 0.85rem; font-weight: 600; }
.top-day-detail { color: #ccc; font-size: 0.72rem; }
</style>
