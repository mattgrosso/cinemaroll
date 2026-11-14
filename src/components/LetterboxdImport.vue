<template>
  <!-- Bring a Letterboxd history in (2026-11-14). One panel for all three
       places it appears: the welcome a brand-new account sees, Settings →
       Letterboxd, and Home's notice card while a run is going or films wait
       for a match. The run itself lives in utils/letterboxdImportRun.js, so
       leaving a screen doesn't stop it. -->
  <div class="lb-import" :class="`lb-import-${variant}`">
    <template v-if="!state.running && !hasResult">
      <p v-if="variant === 'welcome'" class="lb-lead">Coming from Letterboxd? Bring your diary with you.</p>
      <p class="lb-note">
        On Letterboxd: Settings → Import &amp; Export → Export your data. Pick the zip it gives you here.
        Each film's stars become its score (4 stars is an 8), and you can rate any of them properly later.
      </p>
      <label class="lb-button lb-primary" :class="{ disabled: !online }">
        <i class="bi bi-box-arrow-in-down"></i> Choose your Letterboxd export
        <input type="file" accept=".zip,.csv,application/zip,text/csv" class="d-none" :disabled="!online" @change="pickFile">
      </label>
      <p v-if="!online" class="lb-note">Needs a connection: every film is looked up as it comes in.</p>
    </template>

    <template v-if="state.running">
      <p class="lb-lead">
        <span v-if="state.phase === 'reading'">Reading your export&hellip;</span>
        <span v-else-if="state.phase === 'reviews'">Adding your reviews&hellip;</span>
        <span v-else>Bringing in your Letterboxd films: {{ state.processed.toLocaleString() }} of {{ state.total.toLocaleString() }}</span>
      </p>
      <div class="lb-progress" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
        <div class="lb-progress-fill" :style="{ width: `${percent}%` }"></div>
      </div>
      <p class="lb-note">You can keep using Cinema Roll while this runs. If the app closes, it picks up where it stopped.</p>
    </template>

    <template v-if="!state.running && hasResult">
      <p class="lb-lead">
        From Letterboxd: {{ state.imported.toLocaleString() }} film{{ state.imported === 1 ? '' : 's' }} added<span v-if="state.viewingsAdded"> ({{ state.viewingsAdded.toLocaleString() }} viewing{{ state.viewingsAdded === 1 ? '' : 's' }})</span><span v-if="state.reviewsImported">, {{ state.reviewsImported.toLocaleString() }} review{{ state.reviewsImported === 1 ? '' : 's' }}</span>.
      </p>
      <p v-if="state.message" class="lb-note" :class="{ 'lb-warning': state.error }">{{ state.message }}</p>
      <button v-if="state.pending" type="button" class="lb-button lb-primary" :disabled="!online" @click="resume">Pick up where it stopped</button>

      <div v-if="state.doubtful.length" class="lb-doubtful">
        <p class="lb-subhead">Find the match ({{ state.doubtful.length }})</p>
        <p class="lb-note">These weren't a sure match, so they're waiting for you rather than landing on the wrong film.</p>
        <ul class="lb-doubtful-list">
          <li v-for="film in shownDoubtful" :key="film.key" class="lb-doubtful-row">
            <div class="lb-doubtful-head">
              <strong>{{ film.title }}</strong><span v-if="film.year"> ({{ film.year }})</span>
              <span class="lb-viewings"> · {{ film.viewings.length }} viewing{{ film.viewings.length === 1 ? '' : 's' }}</span>
            </div>
            <div v-if="film.suggestion && searchingKey !== film.key" class="lb-suggestion">
              <img v-if="film.suggestion.poster_path" :src="`https://image.tmdb.org/t/p/w92${film.suggestion.poster_path}`" alt="" class="lb-poster">
              <span class="lb-suggestion-text">Is it {{ film.suggestion.title }}<span v-if="film.suggestion.release_date"> ({{ film.suggestion.release_date.slice(0, 4) }})</span>?</span>
            </div>
            <div class="lb-actions">
              <button v-if="film.suggestion && searchingKey !== film.key" type="button" class="lb-button lb-primary lb-small" :disabled="busyKey === film.key || !online" @click="choose(film, film.suggestion.id)">Yes, that one</button>
              <button type="button" class="lb-button lb-small" :disabled="busyKey === film.key || !online" @click="openSearch(film)">Search</button>
              <button type="button" class="lb-button lb-small" :disabled="busyKey === film.key" @click="skip(film)">Skip</button>
            </div>
            <div v-if="searchingKey === film.key" class="lb-search">
              <div class="lb-search-row">
                <input v-model="query" type="text" class="form-control form-control-sm" placeholder="Film title" @keyup.enter.prevent="runSearch">
                <button type="button" class="lb-button lb-small" :disabled="!query || searchBusy" @click="runSearch">Find</button>
              </div>
              <p v-if="searchMessage" class="lb-note">{{ searchMessage }}</p>
              <MediaResultGrid :mediaList="results" @select="choose(film, $event.id)"/>
            </div>
          </li>
        </ul>
        <button v-if="state.doubtful.length > shownDoubtful.length" type="button" class="lb-button lb-small" @click="limit += 10">Show more</button>
      </div>

      <div class="lb-footer">
        <label class="lb-button lb-small" :class="{ disabled: !online }">
          Import another export
          <input type="file" accept=".zip,.csv,application/zip,text/csv" class="d-none" :disabled="!online" @change="pickFile">
        </label>
        <button v-if="!state.pending" type="button" class="lb-button lb-small" @click="clear">Done</button>
      </div>
    </template>

    <p v-if="!state.running && !hasResult && state.message" class="lb-note lb-warning">{{ state.message }}</p>
  </div>
