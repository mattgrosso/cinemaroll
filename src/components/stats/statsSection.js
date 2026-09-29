// Plumbing shared by the library-stats sections (formerly Deep Stats). Each
// section is a pure function in deepStats.js / decadeChampionship.js; the
// components only render.
//
// Results are memoized on the library getter's identity plus the Log Score
// weights as JSON (settings is mutated in place, so it can't be an identity
// key). These sections live on Insights tabs, which remount on every tab
// switch — without the memo every switch rebuilt them.
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { logScoreSettings } from '../../assets/javascript/logScore.js';
import { formatScore } from '../../assets/javascript/formatScore.js';

// fn(library, getRating, weights, ...rest), remembered for the last
// (library, weights, ...rest).
export function libraryMemo (fn) {
  const memo = memoByIdentity((library, weightsKey, ...rest) => fn(library, getRating, JSON.parse(weightsKey), ...rest));
  return (library, weights, ...rest) => memo(library, JSON.stringify(weights ?? null), ...rest);
}

export default {
  computed: {
    library () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    weights () {
      return logScoreSettings(this.$store.state.settings);
    }
  },
  methods: {
    formatScore,
    poster (entry) {
      return `https://image.tmdb.org/t/p/w185${entry.movie.poster_path}`;
    },
    goToMovie (entry) {
      if (entry?.movie?.id == null) return;
      this.$router.push(`/movie/${entry.movie.id}`);
    }
  }
};
