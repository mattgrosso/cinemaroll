import { getRating } from "../assets/javascript/GetRating.js";
import { fetchWithTimeout } from '../utils/networkHealth.js';
import { globalAverage } from "../assets/javascript/logScore.js";
import ErrorLogService from "../services/ErrorLogService.js";

/**
 * Shared machinery for the "Favorite <people>" sections (directors, actors,
 * writers, …). This holds ONLY the parts that are identical across every
 * section and carry no per-type meaning: the TMDB details cache, the Firebase
 * load/save of tuner values, the tuner event wiring, and the stale-rescore
 * guard. Each component keeps its OWN tuningDefaults, lever values, gather
 * logic, scoring, and tunerLevers — so every section stays independently
 * tunable. See FavoriteDirectors.vue for the canonical consumer.
 *
 * A consuming component MUST provide:
 *   data:    tuningKey (String), tuningDefaults (Object), one data prop per
 *            lever key in tuningDefaults.
 *   computed: tunerLevers (Array passed to <FavoriteTuner>).
 *   methods: averageRating(list, weights?), buildTopTwelveList(), rescore().
 */
export default {
  data () {
    return {
      // name -> TMDB details (or null). Cached so re-scoring on a tuner change
      // never re-hits the API.
      detailsCache: {},
      // name -> in-flight lookup promise. Portrait fetches are no longer
      // awaited before the list renders, so two rescores can overlap;
      // without this they would each issue their own request for the same
      // person (caught by the "does not re-hit TMDB" test).
      detailsInFlight: {},
      // Gathered people for the current library load; shape is component-defined.
      peopleData: [],
      // Bumped each rescore so a slower async rescore can detect it was
      // superseded and drop its (now stale) result.
      rescoreSeq: 0
    };
  },
  computed: {
    // The library-wide average, for PersonModal's "vs your library" figure.
    // Type-agnostic, so it belongs here rather than in eight copies — and
    // every section already has the entries it needs.
    libraryAverageScore () {
      return globalAverage(this.allEntriesWithFlatKeywordsAdded, getRating);
    }
  },
  async mounted () {
    this.loadPersistedTuning();
    this.waitForDataAndBuildList();
  },
  methods: {
    getRating,
    updateSearchValue (value) {
      this.$emit('updateSearchValue', value);
    },
    mostRecentRating (result) {
      if (result.ratings && result.ratings.length) {
        return result.ratings[result.ratings.length - 1];
      }
      return {};
    },
    async waitForDataAndBuildList () {
      if (Array.isArray(this.allEntriesWithFlatKeywordsAdded) && this.allEntriesWithFlatKeywordsAdded.length > 0) {
        await this.buildTopTwelveList();
      } else {
        setTimeout(this.waitForDataAndBuildList, 100);
      }
    },
    async getDetailsForCastMember (personName) {
      const query = encodeURIComponent(personName);
      const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${query}`;
      try {
        const response = await fetchWithTimeout(url);
        if (!response.ok) {
          throw new Error('Failed to fetch from TMDB');
        }
        const data = await response.json();
        return data.results && data.results.length > 0 ? data.results[0] : null;
      } catch (error) {
        console.error('Error fetching TMDB person:', error);
        ErrorLogService.error('Error fetching TMDB person:', error);
        return null;
      }
    },
    async getCachedDetails (name) {
      // Cache by name (including null misses) so slider re-scores never re-fetch.
      if (Object.prototype.hasOwnProperty.call(this.detailsCache, name)) {
        return this.detailsCache[name];
      }
      if (this.detailsInFlight[name]) {
        return this.detailsInFlight[name];
      }
      const lookup = this.getDetailsForCastMember(name).then((details) => {
        this.detailsCache[name] = details;
        delete this.detailsInFlight[name];
        return details;
      }).catch((error) => {
        delete this.detailsInFlight[name];
        throw error;
      });
      this.detailsInFlight[name] = lookup;
      return lookup;
    },
    bayesianAverage (list, weights = null, globalAvgOverride = null) {
      // Weighted Bayesian average. globalAvgOverride lets rescore() compute the
      // (lever-dependent) library-wide average ONCE per pass instead of per
      // person — identical result when omitted. Uses the component's own
      // averageRating, so each section's blend/plain rating is respected.
      const n = weights ? weights.reduce((a, b) => a + b, 0) : list.length;
      const c = this.confidenceNumber;
      const avg = parseFloat(this.averageRating(list, weights));
      const globalAvg = globalAvgOverride !== null
        ? globalAvgOverride
        : parseFloat(this.averageRating(this.allEntriesWithFlatKeywordsAdded));
      return (n / (n + c)) * avg + (c / (n + c)) * globalAvg;
    },
    loadPersistedTuning () {
      const saved = this.$store.state.settings &&
        this.$store.state.settings.favoriteTuning &&
        this.$store.state.settings.favoriteTuning[this.tuningKey];
      if (!saved) return;
      Object.keys(this.tuningDefaults).forEach(key => {
        if (typeof saved[key] === 'number' && !isNaN(saved[key])) {
          this[key] = saved[key];
        }
      });
    },
    persistTuning () {
      const values = {};
      Object.keys(this.tuningDefaults).forEach(key => { values[key] = this[key]; });
      const existing = (this.$store.state.settings && this.$store.state.settings.favoriteTuning) || {};
      // Optimistic local update so the change is reflected immediately.
      this.$store.commit('setSettings', {
        ...this.$store.state.settings,
        favoriteTuning: { ...existing, [this.tuningKey]: values }
      });
      this.$store.dispatch('writeDurably', {
        path: `settings/favoriteTuning/${this.tuningKey}`,
        value: values
      });
    },
    async onTunerUpdate ({ key, value }) {
      if (!(key in this.tuningDefaults)) return;
      this[key] = value;
      this.persistTuning();
      await this.rescore();
    },
    async resetTuner () {
      Object.keys(this.tuningDefaults).forEach(key => { this[key] = this.tuningDefaults[key]; });
      this.persistTuning();
      await this.rescore();
    }
  }
};
