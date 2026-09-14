<template>
  <div class="insights" :class="`insights-accent-${activeTab}`">
    <BackLink defer-navigation @click="leave"/>

    <!-- Tabbed rework (Matt, 2026-08-15): one route, four tabs, instead of
         fifteen panes on one endless scroll. Tab choice persists locally. -->
    <nav class="insights-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        class="insights-tab"
        :class="[`insights-tab-${tab.key}`, { active: activeTab === tab.key }]"
        @click="setTab(tab.key)"
      >
        {{ tab.label }}
      </button>
    </nav>

    <!-- OVERVIEW: at-a-glance numbers, fun facts, and the directory of
         every data page in the app. -->
    <template v-if="activeTab === 'overview'">
      <div class="glance-strip">
        <div class="glance-item feature"><span class="glance-label">Movies</span><span class="glance-value">{{ filteredEntriesWithFlatKeywordsAdded.length }}</span></div>
        <div class="glance-item feature"><span class="glance-label">Viewings</span><span class="glance-value">{{ viewsCount }}</span></div>
        <!-- The three rating numbers used to head the Ratings tab, where they
             sat oddly next to the deeper analysis ("I'm not sure how that's
             different from overview"). They're summary figures, so they live
             with the other summary figures. -->
        <div class="glance-item third alt"><span class="glance-label">Highest</span><span class="glance-value">{{ highestRating }}</span></div>
        <div class="glance-item third alt"><span class="glance-label">Average</span><span class="glance-value">{{ averageRating }}</span></div>
        <div class="glance-item third alt"><span class="glance-label">Lowest</span><span class="glance-value">{{ lowestRating }}</span></div>
      </div>

      <!-- Pulled above the fun facts: these are the way OUT of this page, and
           they were buried under a scroll ("maybe they should be pulled
           further up"). -->
      <div class="insights-links">
        <button type="button" class="insights-link-card" @click="$router.push('/stats')">
          <i class="bi bi-graph-up-arrow"></i><span>Deep Stats</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/year-in-review')">
          <i class="bi bi-calendar-heart"></i><span>Year in Review</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/trophy-case')">
          <i class="bi bi-trophy"></i><span>Trophy Case</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/awards')">
          <i class="bi bi-award"></i><span>Awards</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/games/stats')">
          <i class="bi bi-controller"></i><span>Game Stats</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/library-poster')">
          <i class="bi bi-image"></i><span>Library Poster</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
        <button type="button" class="insights-link-card" @click="$router.push('/web')">
          <i class="bi bi-diagram-3"></i><span>The Web</span><i class="bi bi-chevron-right link-chevron"></i>
        </button>
      </div>

      <!-- Board item 8: funFacts.js finally gets a shelf (bug report: "more
           fun data about my ratings and watching habits"). -->
      <FunFactsRow/>
    </template>

    <!-- RATINGS: how you rate. -->
    <template v-else-if="activeTab === 'ratings'">
    <InsightsPane>
      <LineChart :chartData="ratingsCountData" :options="ratingsCountOptions"/>
    </InsightsPane>

    <InsightsPane>
      <YearlyAverage :resultsWithRatings="resultsWithRatings" @updateSearchValue="updateSearchValue"/>
    </InsightsPane>

    <!-- The same years, ranked by money instead of score (bug report,
         2026-09-13: "look at years from my financial perspective"). -->
    <InsightsPane>
      <BoxOfficeYears :resultsWithRatings="resultsWithRatings" @updateSearchValue="updateSearchValue"/>
    </InsightsPane>

    <InsightsPane>
      <Outliers :resultsWithRatings="resultsWithRatings" :allCounts="allCounts" @updateSearchValue="updateSearchValue"/>
    </InsightsPane>

    <InsightsPane>
      <ScatterChart :chartData="scatterPlotData" :options="scatterPlotOptions"/>
      <!-- What the cloud of dots is actually saying. 1,300 points are hard to
           read by eye, so the plot states its own conclusion. -->
      <p v-if="scatterReading" class="scatter-reading">{{ scatterReading }}</p>
      <div class="scatter-controls mt-3">
        <div class="row g-2">
          <div class="col-12">
            <button class="btn btn-outline-light w-100 scatter-button" @click="randomizeAxes" title="Random Axes">
              <i class="bi bi-shuffle"/>
            </button>
          </div>
          <div class="col-12">
            <div class="form-floating" data-bs-theme="dark">
              <select id="x-axis-select" class="form-select scatter-select" v-model="selectedXAxis">
                <option v-for="option in axisOptions" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
              <label for="x-axis-select">X-Axis</label>
            </div>
          </div>
          <div class="col-12">
            <div class="form-floating" data-bs-theme="dark">
              <select id="y-axis-select" class="form-select scatter-select" v-model="selectedYAxis">
                <option v-for="option in axisOptions" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
              <label for="y-axis-select">Y-Axis</label>
            </div>
          </div>
        </div>
      </div>
    </InsightsPane>
    </template>

    <!-- ACTIVITY: when you watch. -->
    <template v-else-if="activeTab === 'activity'">
      <!-- The pace figure gets a box to itself, and every other time-based
           number moved off Overview to join it — Activity was just a calendar,
           and Overview was half activity ("I'm not sure what activity means
           relative to overview"). -->
      <div class="pace-box">
        <span class="pace-label">{{ thisYear }} so far</span>
        <span class="pace-value">{{ moviesWatchedThisYear }}</span>
        <span class="pace-note">on track for {{ estimatedMoviesThisYear }} by the end of the year</span>
      </div>

      <div class="glance-strip">
        <div class="glance-item third"><span class="glance-label">This Week</span><span class="glance-value">{{ moviesWatchedThisWeek }}</span></div>
        <div class="glance-item third"><span class="glance-label">{{ thisMonth }}</span><span class="glance-value">{{ moviesWatchedThisMonth }}</span></div>
        <div class="glance-item third"><span class="glance-label">{{ lastMonth }}</span><span class="glance-value">{{ moviesWatchedLastMonth }}</span></div>
        <!-- Last year's two figures are the comparison pair, so they share a
             deeper shade of the tab's colour rather than a different hue. -->
        <div class="glance-item alt"><span class="glance-label">{{ lastYear }} to Same Date</span><span class="glance-value">{{ moviesWatchedLastYearToDate }}</span></div>
        <div class="glance-item alt"><span class="glance-label">{{ lastYear }} Total</span><span class="glance-value">{{ moviesWatchedLastYear }}</span></div>
      </div>

      <!-- All-time calendar coverage. The Year in Review heatmap shows one
           real year on a weekday grid; this collapses every year onto the
           dates themselves, because a date's weekday moves year to year and
           the question here is "which dates have I never watched on". -->
      <div v-if="coverage.covered" class="coverage-box">
        <h3 class="coverage-title">Every Date on the Calendar</h3>
        <p class="coverage-caption">
          {{ coverage.years }} years of watching, collapsed onto the calendar. You've seen
          a film on <strong>{{ coverage.covered }}</strong> of {{ coverage.total }} dates.
          <template v-if="coverage.missing.length">
            The dark ones are the {{ coverage.missing.length }} you never have.
          </template>
        </p>

        <div class="coverage-grid">
            <div v-for="month in coverage.months" :key="`cov-${month.month}`" class="coverage-row">
              <span class="coverage-month">{{ monthAbbreviations[month.month] }}</span>
              <span
                v-for="cell in month.days"
                :key="`cov-${month.month}-${cell.day}`"
                class="coverage-cell"
                :class="coverageClass(cell)"
                :title="`${monthAbbreviations[month.month]} ${cell.day}: ${cell.count} watched`"
              ></span>
          </div>
        </div>

        <p v-if="nextGapsToFill.length || rareGapsToFill.length" class="coverage-gaps">
          <template v-if="nextGapsToFill.length">
            Still to claim: <strong>{{ nextGapsToFill.join(', ') }}</strong><template v-if="ordinaryGapsRemaining">
              and {{ ordinaryGapsRemaining }} more</template><template v-if="rareGapsToFill.length">.</template>
          </template>
          <template v-if="rareGapsToFill.length">
            <template v-if="!nextGapsToFill.length">Still to claim: </template>
            <strong>{{ rareGapsToFill.join(', ') }}</strong> too — though that one
            only comes round every fourth year.
          </template>
        </p>
        <p v-else-if="!coverage.missing.length" class="coverage-gaps">
          Every date on the calendar, claimed. There is nothing left to fill in.
        </p>
      </div>

      <InsightsPane>
        <FullCalendarView :results="allEntriesWithFlatKeywordsAdded" :open="true" />
      </InsightsPane>
    </template>

    <!-- PEOPLE: the eight Favorite sections behind one chip selector. -->
    <!-- PLACES: where the films are set and shot (Matt, 2026-09-08: "see
         what movies are set where", "I really like movies set in Paris",
         "a coverage map that shows me how much of the world I've explored
         in film"). Data from Wikidata via places.js; tapping any place runs
         a Cinema Roll search, never a map app. -->
    <template v-else-if="activeTab === 'places'">
    <div class="people-chips">
      <button
        v-for="option in placeTypeOptions"
        :key="option.key"
        type="button"
        class="people-chip"
        :class="{ active: placeType === option.key }"
        @click="setPlaceType(option.key)"
      >
        <span class="people-chip-pill">{{ option.label }}</span>
      </button>
    </div>

    <p v-if="!placeSummaryLine.movies" class="places-empty">
      No places yet. Settings → Filming &amp; story locations fills them in for the whole library; new ratings pick theirs up on their own.
    </p>

    <template v-else>
      <InsightsPane>
        <div class="insights-pane-header"><p>Where You've Been</p></div>
        <p class="places-summary">
          <template v-if="world">{{ worldCoverage.touched }} of {{ worldCoverage.total }} countries, across {{ placeSummaryLine.movies }} of your {{ placeSummaryLine.library }} films.</template>
          <template v-else>Loading the map…</template>
          Tap a country. Pinch to zoom, or use the buttons.
        </p>
        <CoverageMap
          v-if="world"
          :world="world"
          :counts="worldCoverage.counts"
          :selectedIso="selectedCountry ? selectedCountry.iso : null"
          accent="#f0ad4e"
          ariaLabel="Map of every country your films touch"
          @select="selectCountry"
        />
        <div v-if="selectedCountryRow" class="country-card">
          <p class="country-card-title">
            <strong>{{ selectedCountryRow.name }}</strong>
            <span class="country-card-count">{{ selectedCountryRow.films }} film{{ selectedCountryRow.films === 1 ? '' : 's' }}</span>
          </p>
          <p class="country-card-breakdown">{{ countryBreakdown(selectedCountryRow) }}</p>
          <div v-if="selectedCountryRow.places.length" class="country-places">
            <button
              v-for="place in selectedCountryRow.places.slice(0, 8)"
              :key="place.name"
              type="button"
              class="place-pill"
              @click="searchPlace(place.name)"
            >{{ place.name }} <span class="place-pill-count">{{ place.films }}</span></button>
          </div>
        </div>
        <p v-else-if="selectedCountry" class="country-card-breakdown">
          {{ selectedCountry.name }} — none of your films yet.
        </p>
      </InsightsPane>

      <InsightsPane v-if="favouritePlaceRows.length">
        <div class="insights-pane-header"><p>Places You Love</p></div>
        <p class="places-summary">Ranked by how their films rate — three films or more, so one great night out doesn't count as a place.</p>
        <ol class="place-list">
          <li v-for="place in favouritePlaceRows" :key="`fav-${place.key}`" class="place-row" @click="searchPlace(place.name)">
            <span class="place-row-name">{{ place.name }}</span>
            <span class="place-row-films">{{ place.films }} film{{ place.films === 1 ? '' : 's' }}</span>
            <span class="place-row-score">{{ formatScore(place.average) }}</span>
          </li>
        </ol>
      </InsightsPane>

      <InsightsPane v-if="mostVisitedRows.length">
        <div class="insights-pane-header"><p>Most Visited</p></div>
        <ol class="place-list">
          <li v-for="place in mostVisitedRows" :key="`most-${place.key}`" class="place-row" @click="searchPlace(place.name)">
            <span class="place-row-name">{{ place.name }}</span>
            <span class="place-row-films">{{ place.films }} film{{ place.films === 1 ? '' : 's' }}</span>
            <span class="place-row-score">{{ formatScore(place.average) }}</span>
          </li>
        </ol>
      </InsightsPane>
    </template>
    </template>

    <template v-else-if="activeTab === 'people'">
    <div class="people-chips">
      <button
        v-for="category in peopleCategories"
        :key="category.key"
        type="button"
        class="people-chip"
        :class="{ active: peopleCategory === category.key }"
        @click="setPeopleCategory(category.key)"
      >
        <!-- The oval is a span inside a taller, invisible button: the pill can
             be small without the tap target going under 40px with it. -->
        <span class="people-chip-pill">{{ category.label }}</span>
      </button>
    </div>
    <InsightsPane :key="peopleCategory">
      <component
        :is="activePeopleComponent"
        :allEntriesWithFlatKeywordsAdded="allEntriesWithFlatKeywordsAdded"
        @updateSearchValue="updateSearchValue"
      />
    </InsightsPane>
    </template>
  </div>
</template>

<script>
import Outliers from "./Outliers.vue";
import YearlyAverage from "./YearlyAverage.vue";
import BoxOfficeYears from "./BoxOfficeYears.vue";
import FullCalendarView from "./FullCalendarView.vue";
import FavoriteActresses from "./FavoriteActresses.vue";
import FavoriteActors from "./FavoriteActors.vue";
import FavoriteDirectors from "./FavoriteDirectors.vue";
import FavoriteWriters from "./FavoriteWriters.vue";
import FavoriteEditors from "./FavoriteEditors.vue";
import FavoriteCinematographers from "./FavoriteCinematographers.vue";
import FavoriteComposers from "./FavoriteComposers.vue";
import FavoriteProducers from "./FavoriteProducers.vue";

// Module-level (not data) so the component objects never become reactive.
const PEOPLE_CATEGORIES = [
  { key: 'directors', label: 'Directors', component: FavoriteDirectors },
  { key: 'actors', label: 'Actors', component: FavoriteActors },
  { key: 'actresses', label: 'Actresses', component: FavoriteActresses },
  { key: 'writers', label: 'Writers', component: FavoriteWriters },
  { key: 'cinematographers', label: 'Cinematographers', component: FavoriteCinematographers },
  { key: 'editors', label: 'Editors', component: FavoriteEditors },
  { key: 'composers', label: 'Composers', component: FavoriteComposers },
  { key: 'producers', label: 'Producers', component: FavoriteProducers }
];
import { getRating, getAllRatings } from "../assets/javascript/GetRating.js";
import { allViewings, calendarCoverage } from "../assets/javascript/yearInReview.js";

import { Chart, registerables } from "chart.js";
import { BarChart, DoughnutChart, ScatterChart, RadarChart, LineChart } from "vue-chart-3";
import InsightsPane from "./InsightsPane.vue";
import CoverageMap from "./CoverageMap.vue";
import { placeRows, favouritePlaces, mostVisitedPlaces, placeSummary, countryCoverage } from "../assets/javascript/places.js";
import { formatScore } from "../assets/javascript/formatScore.js";
import FunFactsRow from './FunFactsRow.vue';
import BackLink from './games/BackLink.vue';
import { followNavigationTarget } from '../utils/navigationTarget.js';
import { correlation, describeCorrelation } from '../assets/javascript/axisCorrelation.js';
import uniq from 'lodash/uniq';

Chart.register(...registerables);

export default {
  name: "Insights",
  components: {
    CoverageMap,
    FunFactsRow,
    LineChart,
    ScatterChart,
    InsightsPane,
    Outliers,
    YearlyAverage,
    BoxOfficeYears,
    FullCalendarView,
    FavoriteActresses,
    FavoriteActors,
    FavoriteDirectors,
    FavoriteWriters,
    FavoriteEditors,
    FavoriteCinematographers,
    FavoriteComposers,
    FavoriteProducers,
    BackLink
  },
  data () {
    return {
      // Tabbed layout state; both persist across visits.
      activeTab: localStorage.getItem('cinemaRoll.insights.tab') || 'overview',
      peopleCategory: localStorage.getItem('cinemaRoll.insights.people') || 'directors',
      monthAbbreviations: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      tabs: [
        { key: 'overview', label: 'Overview' },
        { key: 'ratings', label: 'Ratings' },
        { key: 'activity', label: 'Activity' },
        { key: 'people', label: 'People' },
        { key: 'places', label: 'Places' }
      ],
      // Set in / filmed in / both, for the Places tab. Persists like the tab.
      placeType: localStorage.getItem('cinemaRoll.insights.placeType') || 'all',
      selectedCountry: null,
      // The country polygons (worldCountries.json, ~60K gzipped) are pulled
      // in only when the Places tab is opened, not with the Insights chunk.
      world: null,
      selectedXAxis: 'runtime', // Will be randomized on mount
      selectedYAxis: 'userRating', // Will be randomized on mount
      axisOptions: [
        { key: 'runtime', label: 'Runtime (minutes)' },
        { key: 'releaseYear', label: 'Release Year' },
        { key: 'userRating', label: 'User Rating' },
        { key: 'releaseMonth', label: 'Release Month' },
        { key: 'genreCount', label: 'Genre Count' },
        { key: 'castSize', label: 'Cast Size' },
        { key: 'daysSinceRelease', label: 'Days Since Release' },
        { key: 'titleLength', label: 'Title Length (characters)' },
        { key: 'viewCount', label: 'View Count' },
        { key: 'love', label: 'Love Rating' },
        { key: 'story', label: 'Story Rating' },
        { key: 'direction', label: 'Direction Rating' },
        { key: 'imagery', label: 'Imagery Rating' },
        { key: 'performance', label: 'Performance Rating' },
        { key: 'soundtrack', label: 'Soundtrack Rating' },
        { key: 'stickiness', label: 'Stickiness Rating' },
        { key: 'cerebralScale', label: 'Instinctual ↔ Cerebral' },
        { key: 'blockbusterScale', label: 'Indie ↔ Blockbuster' },
        { key: 'mainstreamScale', label: 'Arthouse ↔ Mainstream' },
        { key: 'comfortScale', label: 'Challenge ↔ Comfort' },
        { key: 'styleScale', label: 'Substance ↔ Style' },
        { key: 'groundedScale', label: 'Fantastical ↔ Grounded' },
        { key: 'classicScale', label: 'Contemporary ↔ Classic' },
        { key: 'upliftingScale', label: 'Melancholy ↔ Uplifting' },
        { key: 'tenseScale', label: 'Relaxing ↔ Tense' },
        { key: 'hopefulScale', label: 'Cynical ↔ Hopeful' },
        { key: 'simpleScale', label: 'Complex ↔ Simple' },
        { key: 'characterScale', label: 'Plot-Driven ↔ Character-Driven' },
        { key: 'linearScale', label: 'Non-Linear ↔ Linear' },
        { key: 'universalScale', label: 'Niche ↔ Universal' },
        { key: 'escapistScale', label: 'Realistic ↔ Escapist' },
        { key: 'polishedScale', label: 'Raw ↔ Polished' },
        { key: 'familiarScale', label: 'Innovative ↔ Familiar' },
        { key: 'minimalistScale', label: 'Maximalist ↔ Minimalist' }
      ],
    };
  },
  mounted () {
    // Set random axes on page load
    this.randomizeAxes();
  },
  computed: {
    // Every viewing ever, for the all-time calendar coverage grid. Shorts are
    // included here deliberately: the question is "did I watch something on
    // this date", and a short absolutely counts as having watched something.
    coverage () {
      return calendarCoverage(
        allViewings(this.$store.getters.allMediaAsArray, getAllRatings, { includeShorts: true })
      );
    },
    // The first few gaps, named. The full list runs to hundreds early on and
    // is useless as prose; a handful reads like a challenge.
    nextGapsToFill () {
      return this.coverage.missing
        .filter((gap) => !gap.rare)
        .slice(0, 6)
        .map((gap) => `${this.monthAbbreviations[gap.month]} ${gap.day}`);
    },
    // How many ORDINARY gaps the named handful leaves out. This used to be
    // measured against the whole missing list, which quietly folded Feb 29
    // into "and 1 more" — bug report 2026-08-25: "it says there are three
    // dates I've never watched on, but it only tells me about two of them.
    // What is that last date? Is it possible it's February 29?" It was.
    ordinaryGapsRemaining () {
      return this.coverage.missing.filter((gap) => !gap.rare).length - this.nextGapsToFill.length;
    },
    // Named rather than hidden. It's kept apart from the ordinary gaps
    // because an empty Feb 29 says much less than an empty Mar 3 — but
    // "there's one more and I won't say which" says least of all.
    rareGapsToFill () {
      return this.coverage.missing
        .filter((gap) => gap.rare)
        .map((gap) => `${this.monthAbbreviations[gap.month]} ${gap.day}`);
    },
    peopleCategories () {
      return PEOPLE_CATEGORIES;
    },
    activePeopleComponent () {
      return (PEOPLE_CATEGORIES.find(c => c.key === this.peopleCategory) || PEOPLE_CATEGORIES[0]).component;
    },
    activePeopleLabel () {
      return (PEOPLE_CATEGORIES.find(c => c.key === this.peopleCategory) || PEOPLE_CATEGORIES[0]).label;
    },


    includeShorts () {
      // Default to false if not set
      return this.$store.state.settings.includeShorts === true;
    },
    placeTypeOptions () {
      return [
        { key: 'all', label: 'Set or filmed' },
        { key: 'narrative', label: 'Set in' },
        { key: 'filming', label: 'Filmed in' }
      ];
    },
    placeRowsForType () {
      return placeRows(this.filteredEntriesWithFlatKeywordsAdded, getRating, { type: this.placeType, includeShorts: true });
    },
    favouritePlaceRows () {
      return favouritePlaces(this.placeRowsForType, { minFilms: 3, limit: 12 });
    },
    mostVisitedRows () {
      return mostVisitedPlaces(this.placeRowsForType, { limit: 12 });
    },
    placeSummaryLine () {
      return placeSummary(this.filteredEntriesWithFlatKeywordsAdded, { type: this.placeType, includeShorts: true });
    },
    worldCoverage () {
      if (!this.world) return { rows: [], counts: {}, touched: 0, total: 0 };
      return countryCoverage(this.filteredEntriesWithFlatKeywordsAdded, this.world, { type: this.placeType, includeShorts: true });
    },
    selectedCountryRow () {
      if (!this.selectedCountry) return null;
      return this.worldCoverage.rows.find((row) => row.iso === this.selectedCountry.iso) || null;
    },
    filteredEntriesWithFlatKeywordsAdded () {
      if (this.includeShorts) return this.allEntriesWithFlatKeywordsAdded;
      // Exclude shorts: genre 'Short' or runtime <= 40
      return this.allEntriesWithFlatKeywordsAdded.filter(result => {
        const structure = this.topStructure(result);
        const genres = structure.genres || [];
        const isShortGenre = genres.some(g => g.name && g.name.toLowerCase() === 'short');
        const runtime = structure.runtime;
        return !isShortGenre && !(runtime && runtime <= 40);
      });
    },
    currentLogIsTVLog () {
      return this.$store.state.currentLog === "tvLog";
    },
    allEntriesWithFlatKeywordsAdded () {
      return this.$store.getters.allMediaAsArray.map((result) => {
        if (this.currentLogIsTVLog) {
          return {
            ...result,
            tvShow: {
              ...this.topStructure(result),
              flatKeywords: this.topStructure(result).keywords ? this.topStructure(result).keywords.map((keyword) => keyword.name) : []
            }
          }
        } else {
          const flatTMDBKeywords = result.movie.keywords ? result.movie.keywords.map((keyword) => keyword.name) : [];
          const flatChatGPTKeywords = this.topStructure(result).chatGPTKeywords || [];
          const flatKeywords = uniq([...flatTMDBKeywords, ...flatChatGPTKeywords]);
          return {
            ...result,
            movie: {
              ...this.topStructure(result),
              flatKeywords: flatKeywords || []
            }
          }
        }
      });
    },
    allCounts () {
      return {
        keywords: this.countedKeywords,
        genres: this.countedGenres,
        years: this.countedYears,
        directors: this.countDirectors,
        castCrew: this.countCastCrew,
        studios: this.countStudios,
        mediums: this.allMediums,
        filmographies: this.allDirectors
      }
    },
    countedKeywords () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        if (this.topStructure(result).flatKeywords) {
          this.topStructure(result).flatKeywords.forEach((keyword) => {
            if (counts[keyword]) {
              counts[keyword]++;
            } else if (keyword) {
              counts[keyword] = 1;
            }
          })
        }
      })

      return counts;
    },
    countedGenres () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        if (this.topStructure(result).genres) {
          this.topStructure(result).genres.forEach((genre) => {
            if (counts[genre.name]) {
              counts[genre.name]++;
            } else if (genre.name) {
              counts[genre.name] = 1;
            }
          })
        }
      })

      return counts;
    },
    countedYears () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        const year = this.getYear(result);
        if (counts[year]) {
          counts[year]++;
        } else if (year) {
          counts[year] = 1;
        }
      })

      return counts;
    },
    countDirectors () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        let director;
        if (this.currentLogIsTVLog) {
          director = result.tvShow.created_by?.[0].name;
        } else {
          director = result.movie.crew?.find((person) => person.job === "Director").name;
        }

        if (director) {
          if (counts[director]) {
            counts[director]++;
          } else if (director) {
            counts[director] = 1;
          }
        }
      })

      return counts;
    },
    countCastCrew () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        const cast = this.topStructure(result).cast?.filter((person, index) => index < 10).map(person => person.name) || [];
        const crew = this.topStructure(result).crew?.filter((person, index) => index < 10).map(person => person.name) || [];
        const castCrewCombined = uniq([...cast, ...crew]);

        castCrewCombined.forEach((person) => {
          if (counts[person]) {
            counts[person]++;
          } else if (person) {
            counts[person] = 1;
          }
        })
      })

      return counts;
    },
    countStudios () {
      const counts = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        const productionCompanies = this.topStructure(result).production_companies?.map(company => company.name) || [];

        productionCompanies.forEach((company) => {
          if (counts[company]) {
            counts[company]++;
          } else if (company) {
            counts[company] = 1;
          }
        })
      })

      return counts;
    },
    allDirectors () {
      if (this.currentLogIsTVLog) {
        return [];
      }

      return Object.keys(this.countDirectors).map((keyword) => {
        const filmography = this.allEntriesWithFlatKeywordsAdded.find((entry) => {
          return entry.movie.crew.find((person) => person.job === "Director" && person.name === keyword);
        }).movie.crew.find((person) => person.name === keyword && person.filmography)?.filmography;

        return {
          name: this.titleCase(keyword),
          count: this.countDirectors[keyword],
          filmography: filmography ? filmography.filter((film) => new Date(film.release_date) < new Date() && film.popularity > 8.65) : []
        }
      });
    },
    allMediums () {
      const mediums = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        if (!this.currentLogIsTVLog) {
          result.ratings.forEach((rating) => {
            if (!rating.medium) {
              return;
            } else if (mediums[rating.medium]) {
              mediums[rating.medium]++;
            } else {
              mediums[rating.medium] = 1;
            }
          })
        }
      })

      return Object.keys(mediums).map((medium) => {
        return {
          name: this.titleCase(medium),
          count: mediums[medium]
        }
      });
    },
    viewsCount () {
      return this.filteredEntriesWithFlatKeywordsAdded.reduce((total, result) => {
        return total + (result.ratings ? result.ratings.length : 0);
      }, 0);
    },
    highestRating () {
      const ratedMovies = this.filteredEntriesWithFlatKeywordsAdded.filter((result) => this.mostRecentRating(result).calculatedTotal);
      const ratings = ratedMovies.map((result) => parseFloat(this.mostRecentRating(result).calculatedTotal));
      return Math.max(...ratings).toFixed(2);
    },
    lowestRating () {
      const ratedMovies = this.filteredEntriesWithFlatKeywordsAdded.filter((result) => this.mostRecentRating(result).calculatedTotal);
      const ratings = ratedMovies.map((result) => parseFloat(this.mostRecentRating(result).calculatedTotal));
      return Math.min(...ratings).toFixed(2);
    },
    averageRating () {
      const ratedMovies = this.filteredEntriesWithFlatKeywordsAdded.filter((result) => this.mostRecentRating(result).calculatedTotal);
      const ratings = ratedMovies.map((result) => parseFloat(this.mostRecentRating(result).calculatedTotal));
      const total = ratings.reduce((a, b) => a + b, 0);
      return (total / ratings.length).toFixed(2);
    },
    datesWithCounts () {
      const datesWithCounts = {};

      for (const result of this.filteredEntriesWithFlatKeywordsAdded) {
        for (const rating of result.ratings) {
          const datesWithCountsKey = new Date(rating.date).toLocaleDateString();
          if (datesWithCounts[datesWithCountsKey]) {
            datesWithCounts[datesWithCountsKey]++;
          } else {
            datesWithCounts[datesWithCountsKey] = 1;
          }
        }
      }

      return datesWithCounts;
    },
    thisMonth () {
      const today = new Date();
      return today.toLocaleString('default', { month: 'long' }); // e.g., "June"
    },
    lastMonth () {
      const today = new Date();
      today.setMonth(today.getMonth() - 1);
      return today.toLocaleString('default', { month: 'long' }); // e.g., "May"
    },
    thisYear () {
      return new Date().getFullYear(); // e.g., 2025
    },
    lastYear () {
      return new Date().getFullYear() - 1; // e.g., 2024
    },
    moviesWatchedThisWeek () {
      let count = 0;
      for (let i = 0; i < 7; i++) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        day.setHours(0, 0, 0, 0);
        const dateString = `${day.getMonth() + 1}/${day.getDate()}/${day.getFullYear()}`;
        count += this.datesWithCounts[dateString] || 0;
      }
      return count;
    },
    moviesWatchedLastWeek () {
      let count = 0;
      for (let i = 7; i < 14; i++) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        day.setHours(0, 0, 0, 0);
        const dateString = `${day.getMonth() + 1}/${day.getDate()}/${day.getFullYear()}`;
        count += this.datesWithCounts[dateString] || 0;
      }
      return count;
    },
    moviesWatchedThisMonth () {
      const today = new Date();
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      let count = 0;
      Object.keys(this.datesWithCounts).forEach(date => {
        const [dateMonth, , dateYear] = date.split('/');
        if (+dateMonth === month && +dateYear === year) {
          count += this.datesWithCounts[date];
        }
      });
      return count;
    },
    moviesWatchedLastMonth () {
      const today = new Date();
      today.setMonth(today.getMonth() - 1);
      const month = today.getMonth() + 1;
      const year = today.getFullYear();
      let count = 0;
      Object.keys(this.datesWithCounts).forEach(date => {
        const [dateMonth, , dateYear] = date.split('/');
        if (+dateMonth === month && +dateYear === year) {
          count += this.datesWithCounts[date];
        }
      });
      return count;
    },
    moviesWatchedThisYear () {
      const year = new Date().getFullYear();
      let count = 0;
      Object.keys(this.datesWithCounts).forEach(date => {
        const dateYear = +date.split('/')[2];
        if (dateYear === year) {
          count += this.datesWithCounts[date];
        }
      });
      return count;
    },
    moviesWatchedLastYearToDate () {
      const today = new Date();
      const lastYear = today.getFullYear() - 1;
      // Get the same month and day as today, but in last year
      const cutoff = new Date(lastYear, today.getMonth(), today.getDate(), 23, 59, 59, 999);
      let count = 0;
      Object.keys(this.datesWithCounts).forEach(date => {
        const [month, day, year] = date.split('/').map(Number);
        const entryDate = new Date(year, month - 1, day);
        if (year === lastYear && entryDate <= cutoff) {
          count += this.datesWithCounts[date];
        }
      });
      return count;
    },
    // A 4th, OPTIONAL signal for estimatedMoviesThisYear below: instead of
    // extrapolating THIS year's own recent pace, scale up by whatever
    // fraction of last year's TOTAL had typically already been watched by
    // this exact same calendar date — captures real seasonality (e.g.
    // habitually watching more late in the year for awards season) that a
    // pure recent-pace extrapolation can't see at all. Follow-up ask:
    // "can we look at what I was doing last year and use that to help
    // guide the number... build in some guards against people with very
    // small libraries, so it only works for those where it will actually
    // be effective."
    //
    // Returns the ADDITIONAL movies this signal implies for the rest of
    // the year (same shape as the other three estimates below), or `null`
    // when there isn't enough of a prior year to trust — callers must
    // treat `null` as "leave this signal out," not as zero.
    //
    // Guards, each independently capable of disqualifying this signal:
    //  - MIN_LAST_YEAR_TOTAL: a full prior year averaging under one movie
    //    a month isn't enough texture to imply a meaningful "shape" at
    //    all — also naturally excludes anyone who wasn't using the app
    //    (or didn't exist as a user) last year, since their whole-year
    //    total would be 0.
    //  - MIN_LAST_YEAR_TO_DATE: a fraction computed from only a couple of
    //    movies is noisy no matter how large the denominator is — e.g. 1
    //    movie by this date out of a 20-movie year is a real data point,
    //    but far too thin to trust as "the typical shape."
    //  - MIN_FRACTION: belt-and-suspenders floor on the fraction itself
    //    (not just the raw counts above) — caps how aggressively this
    //    signal can scale up the estimate even if the count guards pass
    //    but the split still happens to be extremely lopsided (e.g. a
    //    binge-heavy December last year), so one unusual year can nudge
    //    the blend without being able to dominate it.
    seasonalProjectedAdditional () {
      const MIN_LAST_YEAR_TOTAL = 12;
      const MIN_LAST_YEAR_TO_DATE = 4;
      const MIN_FRACTION = 0.15;

      const lastYearTotal = this.moviesWatchedLastYear;
      const lastYearToDate = this.moviesWatchedLastYearToDate;
      if (lastYearTotal < MIN_LAST_YEAR_TOTAL || lastYearToDate < MIN_LAST_YEAR_TO_DATE) return null;

      const fractionWatchedByNowLastYear = Math.max(lastYearToDate / lastYearTotal, MIN_FRACTION);
      const seasonalProjectedTotal = this.moviesWatchedThisYear / fractionWatchedByNowLastYear;

      return seasonalProjectedTotal - this.moviesWatchedThisYear;
    },
    // Projects a year-end total from up to FOUR independent estimates of
    // how many MORE movies get watched in the remaining days of the year,
    // averaged equally: the whole year's own rate so far, the last ~2
    // weeks' rate, the last ~2 calendar months' rate, and (only when
    // seasonalProjectedAdditional's guards allow it) last year's actual
    // seasonal shape. Bug report: "I don't really remember how I
    // calculated that... does it seem accurate."
    //
    // Simplified (Jul 2026) from a version that ALSO computed
    // "movies per week this year" and "movies per month this year" purely
    // by rescaling the same whole-year daily rate up and back down again —
    // those two terms were algebraically IDENTICAL to the whole-year term
    // (rescale-then-rescale-back is a no-op), so despite reading like a
    // blend of three different whole-year-based estimates, the code always
    // just used the whole-year rate three times over. That's not a wrong
    // NUMBER — the surrounding "recent weeks"/"recent months" adjustment
    // terms already supplied the genuine short-term signal, and the overall
    // formula happened to reduce to exactly this same three-rate average —
    // just needlessly obscured, which is what actually prompted this
    // report. Locked in as unchanged by the pre-existing characterization
    // test in Insights.test.js (same output for the same fixture) as of
    // that pass — the seasonal 4th signal below is a separate, later
    // addition and DOES change the number when its guards pass.
    estimatedMoviesThisYear () {
      const today = new Date();
      const currentYear = today.getFullYear();
      const dayOfYear = Math.floor((today - new Date(currentYear, 0, 0)) / 1000 / 60 / 60 / 24);
      const daysInYear = (currentYear % 4 === 0 && currentYear % 100 !== 0) || currentYear % 400 === 0 ? 366 : 365;
      const remainingDays = daysInYear - dayOfYear;

      const wholeYearRate = this.moviesWatchedThisYear / dayOfYear; // movies/day
      const recentWeeksRate = (this.moviesWatchedThisWeek + this.moviesWatchedLastWeek) / 14; // movies/day, last ~2 weeks
      const recentMonthsRate = (this.moviesWatchedThisMonth + this.moviesWatchedLastMonth) / (daysInYear / 6); // movies/day, last ~2 calendar months

      const additionalEstimates = [
        wholeYearRate * remainingDays,
        recentWeeksRate * remainingDays,
        recentMonthsRate * remainingDays
      ];
      if (this.seasonalProjectedAdditional != null) additionalEstimates.push(this.seasonalProjectedAdditional);

      const projectedAdditional = additionalEstimates.reduce((sum, value) => sum + value, 0) / additionalEstimates.length;

      return Math.round(this.moviesWatchedThisYear + projectedAdditional);
    },
    moviesWatchedLastYear () {
      const year = new Date().getFullYear() - 1; // Get last year
      let count = 0;
      Object.keys(this.datesWithCounts).forEach(date => {
        const dateYear = +date.split('/')[2];
        if (dateYear === year) {
          count += this.datesWithCounts[date];
        }
      });
      return count;
    },
    resultsWithRatings () {
      return this.allEntriesWithFlatKeywordsAdded.filter((result) => getRating(result).calculatedTotal);
    },
    ratingsCountData () {
      const rounded = this.resultsWithRatings.map((result) => {
        const roundedValue = Math.round((parseFloat(getRating(result).calculatedTotal)) * 2) / 2;
        if (isNaN(roundedValue)) {
          return 0;
        } else {
          return roundedValue;
        }
      });

      const counts = {
        1: 0,
        1.5: 0,
        2: 0,
        2.5: 0,
        3: 0,
        3.5: 0,
        4: 0,
        4.5: 0,
        5: 0,
        5.5: 0,
        6: 0,
        6.5: 0,
        7: 0,
        7.5: 0,
        8: 0,
        8.5: 0,
        9: 0,
        9.5: 0,
        10: 0
      };
      rounded.forEach((number) => {
        if (!counts[number]) {
          counts[number] = 1;
        } else {
          counts[number]++;
        }
      })

      const countsWithLabels = Object.keys(counts).map((val) => {
        return {
          label: val,
          value: counts[val]
        }
      }).sort((a, b) => parseFloat(a.label) - parseFloat(b.label));

      const data = countsWithLabels.map((count) => count.value);
      const labels = countsWithLabels.map((count) => count.label);

      // The Ratings tab's own colour, so the chart belongs to the section it
      // sits in rather than being a third hue on the page.
      const color = "#1D8BF1";

      return {
        labels,
        datasets: [
          {
            data,
            backgroundColor: color,
            borderColor: color,
            tension: 0.5
          }
        ]
      }
    },
    ratingsCountOptions () {
      return {
        plugins: {
          legend: {
            display: false
          },
          title: {
            display: true,
            text: "Ratings Distribution",
          },
        },
        backgroundColor: 'rgba(100, 100, 0, 1)',
        scales: {
          x: {
            display: true
          }
        }
      }
    },
    // A sentence for the scatter plot: what the dots are actually saying.
    scatterReading () {
      const points = this.scatterPlotData?.datasets?.[0]?.data || [];
      const labelFor = (key) => this.axisOptions.find((option) => option.key === key)?.label;

      return describeCorrelation(
        correlation(points),
        labelFor(this.selectedXAxis),
        labelFor(this.selectedYAxis)
      );
    },
    scatterPlotData () {
      const data = this.filteredEntriesWithFlatKeywordsAdded.map(result => {
        const xValue = this.getAxisValue(result, this.selectedXAxis);
        const yValue = this.getAxisValue(result, this.selectedYAxis);

        // Only include points where both x and y values exist
        if (xValue !== null && yValue !== null) {
          return {
            x: xValue,
            y: yValue,
            label: this.topStructure(result).title || 'Unknown Title'
          };
        }
        return null;
      }).filter(point => point !== null);

      return {
        datasets: [{
          label: 'Movies',
          data,
          backgroundColor: 'rgba(54, 162, 235, 0.6)',
          borderColor: 'rgba(54, 162, 235, 1)',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      };
    },
    scatterPlotOptions () {
      const xAxisOption = this.axisOptions.find(opt => opt.key === this.selectedXAxis);
      const yAxisOption = this.axisOptions.find(opt => opt.key === this.selectedYAxis);

      // Check if either axis is a qualitative scale
      const qualitativeScales = ['cerebralScale', 'blockbusterScale', 'mainstreamScale', 'comfortScale', 'styleScale', 'groundedScale', 'classicScale', 'upliftingScale', 'tenseScale', 'hopefulScale', 'simpleScale', 'characterScale', 'linearScale', 'universalScale', 'escapistScale', 'polishedScale', 'familiarScale', 'minimalistScale'];
      const xIsQualitative = qualitativeScales.includes(this.selectedXAxis);
      const yIsQualitative = qualitativeScales.includes(this.selectedYAxis);

      return {
        responsive: true,
        plugins: {
          legend: {
            display: false
          },
          title: {
            display: false,
            text: `${yAxisOption?.label || 'Y'} vs ${xAxisOption?.label || 'X'}`,
            color: 'white'
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                return context.raw.label;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            position: 'bottom',
            title: {
              display: true,
              text: xAxisOption?.label || 'X-Axis',
              color: 'white'
            },
            ticks: {
              color: 'white',
              display: !xIsQualitative // Hide ticks for qualitative scales
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ...(xIsQualitative && {
              min: -10,
              max: 10
            })
          },
          y: {
            title: {
              display: true,
              text: yAxisOption?.label || 'Y-Axis',
              color: 'white'
            },
            ticks: {
              color: 'white',
              display: !yIsQualitative // Hide ticks for qualitative scales
            },
            grid: {
              color: 'rgba(255, 255, 255, 0.1)'
            },
            ...(yIsQualitative && {
              min: -10,
              max: 10
            })
          }
        }
      };
    },
  },
  watch: {
    activeTab: {
      immediate: true,
      handler (tab) {
        if (tab === 'places') this.loadWorld();
      }
    }
  },
  methods: {
    coverageClass (cell) {
      if (!cell.count) return cell.rare ? 'coverage-rare' : 'coverage-none';
      // Four steps against the busiest date, so the grid still has contrast
      // for someone with a handful of years rather than a decade of them.
      const step = Math.ceil((cell.count / Math.max(1, this.coverage.busiest)) * 4);
      return `coverage-${Math.min(4, Math.max(1, step))}`;
    },
    setTab (key) {
      this.activeTab = key;
      localStorage.setItem('cinemaRoll.insights.tab', key);
    },
    async loadWorld () {
      if (this.world) return;
      try {
        const module = await import(/* webpackChunkName: "world-countries" */ '../assets/data/worldCountries.json');
        this.world = module.default || module;
      } catch (error) {
        console.error('Could not load the world map data:', error);
      }
    },
    setPlaceType (key) {
      this.placeType = key;
      localStorage.setItem('cinemaRoll.insights.placeType', key);
    },
    selectCountry (country) {
      this.selectedCountry = country;
    },
    countryBreakdown (row) {
      const parts = [];
      if (row.setIn) parts.push(`${row.setIn} set here`);
      if (row.filmedIn) parts.push(`${row.filmedIn} filmed here`);
      if (row.madeIn) parts.push(`${row.madeIn} made here`);
      return parts.join(' · ');
    },
    formatScore,
    // The same hand-off MovieDetail's links make: a real place chip, so Home
    // answers precisely rather than re-reading "Paris" as free text.
    searchPlace (name) {
      this.$store.commit('setHomePageNavigationIntent', 'search');
      this.$store.commit('setHomePagePromoteGroup', 'place');
      this.$store.commit('setHomePageSearchValue', '');
      this.$store.commit('setHomePageSearchChips', [{ id: `place-${Date.now()}`, type: 'place', value: name, display: name }]);
      this.$store.commit('setHomePageScrollPosition', 0);
      this.$router.push('/');
    },
    setPeopleCategory (key) {
      this.peopleCategory = key;
      localStorage.setItem('cinemaRoll.insights.people', key);
    },
    // Keeps the header restoration; BackLink works out the destination and
    // hands it over. (The old version also tacked a `movieDbKey` query on from
    // a `dbEntry` this component has never had — always undefined.)
    leave (target) {
      this.$store.commit("setShowHeader", true);
      followNavigationTarget(this.$router, target);
    },
    goToYearInReview () {
      this.$router.push('/year-in-review');
    },
    randomizeAxes () {
      const availableOptions = this.axisOptions.map(opt => opt.key);

      // Get two different random axes
      const randomX = availableOptions[Math.floor(Math.random() * availableOptions.length)];
      let randomY = availableOptions[Math.floor(Math.random() * availableOptions.length)];

      // Ensure Y is different from X
      while (randomY === randomX) {
        randomY = availableOptions[Math.floor(Math.random() * availableOptions.length)];
      }

      this.selectedXAxis = randomX;
      this.selectedYAxis = randomY;
    },
    mostRecentRating (media) {
      return getRating(media);
    },
    updateSearchValue (value) {
      // Navigate to Home and set the search value as a query parameter
      this.$router.push({ name: 'Home', query: { search: encodeURIComponent(value) } });
    },
    getYear (media) {
      let date;
      if (this.currentLogIsTVLog) {
        date = media.tvShow.first_air_date;
      } else {
        date = media.movie.release_date;
      }

      return new Date(date).getFullYear();
    },
    titleCase (input) {
      const string = input.toString();
      return string.replace(
        /\w\S*/g,
        function (txt) {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        }
      );
    },
    topStructure (media) {
      // For insights, we're only dealing with movies
      return media.movie;
    },
    getAxisValue (result, axisKey) {
      const structure = this.topStructure(result);
      const rating = this.mostRecentRating(result);

      switch (axisKey) {
        case 'runtime':
          return structure.runtime || null;
        case 'releaseYear':
          return structure.release_date ? new Date(structure.release_date).getFullYear() : null;
        case 'userRating':
          return rating.calculatedTotal ? parseFloat(rating.calculatedTotal) : null;
        case 'releaseMonth':
          return structure.release_date ? new Date(structure.release_date).getMonth() + 1 : null;
        case 'genreCount':
          return structure.genres ? structure.genres.length : 0;
        case 'castSize':
          return structure.cast ? structure.cast.length : 0;
        case 'daysSinceRelease':
          if (structure.release_date) {
            const releaseDate = new Date(structure.release_date);
            const today = new Date();
            return Math.floor((today - releaseDate) / (1000 * 60 * 60 * 24));
          }
          return null;
        case 'titleLength':
          return structure.title ? structure.title.length : 0;
        case 'viewCount':
          return result.ratings ? result.ratings.length : 1;
        case 'love':
          return rating.love || null;
        case 'story':
          return rating.story || null;
        case 'direction':
          return rating.direction || null;
        case 'imagery':
          return rating.imagery || null;
        case 'performance':
          return rating.performance || null;
        case 'soundtrack':
          return rating.soundtrack || null;
        case 'stickiness':
          return rating.stickiness || null;
        case 'cerebralScale':
          return this.calculateCerebralScale(structure);
        case 'blockbusterScale':
          return this.calculateBlockbusterScale(structure);
        case 'mainstreamScale':
          return this.calculateMainstreamScale(structure);
        case 'comfortScale':
          return this.calculateComfortScale(structure);
        case 'styleScale':
          return this.calculateStyleScale(structure);
        case 'groundedScale':
          return this.calculateGroundedScale(structure);
        case 'classicScale':
          return this.calculateClassicScale(structure);
        case 'upliftingScale':
          return this.calculateUpliftingScale(structure);
        case 'tenseScale':
          return this.calculateTenseScale(structure);
        case 'hopefulScale':
          return this.calculateHopefulScale(structure);
        case 'simpleScale':
          return this.calculateSimpleScale(structure);
        case 'characterScale':
          return this.calculateCharacterScale(structure);
        case 'linearScale':
          return this.calculateLinearScale(structure);
        case 'universalScale':
          return this.calculateUniversalScale(structure);
        case 'escapistScale':
          return this.calculateEscapistScale(structure);
        case 'polishedScale':
          return this.calculatePolishedScale(structure);
        case 'familiarScale':
          return this.calculateFamiliarScale(structure);
        case 'minimalistScale':
          return this.calculateMinimalistScale(structure);
        default:
          return null;
      }
    },
    calculateCerebralScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 90;

      // Cerebral indicators (+) with weighted values
      const cerebralGenres = [
        { name: 'documentary', weight: 2.8 },
        { name: 'drama', weight: 1.4 },
        { name: 'history', weight: 2.2 },
        { name: 'war', weight: 1.8 },
        { name: 'biography', weight: 2.1 }
      ];
      const cerebralKeywords = [
        { name: 'philosophy', weight: 1.7 },
        { name: 'politics', weight: 1.5 },
        { name: 'paranoia', weight: 1.9 },
        { name: 'dystopia', weight: 1.8 },
        { name: 'investigation', weight: 1.6 },
        { name: 'memory', weight: 1.4 },
        { name: 'psychology', weight: 1.8 },
        { name: 'conspiracy', weight: 1.5 },
        { name: 'time travel', weight: 1.3 },
        { name: 'based on true story', weight: 1.2 },
        { name: 'biography', weight: 1.1 }
      ];

      cerebralGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      cerebralKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Instinctual indicators (-) with weighted values
      const instinctualGenres = [
        { name: 'action', weight: -2.3 },
        { name: 'horror', weight: -1.9 },
        { name: 'thriller', weight: -1.1 },
        { name: 'comedy', weight: -1.7 },
        { name: 'adventure', weight: -1.5 }
      ];
      const instinctualKeywords = [
        { name: 'martial arts', weight: -2.2 },
        { name: 'chase', weight: -1.8 },
        { name: 'fight', weight: -1.6 },
        { name: 'explosion', weight: -1.4 },
        { name: 'gun', weight: -1.2 },
        { name: 'violence', weight: -1.5 },
        { name: 'rescue', weight: -1.1 },
        { name: 'showdown', weight: -1.3 },
        { name: 'survival', weight: -1.0 },
        { name: 'escape', weight: -0.9 }
      ];

      instinctualGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      instinctualKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Add runtime factor (longer films tend to be more cerebral)
      score += (runtime - 100) * 0.01;

      // Add some random variation based on title hash for uniqueness
      const titleHash = movie.title ? movie.title.length * 0.13 : 0;
      score += (titleHash % 1) * 0.4 - 0.2;

      return Math.max(-10, Math.min(10, score));
    },
    calculateBlockbusterScale (movie) {
      let score = 0;
      const companies = movie.production_companies || [];
      const cast = movie.cast || [];
      const budget = movie.budget || 0;
      const runtime = movie.runtime || 90;

      // Blockbuster indicators (+) with weighted values - using actual companies from collection
      const majorStudios = [
        { name: 'walt disney', weight: 3.8 },
        { name: 'warner bros', weight: 3.2 },
        { name: 'universal', weight: 3.5 },
        { name: 'paramount', weight: 2.9 },
        { name: 'sony', weight: 2.7 },
        { name: 'columbia pictures', weight: 3.0 },
        { name: 'twentieth century fox', weight: 3.1 },
        { name: 'marvel', weight: 4.2 },
        { name: 'lucasfilm', weight: 3.9 },
        { name: 'touchstone pictures', weight: 2.8 },
        { name: 'dreamworks', weight: 3.1 }
      ];

      majorStudios.forEach(studio => {
        if (companies.some(c => c.name && c.name.toLowerCase().includes(studio.name))) {
          score += studio.weight;
        }
      });

      // Cast size factor (continuous)
      score += Math.min(cast.length * 0.15, 3.0);

      // Budget factor (continuous)
      if (budget > 0) {
        score += Math.min(Math.log10(budget) - 6, 4.0); // Log scale for budget
      }

      // Indie indicators (-) with weighted values - using actual companies from collection
      const indieStudios = [
        { name: 'a24', weight: -3.7 },
        { name: 'focus features', weight: -2.8 },
        { name: 'fox searchlight', weight: -2.9 },
        { name: 'searchlight', weight: -2.9 },
        { name: 'annapurna', weight: -3.1 },
        { name: 'neon', weight: -3.4 },
        { name: 'bleecker street', weight: -2.6 },
        { name: 'miramax', weight: -2.7 },
        { name: 'summit entertainment', weight: -2.3 },
        { name: 'roadside attractions', weight: -2.8 }
      ];

      indieStudios.forEach(studio => {
        if (companies.some(c => c.name && c.name.toLowerCase().includes(studio.name))) {
          score += studio.weight;
        }
      });

      // Small cast penalty (continuous)
      if (cast.length < 15) {
        score -= (15 - cast.length) * 0.12;
      }

      // Low budget factor
      if (budget > 0 && budget < 10000000) {
        score -= Math.min((10000000 - budget) / 2000000, 3.0);
      }

      // Runtime factor (blockbusters tend to be longer)
      score += (runtime - 100) * 0.008;

      // Title-based variation for uniqueness
      const titleVariation = movie.title ? (movie.title.charCodeAt(0) % 100) * 0.02 - 1.0 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateMainstreamScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const language = movie.original_language || 'en';
      const keywords = movie.flatKeywords || [];
      const budget = movie.budget || 0;

      // Mainstream indicators (+) with weighted values
      const popularGenres = [
        { name: 'action', weight: 2.3 },
        { name: 'comedy', weight: 2.8 },
        { name: 'adventure', weight: 2.1 },
        { name: 'animation', weight: 2.4 },
        { name: 'family', weight: 2.9 }
      ];

      popularGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });

      // Language factor with nuance
      if (language === 'en') {
        score += 2.3;
      } else {
        score -= 1.8; // Non-English penalty
      }

      // Arthouse indicators (-) with weighted values
      const arthouseGenres = [
        { name: 'drama', weight: -1.2 },
        { name: 'documentary', weight: -2.7 },
        { name: 'foreign', weight: -2.1 }
      ];
      const arthouseKeywords = [
        { name: 'festival', weight: -2.4 },
        { name: 'cannes', weight: -2.8 },
        { name: 'sundance', weight: -2.2 },
        { name: 'experimental', weight: -2.6 },
        { name: 'avant-garde', weight: -2.9 },
        { name: 'independent film', weight: -2.1 },
        { name: 'black and white', weight: -1.8 },
        { name: 'foreign language film', weight: -2.0 },
        { name: 'art', weight: -1.5 },
        { name: 'surrealism', weight: -2.3 },
        { name: 'minimalism', weight: -1.9 }
      ];

      arthouseGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      arthouseKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Budget factor (mainstream films often have bigger budgets)
      if (budget > 0) {
        score += Math.min((budget / 50000000), 1.5);
      }

      // Genre count factor (arthouse films often have fewer genres)
      const genreCount = genres.length;
      if (genreCount <= 2) {
        score -= 0.8; // Fewer genres = more arthouse
      } else if (genreCount >= 4) {
        score += 0.6; // More genres = more mainstream
      }

      // Title-based variation
      const titleLength = movie.title ? movie.title.length : 20;
      score += (titleLength * 0.037) % 0.8 - 0.4;

      return Math.max(-10, Math.min(10, score));
    },
    calculateComfortScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 90;

      // Comfort indicators (+) with weighted values
      const comfortGenres = [
        { name: 'comedy', weight: 2.6 },
        { name: 'family', weight: 3.1 },
        { name: 'animation', weight: 2.8 },
        { name: 'romance', weight: 2.3 },
        { name: 'adventure', weight: 1.7 }
      ];
      const comfortKeywords = [
        { name: 'friendship', weight: 2.1 },
        { name: 'wedding', weight: 1.8 },
        { name: 'christmas', weight: 2.2 },
        { name: 'holiday', weight: 1.9 },
        { name: 'happy ending', weight: 2.0 },
        { name: 'school', weight: 1.6 },
        { name: 'romantic comedy', weight: 1.7 },
        { name: 'coming of age', weight: 1.5 },
        { name: 'feel good', weight: 1.8 }
      ];

      comfortGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      comfortKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Challenge indicators (-) with weighted values
      const challengeGenres = [
        { name: 'horror', weight: -2.7 },
        { name: 'thriller', weight: -1.4 },
        { name: 'war', weight: -2.2 },
        { name: 'crime', weight: -1.8 }
      ];
      const challengeKeywords = [
        { name: 'murder', weight: -2.4 },
        { name: 'violence', weight: -2.1 },
        { name: 'death', weight: -1.8 },
        { name: 'revenge', weight: -1.9 },
        { name: 'betrayal', weight: -1.7 },
        { name: 'torture', weight: -2.6 },
        { name: 'dystopia', weight: -2.0 },
        { name: 'alcoholism', weight: -1.8 },
        { name: 'suicide', weight: -2.2 },
        { name: 'tragedy', weight: -1.6 },
        { name: 'prison', weight: -1.5 }
      ];

      challengeGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      challengeKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (shorter films often more comfortable)
      score += (100 - runtime) * 0.005;

      // Title-based variation
      const titleHash = movie.title ? movie.title.replace(/\s/g, '').length * 0.17 : 0;
      score += (titleHash % 1) * 0.6 - 0.3;

      return Math.max(-10, Math.min(10, score));
    },
    calculateStyleScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const budget = movie.budget || 0;
      const runtime = movie.runtime || 100;

      // Style indicators (+) with weighted values
      const visualGenres = [
        { name: 'fantasy', weight: 2.4 },
        { name: 'science fiction', weight: 2.1 },
        { name: 'action', weight: 1.8 },
        { name: 'adventure', weight: 1.7 }
      ];
      const styleKeywords = [
        { name: 'visual effects', weight: 2.3 },
        { name: 'special effects', weight: 2.2 },
        { name: 'computer animation', weight: 2.0 },
        { name: 'cinematography', weight: 1.9 },
        { name: 'cgi', weight: 2.1 },
        { name: 'superhero', weight: 1.8 },
        { name: 'spectacle', weight: 1.7 },
        { name: 'epic', weight: 1.6 },
        { name: 'costume design', weight: 1.4 }
      ];

      visualGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      styleKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Budget factor (continuous)
      if (budget > 0) {
        score += Math.min((budget / 50000000) * 1.8, 3.2); // High budget often means visual spectacle
      }

      // Substance indicators (-) with weighted values
      const substanceGenres = [
        { name: 'drama', weight: -2.1 },
        { name: 'biography', weight: -2.4 },
        { name: 'history', weight: -1.9 }
      ];
      const substanceKeywords = [
        { name: 'character study', weight: -2.6 },
        { name: 'based on true story', weight: -2.2 },
        { name: 'biography', weight: -2.4 },
        { name: 'friendship', weight: -1.8 },
        { name: 'marriage', weight: -1.6 },
        { name: 'family relationships', weight: -1.7 },
        { name: 'coming of age', weight: -1.5 },
        { name: 'father son relationship', weight: -1.9 },
        { name: 'mother daughter relationship', weight: -1.8 },
        { name: 'divorce', weight: -1.4 }
      ];

      substanceGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      substanceKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (epic films often emphasize style)
      score += (runtime - 100) * 0.006;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.length * 0.09) % 0.7 - 0.35 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateGroundedScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const language = movie.original_language || 'en';
      const budget = movie.budget || 0;

      // Grounded indicators (+) with weighted values
      const realisticGenres = [
        { name: 'drama', weight: 2.3 },
        { name: 'biography', weight: 2.8 },
        { name: 'documentary', weight: 3.1 },
        { name: 'history', weight: 2.4 },
        { name: 'crime', weight: 1.9 }
      ];
      const groundedKeywords = [
        { name: 'based on true story', weight: 2.7 },
        { name: 'biography', weight: 2.5 },
        { name: 'new york city', weight: 1.8 },
        { name: 'los angeles', weight: 1.6 },
        { name: 'police', weight: 1.9 },
        { name: 'hospital', weight: 1.7 },
        { name: 'journalist', weight: 1.8 },
        { name: 'courtroom', weight: 1.9 },
        { name: 'workplace', weight: 1.5 },
        { name: 'contemporary', weight: 1.6 }
      ];

      realisticGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      groundedKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Language factor (non-English often more grounded)
      if (language !== 'en') {
        score += 1.3;
      }

      // Budget factor (lower budget often more grounded)
      if (budget > 0 && budget < 20000000) {
        score += Math.min((20000000 - budget) / 10000000, 1.8);
      }

      // Fantastical indicators (-) with weighted values
      const fantasticalGenres = [
        { name: 'fantasy', weight: -2.9 },
        { name: 'science fiction', weight: -2.6 },
        { name: 'animation', weight: -2.2 },
        { name: 'horror', weight: -1.7 }
      ];
      const fantasticalKeywords = [
        { name: 'magic', weight: -2.4 },
        { name: 'supernatural', weight: -2.1 },
        { name: 'future', weight: -1.9 },
        { name: 'alien', weight: -2.3 },
        { name: 'monster', weight: -1.8 },
        { name: 'superhero', weight: -2.2 },
        { name: 'time travel', weight: -2.0 },
        { name: 'space', weight: -1.9 },
        { name: 'dragon', weight: -2.5 },
        { name: 'wizard', weight: -2.4 },
        { name: 'mythology', weight: -1.6 }
      ];

      fantasticalGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      fantasticalKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.split(' ').length * 0.23) % 0.8 - 0.4 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateClassicScale (movie) {
      let score = 0;
      const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const currentYear = new Date().getFullYear();

      // Age-based scoring (continuous)
      if (releaseYear > 0) {
        const age = currentYear - releaseYear;
        if (age > 40) {
          score += 2.8 + (age - 40) * 0.04; // Extra points for very old films
        } else if (age > 20) {
          score += 1.2 + (age - 20) * 0.08;
        } else if (age < 10) {
          score -= 2.1 - age * 0.15; // Penalty for very recent films
        }
      }

      // Classic indicators (+) with weighted values
      const classicGenres = [
        { name: 'drama', weight: 1.4 },
        { name: 'romance', weight: 1.8 },
        { name: 'musical', weight: 2.3 },
        { name: 'western', weight: 2.6 }
      ];
      const classicKeywords = [
        { name: 'period piece', weight: 2.3 },
        { name: 'costume drama', weight: 2.1 },
        { name: 'black and white', weight: 2.5 },
        { name: 'world war ii', weight: 1.8 },
        { name: 'historical', weight: 1.9 },
        { name: 'victorian era', weight: 2.0 },
        { name: '1940s', weight: 1.7 },
        { name: '1950s', weight: 1.6 },
        { name: 'old hollywood', weight: 2.2 }
      ];

      classicGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      classicKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Contemporary indicators (-) with weighted values
      const modernGenres = [
        { name: 'science fiction', weight: -1.8 },
        { name: 'action', weight: -1.3 }
      ];
      const contemporaryKeywords = [
        { name: 'internet', weight: -2.1 },
        { name: 'social media', weight: -2.3 },
        { name: 'cell phone', weight: -1.9 },
        { name: 'computer', weight: -1.7 },
        { name: 'modern day', weight: -1.8 },
        { name: '2000s', weight: -1.5 },
        { name: '2010s', weight: -1.6 },
        { name: 'contemporary', weight: -1.4 },
        { name: 'technology', weight: -1.8 }
      ];

      modernGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      contemporaryKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (classic films often have different pacing)
      const runtime = movie.runtime || 100;
      if (runtime > 150) {
        score += 0.8; // Epic length often associated with classics
      } else if (runtime < 90) {
        score -= 0.4; // Very short films less classic
      }

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.charCodeAt(movie.title.length - 1) % 50) * 0.016 - 0.4 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateUpliftingScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 100;

      // Uplifting indicators (+) with weighted values
      const upliftingGenres = [
        { name: 'comedy', weight: 2.8 },
        { name: 'family', weight: 2.6 },
        { name: 'animation', weight: 2.3 },
        { name: 'romance', weight: 2.1 },
        { name: 'adventure', weight: 1.9 },
        { name: 'musical', weight: 2.4 }
      ];
      const upliftingKeywords = [
        { name: 'friendship', weight: 2.2 },
        { name: 'hope', weight: 2.7 },
        { name: 'redemption', weight: 2.5 },
        { name: 'inspiring', weight: 2.3 },
        { name: 'triumph', weight: 2.1 },
        { name: 'happy ending', weight: 2.4 },
        { name: 'celebration', weight: 1.8 },
        { name: 'wedding', weight: 1.9 },
        { name: 'christmas', weight: 2.0 }
      ];

      upliftingGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      upliftingKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Melancholy indicators (-) with weighted values
      const melancholyGenres = [
        { name: 'drama', weight: -1.8 },
        { name: 'war', weight: -2.4 },
        { name: 'crime', weight: -1.6 },
        { name: 'thriller', weight: -1.3 }
      ];
      const melancholyKeywords = [
        { name: 'death', weight: -2.1 },
        { name: 'tragedy', weight: -2.6 },
        { name: 'loss', weight: -2.2 },
        { name: 'suicide', weight: -2.8 },
        { name: 'alcoholism', weight: -2.4 },
        { name: 'depression', weight: -2.5 },
        { name: 'funeral', weight: -2.3 },
        { name: 'betrayal', weight: -2.0 },
        { name: 'divorce', weight: -1.8 }
      ];

      melancholyGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      melancholyKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (longer films often more melancholy)
      score += (100 - runtime) * 0.004;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.replace(/[^a-z]/gi, '').length * 0.11) % 0.9 - 0.45 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateTenseScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 100;

      // Tense indicators (+) with weighted values
      const tenseGenres = [
        { name: 'thriller', weight: 2.9 },
        { name: 'horror', weight: 2.7 },
        { name: 'mystery', weight: 2.2 },
        { name: 'action', weight: 1.8 },
        { name: 'crime', weight: 2.1 }
      ];
      const tenseKeywords = [
        { name: 'suspense', weight: 2.4 },
        { name: 'chase', weight: 2.6 },
        { name: 'kidnapping', weight: 2.1 },
        { name: 'murder', weight: 2.3 },
        { name: 'paranoia', weight: 2.5 },
        { name: 'survival', weight: 2.0 },
        { name: 'escape', weight: 1.9 },
        { name: 'showdown', weight: 1.8 },
        { name: 'violence', weight: 1.7 }
      ];

      tenseGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      tenseKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Relaxing indicators (-) with weighted values
      const relaxingGenres = [
        { name: 'comedy', weight: -2.3 },
        { name: 'romance', weight: -2.1 },
        { name: 'family', weight: -2.5 },
        { name: 'documentary', weight: -1.8 }
      ];
      const relaxingKeywords = [
        { name: 'friendship', weight: -2.4 },
        { name: 'wedding', weight: -2.2 },
        { name: 'christmas', weight: -2.3 },
        { name: 'holiday', weight: -2.0 },
        { name: 'school', weight: -2.1 },
        { name: 'coming of age', weight: -1.9 },
        { name: 'romantic comedy', weight: -2.5 },
        { name: 'feel good', weight: -2.4 }
      ];

      relaxingGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      relaxingKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (longer films can build more tension)
      score += (runtime - 100) * 0.008;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100) * 0.014 - 0.7 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateHopefulScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : 0;

      // Hopeful indicators (+) with weighted values
      const hopefulGenres = [
        { name: 'family', weight: 2.4 },
        { name: 'adventure', weight: 2.1 },
        { name: 'animation', weight: 2.2 },
        { name: 'comedy', weight: 1.9 }
      ];
      const hopefulKeywords = [
        { name: 'hope', weight: 2.8 },
        { name: 'redemption', weight: 2.6 },
        { name: 'triumph', weight: 2.3 },
        { name: 'happy ending', weight: 2.4 },
        { name: 'friendship', weight: 2.1 },
        { name: 'inspiring', weight: 2.2 },
        { name: 'second chance', weight: 2.0 },
        { name: 'rescue', weight: 1.9 },
        { name: 'wedding', weight: 1.8 }
      ];

      hopefulGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      hopefulKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Cynical indicators (-) with weighted values
      const cynicalGenres = [
        { name: 'war', weight: -2.6 },
        { name: 'crime', weight: -2.1 },
        { name: 'thriller', weight: -1.8 }
      ];
      const cynicalKeywords = [
        { name: 'corruption', weight: -2.4 },
        { name: 'betrayal', weight: -2.2 },
        { name: 'revenge', weight: -2.1 },
        { name: 'murder', weight: -2.0 },
        { name: 'dystopia', weight: -2.5 },
        { name: 'paranoia', weight: -2.3 },
        { name: 'conspiracy', weight: -1.9 },
        { name: 'alcoholism', weight: -2.6 },
        { name: 'suicide', weight: -2.8 }
      ];

      cynicalGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      cynicalKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Era factor (older films sometimes more optimistic)
      if (releaseYear > 0 && releaseYear < 1970) {
        score += 1.2;
      } else if (releaseYear > 2000) {
        score -= 0.8; // Modern films often more cynical
      }

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.length * 0.13) % 0.8 - 0.4 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateSimpleScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 100;
      const genreCount = genres.length;

      // Simple indicators (+) with weighted values
      const simpleGenres = [
        { name: 'comedy', weight: 2.1 },
        { name: 'action', weight: 1.9 },
        { name: 'horror', weight: 1.8 },
        { name: 'romance', weight: 2.0 },
        { name: 'family', weight: 2.3 }
      ];
      const simpleKeywords = [
        { name: 'friendship', weight: 2.4 },
        { name: 'family', weight: 2.6 },
        { name: 'school', weight: 2.2 },
        { name: 'wedding', weight: 2.1 },
        { name: 'coming of age', weight: 2.0 },
        { name: 'high school', weight: 2.3 },
        { name: 'love', weight: 2.2 },
        { name: 'christmas', weight: 2.4 }
      ];

      simpleGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      simpleKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Genre count factor
      if (genreCount <= 2) {
        score += 1.8; // Fewer genres = simpler
      } else if (genreCount >= 4) {
        score -= 1.5; // More genres = more complex
      }

      // Complex indicators (-) with weighted values
      const complexGenres = [
        { name: 'drama', weight: -1.7 },
        { name: 'mystery', weight: -2.3 },
        { name: 'science fiction', weight: -2.1 },
        { name: 'thriller', weight: -2.0 }
      ];
      const complexKeywords = [
        { name: 'time travel', weight: -2.8 },
        { name: 'conspiracy', weight: -2.4 },
        { name: 'dystopia', weight: -2.6 },
        { name: 'philosophy', weight: -2.5 },
        { name: 'artificial intelligence', weight: -2.3 },
        { name: 'alternate reality', weight: -2.7 },
        { name: 'multiple timeline', weight: -2.8 },
        { name: 'psychological', weight: -2.2 }
      ];

      complexGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      complexKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (shorter films often simpler)
      score += (90 - runtime) * 0.006;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.replace(/\s/g, '').length * 0.07) % 0.6 - 0.3 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateCharacterScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const cast = movie.credits?.cast || [];
      const runtime = movie.runtime || 100;

      // Character-driven indicators (+) with weighted values
      const characterGenres = [
        { name: 'drama', weight: 2.4 },
        { name: 'biography', weight: 2.8 },
        { name: 'romance', weight: 2.1 }
      ];
      const characterKeywords = [
        { name: 'friendship', weight: 2.5 },
        { name: 'marriage', weight: 2.4 },
        { name: 'father son relationship', weight: 2.6 },
        { name: 'mother daughter relationship', weight: 2.5 },
        { name: 'family relationships', weight: 2.3 },
        { name: 'love', weight: 2.2 },
        { name: 'psychological', weight: 2.1 },
        { name: 'character study', weight: 2.7 }
      ];

      characterGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      characterKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Cast size factor (character-driven films often have smaller casts)
      if (cast.length > 0 && cast.length < 20) {
        score += 1.6;
      } else if (cast.length > 50) {
        score -= 1.2;
      }

      // Plot-driven indicators (-) with weighted values
      const plotGenres = [
        { name: 'action', weight: -2.2 },
        { name: 'adventure', weight: -1.9 },
        { name: 'thriller', weight: -2.0 },
        { name: 'mystery', weight: -1.8 }
      ];
      const plotKeywords = [
        { name: 'superhero', weight: -2.3 },
        { name: 'chase', weight: -2.1 },
        { name: 'explosion', weight: -2.0 },
        { name: 'heist', weight: -2.2 },
        { name: 'mission', weight: -2.0 },
        { name: 'murder', weight: -1.9 },
        { name: 'gun fight', weight: -2.1 },
        { name: 'car chase', weight: -2.2 }
      ];

      plotGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      plotKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (character studies often take time)
      score += (runtime - 100) * 0.005;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.split(' ').length * 0.19) % 0.7 - 0.35 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateLinearScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const runtime = movie.runtime || 100;

      // Linear indicators (+) with weighted values
      const linearGenres = [
        { name: 'action', weight: 2.2 },
        { name: 'adventure', weight: 2.0 },
        { name: 'comedy', weight: 1.9 },
        { name: 'horror', weight: 1.8 }
      ];
      const linearKeywords = [
        { name: 'journey', weight: 2.2 },
        { name: 'coming of age', weight: 2.1 },
        { name: 'road trip', weight: 2.0 },
        { name: 'race against time', weight: 2.3 },
        { name: 'quest', weight: 1.9 },
        { name: 'rescue', weight: 2.0 },
        { name: 'escape', weight: 2.1 },
        { name: 'mission', weight: 1.8 }
      ];

      linearGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      linearKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Non-linear indicators (-) with weighted values
      const nonLinearGenres = [
        { name: 'drama', weight: -1.6 },
        { name: 'mystery', weight: -2.3 },
        { name: 'science fiction', weight: -1.9 }
      ];
      const nonLinearKeywords = [
        { name: 'time travel', weight: -2.4 },
        { name: 'memory', weight: -2.2 },
        { name: 'flashback', weight: -2.0 },
        { name: 'multiple timeline', weight: -2.6 },
        { name: 'nonlinear', weight: -2.7 },
        { name: 'dream', weight: -2.1 },
        { name: 'parallel universe', weight: -2.5 },
        { name: 'anthology', weight: -2.3 }
      ];

      nonLinearGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      nonLinearKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Runtime factor (shorter films often more linear)
      score += (100 - runtime) * 0.007;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.charCodeAt(0) % 60) * 0.016 - 0.48 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateUniversalScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const language = movie.original_language || 'en';
      const budget = movie.budget || 0;

      // Universal indicators (+) with weighted values
      const universalGenres = [
        { name: 'family', weight: 2.6 },
        { name: 'animation', weight: 2.4 },
        { name: 'comedy', weight: 2.2 },
        { name: 'adventure', weight: 2.0 }
      ];
      const universalKeywords = [
        { name: 'family', weight: 2.7 },
        { name: 'friendship', weight: 2.5 },
        { name: 'school', weight: 2.3 },
        { name: 'high school', weight: 2.2 },
        { name: 'love', weight: 2.1 },
        { name: 'christmas', weight: 2.4 },
        { name: 'wedding', weight: 2.0 },
        { name: 'coming of age', weight: 2.2 }
      ];

      universalGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      universalKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Language factor
      if (language === 'en') {
        score += 1.8; // English more universal
      } else {
        score -= 1.4;
      }

      // Budget factor (higher budget often more universal appeal)
      if (budget > 50000000) {
        score += Math.min((budget / 100000000) * 1.5, 2.2);
      }

      // Niche indicators (-) with weighted values
      const nicheGenres = [
        { name: 'documentary', weight: -2.8 },
        { name: 'foreign', weight: -2.4 },
        { name: 'art', weight: -2.6 }
      ];
      const nicheKeywords = [
        { name: 'foreign language film', weight: -2.7 },
        { name: 'art', weight: -2.5 },
        { name: 'independent film', weight: -2.3 },
        { name: 'cult', weight: -2.4 },
        { name: 'experimental', weight: -2.6 },
        { name: 'avant garde', weight: -2.8 },
        { name: 'surreal', weight: -2.5 },
        { name: 'abstract', weight: -2.7 }
      ];

      nicheGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      nicheKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.replace(/[aeiou]/gi, '').length * 0.12) % 0.8 - 0.4 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateEscapistScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const budget = movie.budget || 0;

      // Escapist indicators (+) with weighted values
      const escapistGenres = [
        { name: 'fantasy', weight: 2.8 },
        { name: 'science fiction', weight: 2.6 },
        { name: 'adventure', weight: 2.3 },
        { name: 'animation', weight: 2.4 },
        { name: 'action', weight: 2.1 }
      ];
      const escapistKeywords = [
        { name: 'fantasy', weight: 2.6 },
        { name: 'superhero', weight: 2.5 },
        { name: 'space', weight: 2.4 },
        { name: 'magic', weight: 2.3 },
        { name: 'alien', weight: 2.2 },
        { name: 'time travel', weight: 2.1 },
        { name: 'alternate reality', weight: 2.4 },
        { name: 'computer animation', weight: 2.0 }
      ];

      escapistGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      escapistKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Budget factor (escapist films often have higher budgets)
      if (budget > 80000000) {
        score += Math.min((budget / 150000000) * 1.8, 2.1);
      }

      // Realistic indicators (-) with weighted values
      const realisticGenres = [
        { name: 'drama', weight: -2.0 },
        { name: 'documentary', weight: -2.9 },
        { name: 'biography', weight: -2.4 },
        { name: 'history', weight: -2.2 }
      ];
      const realisticKeywords = [
        { name: 'based on true story', weight: -2.8 },
        { name: 'biography', weight: -2.6 },
        { name: 'documentary', weight: -2.7 },
        { name: 'real life', weight: -2.4 },
        { name: 'prison', weight: -2.1 },
        { name: 'hospital', weight: -2.0 },
        { name: 'courtroom', weight: -2.2 },
        { name: 'war', weight: -2.3 }
      ];

      realisticGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      realisticKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.match(/[A-Z]/g)?.length || 0) * 0.14 - 0.42 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculatePolishedScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const budget = movie.budget || 0;
      const companies = movie.production_companies || [];

      // Polished indicators (+) with weighted values
      const polishedStudios = [
        { name: 'disney', weight: 2.6 },
        { name: 'warner bros', weight: 2.3 },
        { name: 'universal', weight: 2.2 },
        { name: 'paramount', weight: 2.1 },
        { name: 'sony', weight: 2.0 }
      ];
      const polishedKeywords = [
        { name: 'computer animation', weight: 2.4 },
        { name: 'special effects', weight: 2.3 },
        { name: 'visual effects', weight: 2.2 },
        { name: 'cgi', weight: 2.1 },
        { name: 'blockbuster', weight: 2.0 },
        { name: 'sequel', weight: 1.9 },
        { name: 'franchise', weight: 2.2 },
        { name: 'superhero', weight: 2.1 }
      ];

      polishedStudios.forEach(studio => {
        if (companies.some(c => c.name && c.name.toLowerCase().includes(studio.name))) {
          score += studio.weight;
        }
      });
      polishedKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Budget factor (higher budget often more polished)
      if (budget > 0) {
        score += Math.min((budget / 100000000) * 2.8, 3.5);
      }

      // Raw indicators (-) with weighted values
      const rawStudios = [
        { name: 'a24', weight: -2.4 },
        { name: 'mumblecore', weight: -2.8 },
        { name: 'independent', weight: -1.9 }
      ];
      const rawKeywords = [
        { name: 'prison', weight: -2.6 },
        { name: 'murder', weight: -2.4 },
        { name: 'violence', weight: -2.3 },
        { name: 'drug', weight: -2.5 },
        { name: 'crime', weight: -2.2 },
        { name: 'gang', weight: -2.4 },
        { name: 'street', weight: -2.1 },
        { name: 'urban', weight: -2.0 }
      ];

      rawStudios.forEach(studio => {
        if (companies.some(c => c.name && c.name.toLowerCase().includes(studio.name))) {
          score += studio.weight;
        }
      });
      rawKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Low budget factor
      if (budget > 0 && budget < 5000000) {
        score -= Math.min((5000000 - budget) / 1000000, 2.5);
      }

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.replace(/\W/g, '').length * 0.08) % 0.6 - 0.3 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateFamiliarScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : 0;

      // Familiar indicators (+) with weighted values
      const familiarGenres = [
        { name: 'comedy', weight: 2.1 },
        { name: 'action', weight: 1.9 },
        { name: 'romance', weight: 2.0 },
        { name: 'family', weight: 2.2 }
      ];
      const familiarKeywords = [
        { name: 'sequel', weight: 2.4 },
        { name: 'franchise', weight: 2.3 },
        { name: 'superhero', weight: 2.1 },
        { name: 'remake', weight: 2.5 },
        { name: 'adaptation', weight: 2.0 },
        { name: 'classic', weight: 2.2 },
        { name: 'traditional', weight: 1.9 },
        { name: 'formula', weight: 1.8 }
      ];

      familiarGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      familiarKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Era factor (older films more familiar to modern audiences)
      if (releaseYear > 0 && releaseYear < 1990) {
        score += 1.5;
      }

      // Innovative indicators (-) with weighted values
      const innovativeGenres = [
        { name: 'science fiction', weight: -2.0 },
        { name: 'experimental', weight: -2.8 }
      ];
      const innovativeKeywords = [
        { name: 'original screenplay', weight: -2.6 },
        { name: 'experimental', weight: -2.8 },
        { name: 'avant garde', weight: -2.7 },
        { name: 'innovative', weight: -2.5 },
        { name: 'first film', weight: -2.4 },
        { name: 'debut', weight: -2.3 },
        { name: 'breakthrough', weight: -2.2 },
        { name: 'unique', weight: -2.1 }
      ];

      innovativeGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      innovativeKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Recent films factor (very recent films might be more innovative)
      if (releaseYear > 2018) {
        score -= 1.2;
      }

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.split(' ').length * 0.15) % 0.7 - 0.35 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    },
    calculateMinimalistScale (movie) {
      let score = 0;
      const genres = movie.genres || [];
      const keywords = movie.flatKeywords || [];
      const budget = movie.budget || 0;
      const cast = movie.credits?.cast || [];
      const runtime = movie.runtime || 100;

      // Minimalist indicators (+) with weighted values
      const minimalistGenres = [
        { name: 'drama', weight: 2.2 },
        { name: 'documentary', weight: 2.4 },
        { name: 'art', weight: 2.6 }
      ];
      const minimalistKeywords = [
        { name: 'character study', weight: 2.8 },
        { name: 'dialogue', weight: 2.5 },
        { name: 'conversation', weight: 2.4 },
        { name: 'intimate', weight: 2.3 },
        { name: 'quiet', weight: 2.2 },
        { name: 'subtle', weight: 2.1 },
        { name: 'introspective', weight: 2.6 },
        { name: 'contemplative', weight: 2.5 }
      ];

      minimalistGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      minimalistKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // Budget factor (lower budget often more minimalist)
      if (budget > 0 && budget < 10000000) {
        score += Math.min((10000000 - budget) / 2000000, 2.2);
      }

      // Cast size factor (smaller cast more minimalist)
      if (cast.length > 0 && cast.length < 15) {
        score += 1.8;
      }

      // Maximalist indicators (-) with weighted values
      const maximalistGenres = [
        { name: 'action', weight: -2.3 },
        { name: 'adventure', weight: -2.1 },
        { name: 'fantasy', weight: -2.4 },
        { name: 'science fiction', weight: -2.2 }
      ];
      const maximalistKeywords = [
        { name: 'epic', weight: -2.4 },
        { name: 'explosion', weight: -2.3 },
        { name: 'special effects', weight: -2.5 },
        { name: 'visual effects', weight: -2.4 },
        { name: 'spectacle', weight: -2.6 },
        { name: 'action packed', weight: -2.7 },
        { name: 'blockbuster', weight: -2.2 },
        { name: 'ensemble cast', weight: -2.1 }
      ];

      maximalistGenres.forEach(genre => {
        if (genres.some(g => g.name && g.name.toLowerCase().includes(genre.name))) {
          score += genre.weight;
        }
      });
      maximalistKeywords.forEach(keyword => {
        if (keywords.some(k => k.toLowerCase().includes(keyword.name))) {
          score += keyword.weight;
        }
      });

      // High budget factor (blockbusters often maximalist)
      if (budget > 150000000) {
        score -= Math.min((budget - 150000000) / 100000000, 2.8);
      }

      // Large cast factor
      if (cast.length > 50) {
        score -= 1.9;
      }

      // Runtime factor (shorter films often more minimalist)
      score += (90 - runtime) * 0.008;

      // Title-based variation
      const titleVariation = movie.title ? (movie.title.replace(/\s/g, '').length * 0.06) % 0.5 - 0.25 : 0;
      score += titleVariation;

      return Math.max(-10, Math.min(10, score));
    }
  }
};
</script>

