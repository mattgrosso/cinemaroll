<template>
  <div class="rate-movie">
    <div class="rate-movie-header">
      <div class="home-link" @click="returnHome">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-left-fill" viewBox="0 0 16 16">
          <path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
        </svg>
        <span>
          Home
        </span>
      </div>
      <img v-if="rateBannerUrl"
           :src="rateBannerUrl"
           :alt="`${title} backdrop`"
           class="backdrop-image">
      <!-- The heading is the only thing distinguishing an edit from a new
           rating on a screen that otherwise looks identical, and getting that
           wrong means overwriting a viewing you meant to keep. -->
      <h1 class="text-light m-0 px-3 py-2">{{ isEditing ? 'Edit' : 'Rate' }} {{title}}</h1>
    </div>
    <div class="rate-movie-content container-fluid">
      <div class="row p-3">
      <div class="col-12 mb-0">
        <label class="form-label fs-4" for="title">Title</label>
        <input class="form-control" name="title" type="text" id="title" v-model="title">
        <div class="text-end mt-2">
          <button class="btn btn-sm btn-outline-secondary" :disabled="movieContextLoading" @click="getMovieContext">
            <span v-if="movieContextLoading">Thinking...</span>
            <span v-else>More Context</span>
          </button>
        </div>
      </div>

      <div class="col-12 my-3">
        <div class="row g-3">
          <div class="col-3">
            <label class="form-label fs-4" for="year">Year</label>
            <input class="form-control" name="year" id="year" type="text" v-model="year">
          </div>
          <div class="col-4">
            <label class="form-label fs-4" for="medium">Medium</label>
            <select class="form-select" name="medium" id="medium" v-model="medium">
              <option value=""></option>
              <option value="Theater">Theater</option>
              <option value="Physical Media">Physical Media</option>
              <option value="Streaming">Streaming</option>
              <option value="Download">Download</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="col-5">
            <label class="form-label fs-4" for="date">Date</label>
            <input class="form-control" name="date" id="date" type="datetime-local" v-model="date">
          </div>
        </div>
      </div>

      <hr>

      <RatingSelect
        v-for="field in ratingFields"
        :key="field.key"
        v-model="$data[field.key]"
        :name="field.key"
        :label="field.label"
        :description="field.description"
        :options="field.options"
      />

      <hr>

      <div class="col-12 my-3">
        <p class="rating text-center mb-0" id="rating">
          <span class="fw-bold">Rating: {{formatScore(rating.calculatedTotal)}}</span>
          <i class="bi bi-info-circle ms-2" data-bs-toggle="collapse" data-bs-target="#panelsStayOpen-collapseRatingBreakdown" aria-expanded="true" aria-controls="panelsStayOpen-collapseRatingBreakdown"></i>
          <span class="mx-2">|</span>
          <span>#{{indexIfSortedIntoArray(movieAsRatedOnPage, allMoviesRanked) + 1}}/{{numberOfMoviesAfterRating}}</span>
          <span class="mx-2">|</span>
          <span>#{{indexIfSortedIntoArray(movieAsRatedOnPage, moviesRankedFromYear) + 1}} in {{movieYear(movieToRate)}}</span>
        </p>
      </div>

      <div class="rating-breakdown-accordion accordion" id="ratingBreakdownAccordion">
        <div class="accordion-item" >
          <div id="panelsStayOpen-collapseRatingBreakdown" class="accordion-collapse collapse" aria-labelledby="panelsStayOpen-headingRatingBreakdown">
            <div class="accordion-body">
              <table class="table table-striped table-bordered">
                <tbody>
                  <tr v-for="(value, key) in ratingWithoutDate" :key="key">
                    <td>{{ key }}</td>
                    <td>{{ value }}</td>
                    <td>x</td>
                    <td>{{ weights[key] }}</td>
                    <td>=</td>
                    <td>{{ weights[key] * value }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td>{{weightedTotal}}</td>
                  </tr>
                  <tr>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td>Rating</td>
                    <td></td>
                    <td>{{formatScore(rating.calculatedTotal)}}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="best-since">
        <p v-if="lastHigherRatedMovie">
          <span>This is the best movie you've watched since:</span>
          <span class="best-since-movie">
            <strong>{{ lastHigherRatedMovie.title }}</strong>
            <span v-if="lastHigherRatedMovie.date">&nbsp;({{ relativeTime(lastHigherRatedMovie.date) }})</span>
          </span>
        </p>
        <p v-else>
          This is your highest rated movie!
        </p>
      </div>

      <div v-if="movieToRate" class="col-12">
        <div ref="neighbors" class="neighbors" :class="{ unstuck: !neighborsPinned }">
          <!-- A pin, not the up/down arrows this used to show. Those read as a
               sort control - reported as exactly that on 2026-08-21: "I'm
               assuming it's supposed to make that list be sorted ascending or
               descending". Sorting these makes no sense; the strip is
               positional (two above, this film, two below, by rating). What
               the button actually does is pin the strip to the bottom of the
               screen or let it scroll away. -->
          <div
            class="hide-neighbors"
            role="button"
            tabindex="0"
            :title="neighborsPinned ? 'Unpin this strip' : 'Pin this strip to the bottom'"
            :aria-label="neighborsPinned ? 'Unpin this strip' : 'Pin this strip to the bottom'"
            @click="toggleNeighbors"
            @keydown.enter="toggleNeighbors"
            @keydown.space.prevent="toggleNeighbors"
          >
            <i class="bi bi-pin-angle-fill"/>
            <i class="bi bi-pin-angle"/>
          </div>
          <div v-if="neighborTwoAhead" class="neighbor-two-ahead">
            <img :src="posterUrl(neighborTwoAhead.movie, neighborTwoAhead)" :alt="`${neighborTwoAhead.movie.title} poster`">
          </div>
          <div v-if="neighborAhead" class="neighbor-ahead">
            <img :src="posterUrl(neighborAhead.movie, neighborAhead)" :alt="`${neighborAhead.movie.title} poster`">
          </div>
          <div v-if="movieToRate" class="current-movie">
            <img :src="posterUrl(movieToRate, previousEntry)" :alt="`${movieToRate.title} poster`">
          </div>
          <div v-if="neighborBehind" class="neighbor-behind">
            <img :src="posterUrl(neighborBehind.movie, neighborBehind)" :alt="`${neighborBehind.movie.title} poster`">
          </div>
          <div v-if="neighborTwoBehind" class="neighbor-two-behind">
            <img :src="posterUrl(neighborTwoBehind.movie, neighborTwoBehind)" :alt="`${neighborTwoBehind.movie.title} poster`">
          </div>
        </div>
      </div>

      <hr>

      <div class="col-12 my-3 viewing-tags">
        <label class="form-label">Tags for this viewing</label>
        <div class="tag-list d-flex flex-wrap column-gap-2 row-gap-1">
          <div v-for="(tag, index) in viewingTags" :key="index" class="tag-pill-container">
            <span
              class="badge me-1 mb-1 d-inline-flex align-items-center"
              :class="viewingTagChecked(tag) ? 'text-bg-primary' : 'text-bg-secondary'"
              @click="toggleViewingTag(tag)"
              style="cursor: pointer;">
              {{tag.title}}
              <button
                class="btn-close btn-close-white ms-1"
                @click.stop="deleteViewingTag(tag)"
                title="Delete tag"
                style="font-size: 0.5rem; opacity: 0.6;">
              </button>
            </span>
          </div>
        </div>

        <div class="input-group mt-2">
          <input type="text" class="form-control" placeholder="Add new tag" v-model="newViewingTagTitle" @keyup.enter.prevent="addViewingTag">
          <button class="btn btn-outline-primary" type="button" @click.prevent="addViewingTag">
            <i class="bi bi-plus"></i> Add
          </button>
        </div>
      </div>

      <hr>

      <p v-if="submitError" class="text-danger text-center mb-2">{{ submitError }}</p>

      <button
        class="submit-button btn btn-primary col-12 mt-5 mb-4"
        @click.prevent="addRating"
        type="submit"
        value="Submit"
        :disabled="loading"
      >
        <span v-if="!loading">{{ isEditing ? 'Save Changes' : 'Submit' }}</span>
        <span v-if="loading" class="disabled-show spinner-border spinner-border-sm mx-2" role="status" aria-hidden="true"></span>
        <span v-if="loading" class="disabled-show ">{{ isEditing ? 'Saving...' : 'Submiting...' }}</span>
      </button>
    </div>

    <div v-if="getAllRatings(previousEntry)" class="previous-ratings my-3 mb-5 px-4 pt-3 pb-5">
      <label class="fs-4">Previous Viewings</label>
      <div class="accordion" id="previous-ratings-accordion">
        <div class="accordion-item" v-for="(rating, index) in getAllRatings(previousEntry)" :key="index">
          <h2 class="accordion-header" :id="`heading-${index}`">
            <button class="accordion-button px-5" type="button" data-bs-toggle="collapse" :data-bs-target="`#collapse-${index}`" aria-expanded="false" :aria-controls="`collapse-${index}`">
              <div class="col-12 d-flex">
                <p class="col-7 m-0 text-start border-end">
                  <span v-if="rating.date">{{ new Date(rating.date).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) }}</span>
                  <span v-else>-</span>
                </p>
                <p class="col-5 m-0 text-center border-start">{{formatScore(rating.calculatedTotal)}}</p>
              </div>
            </button>
          </h2>
          <div :id="`collapse-${index}`" class="accordion-collapse collapse" :aria-labelledby="`heading-${index}`">
            <div class="accordion-body">
              <table class="table mb-0 col-12 table-striped-columns">
                <thead>
                  <tr>
                    <th class="col-1"><span>dir</span></th>
                    <th class="col-1"><span>img</span></th>
                    <th class="col-1"><span>stry</span></th>
                    <th class="col-1"><span>perf</span></th>
                    <th class="col-1"><span>sndtk</span></th>
                    <th class="col-1"><span>stick</span></th>
                    <th class="col-1"><span>love</span></th>
                    <th class="col-1"><span>ovral</span></th>
                  </tr>
                </thead>
                <tbody>
                  <tr class="table-secondary">
                    <td class="col-1">{{rating.direction}}</td>
                    <td class="col-1">{{rating.imagery}}</td>
                    <td class="col-1">{{rating.story}}</td>
                    <td class="col-1">{{rating.performance}}</td>
                    <td class="col-1">{{rating.soundtrack}}</td>
                    <td class="col-1">{{rating.stickiness}}</td>
                    <td class="col-1">{{rating.love}}</td>
                    <td class="col-1">{{rating.overall}}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      </div><!-- end row -->
    </div><!-- end container-fluid -->

    <!-- Movie Context Modal -->
    <div v-if="movieContext" class="modal fade show d-block" tabindex="-1" style="background-color: rgba(0,0,0,0.5);" @click.self="closeContextModal">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header border-secondary">
            <h5 class="modal-title text-light">{{ title }} ({{ year }})</h5>
            <button type="button" class="btn-close btn-close-white" @click="closeContextModal"></button>
          </div>
          <div class="modal-body">
            <p class="text-light fst-italic mb-3">{{ movieContext }}</p>
            <p class="text-secondary small mb-0">Generated by Claude — take it with a grain of salt.</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Delete Tag Confirmation Modal -->
    <div v-if="showDeleteModal" class="modal fade show d-block" tabindex="-1" style="background-color: rgba(0,0,0,0.5);">
      <div class="modal-dialog modal-sm modal-dialog-centered">
        <div class="modal-content bg-dark text-light">
          <div class="modal-header border-secondary">
            <h5 class="modal-title text-light">Delete Tag</h5>
            <button type="button" class="btn-close btn-close-white" @click="showDeleteModal = false"></button>
          </div>
          <div class="modal-body">
            <p class="text-light">Are you sure you want to delete the tag <strong>"{{ tagToDelete?.title }}"</strong>?</p>
            <p class="text-muted small mb-0">This will remove it from your tag list permanently.</p>
          </div>
          <div class="modal-footer border-secondary">
            <button class="btn btn-secondary" @click="showDeleteModal = false">Cancel</button>
            <button class="btn btn-danger" @click="confirmDeleteTag">Delete Tag</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { formatScore } from '../assets/javascript/formatScore.js';
