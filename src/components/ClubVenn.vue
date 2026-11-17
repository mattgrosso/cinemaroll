<template>
  <div class="club-venn">
    <p v-if="people.length < 2" class="cv-empty">
      The Venn needs at least one friend who shares their ratings — right now it's just you here.
    </p>

    <template v-else>
      <p v-if="selected.length < 2" class="cv-empty">Pick at least two people above to draw the Venn.</p>
      <p v-else-if="selection.length > 3" class="cv-cap-note">Drawing the first three people picked — a Venn stops being readable past three circles.</p>

      <!-- The lens: same circles, three different questions. -->
      <div v-if="selected.length >= 2" class="cv-lenses">
        <button
          v-for="option in lenses"
          :key="option.key"
          type="button"
          class="cv-lens"
          :class="{ selected: lens === option.key }"
          @click="setLens(option.key)"
        >{{ option.label }}</button>
      </div>
      <p v-if="selected.length >= 2" class="cv-lens-note">{{ lensNote }}</p>

      <template v-if="selected.length >= 2">
        <!-- The diagram. A tap anywhere resolves to whichever circles contain
             the point — that subset IS the region, no path hit-testing. -->
        <div class="cv-stage">
          <svg
            class="cv-svg"
            :viewBox="`0 0 100 ${layout.height}`"
            :style="{ aspectRatio: `100 / ${layout.height}` }"
            @click="onVennTap"
          >
            <circle
              v-for="circle in layout.circles"
              :key="circle.key"
              :cx="circle.x"
              :cy="circle.y"
              :r="circle.r"
              class="cv-circle"
              :style="{ fill: colorFor(circle.key), stroke: colorFor(circle.key) }"
            />
            <text
              v-for="region in labelledRegions"
              :key="`n-${region.signature}`"
              :x="anchorFor(region).x"
              :y="anchorFor(region).y"
              class="cv-count"
              :class="{ selected: region.signature === selectedSignature }"
            >{{ region.count }}</text>
          </svg>
        </div>

        <!-- Same regions as rows, for anything too small to tap in the art. -->
        <div class="cv-legend">
          <button
            v-for="region in occupiedRegions"
            :key="`l-${region.signature}`"
            type="button"
            class="cv-legend-row"
            :class="{ selected: region.signature === selectedSignature }"
            @click="selectRegion(region.signature)"
          >
            <span class="cv-legend-dots">
              <span
                v-for="key in region.keys"
                :key="`d-${region.signature}-${key}`"
                class="cv-dot"
                :style="{ background: colorFor(key) }"
              ></span>
            </span>
            <span class="cv-legend-name">{{ labelFor(region) }}</span>
            <span class="cv-legend-count">{{ region.count }}</span>
          </button>
        </div>

        <section v-if="selectedRegion" class="cv-section">
          <h2 class="cv-section-title">{{ labelFor(selectedRegion) }}</h2>
          <p class="cv-caption">{{ regionCaption }}</p>
          <div class="cv-poster-row">
            <div
              v-for="movie in selectedRegion.movies"
              :key="movie.id"
              class="cv-poster-card"
              role="button"
              :aria-label="movie.t"
              @click="openMovie(movie)"
            >
              <div class="cv-poster-frame">
                <img v-if="movie.p" :src="poster(movie.p)" :alt="movie.t" class="cv-poster">
                <div v-else class="cv-poster cv-poster-blank">{{ movie.t }}</div>
                <SendToHat
                  v-if="!inMyLibrary(movie)"
                  class="cv-poster-hat"
                  variant="icon"
                  :movies="hatMovieFor(movie)"
                  :note="hatNoteFor(movie)"
                />
              </div>
              <span class="cv-poster-note">{{ scoresLine(movie) }}</span>
            </div>
          </div>
        </section>
        <p v-else class="cv-hint">Tap a region — in the picture or the list — to see what's in it.</p>
      </template>
    </template>
    <MoviePreview :movie="previewing" @close="previewing = null" @rate="rateFromPreview"/>
  </div>
</template>

<script>
// The Club Venn, as a section of Club Charts. Born standalone at /club-venn,
// folded in the same day on Matt's call: "the club Venn should exist inside
// of club charts... let's pour a similar amount of customizability to the
// other charts". Who's in the diagram now comes from the page-wide people
// picker via the `selection` prop (first three picked, in pick order); this
// component keeps the lens, the diagram, and the region lists. All set math
// and geometry is pure in clubVenn.js.
import SendToHat from './SendToHat.vue';
import MoviePreview from './MoviePreview.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { formatScore } from '../assets/javascript/formatScore.js';
import { memberColors, YOU_COLOR } from '../assets/javascript/clubCharts.js';
import {
  LENSES,
  LOVE_THRESHOLD,
  vennPeople,
  vennRegions,
  vennLayout,
  subsetAt,
  regionLabel
} from '../assets/javascript/clubVenn.js';

