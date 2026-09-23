<template>
  <li
    class="grid-layout-media-result"
    :class="{'not-rated': result.falseEntry, 'loading': isLoading}"
    :id="sanitizeId(result.dbKey)"
    @click="showDetails(`Info-${this.topStructure(result).id}`)"
  >
    <img
      class="poster"
      v-lazy="{
        src: posterImageUrl(result),
        loading: placeholderImage
      }"
    >

    <!-- Loading overlay -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="spinner-border spinner-border-sm text-light" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>

    <!-- Rated offline, not yet matched to a real TMDB movie (see AddRating.js) -->
    <span v-if="topStructure(result).isPendingReconciliation" class="pending-match-badge">Pending match</span>

    <div class="details">
      <span v-if="activeQuickLinkList === 'bestPicture'">
        {{topStructure(result).academyAwardsYear}}
      </span>
      <!-- Overall rank ONLY when the list is sorted by rating. It used to ride
           along in every variant; Matt, 2026-08-26: "when we sort by the
           various money things, we don't need to do that... the only place the
           overall rank is useful is sorted by rating." Everywhere else the bar
           names the thing being sorted on instead, which is what you're
           actually looking at. -->
      <span v-else-if="showsOverallRank" class="rank">
        <span v-if="resultsAreFiltered">{{getOrdinal(index + 1)}} ({{getOrdinal(overAllRank)}})</span>
        <span v-else>{{getOrdinal(overAllRank)}}</span>
      </span>
      <span v-else-if="sortValue === 'watched'">
        {{smallFormattedDate(mostRecentRating(result).date)}}
      </span>
      <span v-else-if="sortValue === 'release'">
        {{smallFormattedDate(topStructure(result).release_date)}}
      </span>
      <span v-else-if="sortValue === 'views'">
        {{result.ratings.length}} view<span v-if="result.ratings.length > 1" >s</span>
      </span>
      <!-- Whatever the list is currently sorted BY, said out loud. Requested
           2026-08-26: "show the sorted values in the tiny bar below each
           poster... the individual scores that we're sorting on, and now the
           budget ones." This IS the bar's content on these sorts — the rank
           is no longer appended (see showsOverallRank). -->
      <span v-else-if="sortDetail">
        {{sortDetail}}<!--
        --><i
          v-if="marksNoBoxOffice"
          class="bi bi-tv no-box-office"
          title="No box office reported — streaming original or never widely released. Sorted to the end of the budget list."
        ></i>
      </span>
      <!-- Nothing to say (title sort). An empty span, not a missing one, so
           space-between keeps the score pinned right. -->
      <span v-else></span>
      <span v-if="!result.falseEntry" class="rating">
        {{parseFloat(ratingForMedia(result)).toFixed(2)}}
      </span>
    </div>
  </li>
  <Modal class="details-modal" :show="showDetailsModal" @close="showDetailsModal = false">
    <template v-slot:header>
      <h2>{{topStructure(result).title}}</h2>
      <img :src="`https://image.tmdb.org/t/p/w500${getBackdropPath(result)}`" alt="Movie backdrop">
    </template>
    <template v-slot:body>
      <div class="details-modal-body col-12">

        <div class="rating-runtime-and-date">
          <div class="line-one">
            <h3>
              <a class="link" @click.stop="searchFor(`${getYear(result)}`)">{{getYear(result)}}</a>
            </h3>
            <ToggleableRating :rating="ratingForMedia(result)" :normalizedRating="normalizedRatingForMedia(result)"/>
          </div>
          <div class="line-two">
            <h3>{{prettifyRuntime(result)}}</h3>
          </div>
        </div>

        <div class="details-actions d-flex align-items-center">
          <div v-if="$store.state.settings.letterboxdConnected"
               @click="logOnLetterboxd"
               :title="isMovieLoggedOnLetterboxd() ? 'View movie on Letterboxd' : 'Log on Letterboxd'"
               :class="['letterboxd-status-button', { 'logged': isMovieLoggedOnLetterboxd(), 'not-logged': !isMovieLoggedOnLetterboxd() }]">
            <img :src="isMovieLoggedOnLetterboxd() ? 'https://a.ltrbxd.com/logos/letterboxd-decal-dots-pos-rgb-500px.png' : 'https://a.ltrbxd.com/logos/letterboxd-decal-dots-pos-mono-500px.png'"
                 alt="Letterboxd"
                 class="letterboxd-icon">
          </div>
          <button class="btn btn-sm btn-success me-2" @click="rateMedia(topStructure(result))">Add New Rating</button>
          <button class="btn btn-sm btn-info me-2" @click="goToWikipedia()">Wikipedia</button>
        </div>

        <div v-if="getAllRatings(previousEntry)" class="previous-ratings mb-3">
          <h4>Ratings</h4>
          <div class="accordion mt-2">
            <div class="accordion-item" v-for="(rating, index) in getAllRatings(previousEntry)" :key="index">
              <h2 class="accordion-header" :id="`heading-${index}`">
                <button class="accordion-button col-12 d-flex" type="button" data-bs-toggle="collapse" :data-bs-target="`#collapse-${index}`" aria-expanded="false" :aria-controls="`collapse-${index}`">
                  <span class="medium-and-date col-9">
                    <span>{{rating.medium}}</span>
                    <span v-if="rating.medium && rating.date">&nbsp;on&nbsp;</span>
                    <span v-else-if="rating.date">On&nbsp;</span>
                    <span>{{formattedDate(rating.date)}}</span>
                  </span>
                  <p class="col-3 m-0 text-center border-start">{{formatScore(rating.calculatedTotal)}}</p>
                </button>
              </h2>
              <div :id="`collapse-${index}`" class="accordion-collapse collapse" :aria-labelledby="`heading-${index}`">
                <div class="accordion-body">
                  <table class="table mb-0 table-striped-columns">
                    <thead>
                      <tr>
                        <th><span>dir</span></th>
                        <th><span>img</span></th>
                        <th><span>stry</span></th>
                        <th><span>perf</span></th>
                        <th><span>sndtk</span></th>
                        <th><span>stick</span></th>
                        <th><span>love</span></th>
                        <th><span>ovral</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr class="table-secondary">
                        <td>{{rating.direction}}</td>
                        <td>{{rating.imagery}}</td>
                        <td>{{rating.story}}</td>
                        <td>{{rating.performance}}</td>
                        <td>{{rating.soundtrack}}</td>
                        <td>{{rating.stickiness && rating.stickiness !== 0 ? rating.stickiness : 1}}</td>
                        <td>{{rating.love}}</td>
                        <td>{{rating.overall}}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div class="d-flex justify-content-end mt-2">
                    <!-- Same pair as MovieDetail's ratings accordion — see the
                         comment there. Editing has to exist everywhere a
                         rating can be deleted, or the delete-and-retype habit
                         just moves to whichever screen lacks it. -->
                    <div class="btn btn-sm btn-secondary me-1" @click="editRating(index)">Edit Rating</div>
                    <div :id="`delete-button-${previousEntry.dbKey}-${index}`" class="delete-button btn btn-sm btn-warning" @click="showConfimDeleteButton(previousEntry.dbKey, index)">Delete Rating</div>
                    <div :id="`confirm-delete-button-${previousEntry.dbKey}-${index}`" class="confirm-delete-button d-none col-12 d-flex justify-content-between align-items-center">
                      <p class="m-0">Are you sure?</p>
                      <div>
                        <div class="btn btn-sm btn-info me-1" @click="showDeleteButton(previousEntry.dbKey, index)">Nevermind</div>
                        <div class="btn btn-sm btn-danger" @click="deleteRating(previousEntry, index)">Yes, Delete</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="directors">
          <h4>
            Director<span v-if="multipleEntries(getCrewMember('Director', true))">s</span>
          </h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Director', 'strict')" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countDirector(name)" class="small-count-bubble">&nbsp;({{ countDirector(name) }})</span><span v-if="index !== getCrewMember('Director', 'strict').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div class="genres">
          <h4>Genre<span v-if="multipleEntries(turnArrayIntoList(topStructure(result).genres, 'name'))">s</span></h4>
          <p class="long-list">
            <a
              v-for="(genre, index) in topStructure(result).genres"
              :key="index"
              class="link me-2"
              @click.stop="searchFor(genre.name)"
            >
              {{genre.name}}<span v-if="countGenre(genre.name)" class="small-count-bubble">&nbsp;({{ countGenre(genre.name) }})</span>
            </a>
          </p>
        </div>

        <div class="awards">
          <div class="academy-awards">
            <h4 v-if="academyAwardWins.length">Academy Award Wins</h4>
            <div v-if="academyAwardWins.length" class="winners">
              <a v-for="award in academyAwardWins" :key="award.id" class="link col-12" @click="goToWikipedia(award.ceremony)">
                {{award.category}}
                <span v-if="award.isActing" >({{parseNamesToList(award.names)}})</span>
              </a>
            </div>
            <h4 v-if="academyAwardNominations.length">Academy Award Nominations</h4>
            <div v-if="academyAwardNominations.length" class="nominees">
              <a v-for="award in academyAwardNominations" :key="award.id" class="link col-12" @click="goToWikipedia(award.ceremony)">
                {{award.category}}
                <span v-if="award.isActing" >({{parseNamesToList(award.names)}})</span>
              </a>
            </div>
          </div>
        </div>

        <div v-if="topStructure(result).cast && topStructure(result).cast.length" class="cast">
          <h4>Cast</h4>
          <p class="long-list">
            <a v-for="(castMember, index) in topStructure(result).cast" :key="index" class="link" @click.stop="searchFor(castMember.name)">
              {{castMember.name}}<span v-if="countCastCrew(castMember.name)" class="small-count-bubble">&nbsp;({{ countCastCrew(castMember.name) }})</span><span v-if="index !== topStructure(result).cast.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="topStructure(result).flatKeywords && topStructure(result).flatKeywords.length" class="keywords">
          <h4>Keyword<span v-if="multipleEntries(topStructure(result).flatKeywords)">s</span></h4>
          <p class="long-list">
            <a v-for="(keyword, index) in sortedFlatKeywords" :key="index" class="link" @click.stop="searchFor(keyword)">

              {{keyword}}<span class="small-count-bubble">&nbsp;({{ keywordCounts[keyword] }})</span><span v-if="index !== topStructure(result).flatKeywords.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="getCrewMember('Writer', false)" class="writers">
          <h4>Writer<span v-if="multipleEntries(getCrewMember('Writer', false))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Writer', false)" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Writer', false).length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="getCrewMember('Composer')" class="composers">
          <h4>Composer<span v-if="multipleEntries(getCrewMember('Composer'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Composer')" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Composer').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="getCrewMember('Editor').length" class="editors">
          <h4>Editor<span v-if="multipleEntries(getCrewMember('Editor'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Editor')" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Editor').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="getCrewMember('Photo').length" class="cinematographers">
          <h4>Cinematographer<span v-if="multipleEntries(getCrewMember('Photo'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Photo')" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Photo').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="topStructure(result).production_companies && topStructure(result).production_companies.length" class="production-companies">
          <h4>Production <span v-if="multipleEntries(turnArrayIntoList(topStructure(result).production_companies, 'name'))">Companies</span><span v-else>Company</span></h4>
          <p class="long-list">
            <a v-for="(productionCompany, index) in topStructure(result).production_companies" :key="index" class="link" @click.stop="searchFor(productionCompany.name)">
              {{productionCompany.name}}<span v-if="countStudios(productionCompany.name)" class="small-count-bubble">&nbsp;({{ countStudios(productionCompany.name) }})</span><span v-if="index !== topStructure(result).production_companies.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <div v-if="getCrewMember('Producer').length" class="producers">
          <h4>Producer<span v-if="multipleEntries(getCrewMember('Producer'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Producer')" :key="index" class="link" @click.stop="searchFor(name)">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Producer').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>
      </div>
    </template>
  </Modal>
  <InsetBrowserModal :show="showInsetBrowserModal" :url="insetBrowserUrl" @close="showInsetBrowserModal = false" />