import addRating from "../assets/javascript/AddRating.js";
import { getRating, getAllRatings } from "../assets/javascript/GetRating.js";
import ErrorLogService from "../services/ErrorLogService.js";
import { postToAi } from '../utils/aiRequest.js';
import { announceLoggedMovie } from '../utils/push.js';
import { isPlaceholderId } from '../utils/placeholderId.js';
import { countViewingTagUsage, sortVocabularyByUsage } from "../utils/tags.js";
import RatingSelect from "./RatingSelect.vue";
import notFoundImage from "../assets/images/Image_not_available.png";

// Option label text for each rating scale, indexed by option value ("0", "1"…).
// The leading empty option is rendered by RatingSelect, not listed here.
const STANDARD_OPTIONS = [
  "0 - Worst in class",
  "1 - Among the worst in class",
  "2 - Terrible",
  "3 - Really Bad",
  "4 - Bad",
  "5 - Average",
  "6 - Good",
  "7 - Great",
  "8 - Incredible",
  "9 - Among the best in class",
  "10 - Best in class"
].map((label, value) => ({ value: String(value), label }));

const LOVE_OPTIONS = [
  "-5 - The worst ever",
  "-4 - One of the worst ever",
  "-3 - I hated it",
  "-2 - I really didn't like it",
  "-1 - I didn't like it",
  "0 - No love",
  "1 - I liked it",
  "2 - I really liked it",
  "3 - A genre favorite",
  "4 - An overall favorite",
  "5 - My favorite"
].map((label, value) => ({ value: String(value), label }));