<style lang="scss">
  .insights {
  /* Matt's house tile language (see .insights-pane-item in InsightsPane.vue):
     white 1px borders, 3px radius, white body text.

     The accent is no longer one blue everywhere. Every tab owns a colour from
     the app's rainbow bar, and everything inside that tab — tile headers, link
     icons, chips, the pane headers in YearlyAverage/Outliers/FunFactsRow —
     paints itself with it. So the variety means something: the colour tells
     you which section you're looking at ("we still need more variety in
     there, and hopefully the variety will have some kind of meaning", Matt
     2026-08-16). --accent-deep is the same hue darkened, for the
     second-tier/comparison tiles within a section.

     Black label text on every one of these, matching the rainbow bar: white
     on the yellow or the green would be illegible. */
  --accent: #1D8BF1;
  --accent-deep: #12578f;
  --accent-text: #000;

  &.insights-accent-overview {
    --accent: #FFD700;
    --accent-deep: #6d5c00;
  }

  &.insights-accent-ratings {
    --accent: #1D8BF1;
    --accent-deep: #12578f;
  }

  &.insights-accent-activity {
    --accent: #24d776;
    --accent-deep: #14663a;
  }

  &.insights-accent-people {
    --accent: #cd7fe8;
    --accent-deep: #6d3b7f;
  }

  &.insights-accent-places {
    --accent: #f0ad4e;
    --accent-deep: #7a4f14;
  }

  /* The deep shades are dark enough to need white back. */
  &.insights-accent-overview .alt .glance-label,
  &.insights-accent-ratings .alt .glance-label,
  &.insights-accent-activity .alt .glance-label,
  &.insights-accent-people .alt .glance-label,
  &.insights-accent-places .alt .glance-label {
    color: white;
  }

  .insights-tabs {
    display: flex;
    gap: 0.35rem;
    margin: 0.25rem 0 0.75rem;
    width: 100%;

    .insights-tab {
      background: none;
      border: 1px solid white;
      border-radius: 3px;
      color: white;
      flex: 1 1 0;
      font-size: 0.85rem;
      font-weight: 600;
      min-height: 40px;
      min-width: 0;

      /* Each tab wears its own colour when active, so the bar itself carries
         the key to the colour coding below it. */
      &.active {
        color: #000;
        font-weight: 700;
      }

      &.insights-tab-overview.active { background: #FFD700; }
      &.insights-tab-ratings.active { background: #1D8BF1; }
      &.insights-tab-activity.active { background: #24d776; }
      &.insights-tab-people.active { background: #cd7fe8; }
      &.insights-tab-places.active { background: #f0ad4e; }

      &:active {
        opacity: 0.7;
      }
    }
  }

  /* Deliberate size variety — a wall of identical half-width boxes read
     as "samey" (Matt). Tiles span 2, 3, or all 6 columns and scale their
     value type to match; the secondary/comparison tiles use a deeper blue
     from the same family. */
  .glance-strip {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(6, 1fr);
    margin-bottom: 0.75rem;
    width: 100%;

    .glance-item {
      border: 1px solid white;
      border-radius: 3px;
      color: white;
      display: flex;
      flex-direction: column;
      grid-column: span 3;
      min-width: 0;
      overflow: hidden;
      text-align: center;

      &.wide { grid-column: span 6; }
      &.third { grid-column: span 2; }
    }

    .glance-label {
      background: var(--accent);
      border-bottom: 1px solid white;
      color: var(--accent-text);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 1px 4px;
    }

    /* Second tier within a section — last year's comparison figures — in the
       same hue, deeper. A different hue here fought with the tab colour. */
    .alt .glance-label {
      background: var(--accent-deep);
    }

    .glance-value {
      font-size: 1.3rem;
      padding: 0.15rem 0;
    }

    .feature .glance-value { font-size: 1.9rem; font-weight: 700; }
    .wide .glance-value { font-size: 2.3rem; font-weight: 700; }
    .third .glance-value { font-size: 1.1rem; }
  }

  .insights-links {
    display: grid;
    gap: 0.5rem;
    grid-template-columns: repeat(2, 1fr);
    margin-top: 0.75rem;
    width: 100%;

    /* These read as boxes, not buttons ("they just kinda look like another box
       like the others"). Everything about them now says control rather than
       tile: a raised fill instead of a transparent panel, a soft 8px radius
       against the tiles' hard 3px, a grey edge instead of the tiles' white
       one, and a chevron saying it goes somewhere. The accent shrinks to the
       icon's own colour — six filled accent chips were a sixth of the wall of
       yellow by themselves. */
    .insights-link-card {
      align-items: center;
      background: #33383d;
      border: 1px solid #555c63;
      border-radius: 8px;
      box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset;
      color: white;
      display: flex;
      font-weight: 600;
      gap: 0.55rem;
      min-height: 52px;
      padding: 0.4rem 0.6rem;
      text-align: left;

      i {
        color: var(--accent);
        flex: 0 0 auto;
        font-size: 1.15rem;
      }

      span {
        flex: 1 1 auto;
        /* Small enough that "Year in Review" and "Library Poster" stay on one
           line at 357px, so the rows keep an even height. */
        font-size: 0.85rem;
        min-width: 0;
      }

      .link-chevron {
        /* #9aa0a6 on #33383d is ~4.6:1 — a hint, but still a legible one. */
        color: #9aa0a6;
        font-size: 0.9rem;
      }

      &:active {
        background: #23272b;
        box-shadow: none;
      }
    }
  }

  /* The pace figure, pulled out into a box of its own — it was one tile in a
     grid of eight and read as just another number. */
  .pace-box {
    border: 1px solid white;
    border-radius: 3px;
    color: white;
    display: flex;
    flex-direction: column;
    margin-bottom: 0.75rem;
    overflow: hidden;
    text-align: center;
    width: 100%;

    .pace-label {
      background: var(--accent);
      border-bottom: 1px solid white;
      color: var(--accent-text);
      font-size: 0.75rem;
      font-weight: 600;
      padding: 2px 4px;
    }

    .pace-value {
      font-size: 3rem;
      font-weight: 700;
      line-height: 1.1;
      padding-top: 0.25rem;
    }

    .pace-note {
      /* #b9b9b9 on the panel background, ~8:1 — .text-muted would fail here. */
      color: #b9b9b9;
      font-size: 0.75rem;
      padding: 0 0.5rem 0.5rem;
    }
  }

  /* All-time calendar coverage. Ramps use the tab's own --accent so this
     belongs to Activity the way every other panel belongs to its tab. */
  .coverage-box {
    border: 1px solid white;
    border-radius: 3px;
    color: white;
    margin-bottom: 0.75rem;
    padding: 0.7rem;
  }

  .coverage-title {
    font-size: 1rem;
    font-weight: 700;
    margin: 0 0 0.25rem;
  }

  .coverage-caption {
    /* #b9b9b9 on this panel is ~8:1; .text-muted would fail here. */
    color: #b9b9b9;
    font-size: 0.75rem;
    margin: 0 0 0.6rem;
  }

  .coverage-caption strong { color: var(--accent); }

  .coverage-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  /* A 31-column grid rather than a flex row: months have 28 to 31 days, and
     flexing the cells would make February's wider than January's, so the
     columns — which are the dates — would stop lining up. Fixed columns keep
     the 14th above the 14th, and 1fr means the whole thing fits any width
     without a 3px overflow that reads as a bug. */
  .coverage-row {
    align-items: center;
    display: grid;
    gap: 2px;
    grid-template-columns: 24px repeat(31, 1fr);
  }

  .coverage-month {
    color: #b9b9b9;
    font-size: 0.6rem;
    text-align: right;
  }

  .coverage-cell {
    aspect-ratio: 1;
    border-radius: 2px;
    display: block;
    min-width: 0;
  }

  /* The gaps are the point of the graph, so they get the only outline —
     a flat dark square would read as background rather than as a date. */
  .coverage-none {
    background: #1b1b1b;
    box-shadow: inset 0 0 0 1px #3d3d3d;
  }

  /* Feb 29 comes round once every four years; an empty one says much less
     than an empty March 3rd, so it isn't dressed up as a real gap. */
  .coverage-rare { background: #1b1b1b; opacity: 0.35; }

  .coverage-1 { background: var(--accent-deep); }
  .coverage-2 { background: var(--accent-deep); filter: brightness(1.45); }
  .coverage-3 { background: var(--accent); filter: brightness(0.8); }
  .coverage-4 { background: var(--accent); }

  .coverage-gaps {
    color: #b9b9b9;
    font-size: 0.72rem;
    margin: 0.5rem 0 0;
  }

  .coverage-gaps strong { color: #e6e6e6; }

  .scatter-reading {
    color: #e6e6e6;
    font-size: 0.85rem;
    margin: 0.6rem 0 0;
    text-align: center;
    width: 100%;
  }

  /* Places tab. Same tile language as the rest; scores use the tab accent. */
  .places-empty,
  .places-summary,
  .country-card-breakdown {
    /* #ccc on the panel background, ~6:1. */
    color: #ccc;
    font-size: 0.82rem;
    margin: 0 0 0.6rem;
  }

  .country-card {
    background: #161616;
    border: 1px solid #2e2e2e;
    border-radius: 8px;
    margin-top: 0.6rem;
    padding: 0.6rem 0.75rem;

    .country-card-title {
      align-items: baseline;
      display: flex;
      justify-content: space-between;
      margin: 0 0 0.2rem;
    }

    .country-card-count {
      color: var(--accent);
      font-size: 0.85rem;
      font-weight: 600;
    }

    .country-card-breakdown {
      margin-bottom: 0.4rem;
    }
  }

  .country-places {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .place-pill {
    background: none;
    border: 1px solid #6f6f6f;
    border-radius: 999px;
    color: #eee;
    font-size: 0.75rem;
    line-height: 1;
    min-height: 32px;
    padding: 0.35rem 0.65rem;

    .place-pill-count {
      color: var(--accent);
      font-weight: 600;
      margin-left: 0.2rem;
    }

    &:active { opacity: 0.7; }
  }

  .place-list {
    list-style: none;
    margin: 0;
    padding: 0;

    .place-row {
      align-items: baseline;
      border-top: 1px solid #2e2e2e;
      display: flex;
      gap: 0.6rem;
      min-height: 40px;
      padding: 0.45rem 0;

      &:first-child { border-top: none; }
      &:active { opacity: 0.7; }
    }

    .place-row-name {
      flex: 1 1 auto;
      font-weight: 600;
      min-width: 0;
    }

    .place-row-films {
      color: #ccc;
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .place-row-score {
      color: var(--accent);
      font-weight: 700;
      min-width: 2.6rem;
      text-align: right;
    }
  }

  .people-chips {
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.35rem;
    margin-bottom: 0.4rem;
    width: 100%;

    /* Deliberately smaller and lighter than the tabs above them: at full size
       with a white border they read as a second tab bar ("they kind of compete
       with the tabs at the top even though they're ovals"). The button keeps a
       40px tap target — the house minimum — while the visible pill inside it
       shrinks. */
    .people-chip {
      align-items: center;
      background: none;
      border: none;
      display: flex;
      min-height: 40px;
      padding: 0;

      .people-chip-pill {
        border: 1px solid #6f6f6f;
        border-radius: 999px;
        /* #ccc on the page background, ~9:1. */
        color: #ccc;
        font-size: 0.72rem;
        line-height: 1;
        padding: 0.3rem 0.6rem;
      }

      &.active .people-chip-pill {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-text);
        font-weight: 700;
      }

      &:active { opacity: 0.7; }
    }
  }

    color: white;
    /* The bottom value clears the floating bug-report button (44px tall,
       sitting 60px up from the viewport bottom). It lives in the shorthand
       deliberately: a separate padding-bottom earlier in this block was
       silently reset by this very declaration. */
    padding: 18px 18px 72px;
    max-width: 600px;
    margin: 0 auto;
    /* .app-main is a flex container, so this is a flex ITEM: min-width:auto
       means content min-size can force it WIDER than the viewport (the
       fun-facts row's rigid cards blew it to its 600px cap on a phone,
       half off-screen with the shell's overflow-clip hiding the evidence).
       min-width:0 lets it shrink to the screen like a normal block. */
    min-width: 0;
    width: 100%;

    .home-link {
      align-items: center;
      column-gap: 4px;
      cursor: pointer;
      display: flex;
      left: 6px;
      position: absolute;
      top: 6px;
    }

  }
</style>