</template>

<script>
import MediaResultGrid from './MediaResultGrid.vue';
import { importState } from '../utils/letterboxdImportState.js';
import { trackEvent } from '../utils/usage.js';

// The runner brings the store, TMDB and the zip reader with it: loaded only
// when there's an import to run or show.
const runner = () => import('../utils/letterboxdImportRun.js');

export default {
  name: 'LetterboxdImport',
  components: { MediaResultGrid },
  props: {
    // 'welcome' (new account), 'settings', or 'notice' (Home's card)
    variant: { type: String, default: 'settings' }
  },
  data () {
    return {
      state: importState,
      limit: 10,
      searchingKey: null,
      query: '',
      results: [],
      searchBusy: false,
      searchMessage: '',
      busyKey: null
    };
  },
  computed: {
    online () {
      return this.$store.state.isOnline !== false;
    },
    hasResult () {
      return this.state.total > 0 && ['done', 'paused'].includes(this.state.phase);
    },
    percent () {
      return this.state.total ? Math.round((this.state.processed / this.state.total) * 100) : 0;
    },
    shownDoubtful () {
      return this.state.doubtful.slice(0, this.limit);
    }
  },
  async mounted () {
    if (!this.state.loaded) (await runner()).loadSavedImport();
  },
  methods: {
    async pickFile (event) {
      const file = event?.target?.files?.[0];
      if (event?.target) event.target.value = '';
      if (!file) return;
      trackEvent('letterboxd-import');
      (await runner()).startLetterboxdImport(file);
    },
    async resume () {
      (await runner()).resumeLetterboxdImport();
    },
    openSearch (film) {
      this.searchingKey = film.key;
      this.query = film.title;
      this.results = [];
      this.searchMessage = '';
      this.runSearch();
    },
    async runSearch () {
      if (!this.query) return;
      this.searchBusy = true;
      this.searchMessage = '';
      try {
        this.results = await (await runner()).searchTmdbMovies(this.query);
        if (!this.results.length) this.searchMessage = 'Nothing found. Try another spelling.';
      } catch {
        this.searchMessage = "Couldn't search just now.";
      } finally {
        this.searchBusy = false;
      }
    },
    async choose (film, tmdbId) {
      this.busyKey = film.key;
      try {
        await (await runner()).matchDoubtfulFilm(film.key, tmdbId);
        this.searchingKey = null;
        this.results = [];
      } catch {
        this.searchMessage = "Couldn't add that one just now. Try again.";
      } finally {
        this.busyKey = null;
      }
    },
    async skip (film) {
      if (this.searchingKey === film.key) this.searchingKey = null;
      (await runner()).skipDoubtfulFilm(film.key);
    },
    async clear () {
      (await runner()).clearLetterboxdImport();
    }
  }
};
</script>

<style scoped>
.lb-import {
  color: #eee;
  text-align: left;
}
.lb-import-welcome {
  background: #1b1b1b;
  border: 1px solid #333;
  border-radius: 10px;
  margin: 0.75rem auto 0;
  max-width: 26rem;
  padding: 0.85rem 1rem;
}
.lb-lead {
  color: #f2f2f2;
  font-size: 0.92rem;
  margin: 0 0 0.4rem;
}
.lb-subhead {
  color: #f2f2f2;
  font-size: 0.88rem;
  font-weight: 600;
  margin: 0.75rem 0 0.2rem;
}
.lb-note {
  color: #c8c8c8;
  font-size: 0.78rem;
  margin: 0 0 0.5rem;
}
.lb-warning {
  color: #ffc46b;
}
.lb-button {
  align-items: center;
  background: #2a2a2a;
  border: 1px solid #555;
  border-radius: 8px;
  color: #f2f2f2;
  cursor: pointer;
  display: inline-flex;
  font-size: 0.85rem;
  gap: 0.35rem;
  margin: 0 0.4rem 0.4rem 0;
  min-height: 40px;
  padding: 0.45rem 0.8rem;
}
.lb-button:active {
  background: #3a3a3a;
}
.lb-button.disabled,
.lb-button:disabled {
  opacity: 0.5;
  pointer-events: none;
}
.lb-primary {
  background: #1d4d63;
  border-color: #3a8db3;
  color: #fff;
}
.lb-primary:active {
  background: #26647f;
}
.lb-small {
  font-size: 0.78rem;
  padding: 0.3rem 0.6rem;
}
.lb-progress {
  background: #2a2a2a;
  border-radius: 4px;
  height: 8px;
  margin-bottom: 0.5rem;
  overflow: hidden;
}
.lb-progress-fill {
  background: #40bcf4;
  height: 100%;
  transition: width 0.3s ease;
}
.lb-doubtful-list {
  list-style: none;
  margin: 0;
  max-height: 60vh;
  overflow-y: auto;
  padding: 0;
}
.lb-doubtful-row {
  border-top: 1px solid #333;
  padding: 0.55rem 0 0.2rem;
}
.lb-doubtful-head {
  color: #f2f2f2;
  font-size: 0.85rem;
  margin-bottom: 0.3rem;
}
.lb-viewings {
  color: #c8c8c8;
}
.lb-suggestion {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
}
.lb-poster {
  border-radius: 3px;
  height: 54px;
  object-fit: cover;
  width: 36px;
}
.lb-suggestion-text {
  color: #ddd;
  font-size: 0.82rem;
}
.lb-actions {
  display: flex;
  flex-wrap: wrap;
}
.lb-search-row {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.4rem;
}
.lb-search-row .lb-button {
  margin: 0;
}
.lb-footer {
  margin-top: 0.6rem;
}
</style>