const STICKINESS_OPTIONS = [
  "0 - If I think of it at all it will be to warn others away",
  "1 - I doubt I'll think of it or recommend it to anyone",
  "2 - I think I'll mention it to some people",
  "3 - I'm going to think about it often and will look for chances to bring it up",
  "4 - This is going to stay with me all the time and I will quote it often",
  "5 - This movie will change the way I think and has expanded what I think movies can be"
].map((label, value) => ({ value: String(value), label }));

// Drives the rating <select> list. `key` matches the same-named data prop the
// select is v-model-bound to (via $data[key]) and the criterion name used by
// the rating math, so order here is the on-screen order.
const RATING_FIELDS = [
  { key: "direction", label: "Direction", description: "Rate the film's directing and editing. Does the film seem to have a consistent and intentional voice?", options: STANDARD_OPTIONS },
  { key: "imagery", label: "Imagery", description: "Rate the film's cinematography, visual effects, production design, costume design, and/or animation.", options: STANDARD_OPTIONS },
  { key: "story", label: "Story", description: "Rate the film's story, screenplay, and writing.", options: STANDARD_OPTIONS },
  { key: "performance", label: "Performance", description: "Rate the performances in the film. In the case of documentaries, rate the interest of the subject matter.", options: STANDARD_OPTIONS },
  { key: "soundtrack", label: "Soundtrack", description: "Rate the film's score, songs, and sound design.", options: STANDARD_OPTIONS },
  { key: "stickiness", label: "Stickiness", description: "How much of a lasting impression do you think the film will have?", options: STICKINESS_OPTIONS },
  { key: "love", label: "Love", description: "The intangible quality of a film that seems to speak to you specifically.", options: LOVE_OPTIONS },
  { key: "overall", label: "Overall", description: "Gut sense of the film's overall rating.", options: STANDARD_OPTIONS }
];

