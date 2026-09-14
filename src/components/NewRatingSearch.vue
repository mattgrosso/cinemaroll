<template>
  <div class="new-rating-search mt-1 mb-4 mx-3">
    <div v-if="suggestionsMode && suggestions && suggestions.length" class="quick-pick">
      <p>Want some help getting started? Rate one of these popular movies:</p>
      <PickMedia :quickPick="true" :mediaList="suggestions" />
      <div class="button-wrapper d-flex justify-content-end gap-2">
        <button class="btn btn-warning" @click="$emit('cancel-suggestions')">Cancel</button>
        <button class="btn btn-primary" @click="fetchSuggestions" id="new-suggestions-button">More suggestions...</button>
      </div>
    </div>
    <div v-else-if="quickPickResults" class="quick-pick">
      <p>Add rating for...</p>
      <PickMedia :quickPick="true"/>
      <div class="button-wrapper d-flex justify-content-end">
        <button class="btn btn-primary" @click="searchTMDB(false)" id="new-rating-button">Show More Results</button>
      </div>
    </div>
    <div v-else-if="offlineFallback" class="offline-fallback">
      <p>You're offline, so "{{ value }}" can't be looked up on TMDB right now.</p>
      <p>You can still rate it from memory — once you're back online, you'll be asked to confirm which movie it was.</p>
      <button class="btn btn-primary" @click="rateOffline">Rate "{{ value }}" from memory</button>
    </div>
    <div v-else-if="noResults" ref="noResults">
      <p>No results found in your Movie Log or on TMDB.</p>
      <p>I'm pretty sure that movie doesn't exist.</p>
      <p>Either you're from the future or maybe you just spelled it wrong.</p>
    </div>
    <div v-else class="d-flex justify-content-center my-5">
      <div class="spinner-border" :class="inDarkMode ? 'text-light' : 'text-dark'" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import debounce from 'lodash/debounce';
import RatingChangeRibbon from './RatingChangeRibbon.vue';
import PickMedia from './PickMedia.vue';
import { makePlaceholderId } from '../utils/placeholderId.js';

export default {
  components: {
    RatingChangeRibbon,
    PickMedia
  },
  props: {
    value: {
      type: String,
      required: true
    },
    suggestionsMode: {
      type: Boolean,
      default: false
    }
  },
  data () {
    return {
      quickPickResults: null,
      noResults: false,
      suggestions: [],
      suggestionsPage: 1,
      offlineFallback: false
    }
  },
  mounted () {
    if (this.suggestionsMode) {
      this.fetchSuggestions();
    } else if (!this.$store.state.isOnline) {
      // No point firing a doomed TMDB search - offer the offline "rate from
      // memory" path immediately instead of waiting on a request that can't
      // succeed. See AddRating.js/placeholderId.js for the placeholder-
      // rating + later-reconciliation mechanics.
      this.offlineFallback = true;
    } else {
      setTimeout(() => {
        this.searchTMDB(true);
      }, 1000);
    }
  },
  watch: {
    value () {
      if (this.suggestionsMode) {
        return;
      }
      if (!this.$store.state.isOnline) {
        this.offlineFallback = true;
        return;
      }
      this.offlineFallback = false;
      this.searchTMDB(true);
    }
  },
  computed: {
    inDarkMode () {
      return document.querySelector("body").classList.contains('bg-dark');
    },
  },
  methods: {
    async fetchSuggestions () {
      // Fetch popular movies from TMDB
      try {
        const resp = await axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US&page=${this.suggestionsPage}`);
        if (resp.data && resp.data.results && resp.data.results.length) {
          // Get IDs of already rated movies
          const ratedIds = this.$store.getters.allMoviesAsArray.map(m => m.movie.id);
          // Filter out already rated
          const filtered = resp.data.results.filter(movie => !ratedIds.includes(movie.id));
          // Shuffle the filtered array
          for (let i = filtered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [filtered[i], filtered[j]] = [filtered[j], filtered[i]];
          }
          this.suggestions = filtered.slice(0, 3);
          this.suggestionsPage = this.suggestionsPage >= resp.data.total_pages ? 1 : this.suggestionsPage + 1;
        }
      } catch {
        this.suggestions = [];
      }
    },
    searchTMDB: debounce(async function (quickPick) {
      if (!this.value) {
        return;
      }
      let resp;
      try {
        resp = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US&query=${this.value}`);
      } catch {
        // Covers both a hard offline drop mid-request and any other network
        // failure - either way TMDB can't be reached right now, so offer the
        // same "rate from memory" recovery rather than hanging on the spinner.
        this.offlineFallback = true;
        return;
      }
      if (!resp || !resp.data || !resp.data.results) {
        this.showNoResultsMessage();
        return;
      }
      this.offlineFallback = false;
      if (quickPick && resp.data.results.length) {
        this.quickPickEntrySearch(resp.data.results);
      } else if (resp.data.results.length) {
        this.newEntrySearch(resp.data.results);
      } else {
        this.showNoResultsMessage();
      }
    }, 500),
    showNoResultsMessage () {
      // No auto-clear timer - it used to silently wipe out whatever the user
      // had typed after 5 seconds with no action on their part, which read as
      // stressful/unpredictable. The message doesn't reference the specific
      // term, so it's safe to just sit here; editing the input (the `value`
      // watcher) naturally re-runs the search and moves on when it succeeds.
      this.noResults = true;
    },
    quickPickEntrySearch (results) {
      this.$store.commit('setNewEntrySearchResults', results);
      this.quickPickResults = results;
    },
    newEntrySearch (results) {
      this.$store.commit('setNewEntrySearchResults', results)
      this.$router.push(`/pick-media/${this.value}`);
    },
    // Bypasses TMDB search entirely - builds a synthetic movieToRate with a
    // placeholder id so RateMovie.vue can be used with just a typed title.
    // AddRating.js recognizes the placeholder id and routes the save through
    // the offline queue instead of a TMDB-dependent path; the movie shows up
    // immediately with a "Pending match" badge until reconciled.
    rateOffline () {
      if (!this.value) {
        return;
      }
      const media = {
        id: makePlaceholderId(),
        title: this.value,
        release_date: null,
        poster_path: null,
        backdrop_path: null
      };
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
  }
}
</script>

<style lang="scss">
  .new-rating-search {
    .search-inputs {
      position: relative;
    }

    .last-three-shows {
      ul {
        align-items: center;
        display: flex;
        justify-content: center;
        list-style: none;
        margin: 0;
        padding: 0;

        li {
          background-color: white;
          border: 6px solid black;
          box-shadow: 0 0 5px 0 rgba(0,0,0,0.5);
          cursor: pointer;
          margin: 0 12px;
          padding: 6px;
          position: relative;

          img {
            width: 100%;
          }

          .rating-change {
            right: 0;
            position: absolute;
            top: 100%;
            transform: translate(22px, -22px);
          }
        }
      }
    }
  }
</style>