</template>

<script>
import axios from 'axios';

const DATE_FORMATS = {
  weekday: new Intl.DateTimeFormat('en-US', { weekday: 'long' }),
  monthDay: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
  monthDayYear: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
};
import { formatScore } from '../assets/javascript/formatScore.js';
import { formatMoneyShort, formatProfit, formatReturn } from '../assets/javascript/formatMoney.js';
import { adjustedMovieMoney } from '../assets/javascript/inflation.js';
import { isModernWithNoBoxOffice } from '../assets/javascript/searchFiltering.js';
import ordinal from "ordinal-js";
import minBy from 'lodash/minBy';
import Modal from './Modal.vue';
import InsetBrowserModal from './InsetBrowserModal.vue';
import ToggleableRating from './ToggleableRating.vue';
import { getRating, getAllRatings } from "../assets/javascript/GetRating.js";
import placeholderImage from '../assets/images/sheen-placeholder.jpg';
import notFoundImage from '../assets/images/Image_not_available.png';
import LetterboxdUrlService from '../services/LetterboxdUrlService.js';
import ErrorLogService from '../services/ErrorLogService.js';
import { sortByAcademyCategoryOrder } from '../assets/javascript/academyAwards.js';

// Same shorthand MovieDetail's ratings table uses, so one vocabulary covers
// both places a criterion score is named.
const CRITERION_LABELS = {
  direction: 'dir',
  imagery: 'img',
  story: 'stry',
  performance: 'perf',
  soundtrack: 'sndtk',
  stickiness: 'stick',
  love: 'love',
  overall: 'ovral'
};