export default {
  name: 'ClubVenn',
  components: { SendToHat, MoviePreview },
  props: {
    // Ordered member keys from the page-wide picker ('you' plus friend
    // keys). The Venn draws the first three, in pick order.
    selection: { type: Array, required: true }
  },
  data () {
    return {
      lenses: LENSES,
      lens: 'all',
      selectedSignature: null,
      previewing: null
    };
  },
  computed: {
    myEntries () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    profiles () {
      return this.$store.getters.filmClubProfiles || {};
    },
    people () {
      return vennPeople(this.myEntries, getRating, this.profiles);
    },
    // Your library's ids, unlensed — governs navigation and the hat ribbon.
    myIds () {
      const you = this.people.find((person) => person.key === 'you');
      return you ? you.movies : new Map();
    },
    // The first three picked, in pick order — the cap that keeps the
    // diagram readable.
    selectedKeys () {
      return this.selection.slice(0, 3);
    },
    selected () {
      return this.selectedKeys
        .map((key) => this.people.find((person) => person.key === key))
        .filter(Boolean);
    },
    colors () {
      return memberColors(Object.keys(this.profiles));
    },
    regionData () {
      if (this.selected.length < 2) return null;
      return vennRegions(this.selected, this.lens, Date.now());
    },
    layout () {
      return this.regionData ? vennLayout(this.regionData) : null;
    },
    occupiedRegions () {
      return (this.regionData?.regions || []).filter((region) => region.count > 0);
    },
    labelledRegions () {
      return this.occupiedRegions.filter((region) => this.layout?.anchors[region.signature]);
    },
    selectedRegion () {
      if (!this.selectedSignature) return null;
      return this.occupiedRegions.find((region) => region.signature === this.selectedSignature) || null;
    },
    lensNote () {
      if (this.lens === 'loved') return `Only films someone gave ${LOVE_THRESHOLD}+ count for that person.`;
      if (this.lens === 'year') return `Only films watched in ${new Date().getFullYear()}.`;
      return 'Everything each person has rated.';
    },
    regionCaption () {
      const region = this.selectedRegion;
      if (!region) return '';
      const films = region.count === 1 ? 'film' : 'films';
      if (!region.keys.includes('you') && this.selectedKeys.includes('you')) {
        return `${region.count} ${films} you haven't rated — the hat ribbon sends one to a Movie Hat.`;
      }
      return `${region.count} ${films}, best first.`;
    }
  },
  watch: {
    // A different cast of circles makes the open region stale.
    selectedKeys () {
      this.selectedSignature = null;
    }
  },
  methods: {
    formatScore,
    setLens (key) {
      this.lens = key;
      this.selectedSignature = null;
    },
    colorFor (key) {
      return key === 'you' ? YOU_COLOR : (this.colors[key] || '#9a9a9a');
    },
    labelFor (region) {
      return regionLabel(region, this.regionData?.people || [], this.selected.length);
    },
    anchorFor (region) {
      return this.layout.anchors[region.signature];
    },
    selectRegion (signature) {
      this.selectedSignature = this.selectedSignature === signature ? null : signature;
    },
    // The tap resolves through the same viewBox the circles were drawn in:
    // the svg keeps its aspect via aspect-ratio, so both axes scale linearly.
    onVennTap (event) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height || !this.layout) return;
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * this.layout.height;
      const keys = subsetAt(x, y, this.layout.circles);
      if (!keys.length) return;
      const signature = [...keys].sort().join('|');
      const region = this.occupiedRegions.find((candidate) =>
        [...candidate.keys].sort().join('|') === signature);
      if (region) this.selectRegion(region.signature);
    },
    inMyLibrary (movie) {
      return this.myIds.has(movie.id);
    },
    scoresLine (movie) {
      return this.selectedKeys
        .filter((key) => movie.scores[key] != null)
        .map((key) => formatScore(movie.scores[key]))
        .join(' · ');
    },
    poster (path) {
      return `https://image.tmdb.org/t/p/w185${path}`;
    },
    openMovie (movie) {
      // Same rule as Club Charts: MovieDetail is a local lookup (it bounces
      // any other id back to /film-club), so a film only a friend has rated
      // opens the preview sheet. It used to do nothing at all (2026-11-17).
      if (movie?.id == null) return;
      if (this.inMyLibrary(movie)) {
        this.$router.push(`/movie/${movie.id}`);
        return;
      }
      const source = this.hatMovieFor(movie);
      this.previewing = { id: source.id, title: source.title, poster_path: source.poster_path, source };
    },
    rateFromPreview (media) {
      this.previewing = null;
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
    hatMovieFor (movie) {
      return { id: movie.id, title: movie.t, poster_path: movie.p, release_date: '', overview: '' };
    },
    hatNoteFor (movie) {
      const names = Object.keys(movie.scores)
        .map((key) => this.regionData?.people.find((person) => person.key === key)?.name)
        .filter(Boolean);
      return `A Club Venn find — rated ${this.scoresLine(movie)} by ${names.join(' & ')}`;
    }
  }
};
</script>