export default {
  components: { RatingSelect },
  data () {
    return {
      // Whether the neighbours strip is pinned to the bottom of the screen.
      // Held in state rather than toggled onto the DOM node through $refs:
      // that made the only evidence of this feature a class mutation no test
      // could see, which is part of how it sat broken for eleven months.
      neighborsPinned: true,
      direction: null,
      imagery: null,
      story: null,
      performance: null,
      soundtrack: null,
      stickiness: null,
      love: null,
      overall: null,
      // datetime-local needs a "T" separator; sv-SE gives "YYYY-MM-DD HH:mm" with
      // a space, which the input rejects (it rendered blank). Swap the space for "T".
      date: new Date().toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'),
      id: null,
      loading: false,
      medium: "",
      newViewingTagTitle: null,
      selectedViewingTags: [],
      title: null,
      year: null,
      getAllRatings,
      dbEntry: null,
      chatGPTKeywords: [],
      movieContext: null,
      movieContextLoading: false,
      showDeleteModal: false,
      tagToDelete: null,
      ratingFields: RATING_FIELDS,
      submitError: null
    }
  },
  mounted () {
    // No scroll-to-top here any more: the router's scrollBehavior does it for
    // every route (2026-08-17), instantly rather than smoothly, and doing it
    // in both places produced a visible double movement. Same removal
    // GamesHub's own workaround got when that policy first landed.
    this.$store.commit("setShowHeader", false);
    this.title = this.movieToRate.title;
    // An offline placeholder (see AddRating.js/placeholderId.js) has no
    // release_date yet - new Date(null).getFullYear() would produce NaN.
    this.year = this.movieToRate.release_date ? new Date(this.movieToRate.release_date).getFullYear() : '';
    this.id = this.movieToRate.id;

    // Amending an existing viewing rather than logging a new one. Bug report
    // 2026-08-25 (Natalie): "I rate a movie and then I don't feel like it's
    // right so I go to rewrite it, so I delete the rating, but then I forget
    // to. It would be nice if you could both delete the rating and edit the
    // rating." Delete-then-retype is the only path today, and the gap between
    // the two steps is where the rating goes missing.
    if (this.editingRating) {
      this.loadRatingForEdit(this.editingRating);
      // Keywords already belong to this viewing; refetching would spend a
      // call to overwrite them with a fresh guess.
      if (!this.chatGPTKeywords.length) this.getChatGPTKeywords();
      return;
    }

    this.getChatGPTKeywords();
  },
  beforeRouteLeave () {
    this.$store.commit("setShowHeader", true);
    document.body.style.overflow = '';
  },
  computed: {
    database () {
      return this.$store.state.movieLog;
    },
    movieToRate () {
      return this.$store.state.movieToRate;
    },
    settings () {
      return this.$store.state.settings;
    },
    rating () {
      const ratingOnPage = {
        ratings: [
          {
            direction: this.direction ? parseFloat(this.direction) : 5,
            imagery: this.imagery ? parseFloat(this.imagery) : 5,
            love: this.love ? parseFloat(this.love) : 5,
            overall: this.overall ? parseFloat(this.overall) : 5,
            performance: this.performance ? parseFloat(this.performance) : 5,
            soundtrack: this.soundtrack ? parseFloat(this.soundtrack) : 5,
            stickiness: this.stickiness,
            story: this.story ? parseFloat(this.story) : 5,
            date: this.date
          }
        ]
      }

      return getRating(ratingOnPage);
    },
    ratingWithoutDate () {
      const { date, calculatedTotal, ...ratingWithoutDate } = this.rating;
      return ratingWithoutDate;
    },
    weights () {
      const weights = {};

      this.$store.state.weights.forEach((weight) => {
        weights[weight.name] = weight.weight;
      })

      return weights;
    },
    weightedTotal () {
      let total = 0;

      for (const key in this.ratingWithoutDate) {
        total += this.ratingWithoutDate[key] * this.weights[key];
      }

      return total;
    },
    movieAsRatedOnPage () {
      return {
        movie: this.movieToRate,
        ratings: [this.rating]
      };
    },
    numberOfMoviesAfterRating () {
      if (this.previousEntry) {
        return this.$store.getters.allMoviesAsArray.length;
      } else {
        return this.$store.getters.allMoviesAsArray.length + 1;
      }
    },
    movieIndex () {
      return this.indexIfSortedIntoArray(this.movieAsRatedOnPage, this.allMoviesRanked);
    },
    neighborAhead () {
      const index = this.movieIndex - 1;
      return index >= 0 ? this.allMoviesRanked[index] : undefined;
    },
    neighborTwoAhead () {
      const index = this.movieIndex - 2;
      return index >= 0 ? this.allMoviesRanked[index] : undefined;
    },
    neighborBehind () {
      const index = this.movieIndex;
      return index < this.allMoviesRanked.length ? this.allMoviesRanked[index] : undefined;
    },
    neighborTwoBehind () {
      const index = this.movieIndex + 1;
      return index < this.allMoviesRanked.length ? this.allMoviesRanked[index] : undefined;
    },
    allMoviesRanked () {
      const movies = [...this.$store.getters.allMoviesAsArray];
      return movies.sort(this.sortByRating);
    },
    moviesRankedFromYear () {
      const moviesFromYear = this.$store.getters.allMoviesAsArray.filter((movie) => {
        return this.movieYear(movie.movie) === this.movieYear(this.movieToRate);
      })

      return moviesFromYear.sort(this.sortByRating);
    },
    previousEntry () {
      return this.$store.getters.allMoviesAsArray.find((entry) => {
        return entry.movie.id === this.id;
      })
    },
    // The existing rating being amended, resolved from { dbKey, index }
    // rather than carried as an object — so it stays the live store copy and
    // can't be saved back over a newer version of itself. Resolves to null
    // (a normal new rating) if the target has since gone.
    editingRating () {
      const target = this.$store.state.ratingToEdit;
      if (!target) return null;
      const entry = this.$store.state.movieLog?.[target.dbKey];
      const rating = entry?.ratings?.[target.index];
      return rating ? { ...target, rating } : null;
    },
    isEditing () {
      return Boolean(this.editingRating);
    },
    viewingTagUsageCounts () {
      return countViewingTagUsage(this.$store.getters.allMoviesAsArray);
    },
    viewingTags () {
      if (!this.settings || !this.settings.tags) {
        return [];
      }
      const vocabulary = Object.values(this.settings.tags["viewing-tags"] || {})
        .filter((tag) => tag && tag.title);
      return sortVocabularyByUsage(vocabulary, this.viewingTagUsageCounts);
    },
    rateBannerUrl () {
      if (this.movieToRate) {
        // Check for custom backdrop in previousEntry
        const backdropPath = this.previousEntry?.customBackdropPath || this.movieToRate.backdrop_path;
        // An offline placeholder has no backdrop_path yet - without this
        // check we'd render ".../w500null" instead of hiding the banner
        // (the template's v-if="rateBannerUrl" already handles `false`).
        if (!backdropPath) {
          return false;
        }
        return `https://image.tmdb.org/t/p/w500${backdropPath}`;
      } else {
        return false;
      }
    },
    databaseTopKey () {
      return this.$store.state.databaseTopKey;
    },
    selectedViewingTagNames () {
      return this.selectedViewingTags.map((tag) => tag.title);
    },
    lastHigherRatedMovie () {
      // Get all movies as array, including the current one as rated on page
      const allMovies = [...this.$store.getters.allMoviesAsArray];
      const current = this.movieAsRatedOnPage;

      // Add current if not already present (by id)
      if (!allMovies.some(entry => entry.movie.id === current.movie.id)) {
        allMovies.push(current);
      }

      // Get current movie's rating
      const currentRating = this.rating.calculatedTotal;
      // Find all movies with higher rating
      const higherRated = allMovies.filter(entry => {
        const entryRating = getRating(entry).calculatedTotal;
        return entryRating > currentRating;
      });

      if (!higherRated.length) return null;

      // Filter out movies without valid dates, then find the most recent
      const moviesWithDates = higherRated.filter(entry => {
        const rating = this.mostRecentRating(entry);
        return rating && rating.date;
      });

      if (!moviesWithDates.length) return null;

      // Find the one with the most recent rating date
      const mostRecent = moviesWithDates.reduce((latest, entry) => {
        return this.toMillis(this.mostRecentRating(entry).date) > this.toMillis(this.mostRecentRating(latest).date) ? entry : latest;
      });

      return {
        title: mostRecent.movie.title,
        date: this.mostRecentRating(mostRecent).date,
        movie: mostRecent.movie
      };
    }
  },
  methods: {
    formatScore,
    movieYear (movie) {
      return new Date(movie.release_date).getFullYear();
    },
    // Rating dates are stored as either epoch millis (number) or a date string.
    // Normalize either to millis for comparison.
    toMillis (date) {
      return typeof date === 'number' ? date : new Date(date).getTime();
    },
    mostRecentRating (movie) {
      if (!movie?.ratings?.length) {
        return null;
      }

      let mostRecentRating = movie.ratings[0];

      movie.ratings.forEach((rating) => {
        if (!mostRecentRating?.date) {
          mostRecentRating = rating;
        } else if (rating.date && this.toMillis(rating.date) > this.toMillis(mostRecentRating.date)) {
          mostRecentRating = rating;
        }
      });

      return mostRecentRating;
    },
    sortByRating (a, b) {
      const aRating = getRating(a).calculatedTotal;
      const bRating = getRating(b).calculatedTotal;

      if (aRating < bRating) {
        return 1;
      }
      if (aRating > bRating) {
        return -1;
      }

      return 0;
    },
    indexIfSortedIntoArray (movie, array) {
      const arr = [...array];
      arr.push(movie);

      arr.sort(this.sortByRating);

      return arr.indexOf(movie);
    },
    async addViewingTag () {
      // Offline audit 2026-08-15: this used to `set()` at the WHOLE
      // `settings` path when the tags map didn't exist yet — which would
      // replace every other setting the user has (awards, curve, games...)
      // with just `{tags}`. Leaf-path durable writes only, ever.
      const existingTags = this.settings.tags?.["viewing-tags"] || {};
      const viewingTagsArray = Object.values(existingTags);
      if (!viewingTagsArray.find((tag) => tag?.title === this.newViewingTagTitle)) {
        const dbKey = `${new Date().getTime()}-${crypto.randomUUID()}`;
        await this.$store.dispatch('writeDurably', {
          path: `settings/tags/viewing-tags/${dbKey}`,
          value: { title: this.newViewingTagTitle }
        });
      }

      this.newViewingTagTitle = null;
    },
    toggleViewingTag (tag) {
      if (this.viewingTagChecked(tag)) {
        this.selectedViewingTags.splice(this.selectedViewingTags.indexOf(tag), 1);
      } else {
        this.selectedViewingTags.push(tag);
      }
    },
    posterUrl (movie, result) {
      // Check if user has selected a custom poster in the result object
      const posterPath = result?.customPosterPath || movie.poster_path;
      // An offline placeholder has no poster_path yet.
      if (!posterPath) {
        return notFoundImage;
      }
      return `https://image.tmdb.org/t/p/w500${posterPath}`;
    },
    // Seed the form from an existing viewing so an edit starts where the
    // rating actually is, not at the defaults. Anything absent falls back to
    // the same 5 the submit path uses, so an old rating missing a criterion
    // doesn't render blank sliders.
    loadRatingForEdit ({ rating }) {
      // Null and undefined are left alone rather than coerced: `stickiness`
      // is legitimately null on a viewing that was never asked, and the
      // submit path passes it through as null too.
      RATING_FIELDS.forEach(({ key }) => {
        if (rating[key] !== undefined && rating[key] !== null) this[key] = rating[key];
      });
      this.medium = rating.medium || '';
      this.selectedViewingTags = Array.isArray(rating.tags) ? [...rating.tags] : [];
      this.chatGPTKeywords = Array.isArray(rating.chatGPTKeywords) ? [...rating.chatGPTKeywords] : [];

      // Stored as an epoch; the datetime-local input wants "YYYY-MM-DDTHH:mm"
      // in LOCAL time. toISOString would be UTC and shows an evening viewing
      // on the previous day (the same trap documented for Letterboxd links).
      if (rating.date) {
        const when = new Date(rating.date);
        if (!Number.isNaN(when.getTime())) {
          this.date = when.toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T');
        }
      }
    },

    async addRating () {
      this.loading = true;
      this.submitError = null;

      let ratings = [];

      if (this.previousEntry?.ratings) {
        ratings = [...this.previousEntry.ratings];
      }

      const rating = {
        chatGPTKeywords: this.chatGPTKeywords,
        date: this.date ? new Date(this.date).getTime() : new Date().getTime(),
        direction: this.direction ? this.direction : 5,
        id: this.id,
        imagery: this.imagery ? this.imagery : 5,
        love: this.love ? this.love : 5,
        medium: this.medium ? this.medium : "Other",
        overall: this.overall ? this.overall : 5,
        performance: this.performance ? this.performance : 5,
        rating: this.rating,
        soundtrack: this.soundtrack ? this.soundtrack : 5,
        stickiness: this.stickiness,
        story: this.story ? this.story : 5,
        tags: this.selectedViewingTags,
        title: this.title,
        year: this.year
      };

      // Editing REPLACES the viewing in place; a new rating is appended.
      // AddRating.js reads only `ratings[0].id` and writes the whole array,
      // so a swapped element travels the same path as an appended one.
      const editing = this.editingRating;
      if (editing && editing.index < ratings.length) {
        // Merge rather than overwrite: fields this form doesn't collect
        // (anything a future rating shape adds, or data written by another
        // screen) would otherwise be dropped by the edit.
        ratings[editing.index] = { ...ratings[editing.index], ...rating };
      } else {
        ratings.push(rating);
      }

      // AddRating.js can throw (e.g. a brand-new movie whose TMDB fetch
      // failed while online, with no local data to fall back to) - surface
      // that instead of leaving the button stuck on "Submitting..." forever.
      let dbEntry;
      try {
        dbEntry = await addRating(ratings);
      } catch (error) {
        console.error('Failed to save rating:', error);
        ErrorLogService.error('Failed to save rating:', error);
        this.loading = false;
        this.submitError = 'Could not save this rating. Please check your connection and try again.';
        return;
      }
      this.dbEntry = dbEntry;

      // A genuinely NEW viewing (never an edit — those replace in place
      // above, and stickiness/tiebreak updates don't come through here at
      // all) announces itself to the push Lambda, which fans out to mutual
      // friends who opted into friend-log notifications. Fire-and-forget:
      // announceLoggedMovie never throws, and a placeholder has no TMDB id
      // for a friend's app to link to, so it stays quiet until reconciled.
      const social = this.$store.getters.socialSettings;
      if (!editing && !isPlaceholderId(this.id) && social?.enabled && this.$store.state.isOnline) {
        const announce = () => announceLoggedMovie({
          tmdbId: this.id,
          title: this.title,
          // The score travels only when ratings are shared — the same
          // opt-in tier that governs what friends see in the app.
          score: social.shareRatings ? getRating(dbEntry.value)?.calculatedTotal : null
        });
        // A friend's Film Club — and the pills on the film's page — render
        // the published profile snapshot, never the rater's live library, so
        // the push and the publish have to go out together, and IN THAT
        // ORDER: the push is what makes a friend open the page, so it leaves
        // only once the snapshot it points at has landed (2026-09-06: Seth's
        // push reached Matt's phone and the page had no rating to show).
        // Publishing on the usual 20-second debounce would lose the timer to
        // returnHome() below plus a phone going back in a pocket. Not
        // awaited: the write is in flight across the route change, which
        // keeps a ~100KB upload out of the transition; the push follows the
        // moment it resolves. A publish that fails withholds the push — a
        // notification for something the club cannot show is worse than no
        // notification (see publishSocialProfileNow).
        Promise.resolve(this.$store.dispatch('publishSocialProfileNow')).then(announce).catch((error) => {
          console.warn('Profile publish failed; friend-log push withheld (non-fatal):', error?.message);
        });
      }

      window.scroll({
        top: 0,
        behavior: 'smooth'
      })

      this.$store.commit("setShowHeader", true);
      this.returnHome();
    },
    returnHome () {
      this.$store.commit("setShowHeader", true);
      // Feature the just-rated movie in the home banner.
      this.$store.commit("setBannerRequest", { type: 'movie', movieId: this.id });
      this.$router.push({ path: '/', query: { movieDbKey: this.dbEntry?.path?.split("movieLog/")[1] } });
    },
    viewingTagChecked (tag) {
      if (!this.selectedViewingTagNames) {
        return false;
      }

      return this.selectedViewingTagNames.includes(tag.title);
    },
    deleteViewingTag (tag) {
      this.tagToDelete = tag;
      this.showDeleteModal = true;
    },
    confirmDeleteTag () {
      if (!this.tagToDelete) return;

      const tag = this.tagToDelete;

      if (this.settings.tags && this.settings.tags["viewing-tags"]) {
        const tagKey = Object.keys(this.settings.tags["viewing-tags"]).find(
          (key) => this.settings.tags["viewing-tags"][key].title === tag.title
        );
        if (tagKey) {
          delete this.settings.tags["viewing-tags"][tagKey];
          // Leaf-path durable deletion — the whole-map setDBValue was lost
          // offline, resurrecting the tag on reconnect (2026-08-15 audit).
          this.$store.dispatch('writeDurably', {
            path: `settings/tags/viewing-tags/${tagKey}`,
            value: null
          });
        }
      }

      if (this.selectedViewingTagNames && this.selectedViewingTagNames.includes(tag.title)) {
        this.selectedViewingTags = this.selectedViewingTags.filter((t) => t.title !== tag.title);
      }

      this.showDeleteModal = false;
      this.tagToDelete = null;
    },
    async getMovieContext () {
      this.movieContextLoading = true;
      this.movieContext = null;
      try {
        const response = await postToAi('/context', { title: this.title, year: this.year });
        this.movieContext = response.data.context;
      } catch {
        this.movieContext = 'Could not load context. Please try again.';
      } finally {
        this.movieContextLoading = false;
        // The context modal is now showing (with either the result or an error
        // message), so lock body scroll behind it. closeContextModal() clears it.
        document.body.style.overflow = 'hidden';
      }
    },
    closeContextModal () {
      this.movieContext = null;
      document.body.style.overflow = '';
    },
    async getChatGPTKeywords () {
      try {
        const title = this.movieToRate.title;
        const year = this.movieToRate.release_date ? new Date(this.movieToRate.release_date).getFullYear() : "";

        const response = await postToAi('/keywords', { title, year });

        this.chatGPTKeywords = response.data.keywords || [];
      } catch (error) {
        console.error('Failed to fetch keywords:', error);
        ErrorLogService.error("Failed to fetch keywords", { error });
        this.chatGPTKeywords = [];
      }
    },
    toggleNeighbors () {
      this.neighborsPinned = !this.neighborsPinned;
    },
    // Returns a human-friendly relative time string for a given timestamp
    relativeTime (date) {
      if (!date) return '';
      const now = Date.now();
      const then = typeof date === 'string' ? new Date(date).getTime() : date;
      const diff = now - then;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      const months = Math.floor(days / 30);
      const years = Math.floor(days / 365);
      if (seconds < 60) return 'just now';
      if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
      if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
      if (days === 1) return 'yesterday';
      if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
      if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
      return `${years} year${years === 1 ? '' : 's'} ago`;
    },
  },
}
</script>