export default {
  props: {
    result: {
      type: Object,
      required: true
    },
    keywordCounts: {
      type: Object,
      required: false
    },
    allCounts: {
      type: Array,
      required: false
    },
    index: {
      type: Number,
      required: true
    },
    resultsAreFiltered: {
      type: Boolean,
      required: false,
      default: false
    },
    sortValue: {
      type: String,
      required: false,
      default: ""
    },
    activeQuickLinkList: {
      type: String,
      required: false,
      default: ""
    }
  },
  data () {
    return {
      getAllRatings,
      showInsetBrowserModal: false,
      insetBrowserUrl: "",
      letterboxdData: null,
      placeholderImage,
      isLoading: false
    }
  },
  components: {
    Modal,
    InsetBrowserModal,
    ToggleableRating
  },
  mounted () {
    // Reset loading state when component mounts (when returning from movie detail)
    this.isLoading = false;
  },
  watch: {
    async showDetailsModal (val) {
      if (val && this.$store.state.settings.letterboxdConnected && this.$store.state.settings.letterboxdUsername) {
        this.checkLetterboxdData();
      }
    }
  },
  computed: {
    // The value this list is sorted by, short enough for an 8px caption.
    // Empty for sorts that already say their own value elsewhere (rating is
    // the number on the right) or have none to say (title).
    sortDetail () {
      const movie = this.topStructure(this.result) || {};
      const rawBudget = movie.budget || 0;
      const rawRevenue = movie.revenue || 0;

      // The caption has to agree with the sort, or a list ordered by today's
      // dollars would be labelled with the original ones. Falls back to the
      // raw figure when a film can't be adjusted (no release date), matching
      // boxOfficeFor in searchFiltering.js. Return on budget is a ratio of
      // two same-year figures and is left unadjusted on purpose.
      const adjusting = this.$store.state.moneyInTodaysDollars;
      const budget = adjusting
        ? (adjustedMovieMoney(movie, 'budget') ?? rawBudget)
        : rawBudget;
      const revenue = adjusting
        ? (adjustedMovieMoney(movie, 'revenue') ?? rawRevenue)
        : rawRevenue;

      switch (this.sortValue) {
        // TMDB's 0 means "we don't know", which is why these show a dash
        // rather than "$0" — see isSortValueUnknown in searchFiltering.js,
        // where the same films sink to the bottom of the sort.
        case 'budget':
          return rawBudget > 0 ? formatMoneyShort(budget) : '—';
        case 'boxOffice':
          return rawRevenue > 0 ? formatMoneyShort(revenue) : '—';
        case 'profit':
          return rawBudget > 0 && rawRevenue > 0 ? formatProfit(budget, revenue) : '—';
        case 'returnPct':
          return rawBudget > 0 && rawRevenue > 0 ? formatReturn(rawBudget, rawRevenue) : '—';
        default:
          break;
      }

      // The eight rating criteria. Abbreviated the way MovieDetail's ratings
      // table already abbreviates them, because a bare "8" next to an 8.44
      // score reads as a second, contradictory rating.
      const label = CRITERION_LABELS[this.sortValue];
      if (!label) return '';
      const score = this.mostRecentRating(this.result)?.[this.sortValue];
      const numeric = parseFloat(score);
      return Number.isFinite(numeric) ? `${label} ${numeric}` : '';
    },
    // Only on the budget sort, and only where the film was deliberately sunk —
    // otherwise a $150M film sitting at the bottom of "most expensive" reads
    // as a bug rather than a decision.
    // The rank answers "where does this sit in my whole library, by score",
    // which is only the question being asked when the list is sorted by score.
    // An empty sortValue is the rating sort (see getSortValue's default).
    showsOverallRank () {
      return !this.sortValue || this.sortValue === 'rating';
    },
    marksNoBoxOffice () {
      return this.sortValue === 'budget' && isModernWithNoBoxOffice(this.result);
    },
    overAllRank () {
      const ranks = this.$store.getters.overallRankByDbKey;
      return (ranks && ranks.get(this.result.dbKey)) || 0;
    },
    previousEntry () {
      return this.$store.getters.allMediaAsArray.find((entry) => {
        return entry.dbKey === this.result.dbKey;
      })
    },
    // Reads the locally-cached, already-normalized FULL Academy Awards
    // dataset (state.allAcademyAwards — see CLAUDE.md's "Full Academy
    // Awards Dataset, Cached Locally") instead of a live per-movie fetch.
    // Being a plain computed also fixes a real latent bug the old fetch-
    // on-modal-open mechanism had: `showDetailsModal`'s watcher used to do
    // `this.awardsData = this.getAwardsData()`, assigning the un-awaited
    // PROMISE (getAwardsData is async) rather than the resolved array, so
    // `Array.isArray(this.awardsData)` was always false and this whole
    // section silently rendered empty for every user, every time.
    awardsForResult () {
      const movieId = String(this.topStructure(this.result).id);
      return (this.$store.state.allAcademyAwards || []).filter((award) => String(award.tmdb) === movieId);
    },
    academyAwardWins () {
      return sortByAcademyCategoryOrder(this.awardsForResult.filter((award) => award.isWinner));
    },
    academyAwardNominations () {
      return sortByAcademyCategoryOrder(this.awardsForResult.filter((award) => !award.isWinner));
    },
    sortedFlatKeywords () {
      return this.topStructure(this.result).flatKeywords.sort((a, b) => {
        return this.keywordCounts[b] - this.keywordCounts[a];
      });
    }
  },
  methods: {
    formatScore,
    async checkLetterboxdData () {
      if (!this.$store.state.settings.letterboxdConnected) {
        return;
      }

      try {
        const movie = this.topStructure(this.result);
        const username = this.$store.state.settings.letterboxdUsername;

        if (!username) {
          console.log('No Letterboxd username provided');
          return;
        }

        // Use the scraping service to get user's film data
        const LetterboxdScrapingService = (await import('../services/LetterboxdScrapingService.js')).default;
        const userData = await LetterboxdScrapingService.getUserData(username);

        // Filter to just this movie's entries
        if (userData && userData.films) {
          const movieEntries = userData.films.filter(film => {
            const normalizedFilmTitle = LetterboxdScrapingService.normalizeMovieTitle(film.title);
            const normalizedSearchTitle = LetterboxdScrapingService.normalizeMovieTitle(movie.title);
            return normalizedFilmTitle === normalizedSearchTitle;
          });

          this.letterboxdData = movieEntries;
        }
      } catch (error) {
        console.error('Failed to get Letterboxd data:', error);
        ErrorLogService.error('Failed to get Letterboxd data:', error);
        this.letterboxdData = null;
      }
    },
    parseNamesToList (names) {
      try {
        if (names.length > 1) {
          return names.map((name) => name.name).join(", ");
        } else {
          return names[0].name;
        }
      } catch (error) {
        console.error('Failed to parse names:', error);
        ErrorLogService.error('Failed to parse names:', error);
        return null;
      }
    },
    sanitizeId (id) {
      id = id || crypto.randomUUID();

      return `movie-${id.replace(/[^a-z0-9\-_:.]/gi, '_')}`;
    },
    updateSearchValue (value) {
      this.$emit('updateSearchValue', value);
    },
    topStructure (result) {
      return result.movie;
    },
    showDetails () {
      if (this.result.falseEntry) {
        this.goToWikipedia(this.result.movie.title);
        return;
      }

      if (this.topStructure(this.result).isPendingReconciliation) {
        this.$router.push(`/reconcile/${this.result.dbKey}`);
        return;
      }

      // Show loading state immediately
      this.isLoading = true;

      // Save current home page state before navigating
      this.$store.commit('setHomePageScrollPosition', window.pageYOffset);
      // We'll need to get search chips and search value from the Home component
      // This will be handled by the Home component when the navigation happens

      // Small delay to ensure loading state renders before navigation
      setTimeout(() => {
        const tmdbId = this.topStructure(this.result).id;
        this.$router.push(`/movie/${tmdbId}`);
      }, 50);
    },
    async goToWikipedia (searchValue) {
      let value;

      if (searchValue) {
        value = searchValue;
      } else {
        value = this.result.movie.title;
      }

      this.insetBrowserUrl = await this.wikiLinkFor(value);
      this.showInsetBrowserModal = true;
    },
    async wikiLinkFor (title) {
      try {
        const wiki = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrnamespace=0&gsrlimit=5&gsrsearch=%27${title}%27`);
        const pages = wiki?.data?.query?.pages;
        if (!pages) return '';
        const pagesArray = Object.keys(pages).map((page) => pages[page]);
        const bestMatch = minBy(pagesArray, (page) => page.index);

        return `https://en.m.wikipedia.org/w/index.php?curid=${bestMatch.pageid}`;
      } catch {
        return ''; // offline/blocked: no unhandled rejection (2026-08-15 audit)
      }
    },
    searchFor (term) {
      this.updateSearchValue(term);

      window.scroll({
        top,
        behavior: 'smooth'
      });

      this.showDetailsModal = false;
    },
    getYear (media) {
      const date = media.movie.release_date;
      return new Date(date).getFullYear();
    },
    prettifyRuntime (result) {
      const minutes = result.movie.runtime;
      return minutes ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : "";
    },
    turnArrayIntoList (array, key) {
      if (!array) {
        return ""
      }

      let arr = [...array];

      if (arr[0][key] && !key) {
        return "";
      }

      if (key && arr[0][key]) {
        arr = arr.map((el) => el[key]);
      }

      if (arr.length > 1) {
        return arr.join(", ");
      } else {
        return arr[0];
      }
    },
    multipleEntries (entry) {
      return entry && entry.length > 1;
    },
    getCrewMember (title, strict) {
      if (!this.topStructure(this.result).crew) {
        return "";
      }

      const crew = this.topStructure(this.result).crew;

      let matches;
      if (strict) {
        matches = crew.filter((member) => member.job === title);
      } else {
        let titles;
        switch (title) {
          case "Writer":
            titles = ["Writer", "Story", "Screenplay", "Author", "Script"];
            break;
          case "Composer":
            titles = ["Composer", "Music", "Score", "Soundtrack"];
            break;
          case "Photo":
            titles = ["Photo", "Cinematographer", "Director of Photography", "Camera Operator"];
            break;
          default:
            titles = [title];
        }
        matches = crew.filter((member) => titles.some(t => member.job.includes(t)));
      }

      const names = matches.map((match) => match.name);

      return names.length ? names : "";
    },
    ratingForMedia (result) {
      return this.mostRecentRating(result).calculatedTotal;
    },
    normalizedRatingForMedia (result) {
      return this.mostRecentRating(result).normalizedRating;
    },
    mostRecentRating (media) {
      // Home pre-scores its entries once per library (see its
      // allEntriesWithFlatKeywordsAdded); a fresh score only when it hasn't.
      return media?._rating || getRating(media);
    },
    getOrdinal (number) {
      return ordinal.toOrdinal(number);
    },
    rateMedia (media) {
      this.$store.commit('setMovieToRate', media);
      window.scroll({ top, behavior: 'smooth' });
      this.showDetailsModal = false;
      this.$router.push('/rate-movie');
    },
    // setMovieToRate CLEARS ratingToEdit, so the target is set after it.
    editRating (index) {
      this.$store.commit('setMovieToRate', this.topStructure(this.result));
      this.$store.commit('setRatingToEdit', { dbKey: this.previousEntry.dbKey, index });
      this.showDetailsModal = false;
      this.$router.push('/rate-movie');
    },
    formattedDate (date) {
      return new Date(date).toLocaleDateString();
    },
    smallFormattedDate (date, endDate) {
      const inputDate = new Date(date);

      if (endDate) {
        const inputEndDate = new Date(endDate);
        if (inputDate.getFullYear() === inputEndDate.getFullYear()) {
          return `${inputDate.getFullYear()}`;
        } else {
          return `${inputDate.getFullYear()} - ${inputEndDate.getFullYear()}`;
        }
      }

      // toLocaleDateString rendered an unparseable date as this string;
      // Intl.DateTimeFormat.format throws on one instead.
      if (Number.isNaN(inputDate.getTime())) return 'Invalid Date';

      const now = new Date();
      const diffInDays = Math.floor((now - inputDate) / (1000 * 60 * 60 * 24));

      // Shared Intl formatters: toLocaleDateString(locale, options) builds a
      // new formatter per call, and a grid of 120 cards calls this twice
      // each on every render - 30ms+ of a keystroke (2026-09-23 sweep).
      if (diffInDays <= 6) {
        return DATE_FORMATS.weekday.format(inputDate);
      } else {
        if (now.getFullYear() === inputDate.getFullYear()) {
          return DATE_FORMATS.monthDay.format(inputDate);
        } else {
          return DATE_FORMATS.monthDayYear.format(inputDate);
        }
      }
    },
    showConfimDeleteButton (previousEntry, index) {
      const deleteButton = document.getElementById(`delete-button-${previousEntry}-${index}`);
      const confirmDeleteButton = document.getElementById(`confirm-delete-button-${previousEntry}-${index}`);

      deleteButton.classList.add('d-none');
      confirmDeleteButton.classList.remove('d-none');
    },
    showDeleteButton (previousEntry, index) {
      const deleteButton = document.getElementById(`delete-button-${previousEntry}-${index}`);
      const confirmDeleteButton = document.getElementById(`confirm-delete-button-${previousEntry}-${index}`);

      deleteButton.classList.remove('d-none');
      confirmDeleteButton.classList.add('d-none');
    },
    deleteRating (previousEntry, index) {
      let scratch = { ...previousEntry };
      scratch.ratings.splice(index, 1);

      if (!scratch.ratings.length) {
        scratch = null;
      }

      // Durable deletion — the setDBValue version was lost offline and the
      // rating came back on reconnect (2026-08-15 offline audit). Partial
      // removals write the ratings leaf; the last one deletes the entry.
      const dbEntry = scratch === null
        ? { path: `movieLog/${previousEntry.dbKey}`, value: null }
        : { path: `movieLog/${previousEntry.dbKey}/ratings`, value: scratch.ratings };

      this.$store.dispatch('writeDurably', dbEntry);
      document.querySelectorAll('.confirm-delete-button').forEach((button) => button.classList.add('d-none'));
      document.querySelectorAll('.delete-button').forEach((button) => button.classList.remove('d-none'));
    },
    countDirector (name) {
      return this.allCounts.directors[name] || 0;
    },
    countCastCrew (name) {
      return this.allCounts.castCrew[name] || 0;
    },
    countGenre (genre) {
      return this.allCounts.genres[genre] || 0;
    },
    countStudios (studio) {
      return this.allCounts.studios[studio] || 0;
    },
    logOnLetterboxd () {
      const movie = this.topStructure(this.result);

      // Check if movie is already logged on Letterboxd
      if (this.isMovieLoggedOnLetterboxd() && this.letterboxdData && this.letterboxdData.length > 0) {
        // Movie is logged - open the movie's Letterboxd page where user can see their diary entries
        const urls = LetterboxdUrlService.generateUrls(movie.title, this.getYear(this.result));

        if (urls && urls.webUrl) {
          // Open the movie's page on Letterboxd - use location.href to avoid white screen on return
          window.location.href = urls.webUrl;
        } else {
          // Fallback: open user's diary page
          const username = this.$store.state.settings.letterboxdUsername;
          if (username) {
            const diaryUrl = `https://letterboxd.com/${username}/films/diary/`;
            window.location.href = diaryUrl;
          }
        }
      } else {
        // Movie not logged - use the log action to open rating/review interface,
        // pre-filling the star rating from Cinema Roll's normalized score.
        const success = LetterboxdUrlService.logMovie(movie.title, this.getYear(this.result), {
          normalizedRating: this.normalizedRatingForMedia(this.result),
          // The date it was actually watched, not today. mostRecentRating is
          // the latest viewing, which is the one being logged when a movie has
          // been seen more than once.
          viewingDate: this.mostRecentRating(this.result)?.date
        });

        if (!success) {
          console.error('Failed to open movie on Letterboxd for logging:', movie.title);
          ErrorLogService.error('Failed to open movie on Letterboxd for logging:', movie.title);
        }
      }
    },
    isMovieLoggedOnLetterboxd () {
      // First check manual overrides
      const movie = this.topStructure(this.result);
      const overrides = this.$store.state.settings.letterboxdOverrides || {};

      // Create override key to match what we use in Settings
      const overrideKey = `${movie.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${this.getYear(this.result)}`;

      if (overrides[overrideKey]) {
        return true; // Manual override says this movie is logged
      }

      // Fall back to automatic detection
      return this.letterboxdData && this.letterboxdData.length > 0;
    },
    getPosterPath (result) {
      // Check if user has selected a custom poster
      return result.customPosterPath || this.topStructure(result).poster_path;
    },
    posterImageUrl (result) {
      const path = this.getPosterPath(result);
      // A placeholder rating (or any entry with no poster path yet) has
      // nothing to append here - fall back to the same "not found" image
      // PickMedia.vue already uses, instead of ".../w342null".
      if (!path) {
        return notFoundImage;
      }
      return `https://image.tmdb.org/t/p/w342${path}`;
    },
    getBackdropPath (result) {
      // Check if user has selected a custom backdrop
      return result.customBackdropPath || this.topStructure(result).backdrop_path;
    }
  }
};
</script>