<style lang="scss" scoped>
/* Lives inside a Club Charts .cc-section, so no page padding of its own. */
.club-venn {
  color: #eee;
}

.cv-empty { color: #ccc; padding: 1rem 0; text-align: center; }
.cv-hint { color: #b9b9b9; font-size: 0.8rem; padding: 0.75rem 0; text-align: center; }
.cv-cap-note { color: #7a7a7a; font-size: 0.68rem; margin: 0 0 0.5rem; }

.cv-lenses {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  display: flex;
  margin-bottom: 0.35rem;
  overflow: hidden;
}

.cv-lens {
  background: transparent;
  border: none;
  color: #ccc;
  flex: 1 1 0;
  font-size: 0.8rem;
  min-height: 40px;
  padding: 0.4rem 0;

  &.selected {
    background: #2e2e2e;
    color: #fff;
    font-weight: 700;
  }

  &:active { opacity: 0.75; }
}

.cv-lens-note { color: #7a7a7a; font-size: 0.68rem; margin: 0 0 0.75rem; text-align: center; }

.cv-stage {
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
}

.cv-svg { display: block; width: 100%; }

.cv-circle {
  fill-opacity: 0.28;
  stroke-opacity: 0.9;
  stroke-width: 0.6;
}

/* White with a dark halo, so a count stays readable whether it lands on the
   dark ground or inside two overlapping light fills. */
.cv-count {
  fill: #fff;
  font-size: 5px;
  font-weight: 700;
  paint-order: stroke;
  pointer-events: none;
  stroke: #101010;
  stroke-width: 1px;
  text-anchor: middle;

  &.selected { font-size: 6.5px; }
}

.cv-legend {
  display: flex;
  flex-direction: column;
  margin-bottom: 0.75rem;
}

.cv-legend-row {
  align-items: center;
  background: transparent;
  border: none;
  border-bottom: 1px solid #242424;
  color: #eee;
  display: flex;
  gap: 0.5rem;
  min-height: 40px;
  padding: 0.45rem 0.25rem;
  text-align: left;

  &:last-child { border-bottom: none; }
  &.selected { background: #1c1c1c; border-radius: 6px; }
  &:active { background: #222; }
}

.cv-legend-dots { display: flex; flex: 0 0 auto; gap: 3px; }

.cv-dot {
  border-radius: 50%;
  display: inline-block;
  height: 9px;
  width: 9px;
}

.cv-legend-name { flex: 1 1 auto; font-size: 0.85rem; min-width: 0; }
.cv-legend-count { color: #b9b9b9; flex: 0 0 auto; font-size: 0.8rem; font-weight: 700; }

.cv-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  padding: 0.9rem 1rem;
}

.cv-section-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.25rem; }
.cv-caption { color: #ccc; font-size: 0.78rem; margin: 0 0 0.9rem; }

/* Poster rows, house rules: fixed image height so edges line up, text below
   free to run. */
.cv-poster-row {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
  -webkit-overflow-scrolling: touch;
}

.cv-poster-card { flex: 0 0 92px; width: 92px; }
.cv-poster-card:active { transform: scale(0.97); }
.cv-poster-frame { position: relative; }
.cv-poster { border-radius: 6px; display: block; height: 138px; object-fit: cover; width: 92px; }
.cv-poster-hat { position: absolute; right: 0; top: 0; }

.cv-poster-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.68rem;
  justify-content: center;
  padding: 0.3rem;
  text-align: center;
}

.cv-poster-note { color: #ccc; display: block; font-size: 0.7rem; font-weight: 700; margin-top: 0.2rem; text-align: center; }
</style>