<style lang="scss">
  .rate-movie {
    .rate-movie-header {
      position: relative;
      height: 200px;
      overflow: hidden;

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
        background-color: #000000a3;
        bottom: 0;
        position: absolute;
      }

      .backdrop-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .rate-movie-content {
      margin: 0 auto;
      max-width: 650px;
    }

    // Form controls must never exceed their grid column. Inputs/selects have a
    // UA-imposed intrinsic minimum width (datetime-local is the worst offender —
    // it reserves room for "MM/DD/YYYY, --:-- --"); in a narrow column that
    // min-width beats `width: 100%` and the field's box pokes past the right
    // edge of the screen. On the iOS PWA that sideways overflow latches the
    // layout viewport wider than the screen, which then makes every page stop
    // short of the bottom. min-width:0 lets them shrink to the column instead.
    .form-control,
    .form-select {
      min-width: 0;
      max-width: 100%;
    }

    .rating {
      i {
        cursor: pointer;
      }
    }

    .best-since {
      padding: 0.5rem;

      span {
        display: block;
      }

      .best-since-movie {
        display: flex;
        justify-content: center;
        align-items: center;
      }
    }

    .neighbors {
      align-items: center;
      background: #212529;
      border-bottom: 1px solid white;
      border-top: 1px solid white;
      display: flex;
      justify-content: space-between;
      margin: 0 -1rem; /* Extend to edges, counteracting parent p-3 padding */
      padding: 6px;
      /* Pinned to the bottom of the viewport while you scroll the form, so
         where this film sits against its neighbours stays visible the whole
         time you're moving sliders. That is the entire point of the strip, and
         of the pin button.
         Restored 2026-08-21: "Cleans up layout for rate movie form" (6020426,
         2025-09-06) swapped this for `position: relative` during a 267-line
         refactor. That silently made the pin button a no-op — `.unstuck` below
         sets `position: relative` too, so both of its states were identical
         and only the icon changed. It stayed that way for eleven months, until
         a bug report: "I press this little up/down arrow... it doesn't do
         anything." The toggle was left in place by that commit, which is what
         makes it collateral rather than a decision. */
      bottom: 0;
      position: sticky;

      &.unstuck {
        /* Released: back into normal flow, scrolling away with the page.
           `bottom` has to be cleared too, or it lingers as an offset. */
        bottom: auto;
        position: relative;

        .bi-pin-angle-fill {
          display: none;
        }

        .bi-pin-angle {
          display: block;
        }
      }

      .bi-pin-angle {
        display: none;
      }

      .bi-pin-angle-fill {
        display: block;
      }

      .hide-neighbors {
        cursor: pointer;
        position: absolute;
        right: 10px;
        top: 3px;
      }

      .neighbor-two-ahead,
      .neighbor-ahead,
      .neighbor-behind,
      .neighbor-two-behind {
        width: 18%;
        padding: 0 2px;
      }

      .current-movie {
        width: 28%;
        padding: 0 2px;
      }

      img {
        max-width: 100%;
      }
    }

    .rating-breakdown-accordion {
      .accordion-item {
        border: 0;

        .accordion-collapse.show {
          margin-bottom: 1rem;
        }
      }

      table {
        font-size: 0.75rem;

        td:nth-child(1) {
          text-align: right;
        }

        tfoot {
          td {
            font-weight: bold;
          }
        }
      }
    }

    .submit-button {
      &[disabled] {
        .disabled-show {
          display: inline-block;
        }
      }

      .disabled-show {
        display: none;
      }
    }

    .previous-ratings {
      .accordion-button {
        background-color: white;
        color: black;

        &:focus {
          box-shadow: none;
        }
      }

      table {
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

  .bg-dark {
    .rate-movie {
      color: white;
    }
  }
</style>