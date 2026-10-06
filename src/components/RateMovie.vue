<template>
  <div class="rate-movie" :class="{ 'rate-movie-saving': loading }">
    <!-- Hero, matching the film page (2026-09-30 redesign): the same backdrop
         size, so arriving from a film's page reuses the image it just loaded. -->
    <div class="rate-movie-header">
      <div class="home-link" role="button" aria-label="Back to Home" @click="returnHome">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-left-fill" viewBox="0 0 16 16">
          <path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
        </svg>
        <span>Home</span>
      </div>
      <img v-if="rateBannerUrl"
           :src="rateBannerUrl"
           :alt="`${title} backdrop`"
           class="backdrop-image">
      <!-- The heading is the only thing distinguishing an edit from a new
           rating on a screen that otherwise looks identical, and getting that
           wrong means overwriting a viewing you meant to keep. -->
      <!-- The title sits on a fade across the whole bottom of the backdrop,
           large and left-aligned (bug report 2026-10-02: "I would like the
           title to be more prominently displayed"); it used to be a small
           translucent box in the bottom-right corner. -->
      <!-- The title and year are quietly editable (bug report 2026-10-06):
           the Title box that used to sit under the tiles only repeated the
           header, so it went, and a tap on either piece of the header swaps
           it for a look-alike input. Return or tapping away keeps the edit;
           a blank title falls back to the one it had. The year sits at the
           right end of the title's last line. -->
      <h1 class="rate-title">
        <span class="rate-kicker">{{ isEditing ? 'Edit rating' : 'Rate' }}</span>
        <span class="rate-title-row">
          <input v-if="headerEditing === 'title'"
                 ref="headerTitleInput"
                 v-model="headerDraft"
                 class="rate-title-input rate-title-text-input"
                 type="text"
                 aria-label="Title"
                 @keydown.enter.prevent="$event.target.blur()"
                 @keydown.esc="cancelHeaderEdit"
                 @blur="commitHeaderEdit">
          <span v-else class="rate-title-text" @click="startHeaderEdit('title')">{{ title }}</span>
          <input v-if="headerEditing === 'year'"
                 ref="headerYearInput"
                 v-model="headerDraft"
                 class="rate-title-input rate-title-year-input"
                 type="text"
                 inputmode="numeric"
                 aria-label="Year"
                 @keydown.enter.prevent="$event.target.blur()"
                 @keydown.esc="cancelHeaderEdit"
                 @blur="commitHeaderEdit">
          <!-- Rendered even with no year, as an empty tap target, so a film
               with no release date can still be given one. -->
          <span v-else class="rate-title-year" :class="{ 'rate-title-year-empty': !year }" @click="startHeaderEdit('year')">{{ year }}</span>
        </span>
      </h1>
    </div>

    <div class="rate-movie-content" data-bs-theme="dark">
      <!-- One row of three tiles: the watch date, the medium, and More
           context. The score used to lead this row, but you want it once
           you've answered the questions, so it lives in the score card at
           the bottom of the form (bug report 2026-10-02). The date tile is a
           real datetime-local input laid invisibly over the tile, so a tap
           opens the phone's own picker. -->
      <div class="rate-actions">
        <label class="fact fact-date" for="date">
          <span class="fact-value">{{ watchedDay }}</span>
          <span class="fact-label">{{ watchedLabel }}</span>
          <input class="fact-overlay-input" name="date" id="date" type="datetime-local" v-model="date">
        </label>
        <!-- Empty, the tile has to read as a field to fill in (bug report
             2026-10-01: "doesn't look like a button I need to click on"):
             dashed green outline, "Choose" and a down arrow. Chosen, it
             shows the medium. Either way it is labelled Medium underneath. -->
        <label class="action-tile action-medium" :class="{ 'needs-choice': !medium }" for="medium">
          <i class="bi bi-film"></i>
          <span v-if="medium" class="medium-value">{{ medium }}</span>
          <span v-else class="medium-prompt">Choose <i class="bi bi-chevron-down"></i></span>
          <span class="medium-label">Medium</span>
          <select class="fact-overlay-input" name="medium" id="medium" v-model="medium">
            <option value=""></option>
            <option value="Theater">Theater</option>
            <option value="Physical Media">Physical Media</option>
            <option value="Streaming">Streaming</option>
            <option value="Download">Download</option>
            <option value="Other">Other</option>
          </select>
        </label>
        <button type="button" class="action-tile" :disabled="movieContextLoading" @click="getMovieContext">
          <i class="bi bi-chat-square-text"></i>
          <span>{{ movieContextLoading ? 'Thinking…' : 'More context' }}</span>
        </button>
      </div>

      <p class="band-title">Your rating</p>

      <RatingSelect
        v-for="field in ratingFields"
        :key="field.key"
        v-model="$data[field.key]"
        :name="field.key"
        :label="field.label"
        :description="field.description"
        :options="field.options"
      />

      <!-- The score, where you land after answering the questions (bug
           report 2026-10-02: "The place where I wanna see the rating is when
           I get to the bottom of the form"): the number, where it ranks, and
           how it compares. The arithmetic is folded away underneath.
           Nothing picked yet, it shows dashes: every unpicked criterion
           counts as 5, so a blank form would claim a score you never gave
           (bug report 2026-10-02: "I haven't even given any of its ratings
           yet"). -->
      <div class="score-card" :class="{ 'score-card-empty': !hasPicks }">
        <span class="score-card-label">Your score</span>
        <span class="score-card-value">{{ hasPicks ? formatScore(rating.calculatedTotal) : '–' }}</span>
        <span v-if="!hasPicks" class="score-card-waiting">Not rated yet</span>
        <span v-if="hasPicks && scoreChange" class="score-card-change" :class="scoreChange.direction">
          <i class="bi" :class="scoreChange.icon"></i>{{ scoreChange.text }}
        </span>
        <div class="score-card-ranks">
          <div class="score-card-rank score-rank-overall">
            <span class="score-rank-value">{{ hasPicks ? `#${(movieIndex + 1).toLocaleString('en-US')}` : '–' }}</span>
            <span class="score-rank-label">of {{ numberOfMoviesAfterRating.toLocaleString('en-US') }} overall</span>
          </div>
          <div class="score-card-rank score-rank-year">
            <span class="score-rank-value">{{ hasPicks && releaseYearKnown ? `#${yearIndex + 1}` : '–' }}</span>
            <span class="score-rank-label">{{ releaseYearKnown ? `in ${movieYear(movieToRate)}` : 'in its year' }}</span>
          </div>
        </div>
        <p v-if="hasPicks" class="score-card-since">
          <template v-if="lastHigherRatedMovie">
            The best movie you've watched since
            <strong>{{ lastHigherRatedMovie.title }}</strong><template v-if="lastHigherRatedMovie.date">, {{ relativeTime(lastHigherRatedMovie.date) }}</template>.
          </template>
          <template v-else>
            This would be your highest rated movie.
          </template>
        </p>
      </div>

      <!-- The rows come from ratingMath.js, the same rows the score is built
           from, so the table always lands on the score above it. Closed, it
           says nothing: the card already shows the score, and the division
           on the closed line was "not helpful" (2026-10-02). -->
      <DetailSection id="rate.breakdown" label="How it's scored" tone="you">
        <table class="breakdown-table">
          <tbody>
            <tr v-for="row in breakdownRows" :key="row.key">
              <td class="breakdown-name">{{ row.key }}</td>
              <td>{{ row.value }}</td>
              <td class="breakdown-op">×</td>
              <td>{{ row.weight }}</td>
              <td class="breakdown-op">=</td>
              <td class="breakdown-product">{{ formatScore(row.product) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td class="breakdown-name" colspan="5">Total</td>
              <td class="breakdown-product">{{ hasPicks ? formatScore(breakdown.sum) : '–' }}</td>
            </tr>
            <tr>
              <td class="breakdown-name" colspan="5">÷ 10 = Rating</td>
              <td class="breakdown-product">{{ hasPicks ? formatScore(rating.calculatedTotal) : '–' }}</td>
            </tr>
          </tfoot>
        </table>
      </DetailSection>

      <p class="band-title">Tags for this viewing</p>
      <div class="viewing-tags">
        <div class="tag-list">
          <span
            v-for="tag in viewingTags"
            :key="tag.title"
            class="tag-pill"
            :class="{ selected: viewingTagChecked(tag) }"
            role="button"
            tabindex="0"
            :aria-pressed="viewingTagChecked(tag) ? 'true' : 'false'"
            @click="toggleViewingTag(tag)"
            @keydown.enter="toggleViewingTag(tag)">
            <i v-if="viewingTagChecked(tag)" class="bi bi-check-lg"></i>
            {{tag.title}}
            <button
              type="button"
              class="tag-delete"
              @click.stop="deleteViewingTag(tag)"
              :aria-label="`Delete tag ${tag.title}`"
              title="Delete tag">
              <i class="bi bi-x"></i>
            </button>
          </span>
        </div>

        <div class="tag-add">
          <input type="text" class="form-control" placeholder="Add a new tag" v-model="newViewingTagTitle" @keyup.enter.prevent="addViewingTag">
          <button class="tag-add-button" type="button" :disabled="!newViewingTagTitle" @click.prevent="addViewingTag">
            <i class="bi bi-plus-lg"></i> Add
          </button>
        </div>
      </div>

      <p v-if="submitError" class="submit-error">{{ submitError }}</p>

      <button
        class="submit-button"
        @click.prevent="addRating"
        type="submit"
        value="Submit"
        :disabled="loading"
      >
        <span v-if="!loading">{{ isEditing ? 'Save Changes' : 'Submit' }}</span>
        <span v-if="loading" class="disabled-show spinner-border spinner-border-sm mx-2" role="status" aria-hidden="true"></span>
        <span v-if="loading" class="disabled-show ">{{ isEditing ? 'Saving…' : 'Submitting…' }}</span>
      </button>

      <DetailSection
        v-if="previousViewings.length"
        id="rate.previousViewings"
        class="previous-ratings"
        label="Viewings"
        tone="you"
        :summary="previousViewingsSummary">
        <div v-for="(viewing, index) in previousViewings" :key="index" class="previous-viewing">
          <div class="previous-viewing-head">
            <span>{{ viewing.date ? shortDate(viewing.date) : 'No date' }}</span>
            <strong>{{formatScore(viewing.calculatedTotal)}}</strong>
          </div>
          <div class="previous-viewing-grid">
            <div v-for="criterion in previousCriteria" :key="criterion.key" class="previous-cell">
              <span class="previous-cell-label">{{ criterion.short }}</span>
              <span class="previous-cell-value">{{ viewing[criterion.key] ?? '–' }}</span>
            </div>
          </div>
        </div>
      </DetailSection>

      <!-- Three above, this film, three below, by rating. Last, so the sticky
           strip has the whole form to ride along over. -->
      <div v-if="movieToRate" ref="neighbors" class="neighbors" :class="{ unstuck: !neighborsPinned }">
        <!-- Cover Flow (2026-10-02): the film being rated faces you in the
             middle, and its neighbours turn closer to edge-on the further out
             they sit. Every poster is positioned from the centre, so the film
             stays centred when one side runs short near the top or bottom of
             the rankings.
             DOM order is the neighbours in rank order with this film LAST, on
             purpose: as a score moves the film past a neighbour, no element
             changes place in the DOM, so each poster's transform transitions
             (slides and turns) instead of being re-inserted and jumping. -->
        <div :ref="observeStage" class="neighbor-posters" :style="{ height: `${coverFlowLayout.height}px` }">
          <div
            v-for="poster in coverFlow"
            :key="poster.key"
            class="neighbor"
            :class="{ 'current-movie': poster.offset === 0 }"
            :data-offset="poster.offset"
            :style="coverFlowStyle(poster.offset)"
          >
            <img :src="posterUrl(poster.movie, poster.result)" :alt="`${poster.movie.title} poster`">
          </div>
        </div>
        <!-- A pin, not the up/down arrows this used to show. Those read as a
             sort control - reported as exactly that on 2026-08-21: "I'm
             assuming it's supposed to make that list be sorted ascending or
             descending". Sorting these makes no sense; the strip is
             positional (films above, this film, films below). What
             the button actually does is pin the strip to the bottom of the
             screen or let it scroll away. Since 2026-10-04 it floats small
             over the strip's top-right corner instead of taking a slot at the
             end of the row ("the pin icon is way too big over there now"),
             so Cover Flow gets the full width. -->
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
      </div>
    </div>

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
            <p class="modal-note small mb-0">Generated by Claude — take it with a grain of salt.</p>
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
            <!-- #ccc, not .text-muted: Bootstrap's grey fails on this dark panel. -->
            <p class="modal-note small mb-0">This will remove it from your tag list permanently.</p>
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
import { ratingBreakdown } from "../assets/javascript/ratingMath.js";
import ErrorLogService from "../services/ErrorLogService.js";
import { postToAi } from '../utils/aiRequest.js';
import { announceLoggedMovie } from '../utils/push.js';
import { isPlaceholderId } from '../utils/placeholderId.js';
import { countViewingTagUsage, sortVocabularyByUsage } from "../utils/tags.js";
import RatingSelect from "./RatingSelect.vue";
import DetailSection from "./DetailSection.vue";
import notFoundImage from "../assets/images/Image_not_available.png";
import { coverFlowLayout, coverFlowPose, neighborWindow } from "../assets/javascript/rankNeighbors.js";

const NEIGHBORS_PER_SIDE = 3;

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

// The previous-viewings grid, in the order the old table's columns ran.
const PREVIOUS_CRITERIA = [
  { key: "direction", short: "Dir" },
  { key: "imagery", short: "Img" },
  { key: "story", short: "Story" },
  { key: "performance", short: "Perf" },
  { key: "soundtrack", short: "Sound" },
  { key: "stickiness", short: "Stick" },
  { key: "love", short: "Love" },
  { key: "overall", short: "Overall" }
];

export default {
  components: { RatingSelect, DetailSection },
  data () {
    return {
      // Whether the neighbours strip is pinned to the bottom of the screen.
      // Held in state rather than toggled onto the DOM node through $refs:
      // that made the only evidence of this feature a class mutation no test
      // could see, which is part of how it sat broken for eleven months.
      neighborsPinned: true,
      // The Cover Flow stage's measured width (px); 0 until measured, which
      // lays it out for a phone. See `observeStage`.
      stageWidth: 0,
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
      headerEditing: null,
      headerDraft: '',
      dbEntry: null,
      chatGPTKeywords: [],
      movieContext: null,
      movieContextLoading: false,
      showDeleteModal: false,
      tagToDelete: null,
      ratingFields: RATING_FIELDS,
      previousCriteria: PREVIOUS_CRITERIA,
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
    // The score's own arithmetic, row by row (ratingMath.js). Reading the
    // page's raw values instead made the table disagree with the score: an
    // unset Stickiness counts as 1 in the score, and the ÷ 10 was never
    // shown (bug report 2026-10-01: "45.25, which doesn't make any sense").
    breakdown () {
      return ratingBreakdown(this.rating, (name) => this.weights[name]);
    },
    // In the on-screen order of the rating selects.
    breakdownRows () {
      const byKey = {};
      for (const row of this.breakdown.rows) byKey[row.key] = row;
      return RATING_FIELDS.map((field) => byKey[field.key]);
    },
    weights () {
      const weights = {};

      this.$store.state.weights.forEach((weight) => {
        weights[weight.name] = weight.weight;
      })

      return weights;
    },
    weightedTotal () {
      return this.breakdown.sum;
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
    yearIndex () {
      return this.indexIfSortedIntoArray(this.movieAsRatedOnPage, this.moviesRankedFromYear);
    },
    // An offline placeholder has no release date, and new Date(null) is
    // 1970 — the year tile would rank it among the films of 1970.
    releaseYearKnown () {
      return Boolean(this.movieToRate?.release_date);
    },
    watchedAt () {
      const when = this.date ? new Date(this.date) : null;
      return when && !Number.isNaN(when.getTime()) ? when : null;
    },
    watchedDay () {
      return this.watchedAt ? this.watchedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Today';
    },
    watchedLabel () {
      if (!this.watchedAt || this.watchedAt.getFullYear() === new Date().getFullYear()) return 'watched';
      return `watched ${this.watchedAt.getFullYear()}`;
    },
    // The score before this visit: the viewing being edited, or the film's
    // latest score when it's being rated again. Null for a first rating.
    previousScore () {
      if (this.isEditing) return getRating({ ratings: [this.editingRating.rating] })?.calculatedTotal ?? null;
      if (this.previousEntry) return getRating(this.previousEntry)?.calculatedTotal ?? null;
      return null;
    },
    // Whether any criterion has been picked. Until one is, the score is
    // made of nothing but defaults, so the card holds back its numbers.
    hasPicks () {
      return RATING_FIELDS.some(({ key }) => this[key] !== null && this[key] !== '');
    },
    scoreChange () {
      if (this.previousScore == null) return null;
      const delta = Number((this.rating.calculatedTotal - this.previousScore).toFixed(4));
      const since = this.isEditing ? 'before this edit' : 'last time';
      if (Math.abs(delta) < 0.005) return { direction: 'same', icon: 'bi-dash', text: `Same as ${since}` };
      const up = delta > 0;
      return {
        direction: up ? 'up' : 'down',
        icon: up ? 'bi-arrow-up-short' : 'bi-arrow-down-short',
        text: `${formatScore(Math.abs(delta))} ${up ? 'higher' : 'lower'} than ${since}`
      };
    },
    previousViewings () {
      return getAllRatings(this.previousEntry) || [];
    },
    previousViewingsSummary () {
      const count = this.previousViewings.length;
      return `${count} logged`;
    },
    // The films either side of where this rating lands. A film being
    // re-rated is left out, or its own old entry would sit in the strip
    // next to it.
    neighbors () {
      const ranked = this.previousEntry
        ? this.allMoviesRanked.filter((entry) => entry !== this.previousEntry)
        : this.allMoviesRanked;
      const ownOldRank = this.previousEntry ? this.allMoviesRanked.indexOf(this.previousEntry) : -1;
      const insertAt = ownOldRank !== -1 && ownOldRank < this.movieIndex ? this.movieIndex - 1 : this.movieIndex;
      return neighborWindow(ranked, insertAt, NEIGHBORS_PER_SIDE);
    },
    // The strip's posters with their place relative to this film (negative
    // above, positive below), neighbours in rank order and this film last —
    // see the template for why it's last.
    coverFlow () {
      const { ahead, behind } = this.neighbors;
      const neighbor = (entry, offset) => ({ key: entry.movie.id, movie: entry.movie, result: entry, offset });
      return [
        ...ahead.map((entry, i) => neighbor(entry, i - ahead.length)),
        ...behind.map((entry, i) => neighbor(entry, i + 1)),
        { key: "current", movie: this.movieToRate, result: this.previousEntry, offset: 0 },
      ];
    },
    // Poster sizes and poses sized to the stage's width, so the strip fills it
    // (2026-10-04: it "doesn't use enough of the space").
    coverFlowLayout () {
      return coverFlowLayout(this.stageWidth);
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
        // w1280, the film page's size: arriving from there, it's already cached.
        return `https://image.tmdb.org/t/p/w1280${backdropPath}`;
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
    startHeaderEdit (field) {
      if (this.headerEditing) return;
      this.headerDraft = this[field] == null ? '' : String(this[field]);
      this.headerEditing = field;
      this.$nextTick(() => {
        const input = this.$refs[field === 'title' ? 'headerTitleInput' : 'headerYearInput'];
        if (input) {
          input.focus();
          input.select();
        }
      });
    },
    commitHeaderEdit () {
      const field = this.headerEditing;
      if (!field) return;
      const value = String(this.headerDraft).trim();
      // A blank title would save a nameless viewing; keep the old one.
      if (field === 'title' && !value) {
        this.headerEditing = null;
        return;
      }
      this[field] = value;
      this.headerEditing = null;
    },
    cancelHeaderEdit () {
      this.headerEditing = null;
    },
    formatScore,
    shortDate (date) {
      return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },
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
    // Function ref on the Cover Flow stage: watch its width so the posters
    // spread to its edges. Called with the element on mount, null on unmount.
    observeStage (el) {
      if (el === this.observedStage) return;
      this.stageObserver?.disconnect();
      this.observedStage = el;
      if (!el || typeof ResizeObserver === 'undefined') return;
      this.stageObserver = new ResizeObserver(([entry]) => {
        this.stageWidth = Math.round(entry.contentRect.width);
      });
      this.stageObserver.observe(el);
    },
    coverFlowStyle (offset) {
      const layout = this.coverFlowLayout;
      const pose = coverFlowPose(offset, layout);
      return {
        width: `${offset === 0 ? layout.current : layout.poster}px`,
        opacity: pose.opacity,
        transform: `translate(-50%, -50%) translateX(${pose.x}px) translateZ(${pose.z}px) rotateY(${pose.angle}deg)`,
        zIndex: pose.layer,
      };
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
@import '@/assets/scss/detail-scale';
  /* 2026-09-30: restyled in the film page's language (Matt: "take the styling
     changes that we've made other places, especially the ones recently in
     the movie detail page, and apply a similar redesign to the rate a movie
     page"). Dark tiles at rgba(255,255,255,.06), uppercase .62rem labels in
     #ccc, folded DetailSection rows, :active press states only. */
  .rate-movie {
    @include detail-scale-root;
    color: #fff;

    .rate-movie-header {
      position: relative;
      height: 200px;
      overflow: hidden;

      .home-link {
        align-items: center;
        color: white;
        column-gap: 4px;
        cursor: pointer;
        display: flex;
        left: 12px;
        position: absolute;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
        top: 12px;
        z-index: 10;

        &:active { opacity: 0.6; }
      }

      /* Full-width fade rather than a corner box, so a bright backdrop
         still gives the white title a near-black ground: the bottom stop is
         .85 black, and the text shadow covers the lighter top of the fade. */
      .rate-title {
        background: linear-gradient(to bottom, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.6) 45%, rgba(0, 0, 0, 0.85) 100%);
        bottom: 0;
        color: #fff;
        font-size: ds(2.3rem);
        font-weight: 700;
        left: 0;
        line-height: 1.1;
        margin: 0;
        overflow-wrap: anywhere;
        padding: 40px 14px 10px;
        position: absolute;
        right: 0;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9), 0 0 12px rgba(0, 0, 0, 0.6);
      }

      .rate-title-text {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }

      .rate-kicker {
        color: #6fd39b;
        display: block;
        font-size: ds(0.75rem);
        font-weight: 700;
        letter-spacing: 0.08em;
        margin-bottom: 2px;
        text-transform: uppercase;
      }

      /* Title and year share a line: the year rides the right edge,
         level with the title's last line. */
      .rate-title-row {
        align-items: flex-end;
        column-gap: 12px;
        display: flex;
      }

      .rate-title-text,
      .rate-title-text-input {
        flex: 1 1 auto;
        min-width: 0;
      }

      .rate-title-year,
      .rate-title-year-input {
        color: #ddd;
        flex: 0 0 auto;
        font-size: ds(1rem);
        font-weight: 400;
        padding-bottom: 0.2em;
      }

      /* No year: an invisible but tappable spot at the right edge. */
      .rate-title-year-empty {
        min-height: 1.4em;
        min-width: 3em;
      }

      /* The editors wear the header's own type, so a tap reads as the text
         becoming editable rather than a form appearing. A faint underline
         is the only tell. */
      .rate-title-input {
        background: transparent;
        border: 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.45);
        border-radius: 0;
        color: inherit;
        font-family: inherit;
        line-height: inherit;
        margin: 0;
        outline: none;
        padding: 0;
        text-shadow: inherit;
      }

      .rate-title-text-input {
        font-size: inherit;
        font-weight: inherit;
      }

      .rate-title-year-input {
        text-align: right;
        width: 3.2em;
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
      /* No bottom padding: the pinned neighbours strip is the last thing on
         the page and has to reach the bottom edge. */
      padding: 1rem 1rem 0;
    }

    // Form controls must never exceed their container. Inputs/selects have a
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

    .rate-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin: 0 0 14px;
    }

    .fact,
    .action-tile {
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border: 0;
      border-radius: 6px;
      color: #fff;
      display: flex;
      flex-direction: column;
      justify-content: center;
      margin: 0;
      min-width: 0;
      /* Contains the invisible overlay input below, so its UA minimum width
         can't leak into the page's scroll width (see the form-control note). */
      overflow: hidden;
      position: relative;
      text-align: center;
    }

    .fact {
      gap: 2px;
      min-height: ds(64px);
      padding: ds(10px) 6px ds(8px);
    }

    .fact-date:active,
    .action-tile:active { background: rgba(255, 255, 255, 0.12); }

    .fact-value {
      font-size: ds(1.35rem);
      font-weight: 700;
      line-height: 1.1;
    }

    .fact-label {
      color: #ccc;
      font-size: ds(0.62rem);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .action-tile {
      font-size: ds(0.7rem);
      gap: 4px;
      letter-spacing: 0.04em;
      min-height: ds(56px);
      padding: ds(8px) 6px;
      text-transform: uppercase;

      i { font-size: ds(1.15rem); line-height: 1; }
      &:disabled { color: #ccc; }
    }

    .action-medium {
      .medium-prompt {
        align-items: center;
        display: inline-flex;
        gap: 4px;

        i { font-size: ds(0.75rem); }
      }

      .medium-label {
        color: #ccc;
        font-size: ds(0.58rem);
        letter-spacing: 0.06em;
      }

      &.needs-choice {
        background: rgba(111, 211, 155, 0.08);
        border: 1px dashed #6fd39b;
        color: #6fd39b;
      }

      &.needs-choice:active { background: rgba(111, 211, 155, 0.18); }
    }

    /* The real control, laid over its tile and invisible: the tile shows the
       value, the tap opens the phone's own date or option picker. */
    .fact-overlay-input {
      cursor: pointer;
      font-size: ds(16px); /* under 16px, iOS zooms the page on focus */
      height: 100%;
      inset: 0;
      opacity: 0;
      position: absolute;
      width: 100%;
    }

    .band-title {
      color: #fff;
      font-size: ds(1rem);
      font-weight: 600;
      margin: 18px 0 8px;
    }

    .form-control,
    .form-select {
      background-color: #1c1c1c;
      border-color: rgba(255, 255, 255, 0.15);
      color: #fff;
      font-size: ds(16px);

      &::placeholder { color: #9a9a9a; }
    }

    /* Same surface as the tiles at the top, full width. */
    .score-card {
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 10px 0;
      padding: ds(14px) 12px ds(12px);
      text-align: center;
    }

    .score-card-label,
    .score-rank-label {
      color: #ccc;
      font-size: ds(0.62rem);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .score-card-value {
      color: #6fd39b;
      font-size: ds(2.6rem);
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      line-height: 1;
    }

    /* No picks yet: a grey dash, not a green number. */
    .score-card-empty .score-card-value { color: #ccc; }

    .score-card-waiting {
      color: #ccc;
      font-size: ds(0.8rem);
    }

    .score-card-change {
      align-items: center;
      display: inline-flex;
      font-size: ds(0.8rem);
      gap: 2px;

      i { font-size: ds(1.1rem); line-height: 1; }
      &.up { color: #6fd39b; }
      &.down { color: #ff9b8a; }
      &.same { color: #ccc; }
    }

    .score-card-ranks {
      display: grid;
      gap: 6px;
      grid-template-columns: repeat(2, 1fr);
      margin-top: 8px;
      width: 100%;
    }

    .score-card-rank {
      background: rgba(255, 255, 255, 0.06);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 8px 6px;
    }

    .score-rank-value {
      color: #fff;
      font-size: ds(1.2rem);
      font-weight: 700;
      line-height: 1.1;
    }

    .score-card-since {
      color: #ccc;
      font-size: ds(0.85rem);
      line-height: 1.35;
      margin: 8px 0 0;

      strong { color: #fff; }
    }

    .breakdown-table {
      font-size: ds(0.75rem);
      font-variant-numeric: tabular-nums;
      width: 100%;

      td {
        color: #ccc;
        padding: 2px 4px;
        text-align: right;
      }

      .breakdown-name { color: #fff; text-align: left; text-transform: capitalize; }
      .breakdown-op { color: #9a9a9a; text-align: center; }
      .breakdown-product { color: #fff; }

      tfoot td {
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        font-weight: 700;
      }
    }

    .viewing-tags {
      margin-bottom: 18px;
    }

    .tag-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .tag-pill {
      align-items: center;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 999px;
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      /* Back to the old Bootstrap badge scale (bug report 2026-10-01: "I
         liked them small"). */
      font-size: 0.75em;
      font-weight: 700;
      gap: 3px;
      line-height: 1;
      padding: 0.35em 0.25em 0.35em 0.65em;

      &:active { background: rgba(255, 255, 255, 0.12); }

      &.selected {
        background: rgba(111, 211, 155, 0.18);
        border-color: #6fd39b;
        color: #fff;

        .bi-check-lg { color: #6fd39b; }
      }
    }

    .tag-delete {
      align-items: center;
      background: none;
      border: 0;
      color: #9a9a9a;
      display: inline-flex;
      font-size: 0.85em;
      justify-content: center;
      line-height: 1;
      padding: 0 2px;

      &:active { color: #fff; }
    }

    .tag-add {
      display: flex;
      gap: 6px;
      margin-top: 10px;

      .form-control { flex: 1 1 auto; }
    }

    .tag-add-button {
      background: rgba(255, 255, 255, 0.06);
      border: 0;
      border-radius: 6px;
      color: #6fd39b;
      flex: 0 0 auto;
      min-height: 40px;
      padding: 0 14px;

      &:active { background: rgba(255, 255, 255, 0.12); }
      &:disabled { color: #9a9a9a; }
    }

    .submit-error {
      color: #ff8a8a;
      margin: 0 0 8px;
      text-align: center;
    }

    .submit-button {
      align-items: center;
      background: #6fd39b;
      border: 0;
      border-radius: 8px;
      color: #0d0d0d; /* dark on the green: ~11:1, where white would be ~1.9:1 */
      display: flex;
      font-size: ds(1rem);
      font-weight: 700;
      justify-content: center;
      letter-spacing: 0.02em;
      margin: 8px 0 18px;
      min-height: ds(52px);
      width: 100%;

      &:active { background: #5bbd88; }

      &[disabled] {
        opacity: 0.8;

        .disabled-show {
          display: inline-block;
        }
      }

      .disabled-show {
        display: none;
      }
    }

    .previous-ratings {
      margin-bottom: 18px;
    }

    .previous-viewing {
      padding: 6px 0;

      & + .previous-viewing { border-top: 1px solid rgba(255, 255, 255, 0.06); }
    }

    .previous-viewing-head {
      display: flex;
      font-size: ds(0.85rem);
      justify-content: space-between;
      margin-bottom: 4px;

      span { color: #ccc; }
    }

    .previous-viewing-grid {
      display: grid;
      gap: 4px;
      grid-template-columns: repeat(4, 1fr);
    }

    .previous-cell {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 4px;
      display: flex;
      flex-direction: column;
      padding: 3px 0;
      text-align: center;
    }

    .previous-cell-label {
      color: #ccc;
      font-size: ds(0.58rem);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .previous-cell-value {
      font-size: ds(0.85rem);
      font-variant-numeric: tabular-nums;
    }

    .neighbors {
      /* Cover Flow keeps its own size: it is sized to the stage's measured
         width, and the dial is for the form above it. */
      --detail-scale: 1;
      font-size: ds(1rem);
      align-items: center;
      background: rgba(18, 18, 18, 0.96);
      border-top: 1px solid rgba(255, 255, 255, 0.12);
      display: flex;
      justify-content: space-between;
      margin: 0 -1rem; /* Extend to edges, counteracting the content's 1rem padding */
      padding: 6px 6px calc(6px + env(safe-area-inset-bottom));
      /* Pinned to the bottom of the viewport while you scroll the form, so
         where this film sits against its neighbours stays visible the whole
         time you're choosing scores. That is the entire point of the strip, and
         of the pin button.
         Restored 2026-08-21: "Cleans up layout for rate movie form" (2025-09-06)
         swapped this for `position: relative` during a 267-line
         refactor. That silently made the pin button a no-op — `.unstuck` below
         sets `position: relative` too, so both of its states were identical
         and only the icon changed. It stayed that way for eleven months, until
         a bug report: "I press this little up/down arrow... it doesn't do
         anything." The toggle was left in place by that commit, which is what
         makes it collateral rather than a decision.
         Since 2026-09-30 it is the last thing on the page, so it rides along
         over the whole form instead of letting go halfway down. */
      bottom: 0;
      position: sticky;
      z-index: 5;

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

      /* A small bare pin floating over the strip's top-right corner, out of
         the flex row so the posters (sized to the stage's measured width)
         reach the edge. The icon is 14px but the tap area stays 40px, tucked
         into the corner; the shadow keeps it legible over a poster's edge. */
      .hide-neighbors {
        align-items: flex-start;
        color: #ccc;
        cursor: pointer;
        display: flex;
        font-size: 14px; /* outside the dial: Cover Flow */
        height: 40px;
        justify-content: flex-end;
        line-height: 1;
        padding: 5px 6px 0 0;
        position: absolute;
        right: 0;
        text-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
        top: 0;
        width: 40px;
        z-index: 1;

        &:active { color: #fff; }
      }

      /* Seven posters in Cover Flow (2026-10-02, after nine small flat ones
         on 2026-10-01 went "a bit too far"): about 10% bigger than those
         rendered on a phone, one fewer each side. Each poster is placed from
         the centre by its inline transform (`coverFlowPose`), so the row is
         a stage rather than a flex row. Since 2026-10-04 its height and the
         posters' widths are inline too: `coverFlowLayout` sizes them to the
         stage's measured width so the row reaches both edges. Keep
         `perspective` in step with COVER_FLOW_PERSPECTIVE. */
      .neighbor-posters {
        flex: 1 1 auto;
        min-width: 0;
        perspective: 500px;
        position: relative;
      }

      .neighbor {
        left: 50%;
        position: absolute;
        top: 50%;
        transition: transform 320ms ease, opacity 320ms ease;
        /* A poster newly in the window (the film moved past the edge of it)
           fades in where it lands instead of popping. */
        animation: neighbor-arrive 320ms ease;
      }

      .current-movie {
        img { box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); }
      }

      @media (prefers-reduced-motion: reduce) {
        .neighbor {
          animation: none;
          transition: none;
        }
      }

      img {
        aspect-ratio: 2 / 3;
        border-radius: 3px;
        display: block;
        object-fit: cover;
        width: 100%;
      }
    }

    @keyframes neighbor-arrive {
      from { opacity: 0; }
    }

    .modal-note { color: #ccc; }
  }
</style>

<style>
/* While a rating is saving (up to a few seconds on a weak signal) the form
   steps back so the "Submitting…" button is the only live thing on screen,
   and a second tap on anything can't land. */
.rate-movie.rate-movie-saving > *:not(.rate-movie-header) {
  opacity: 0.6;
  pointer-events: none;
  transition: opacity 160ms ease;
}
</style>

