<template>
  <div class="reconcile-placeholder">
    <div class="reconcile-header">
      <div class="home-link" @click="goHome">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-left-fill" viewBox="0 0 16 16">
          <path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
        </svg>
        <span>Home</span>
      </div>
      <h1 class="text-light m-0 px-3 py-2">Find the Match</h1>
    </div>

    <div class="reconcile-content container-fluid" v-if="queueEntry">
      <p class="text-center mt-3">
        You rated "<strong>{{ queueEntry.title }}</strong>"<span v-if="queueEntry.year"> ({{ queueEntry.year }})</span> while offline.
        Search below and pick the real movie so it can be matched up.
      </p>

      <div v-if="!$store.state.isOnline" class="alert alert-warning text-center mx-auto" style="max-width: 500px;">
        You're offline — come back once you have a connection to find the real match.
      </div>
      <template v-else>
        <div class="row p-3 justify-content-center">
          <div class="col-12 col-md-8">
            <input class="form-control" type="text" v-model="query" @keyup.enter.prevent="search" placeholder="Movie title">
            <button class="btn btn-primary mt-2 w-100" @click="search" :disabled="searching || !query">
              <span v-if="searching">Searching...</span>
              <span v-else>Search</span>
            </button>
          </div>
        </div>

        <p v-if="searchError" class="text-danger text-center">{{ searchError }}</p>
        <p v-else-if="searched && !results.length" class="text-center">No results found. Try a different search.</p>

        <MediaResultGrid :mediaList="results" @select="selectMatch" />
      </template>

      <div class="text-center mt-3 mb-5">
        <button class="btn btn-outline-secondary" @click="skip" :disabled="finalizing">Skip for now</button>
      </div>
    </div>

    <div v-else class="text-center py-5">
      <p>Couldn't find that pending rating — it may have already been matched.</p>
      <button class="btn btn-primary" @click="goHome">Back to Home</button>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import MediaResultGrid from './MediaResultGrid.vue';
import { finalizePlaceholder } from '../assets/javascript/reconcilePlaceholder.js';
import { listPendingWrites } from '../utils/pendingWriteQueue.js';
import ErrorLogService from '../services/ErrorLogService.js';

export default {
  components: { MediaResultGrid },
  data () {
    return {
      queueEntry: null,
      query: '',
      results: [],
      searching: false,
      searched: false,
      searchError: null,
      finalizing: false
    }
  },
  async mounted () {
    this.$store.commit('setShowHeader', false);

    const dbKey = this.$route.params.dbKey;
    const pending = await listPendingWrites();
    this.queueEntry = pending.find((entry) => entry.type === 'placeholder' && entry.dbEntry?.path === `movieLog/${dbKey}`) || null;

    if (this.queueEntry) {
      this.query = this.queueEntry.title || '';
      if (this.query && this.$store.state.isOnline) {
        this.search();
      }
    }
  },
  beforeRouteLeave () {
    this.$store.commit('setShowHeader', true);
  },
  methods: {
    async search () {
      if (!this.query) {
        return;
      }
      this.searching = true;
      this.searchError = null;
      this.searched = false;
      try {
        const resp = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US&query=${encodeURIComponent(this.query)}`);
        this.results = resp?.data?.results || [];
      } catch (error) {
        console.error('Reconciliation search failed:', error);
        ErrorLogService.error('Reconciliation search failed:', error);
        this.searchError = 'Could not search TMDB right now. Check your connection and try again.';
        this.results = [];
      } finally {
        this.searching = false;
        this.searched = true;
      }
    },
    // Finalizes the placeholder: builds the real, TMDB-shaped movie object
    // from the picked result + the ratings already collected offline, and
    // REPLACES the existing movieLog entry in place (same dbKey) rather than
    // creating a new one + deleting the old - a single atomic write.
    async selectMatch (tmdbResult) {
      if (!this.queueEntry) {
        return;
      }
      this.finalizing = true;
      this.searchError = null;
      try {
        // Shared with the automatic path (reconcilePlaceholder.js): the
        // entry is replaced in place, the write confirmed, the queue tidied.
        await finalizePlaceholder(this.$store, this.queueEntry, tmdbResult.id);

        this.goHome();
      } catch (error) {
        console.error('Failed to finalize reconciliation:', error);
        ErrorLogService.error('Failed to finalize reconciliation:', error);
        this.searchError = 'Could not save this match. Check your connection and try again.';
      } finally {
        this.finalizing = false;
      }
    },
    skip () {
      this.goHome();
    },
    goHome () {
      this.$store.commit('setShowHeader', true);
      this.$router.push('/');
    }
  }
}
</script>

<style lang="scss">
  .reconcile-placeholder {
    .reconcile-header {
      position: relative;
      background-color: #212529;

      .home-link {
        align-items: center;
        background: rgba(0, 0, 0, 0.5);
        border-radius: 4px;
        color: white;
        cursor: pointer;
        display: flex;
        font-size: 1rem;
        left: 0;
        margin: 6px;
        padding: 2px 8px;
        position: absolute;
        text-decoration: none;
        top: 0;
      }

      h1 {
        font-size: 1.5rem;
        padding-top: 3rem !important;
      }
    }

    .reconcile-content {
      max-width: 650px;
      margin: 0 auto;
    }
  }
</style>