<style lang="scss">
  .loading-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  .grid-layout-media-result {
    position: relative;

    &.loading {
      pointer-events: none;
      opacity: 0.8;
    }
  }

  .letterboxd-status-button {
    width: 32px;
    height: 32px;
    margin-right: 8px;
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s, border-color 0.2s;
    border: 0;

    &.logged {
      border-color: #28a745;
    }

    &.not-logged {
      border-color: #6c757d;
    }
  }

  .letterboxd-icon {
    width: 24px;
    height: 24px;
    background: none !important;
  }

  .grid-layout-media-result {
    cursor: pointer;
    position: relative;
    transition: transform 90ms ease-out, filter 90ms ease-out;

    // A finger on a poster: the card presses in until the detail page (or
    // the tap's own frame of work) arrives. Bootstrap removes the native tap
    // highlight, so without this a poster tap looked like a miss.
    &:active {
      transform: scale(0.97);
      filter: brightness(0.85);
    }

    &.not-rated {
      filter: sepia(1);
    }

    .details {
      position: absolute;
      width: 100%;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.5);
      color: white;
      font-size: 0.5rem;
      height: 12px;
      display: flex;
      justify-content: space-between;
      padding: 0.5rem;
      align-items: center;
    }

    .no-box-office {
      // Present but quiet: the figure is the message, this only says why the
      // film is where it is.
      font-size: 0.55rem;
      margin-left: 0.2rem;
      opacity: 0.65;
    }

    .pending-match-badge {
      position: absolute;
      top: 4px;
      left: 4px;
      background-color: #ffc107;
      color: #000;
      font-size: 0.55rem;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      z-index: 5;
    }
  }

  .details-modal {
    a {
      color: white;
      cursor: pointer;
    }

    .cinemaroll-modal-content {
      .cinemaroll-modal-header {
        h2 {
          position: absolute;
          font-size: 2rem;
          margin: 0;
          bottom: 0;
          color: white;
          background-color: rgba(0, 0, 0, 0.5);
          padding: 6px 12px;
          right: 0;
        }

        img {
          width: 100%;
          height: 200px;
          object-fit: cover;
        }
      }
    }

    .cinemaroll-modal-body {
      .details-modal-body {
        h4 {
          font-size: 0.75rem;
          margin-bottom: 2px;
        }

        p {
          font-size: 1rem;
          margin-bottom: 1rem;
        }

        .rating-runtime-and-date {
          margin-bottom: 1rem;

          .line-one {
            display: flex;
            justify-content: space-between;

            h3 {
              margin: 0;
            }
          }
        }

        .details-actions {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 1rem;
        }

        .awards {
          .winners,
          .nominees {
            margin-bottom: 1rem;
            display: flex;
            flex-wrap: wrap;
            padding: 6px;
          }
        }

        .long-list {
          max-height: 150px;
          overflow-y: auto;
          padding: 6px;
          box-shadow: inset 0 0 5px -2px rgb(0 0 0 / 50%);

          a {
            white-space: nowrap;

            span {
              display: inline-block;
              text-decoration: none;
            }
          }
        }

        .previous-ratings {
          .accordion-button {
            background-color: white;
            color: black;
            padding: 8px 12px;

            &:focus {
              box-shadow: none;
            }

            &::after {
              display: none;
            }
          }

          .accordion-body {
            padding: 6px;

            table {
              table-layout: fixed;
              width: 100%;

              th {
                span {
                  display: inline-block;
                  font-size: 0.6rem;
                  transform: rotate(60deg);
                }
              }

              td {
                font-size: 0.6rem;
              }
            }
          }

        }
      }
    }

    .small-count-bubble {
      bottom: 3px;
      font-size: 0.5rem;
      position: relative;
    }

    .letterboxd-actions {
      .letterboxd-status {
        .badge {
          font-size: 0.75rem;
          padding: 0.5rem 0.75rem;

          i {
            margin-right: 0.25rem;
          }
        }

        .bg-success {
          background-color: #00e054 !important; // Letterboxd green
        }
      }

      .letterboxd-buttons {
        .btn {
          font-size: 0.7rem;
          padding: 0.375rem 0.5rem;

          i {
            margin-right: 0.25rem;
            font-size: 0.8rem;
          }
        }

        .btn-outline-success {
          border-color: #00e054;
          color: #00e054;

          &:hover {
            background-color: #00e054;
            border-color: #00e054;
          }
        }

        .btn-success {
          background-color: #00e054;
          border-color: #00e054;
        }
      }
    }
  }
</style>