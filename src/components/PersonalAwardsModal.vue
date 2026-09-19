<template>
  <div class="personal-awards">
    <div v-if="!pageMode && firstEligibleYear != null" class="prompt-card" role="alert" @click="openModal">
      <span class="prompt-badge prompt-badge-awards"><i class="bi bi-trophy-fill"></i></span>
      <span class="prompt-body">
        <span class="prompt-label">{{ awardNameSingular }}</span>
        <p class="prompt-text">{{ promptCopy.text }}</p>
        <a class="prompt-action prompt-action-awards" @click.stop="openModal">{{ promptCopy.action }}</a>
      </span>
    </div>
    <Modal :show="showModal" :page="pageMode" @close="closeModal">
      <template v-slot:header>
        <div v-if="!selectedCategory" class="text-center awards-header">
          <!-- "The 2026 Oscars", not "The Oscars 2026" — the award name is
               explicitly shaped to read like the Oscars, so the year belongs
               in front of it (2026-08-17). -->
          <h2 class="mb-1">{{ awardHeading }}</h2>
          <p class="mb-0">Your own annual awards</p>

          <!-- New Movies Notification: dark card + poster row (house style:
               posters over text, no Bootstrap alert-info blue on dark) -->
          <div v-if="hasNewMovies" class="new-movies-card text-start">
            <h6 class="new-movies-title">
              Movies you&rsquo;ve watched since you last nominated
            </h6>
            <div class="new-movies-row">
              <!-- Bare posters, titles as tooltips only (feedback) -->
              <div v-for="entry in newMoviesForCurrentYear" :key="entry.movie.id" class="new-movie-card" :title="entry.movie.title">
                <img
                  v-if="entry.movie.poster_path"
                  :src="`https://image.tmdb.org/t/p/w185${entry.movie.poster_path}`"
                  :alt="entry.movie.title"
                  class="new-movie-poster"
                >
                <div v-else class="new-movie-poster new-movie-poster-blank">{{ entry.movie.title }}</div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <template v-slot:body>
        <div class="awards-form">
          <!-- Drill-down slider (feedback iteration three, the keeper):
               ONE full-width column of categories; choosing one slides the
               whole surface left to expose the detail pane, and the slim
               rail on the detail pane's left edge slides back. All motion
               is a single transform, so it cannot read as janky. -->
          <div ref="awardsSlider" class="awards-slider" :class="{ 'showing-detail': Boolean(selectedCategory) }">
          <div class="awards-pane list-pane" :aria-hidden="Boolean(selectedCategory)">
          <div class="category-grid">
            <div class="category-buttons">
              <!-- Drill rows: name + status on the left, chevron on the
                   right — the row shape that says "slides through to a
                   detail pane" (feedback: the UI should indicate the slide). -->
              <button
                v-for="category in categories"
                :key="category.key"
                type="button"
                class="category-btn"
                :class="{'completed': category.completed, 'disabled': category.disabled, 'has-banner': Boolean(categoryBannerStyle(category.key))}"
                :style="categoryBannerStyle(category.key)"
                :disabled="category.disabled"
                :title="category.disabledReason || ''"
                @click="onCategoryTileClick(category)"
              >
                <span class="category-row-main">
                  <span class="category-name">{{ category.name }}</span>
                  <span class="category-winner" v-if="getCategoryWinner(category.key)">
                    {{ getCategoryWinner(category.key) }}
                  </span>
                  <span class="category-no-nominees" v-else-if="isCategoryMarkedAsNoNominees(category.key)">
                    No nominees
                  </span>
                  <!-- Shown for EVERY category, not just the ones still
                       undecided: "it would be nice if the nominee count was
                       visible for each category" (report
                       -P-HyPlss8uUwGJzLgN4). It used to be the third branch
                       of the same v-if chain, so the moment a category had a
                       winner its count disappeared — which is most of them,
                       once you've been through. -->
                  <span
                    v-if="!category.disabled && !isCategoryMarkedAsNoNominees(category.key)"
                    class="category-meta"
                  >
                    {{ getCategoryNomineeCount(category.key) }}
                    {{ getCategoryNomineeCount(category.key) === 1 ? 'nominee' : 'nominees' }}
                  </span>
                </span>
                <span class="category-row-side">
                  <span class="green-checkmark" v-if="category.completed">
                    <i class="bi bi-check"></i>
                  </span>
                  <i v-if="!category.disabled" class="bi bi-chevron-right category-chevron"></i>
                </span>
              </button>
            </div>

            <!-- Invent an award (2026-08-20). Sits after the standard list
                 rather than above it: the thirteen are the ceremony, this is
                 the honorary extra. -->
            <div class="custom-award-add">
              <button
                v-if="!addingCustomAward"
                type="button"
                class="custom-award-open"
                @click="openCustomAwardForm"
              >
                <i class="bi bi-plus-lg"></i> Add your own award
              </button>

              <div v-else class="custom-award-form">
                <input
                  ref="customAwardInput"
                  v-model="customAwardName"
                  type="text"
                  class="form-control custom-award-input"
                  placeholder="Best Needle Drop"
                  maxlength="60"
                  @keyup.enter="addCustomAward"
                  @keyup.esc="cancelCustomAward"
                >
                <!-- Who it goes to. A film is the common case, but an
                     honorary award is exactly the one that often isn't
                     ("I definitely need to be able to do honorary awards to
                     people"), and the pool differs entirely, so it has to be
                     decided up front. -->
                <div class="custom-award-types" role="radiogroup" aria-label="What this award goes to">
                  <button
                    v-for="option in customAwardTypeOptions"
                    :key="option.value"
                    type="button"
                    role="radio"
                    class="custom-award-type"
                    :class="{ active: customAwardType === option.value }"
                    :aria-checked="customAwardType === option.value"
                    @click="customAwardType = option.value"
                  >{{ option.label }}</button>
                </div>

                <div class="custom-award-actions">
                  <button type="button" class="btn btn-sm btn-outline-light" @click="cancelCustomAward">Cancel</button>
                  <button type="button" class="btn btn-sm btn-warning" :disabled="!customAwardName.trim()" @click="addCustomAward">Add</button>
                </div>
                <p v-if="customAwardError" class="custom-award-error">{{ customAwardError }}</p>
              </div>
            </div>
          </div>

          </div><!-- /list-pane -->

          <div class="awards-pane detail-pane">
          <div v-if="selectedCategory" ref="categoryPanel" class="category-detail">
            <!-- No back link here any more - it lives in the sticky bar
                 below, alone: "I don't want that categories link to be
                 duplicated. You can get rid of the one that isn't sticky"
                 (2026-08-21). The trash followed it the same day - the reveal
                 tap lives in the sticky bar, so a button that appeared up
                 here materialised off-screen once you'd scrolled. The bar's
                 one remaining job is Remove award for a custom category. -->
            <div v-if="selectedCategoryIsCustom" class="panel-bar">
              <!-- An invented award can be un-invented; the thirteen standard
                   ones cannot. Offered here rather than as an × on the
                   category row, because those rows are <button>s and a button
                   inside a button is invalid markup. -->
              <button
                v-if="selectedCategoryIsCustom"
                type="button"
                class="panel-remove"
                @click="removeCustomAward"
              >
                Remove award
              </button>
            </div>
            <!-- Sticky Top Section (the promoted category tile above is the
                 header — tapping it reveals Matt's trash, the × collapses) -->
            <!-- 1px sentinel: when it scrolls off-screen the bar below is
                 pinned, and the safe-area shade turns on. -->
            <div ref="stickySentinel" class="sticky-sentinel" aria-hidden="true"></div>
            <!-- iPhone only in practice: while the bar is stuck, black out the
                 transparent status-bar / Dynamic Island strip above it so
                 nominees don't peek out around the island while scrolling.
                 env(safe-area-inset-top) is 0 elsewhere, so it renders as
                 nothing on desktop. -->
            <Teleport to="body">
              <div v-if="nomineesBarStuck" class="awards-safe-area-shade"></div>
            </Teleport>
            <div class="sticky-top-section">
              <!-- Which category this is. Bug report, 2026-08-20: "When I
                   click into a category on my personal awards, it doesn't
                   actually say anywhere what category I'm working on on that
                   page so if I look away and forget, I have to exit and come
                   back in order to see what category I'm in."
                   Inside the STICKY section deliberately: the panel bar above
                   scrolls away, and a name you lose the moment you scroll
                   down a grid of nominees is the same bug again. -->
              <!-- The ONLY back link (bug report 2026-08-21 put one here;
                   feedback the same day removed the panel-bar copy: "I don't
                   want that categories link to be duplicated"). One line,
                   per the same feedback: link on the left edge; category
                   title with the Current Nominees instruction under it as a
                   right-aligned block. Tapping the instruction still reveals
                   Matt's trash, as it did when it lived below. -->
              <div class="category-header-row">
                <button type="button" class="panel-back sticky-back" @click="backToCategories">
                  <i class="bi bi-chevron-left"></i> Categories
                </button>
                <div class="category-header-titles">
                  <h5 class="category-header">{{ getCurrentCategoryName() }}</h5>
                  <div class="nominees-instruction-row">
                    <!-- Deliberately unadvertised: revealed by tapping the
                         instruction text beside it. In the sticky bar WITH
                         its tap target ("the trash icon could appear to the
                         left hand side of the text", 2026-08-21) - when it
                         lived in the top bar, tapping the reveal after
                         scrolling made a button appear somewhere off-screen,
                         which reads as the tap doing nothing. -->
                    <button v-if="isMatt" v-show="showTrashIcon" type="button" class="panel-trash sticky-trash" title="Clear all nominees" @click="onTrashTap">
                      <i class="bi bi-trash3"></i>
                    </button>
                    <h6 class="section-title" @click="toggleTrashReveal">Current Nominees: <span class="instruction-text">Click a nominee to select winner</span></h6>
                  </div>
                </div>
              </div>

              <!-- Current Nominees - always visible; its heading moved up
                   into the header row (2026-08-21). -->
              <div class="current-nominees-section">
                <div class="current-nominees-gallery">
                  <!-- No nominees button when category is empty -->
                  <div v-if="getCurrentNominees().length === 0" class="no-nominees-placeholder">
                    <button
                      class="btn btn-sm btn-outline-secondary no-nominees-btn text-bg-dark"
                      @click="markCategoryAsNoNominees"
                    >
                      <i class="fas fa-ban"></i>
                      No nominees for now
                    </button>
                    <div class="helper-text">
                      Click options below to nominate
                    </div>
                  </div>

                  <div
                    v-for="nominee in getCurrentNominees()"
                    :key="getOptionId(nominee)"
                    class="current-nominee-poster"
                    :class="{'winner': isWinner(nominee)}"
                    @click="selectWinner(nominee)"
                    :title="getOptionTitle(nominee)"
                  >
                    <!-- Image -->
                    <div class="nominee-poster-image">
                      <img
                        v-if="isActingCategory(selectedCategory) && nominee.details && nominee.details.profile_path"
                        :src="`https://image.tmdb.org/t/p/w185${nominee.details.profile_path}`"
                        :alt="nominee.name"
                      >
                      <img
                        v-else-if="isActingCategory(selectedCategory)"
                        src="../assets/images/Image_not_available.png"
                        :alt="nominee.name"
                      >
                      <img
                        v-else-if="nominee.movie && nominee.movie.poster_path"
                        :src="`https://image.tmdb.org/t/p/w185${nominee.movie.poster_path}`"
                        :alt="getOptionTitle(nominee)"
                      >
                      <img
                        v-else
                        src="../assets/images/Image_not_available.png"
                        :alt="getOptionTitle(nominee)"
                      >

                      <!-- Winner crown overlay -->
                      <div v-if="isWinner(nominee)" class="winner-overlay">
                        <span class="winner-crown"><i class="bi bi-trophy-fill"></i></span>
                      </div>

                      <!-- Remove button -->
                      <button class="remove-nominee-btn" @click.stop="toggleNominee(nominee)">
                        <i class="bi bi-x"></i>
                      </button>
                    </div>

                    <!-- Name below.
                         Report -P1_WpzyTRahOiZTWLK2 (2026-09-15): "In the
                         nominees pane we don't need the name of the movie
                         below the poster." For a movie category the caption
                         was the title the poster already says — and said it
                         badly, truncated to nine characters plus an ellipsis.
                         Acting categories keep theirs: that caption is the
                         PERSON's name over a headshot, which no image states,
                         plus the roles they were nominated for. -->
                    <div v-if="isActingCategory(selectedCategory)" class="nominee-poster-name">
                      <div class="actor-name">
                        {{ getOptionTitle(nominee).length > 10 ? getOptionTitle(nominee).substring(0, 9) + '...' : getOptionTitle(nominee) }}
                      </div>
                      <!-- The roles they were nominated for -->
                      <div v-if="nominee.allRoles" class="all-roles">
                        <div v-for="movieGroup in getGroupedRolesByMovie(nominee.allRoles)" :key="movieGroup.movieId" class="movie-group-entry">
                          <div class="role-movie">{{ movieGroup.movieTitle }}</div>
                          <div v-for="character in movieGroup.characters" :key="character" class="role-character">{{ character }}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <!-- Available Options Section -->
            <div class="available-options-section">
              <h6 class="section-title">Available Options:</h6>
              <!-- Bug report (2026-08-21): "How are the movies sorted when I'm
                   nominating people for personal acting awards? It seems
                   random." It was never random - acting categories order the
                   films by your Performance score, others by the criterion
                   that category is about. Nothing on screen said so, and no
                   score was shown anywhere, so the order had no visible
                   justification. Saying it, and showing the score on each
                   film, is the whole fix. -->
              <p v-if="!loadingOptions && eligibleOptions.length" class="options-sort-note">
                Films ordered by your <strong>{{ sortCriterionLabel }}</strong> score, best first.
              </p>
              <!-- Loading state -->
              <div v-if="loadingOptions" class="loading-container">
                <div class="spinner-border" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2">Loading nominees...</p>
              </div>

              <!-- Movie-grouped options (for acting categories) -->
              <div v-else-if="isActingCategory(selectedCategory)" class="movie-groups">
                <div
                  v-for="movieGroup in eligibleOptionsByMovie"
                  :key="movieGroup.movieId"
                  class="movie-group"
                >
                  <!-- Movie header -->
                  <div class="movie-group-header">
                    <h6 class="movie-title">{{ movieGroup.movie.title }}</h6>
                    <span class="movie-year">({{ new Date(movieGroup.movie.release_date).getFullYear() }})</span>
                    <span v-if="sortScoreFor(movieGroup) !== null" class="movie-sort-score">
                      {{ sortCriterionLabel }} {{ sortScoreFor(movieGroup) }}
                    </span>
                  </div>

                  <!-- Cast members grid for this movie -->
                  <div class="nominees-grid">
                    <div
                      v-for="option in movieGroup.loadedCast"
                      :key="getOptionId(option)"
                      class="nominee-tile text-bg-dark"
                      :class="[{'winner': isWinner(option), 'sibling-conflict': Boolean(siblingConflictFor(option)) && !isNominee(option)}]"
                      @click="toggleNominee(option)"
                    >
                      <!-- Image container -->
                      <div class="nominee-image">
                        <img
                          v-if="isActingCategory(selectedCategory) && option.details && option.details.profile_path"
                          :src="`https://image.tmdb.org/t/p/w154${option.details.profile_path}`"
                          :alt="option.name"
                        >
                        <img
                          v-else-if="isActingCategory(selectedCategory)"
                          src="../assets/images/Image_not_available.png"
                          :alt="option.name"
                        >
                        <img
                          v-else-if="option.movie && option.movie.poster_path"
                          :src="`https://image.tmdb.org/t/p/w154${option.movie.poster_path}`"
                          :alt="getOptionTitle(option)"
                        >

                        <!-- Status overlay -->
                        <div class="nominee-status-overlay">
                          <span v-if="isWinner(option)" class="status-icon winner"><i class="bi bi-trophy-fill"></i></span>
                          <span v-else-if="isNominee(option)" class="status-icon nominee"><i class="bi bi-check"></i></span>
                        </div>
                      </div>

                      <!-- Text overlay -->
                      <div class="nominee-info-overlay">
                        <div class="nominee-title">{{ getOptionTitle(option) }}</div>
                        <div class="nominee-movie" v-if="getOptionMovie(option)">
                          {{ getOptionMovie(option) }}
                        </div>
                        <div class="nominee-role" v-if="getOptionRole(option)">
                          {{ getOptionRole(option) }}
                        </div>
                        <!-- Feedback: the same person+movie must not sit in
                             both lead and supporting — say WHY the tile
                             won't select instead of silently refusing. -->
                        <div v-if="siblingConflictFor(option)" class="nominee-conflict">
                          Already in {{ siblingConflictLabel(option) }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Load more button for this movie -->
                  <div v-if="movieGroup.hasMore || movieGroup.isLoading" class="load-more-section">
                    <button
                      class="btn btn-sm btn-outline-secondary load-more-btn"
                      :disabled="movieGroup.isLoading"
                      @click="loadMoreForMovie(movieGroup.movieId)"
                    >
                      <span v-if="movieGroup.isLoading" class="spinner-border spinner-border-sm me-2" role="status"></span>
                      <i v-else class="fas fa-plus me-2"></i>
                      {{ movieGroup.isLoading ? 'Loading...' : 'Load more cast' }}
                    </button>
                  </div>
                </div>
              </div>

              <!-- Simple grid for non-acting categories -->
              <div v-else class="simple-options">
                <div class="nominees-grid">
                  <div
                    v-for="option in eligibleOptions"
                    :key="getOptionId(option)"
                    class="nominee-tile text-bg-dark"
                    :class="[{'winner': isWinner(option)}]"
                    @click="toggleNominee(option)"
                  >
                    <!-- Image container -->
                    <div class="nominee-image">
                      <img
                        v-if="option.movie && option.movie.poster_path"
                        :src="`https://image.tmdb.org/t/p/w154${option.movie.poster_path}`"
                        :alt="getOptionTitle(option)"
                      >
                      <img
                        v-else
                        src="../assets/images/Image_not_available.png"
                        :alt="getOptionTitle(option)"
                      >

                      <!-- Status overlay -->
                      <div class="nominee-status-overlay">
                        <span v-if="isWinner(option)" class="status-icon winner"><i class="bi bi-trophy-fill"></i></span>
                        <span v-else-if="isNominee(option)" class="status-icon nominee"><i class="bi bi-check"></i></span>
                      </div>
                    </div>

                    <!-- Text overlay - conditional based on category -->
                    <div v-if="shouldShowTextOverlay(selectedCategory)" class="nominee-info-overlay">
                      <div class="nominee-title" :class="{ 'allow-wrap': selectedCategory === 'bestDirector' }">
                        {{ getOptionTitle(option) }}
                      </div>
                      <div v-if="isActingCategory(selectedCategory) && getOptionMovie(option)" class="nominee-movie">
                        {{ getOptionMovie(option) }}
                      </div>
                      <div v-if="isActingCategory(selectedCategory) && getOptionRole(option)" class="nominee-role">
                        {{ getOptionRole(option) }}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div><!-- /detail-pane -->
          </div><!-- /awards-slider -->
        </div>
      </template>
      <template v-slot:footer>
        <!-- Only show footer on category screen, not nomination screens -->
        <div v-if="!selectedCategory" class="awards-modal-footer w-100">
          <div v-if="completedCategories === totalCategories" class="completion-section w-100">
            <button
              class="btn btn-success w-100"
              @click="completeYearAndClose"
              :disabled="savingState"
            >
              <span v-if="savingState" class="spinner-border spinner-border-sm me-2" role="status"></span>
              <i v-else class="fas fa-trophy me-2"></i>
              {{ savingState ? 'Completing...' : `Complete ${currentYear} Awards` }}
            </button>
          </div>

          <div v-else class="progress-section text-center">
            <small>
              {{ completedCategories }} of {{ totalCategories }} categories complete
            </small>
          </div>
        </div>
      </template>
    </Modal>
  </div>
</template>

<script>
import Modal from './Modal.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import ErrorLogService from '../services/ErrorLogService.js';
import { pickEligibleAwardsYear } from '../utils/awards.js';
import { yearsMeetingAwardsThreshold, awardsPromptCopy, distinctNomineeCount } from '../assets/javascript/personalAwards.js';
import { PERSONAL_AWARD_CATEGORIES, categoriesForYear, customAwardKey, isCustomAwardKey } from '../assets/javascript/personalAwardsCategories.js';
import { isEligibleForActingCategory } from '../assets/javascript/genderEligibility.js';
import { expandNomineeFromMinimal as expandNomineeFromMinimalShared, actingSiblingConflict, samePersonNominee, personNomineeKey } from '../assets/javascript/personalAwards.js';

// Top-billed cast offered for a person-type custom award, per film. Cast is
// stored untrimmed (Six Degrees walks the full billing list on purpose), so
// without a cap a ten-film year would render hundreds of tiles.
const CUSTOM_AWARD_CAST_DEPTH = 10;

export default {
  name: "PersonalAwardsModal",
  props: {
    allEntriesWithFlatKeywordsAdded: {
      type: Array,
      required: true
    },
    personalAwardName: {
      type: String,
      default: 'Oscar'
    },
    awardNameWithThe: {
      type: String,
      default: 'The Oscars'
    },
    awardNameSingular: {
      type: String,
      default: 'Oscar'
    },
    selectedYear: {
      type: Number,
      default: null
    },
    autoOpen: {
      type: Boolean,
      default: false
    },
    // Full-page rendering at /awards (PersonalAwardsScreen.vue): no notice
    // banner, the Modal shell in page mode, and closing emits 'closed' so
    // the route wrapper can navigate away.
    pageMode: {
      type: Boolean,
      default: false
    },
    // Home's embedded instance keeps only the "year is ready" notice —
    // opening from there NAVIGATES to the /awards page instead of popping
    // the overlay in place.
    navigateOnOpen: {
      type: Boolean,
      default: false
    }
  },
  components: {
    Modal
  },
  data () {
    return {
      showModal: false,
      savingState: false,
      completingYear: false, // Flag to prevent saves after completion starts
      selectedCategory: null,
      currentYear: null,
      awardsData: {},
      // This year's invented awards, as { <key>: { name, createdAt } }.
      // Held beside awardsData rather than inside it: awardsData is
      // nominees/winner per category, and an award can exist with neither.
      customCategories: {},
      // The "add an award" row's open/typing state.
      addingCustomAward: false,
      customAwardName: '',
      // Most invented awards go to a film, so that is where the toggle starts.
      customAwardType: 'movie',
      customAwardError: null,
      eligibleOptions: [], // For movie categories: simple array. For acting: movie-grouped array
      loadingOptions: false,
      showTrashIcon: false, // For Matt's category reset functionality
      nomineesBarStuck: false, // Sentinel scrolled off => bar is pinned
      awardsDataDirty: false, // User has edited this session; late data must not clobber
      // Cache expensive operations per year/category
      optionsCache: {}, // Format: { "1994-bestActor": [{ movieId, movie, loadedCast, hasMore }] }
      // Cache TMDb person details across all categories
      personDetailsCache: {}, // Format: { "Tom Hanks": { gender, profile_path, etc. } }
      // In-flight request per actor name, so concurrent lookups for the same
      // person (now that the grids load in parallel) share one fetch instead
      // of racing — the caches above are only written AFTER the await.
      personDetailsInFlight: {}
    };
  },
  computed: {
    // "The Oscars" + 2026 reads as "The 2026 Oscars": the leading article
    // stays in front, the year slots between it and the name.
    awardHeading () {
      const name = this.awardNameWithThe || '';
      const leading = /^(the)\s+/i.exec(name);
      return leading
        ? `${leading[1]} ${this.currentYear} ${name.slice(leading[0].length)}`
        : `${name} ${this.currentYear}`;
    },
    isMatt () {
      return this.$store.state.databaseTopKey === "mattgrosso-gmail-com" || !this.$store.state.databaseTopKey;
    },
    yearsEligibleForAwards () {
      try {
        if (!this.allEntriesWithFlatKeywordsAdded || !Array.isArray(this.allEntriesWithFlatKeywordsAdded)) {
          return [];
        }

        // Shared with Home's prompt gate and the /awards year strip, so the
        // threshold setting can't be honoured on one screen and hardcoded on
        // another (bug report 2026-08-22). Ascending there; most recent first
        // is what this list wants.
        const eligibleYears = yearsMeetingAwardsThreshold(
          this.allEntriesWithFlatKeywordsAdded,
          this.$store.state.settings
        ).slice().reverse();

        // Filter out years that are already completed (optional - since this is a "living record")
        return eligibleYears.filter(year => {
          try {
            const existingAwards = this.$store.state.settings?.personalAwards?.[year];
            return !existingAwards?.completed || this.hasNewMoviesForYear(year, existingAwards);
          } catch (error) {
            console.error('Error checking year eligibility:', year, error);
            ErrorLogService.error('Error checking year eligibility:', year, error);
            return false;
          }
        });
      } catch (error) {
        console.error('Error in yearsEligibleForAwards:', error);
        ErrorLogService.error('Error in yearsEligibleForAwards:', error);
        return [];
      }
    },
    // The standard thirteen plus whatever awards the user has invented for
    // THIS year (2026-08-20: "I can name an award whatever I want and then
    // assign it"). Custom ones are movie-type and carry no genre filter, so
    // every per-key helper below already answers correctly for them: not
    // disabled, no disabled reason, sorted by rating.
    categories () {
      return categoriesForYear({ customCategories: this.customCategories }).map(category => ({
        ...category,
        completed: this.isCategoryCompleted(category.key),
        disabled: this.isCategoryDisabled(category.key),
        disabledReason: this.getCategoryDisabledReason(category.key)
      }));
    },
    selectedCategoryIsCustom () {
      return isCustomAwardKey(this.selectedCategory);
    },
    customAwardTypeOptions () {
      return [
        { value: 'movie', label: 'A film' },
        { value: 'person', label: 'A person' }
      ];
    },
    totalCategories () {
      return this.categories.filter(cat => !cat.disabled).length;
    },
    completedCategories () {
      return this.categories.filter(cat => cat.completed && !cat.disabled).length;
    },
    newMoviesForCurrentYear () {
      // Get movies that weren't available when this year was last completed
      const existingAwards = this.$store.state.settings.personalAwards?.[this.currentYear];
      if (!existingAwards || !existingAwards.completed) {
        return []; // No previous completion or not completed yet
      }

      return this.getNewMoviesForYear(this.currentYear, existingAwards);
    },
    hasNewMovies () {
      return this.newMoviesForCurrentYear.length > 0;
    },
    incompleteYears () {
      try {
        if (!this.yearsEligibleForAwards || this.yearsEligibleForAwards.length === 0) return [];

        return this.yearsEligibleForAwards.filter((year) => {
          try {
            const existingAwards = this.$store.state.settings?.personalAwards?.[year];
            if (!existingAwards) return true;

            // Awards exist but were not explicitly completed → still incomplete (partial progress).
            if (!existingAwards.completed) return true;

            // Explicitly completed: still incomplete if new movies have been rated since last update.
            if (!existingAwards.lastUpdated) return true;
            if (!this.allEntriesWithFlatKeywordsAdded) return false;

            const newMovies = this.allEntriesWithFlatKeywordsAdded.filter((entry) => {
              try {
                if (!entry || !entry.movie || !entry.movie.release_date) return false;
                const entryYear = new Date(entry.movie.release_date).getFullYear();
                if (entryYear !== year) return false;
                const movieDate = new Date(entry.ratings?.[0]?.date || entry.movie.release_date);
                return movieDate.getTime() > existingAwards.lastUpdated;
              } catch (error) {
                console.error('Error checking new movies for year:', year, entry, error);
                ErrorLogService.error('Error checking new movies for year:', year, entry, error);
                return false;
              }
            });

            return newMovies.length > 0;
          } catch (error) {
            console.error('Error filtering incomplete years:', year, error);
            ErrorLogService.error('Error filtering incomplete years:', year, error);
            return false;
          }
        });
      } catch (error) {
        console.error('Error in incompleteYears:', error);
        ErrorLogService.error('Error in incompleteYears:', error);
        return [];
      }
    },
    /**
     * Films rated for the prompt's year since its awards were last updated —
     * the number the "you've rated more films" wording quotes. Mirrors the
     * same check incompleteYears makes; 0 for a year that was never completed.
     */
    newFilmsSinceAwards () {
      const year = this.firstEligibleYear;
      const existing = this.$store.state.settings?.personalAwards?.[year];
      if (year == null || !existing?.lastUpdated) return 0;

      return (this.allEntriesWithFlatKeywordsAdded || []).filter((entry) => {
        const releaseDate = entry?.movie?.release_date;
        if (!releaseDate) return false;
        if (new Date(releaseDate).getFullYear() !== year) return false;
        const ratedAt = new Date(entry.ratings?.[0]?.date || releaseDate).getTime();
        return ratedAt > existing.lastUpdated;
      }).length;
    },
    // Wording matched to WHY this year is being offered (bug report) — a
    // first-time year, one part-way through, and one revisited because more
    // films were rated are three different messages.
    promptCopy () {
      const year = this.firstEligibleYear;
      const existing = this.$store.state.settings?.personalAwards?.[year];
      return awardsPromptCopy(year, existing, this.newFilmsSinceAwards);
    },
    firstEligibleYear () {
      try {
        const settings = this.$store.state.settings || {};
        return pickEligibleAwardsYear({
          incompleteYears: this.incompleteYears,
          personalAwards: settings.personalAwards,
          dailyAwardsYear: settings.dailyAwardsYear,
          dailyAwardsYearDate: settings.dailyAwardsYearDate,
          todayString: new Date().toDateString(),
          selectedYearProp: this.selectedYear
        });
      } catch (error) {
        console.error('Error in firstEligibleYear:', error);
        ErrorLogService.error('Error in firstEligibleYear:', error);
        return null;
      }
    },
    // The page header banner follows the year (feedback): the Best Picture
    // winner's backdrop, or the year's highest-rated movie until one is
    // crowned. Reactive, so crowning Best Picture swaps the banner live.
    yearBannerUrl () {
      if (!this.pageMode || this.currentYear == null) return null;

      const winner = this.awardsData?.bestPicture?.winner;
      let entry = (winner && winner.movie) ? winner : null;

      if (!entry) {
        const candidates = (this.allEntriesWithFlatKeywordsAdded || []).filter((candidate) => {
          if (!candidate?.movie?.release_date) return false;
          if (candidate.movie.runtime && candidate.movie.runtime <= 40) return false;
          return new Date(candidate.movie.release_date).getFullYear() === this.currentYear;
        });
        entry = candidates.reduce((best, candidate) => {
          if (!best) return candidate;
          return this.mostRecentRating(candidate).calculatedTotal > this.mostRecentRating(best).calculatedTotal
            ? candidate
            : best;
        }, null);
      }

      const backdrop = entry && (entry.customBackdropPath || entry.movie?.backdrop_path);
      return backdrop ? `https://image.tmdb.org/t/p/w500${backdrop}` : null;
    },
    // The criterion this category orders by, in the words the rating form
    // uses. getCategorySortKey already decides it; this only names it.
    sortCriterionLabel () {
      const key = this.getCategorySortKey(this.selectedCategory);
      const labels = {
        rating: 'Rating',
        direction: 'Direction',
        performance: 'Performance',
        story: 'Story',
        imagery: 'Imagery',
        soundtrack: 'Soundtrack'
      };
      return labels[key] || 'Rating';
    },
    eligibleOptionsByMovie () {
      // Only return movie-grouped data for acting categories
      if (this.isActingCategory(this.selectedCategory)) {
        return this.eligibleOptions;
      }
      return [];
    }
  },
  watch: {
    // The page's year strip changes ?year=, which changes this prop on an
    // ALREADY-MOUNTED component — the route is the same, so nothing remounts
    // and openModal() never runs again. Without this, tapping a year did
    // nothing at all. Note it only reloads data; the modal never auto-closes.
    selectedYear (year) {
      if (year == null || year === this.currentYear) return;
      this.currentYear = year;
      this.selectedCategory = null;
      this.optionsCache = {};
      this.initializeAwardsData();
    },
    // Lets the page highlight the right pill, including on a bare /awards
    // where the modal — not the URL — decides which year you land on.
    currentYear: {
      immediate: true,
      handler (year) {
        this.$emit('yearChanged', year);
      }
    },
    firstEligibleYear: {
      immediate: true,
      handler (newYear) {
        // Cold-boot recovery: on a direct load of /awards the modal opens
        // before the library/settings arrive, so openModal() snapshotted
        // currentYear as null and rendered an empty, year-less page that
        // never healed (live-reproduced after tapping the update banner's
        // Refresh on /awards). Once enough data exists to compute an
        // eligible year, adopt it and (re)read the saved awards.
        if (this.showModal && this.currentYear == null && newYear != null) {
          this.currentYear = newYear;
          this.initializeAwardsData();
        }

        // Persist the daily selection so the banner and openModal() agree on the same year.
        // Skip when an explicit selectedYear prop is in play (Resume/Edit actions own that state).
        if (this.selectedYear != null) return;
        if (newYear == null) return;

        const settings = this.$store.state.settings || {};
        const today = new Date().toDateString();
        const alreadyPersisted =
          settings.dailyAwardsYear === newYear && settings.dailyAwardsYearDate === today;
        if (alreadyPersisted) return;

        try {
          this.$store.dispatch('writeDurably', { path: 'settings/dailyAwardsYear', value: newYear });
          this.$store.dispatch('writeDurably', { path: 'settings/dailyAwardsYearDate', value: today });
        } catch (error) {
          console.error('Error persisting daily awards selection:', error);
          ErrorLogService.error('Error persisting daily awards selection:', error);
        }
      }
    },
    selectedCategory () {
      // The sentinel lives in the detail pane; (re)bind whenever it
      // appears or goes away.
      this.$nextTick(() => this.setupStickyObserver());
    },
    // Cold-boot recovery, part two: with a year already known (e.g.
    // /awards?year=1997), the mount-time initializeAwardsData() ran against
    // not-yet-loaded settings and produced an empty slate. Re-read once
    // settings actually arrive — but never over user edits already made.
    '$store.state.settingsLoaded' (loaded) {
      if (!loaded || !this.showModal || this.currentYear == null) return;
      if (this.awardsDataDirty) return;
      this.initializeAwardsData();
    },
    yearBannerUrl: {
      immediate: true,
      handler (url) {
        if (url) this.$store.commit('setBannerUrl', url);
      }
    },
    // Cold-boot recovery, part three (live repro #2): when SETTINGS beat the
    // LIBRARY in, initializeAwardsData ran fine but every saved nominee
    // failed expandNomineeFromMinimal (movieIds can't resolve against an
    // empty library) and was silently filtered out — 0 nominees everywhere.
    // Re-expand when the library lands, unless the user has edited.
    'allEntriesWithFlatKeywordsAdded.length' (count, previous) {
      if (!count || previous) return;
      if (!this.showModal || this.currentYear == null) return;
      if (this.awardsDataDirty) return;
      this.initializeAwardsData();
    }
  },
  mounted () {
    if (this.autoOpen) {
      this.openModal();
      // Reset forced state so it doesn't re-trigger on next visit
      this.$store.dispatch('writeDurably', { path: 'settings/awardsPromptState', value: null });
    }
  },
  beforeUnmount () {
    this.teardownStickyObserver();
  },
  methods: {
    setupStickyObserver () {
      this.teardownStickyObserver();
      const sentinel = this.$refs.stickySentinel;
      if (!sentinel || typeof IntersectionObserver === 'undefined') return; // jsdom
      this.stickyObserver = new IntersectionObserver(([entry]) => {
        this.nomineesBarStuck = !entry.isIntersecting;
      });
      this.stickyObserver.observe(sentinel);
    },
    teardownStickyObserver () {
      if (this.stickyObserver) {
        this.stickyObserver.disconnect();
        this.stickyObserver = null;
      }
      this.nomineesBarStuck = false;
    },
    markCategoryAsNoNominees () {
      this.awardsDataDirty = true;
      // Mark category as having no worthy nominees for now
      if (!this.awardsData[this.selectedCategory]) {
        this.awardsData[this.selectedCategory] = {};
      }

      this.awardsData[this.selectedCategory].nominees = [];
      this.awardsData[this.selectedCategory].winner = null;
      this.awardsData[this.selectedCategory].noNominees = true; // Special flag

      // Save removed - will save on Back/Complete/Close only

      // Navigate back to category grid to show updated status
      this.selectedCategory = null;
    },

    resetCategory () {
      this.awardsDataDirty = true;
      if (this.awardsData[this.selectedCategory]) {
        this.awardsData[this.selectedCategory].nominees = [];
        this.awardsData[this.selectedCategory].winner = null;
        this.awardsData[this.selectedCategory].noNominees = false;
      }

      // Save the reset
      this.saveCurrentState();
    },

    resetYear () {
      if (!confirm(`Reset ALL awards data for ${this.currentYear}? This cannot be undone.`)) return;

      // Clear all awards data for this year
      this.awardsData = {};

      // Navigate back to category grid
      this.selectedCategory = null;

      // Save the reset
      this.saveCurrentState();
    },
    onCategoryTileClick (category) {
      if (category.disabled) return;
      this.showTrashIcon = false;
      this.selectCategory(category.key);
      // Belt-and-braces: the track must never be natively scrolled — the
      // transform owns all horizontal motion.
      if (this.$refs.awardsSlider) this.$refs.awardsSlider.scrollLeft = 0;
      // Vertical reset only. NEVER scrollIntoView here: the detail starts
      // one pane to the right, and scrollIntoView horizontally scrolls the
      // slider's overflow-hidden track to reach it — which then stacks
      // with the transform's own slide and overshoots by a full screen
      // (the reported "content is off the left" bug).
      window.scrollTo({ top: 0, behavior: 'instant' });
    },
    // The hidden-ness is the safety: the trash only exists after the
    // unadvertised heading tap, so its own tap clears directly (matching
    // the original secret's behavior).
    toggleTrashReveal () {
      if (!this.isMatt) return;
      this.showTrashIcon = !this.showTrashIcon;
    },
    onTrashTap () {
      this.showTrashIcon = false;
      this.resetCategory();
    },
    async backToCategories () {
      if (this.$refs.awardsSlider) this.$refs.awardsSlider.scrollLeft = 0;
      this.selectedCategory = null;
      this.showTrashIcon = false; // Reset trash icon when going back

      // Queue save in background - store handles deduplication and sequencing
      setTimeout(() => {
        this.saveCurrentState()
      }, 0);
    },
    async completeYearAndClose () {
      try {
        this.completingYear = true; // Set flag to prevent further saves
        // Record completion date. The date string is what every existing
        // account carries; the timestamp beside it is what the prompt quota
        // actually spaces on now (see promptQuota.js), so both get written.
        await this.$store.dispatch('writeDurably', {
          path: 'settings/lastAwardCompletionDate',
          value: new Date().toDateString()
        });
        await this.$store.dispatch('writeDurably', {
          path: 'settings/lastAwardsPromptAt',
          value: Date.now()
        });

        // Clear daily selection
        await this.$store.dispatch('writeDurably', {
          path: 'settings/dailyAwardsYear',
          value: null
        });

        // Before completing, ensure all disabled categories are marked as noNominees
        this.ensureDisabledCategoriesMarked();

        // Temporarily allow save during completion by clearing the flag
        this.completingYear = false;

        // Save state first, then close modal — the ONE place a year is
        // ever marked completed.
        await this.saveCurrentState(true);

        // Restore the completing flag and close modal
        this.completingYear = true;
        this.closeModal();
      } catch (error) {
        console.error('🚨 COMPLETE YEAR FAILED:', error.message);
        ErrorLogService.error('Error completing year:', error);
        // Still close even if save fails
        this.closeModal();
      } finally {
        this.savingState = false;
      }
    },
    openModal () {
      if (this.navigateOnOpen) {
        const year = this.selectedYear || this.firstEligibleYear;
        this.$router.push({ path: '/awards', query: year != null ? { year } : {} });
        return;
      }
      try {
        this.showModal = true;
        // firstEligibleYear already accounts for dailyAwardsYear and selectedYear prop,
        // so use it directly to guarantee the modal opens on the same year shown in the banner.
        this.currentYear = this.selectedYear || this.firstEligibleYear;
        this.initializeAwardsData();

        // Clear options cache for new session
        this.optionsCache = {};
        this.personDetailsCache = {};

        // Clean up old localStorage entries (24+ hours old)
        this.cleanupLocalStorageCache();
      } catch (error) {
        console.error('🚨 MODAL OPEN FAILED:', error.message);
        ErrorLogService.error('Error opening Personal Awards modal:', error);
      }
    },
    closeModal () {
      if (this.pageMode) this.$emit('closed');
      try {
        this.showModal = false;
        this.selectedCategory = null;
        // Don't clear awardsData if we're in the middle of saving (completing)
        if (!this.savingState) {
          this.awardsData = {};
        }

        this.eligibleOptions = [];
      } catch (error) {
        console.error('🚨 MODAL CLOSE FAILED:', error.message);
        ErrorLogService.error('Error closing Personal Awards modal:', error);
      }
    },
    async saveCurrentState (explicitComplete = false) {
      // Prevent multiple clicks or saves after completion
      if (this.savingState || this.completingYear) {
        return;
      }
      this.savingState = true;

      try {
        // Bug (Matt): "nothing should complete the year except for me
        // clicking complete the year." This used to compute completed from
        // all-categories-decided on EVERY save — and saves fire on every
        // back-slide/reset/close — so merely visiting a fully-decided year
        // silently re-completed it and refreshed availableMovieIds, eating
        // the new-movies prompt. Both now move ONLY on the explicit button.
        const existingData = this.$store.state.settings.personalAwards?.[this.currentYear];
        const isNowComplete = explicitComplete || Boolean(existingData?.completed);

        let movieIds = null;
        if (explicitComplete) {
          // The completion snapshot: what was available when the user
          // declared the year done.
          const moviesForYear = this.getMoviesForYear();
          movieIds = moviesForYear.map(entry => entry?.movie?.id).filter(id => id);
        } else if (existingData?.availableMovieIds) {
          // Intermediate save on a completed year: preserve the snapshot.
          movieIds = existingData.availableMovieIds;
        }

        // Create minimal data structure by removing huge movie objects
        const cleanedCategories = {};
        Object.keys(this.awardsData).forEach(key => {
          const categoryData = this.awardsData[key];
          if (categoryData) {
            cleanedCategories[key] = {
              nominees: (categoryData.nominees || []).map(nominee => this.convertNomineeToMinimal(nominee)).filter(n => n),
              winner: categoryData.winner ? this.convertNomineeToMinimal(categoryData.winner) : null,
              noNominees: categoryData.noNominees || false
            };
          }
        });

        const awardsEntry = {
          completed: isNowComplete,
          lastUpdated: Date.now(),
          categories: cleanedCategories
        };
        // Only when there are some: writing an empty object would have
        // Firebase delete the key anyway, and every year carrying an
        // explicit `customCategories: {}` is noise in the stored shape.
        if (Object.keys(this.customCategories).length) {
          awardsEntry.customCategories = { ...this.customCategories };
        }
        if (movieIds) {
          awardsEntry.availableMovieIds = movieIds;
        }

        // writeDurably (not setDBValue, everywhere in this component) - bug
        // report: personal awards changes should work offline and sync once
        // back online, same as ratings/stickiness/tiebreak. Commits locally
        // first (via applyDbPathLocally) so awardsData/this.$store.state
        // reflects the save immediately regardless of connectivity, then
        // durably queues before attempting the network write. See
        // CLAUDE.md's Offline Support Extension section.
        await this.$store.dispatch('writeDurably', {
          path: `settings/personalAwards/${this.currentYear}`,
          value: awardsEntry
        });

        this.savingState = false;
      } catch (error) {
        console.error('🚨 SAVE PREPARATION FAILED:', error.message);
        ErrorLogService.error('Error saving Personal Awards state:', error);
      }
    },
    initializeAwardsData () {
      try {
        const existingAwards = this.$store.state.settings.personalAwards?.[this.currentYear];
        // Read before the categories branch below: a year can have an award
        // invented but not yet assigned, which leaves customCategories set
        // and `categories` empty.
        this.customCategories = existingAwards?.customCategories || {};
        if (existingAwards && existingAwards.categories) {
          // Expand minimal nominees back to full objects for display
          this.awardsData = {};
          Object.keys(existingAwards.categories).forEach(categoryKey => {
            const categoryData = existingAwards.categories[categoryKey];
            this.awardsData[categoryKey] = {
              nominees: (categoryData.nominees || [])
                .map(nominee => this.expandNomineeFromMinimal(nominee))
                .filter(nominee => nominee !== null), // Remove any that couldn't be expanded
              winner: categoryData.winner ? this.expandNomineeFromMinimal(categoryData.winner) : null,
              noNominees: categoryData.noNominees || false
            };
          });
        } else {
          this.awardsData = {};
        }
      } catch (error) {
        console.error('🚨 INIT FAILED:', error.message);
        ErrorLogService.error('Error initializing awards data:', error);
        this.awardsData = {};
        this.customCategories = {};
      }
      this.awardsDataDirty = false;
    },
    async selectCategory (categoryKey) {
      this.selectedCategory = categoryKey;
      this.showTrashIcon = false; // Reset trash icon when changing categories
      this.loadingOptions = true;
      try {
        this.eligibleOptions = await this.getEligibleOptionsByMovie();

        // Auto-detect empty categories and manage noNominees flag
        this.updateNoNomineesFlag(categoryKey);
      } catch (error) {
        ErrorLogService.error('Error fetching eligible options:', error);
        this.eligibleOptions = []; // Fallback to empty array

        // Still check for empty category even on error
        this.updateNoNomineesFlag(categoryKey);
      } finally {
        this.loadingOptions = false;
      }
    },
    getCurrentCategoryName () {
      const category = this.categories.find(cat => cat.key === this.selectedCategory);
      return category ? category.name : '';
    },
    // --- Custom awards -----------------------------------------------------
    //
    // 2026-08-20: "I could add custom awards... name an award whatever I want
    // and then assign it. So I can basically hand out honorary awards."
    openCustomAwardForm () {
      this.addingCustomAward = true;
      this.customAwardName = '';
      this.customAwardType = 'movie';
      this.customAwardError = null;
      // The input renders on this tick; focusing it saves a second tap on a
      // phone, where the keyboard is the slow part.
      this.$nextTick(() => this.$refs.customAwardInput?.focus?.());
    },
    cancelCustomAward () {
      this.addingCustomAward = false;
      this.customAwardName = '';
      this.customAwardType = 'movie';
      this.customAwardError = null;
    },
    async addCustomAward () {
      const name = this.customAwardName.trim();
      const key = customAwardKey(name);

      // A name of pure punctuation slugs to nothing, which would otherwise be
      // stored under a bare "custom-" prefix.
      if (!key) {
        this.customAwardError = 'Give the award a name.';
        return;
      }
      // Same name, same key (that is what lets a repeated award aggregate
      // across years) — so within ONE year a duplicate would silently
      // overwrite the first. Refuse instead.
      if (this.customCategories[key]) {
        this.customAwardError = 'You already have an award called that this year.';
        return;
      }
      if (this.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
        this.customAwardError = 'That is already one of the categories.';
        return;
      }

      this.customCategories = {
        ...this.customCategories,
        [key]: { name, type: this.customAwardType, createdAt: Date.now() }
      };
      this.cancelCustomAward();
      // Persist before drilling in: an award you invented and then lost to a
      // reload would be worse than not offering it.
      await this.saveCurrentState();
      await this.selectCategory(key);
    },
    /**
     * Remove an invented award, and everything it was holding.
     *
     * Offered from inside the award rather than as an × on its row: the rows
     * are <button>s, and a button inside a button is invalid markup that
     * behaves differently across browsers.
     */
    async removeCustomAward () {
      const key = this.selectedCategory;
      if (!isCustomAwardKey(key)) return;

      const remaining = { ...this.customCategories };
      delete remaining[key];
      this.customCategories = remaining;

      // Its nominees and winner go with it — leaving them orphaned under a
      // key nothing lists any more would keep the award alive in the Trophy
      // Case and in every winner's award history.
      const remainingAwards = { ...this.awardsData };
      delete remainingAwards[key];
      this.awardsData = remainingAwards;

      this.backToCategories();
      await this.saveCurrentState();
    },
    updateNoNomineesFlag (categoryKey) {
      // Safely manage the noNominees flag based on available options and existing nominees
      try {
        // Initialize category data if it doesn't exist
        if (!this.awardsData[categoryKey]) {
          this.awardsData[categoryKey] = { nominees: [], winner: null };
        }

        const categoryData = this.awardsData[categoryKey];
        const hasEligibleOptions = this.eligibleOptions && this.eligibleOptions.length > 0;
        const hasExistingNominees = categoryData.nominees && categoryData.nominees.length > 0;

        if (!hasEligibleOptions && !hasExistingNominees) {
          // No eligible options AND no existing nominees = auto-set noNominees to true
          if (!categoryData.noNominees) {
            categoryData.noNominees = true;
          }
        } else if (hasExistingNominees && categoryData.noNominees) {
          // Has nominees but noNominees is still true = clear the flag
          categoryData.noNominees = false;
        }
        // If there are eligible options but no nominees yet, leave noNominees as-is (user can choose)
      } catch (error) {
        console.error('🚨 Error updating noNominees flag:', error);
        ErrorLogService.error('Error updating noNominees flag:', error);
      }
    },
    ensureDisabledCategoriesMarked () {
      // Check all categories and mark disabled ones as noNominees during completion
      try {
        this.categories.forEach(category => {
          if (this.isCategoryDisabled(category.key)) {
            // Initialize category data if it doesn't exist
            if (!this.awardsData[category.key]) {
              this.awardsData[category.key] = { nominees: [], winner: null };
            }

            const categoryData = this.awardsData[category.key];

            // Only set noNominees if it's not already set and there are no nominees
            if (!categoryData.noNominees && (!categoryData.nominees || categoryData.nominees.length === 0)) {
              categoryData.noNominees = true;
            }
          }
        });
      } catch (error) {
        console.error('🚨 Error marking disabled categories:', error);
        ErrorLogService.error('Error marking disabled categories:', error);
      }
    },
    isCategoryCompleted (categoryKey) {
      const categoryData = this.awardsData[categoryKey];
      // Category is complete if it has nominees + winner OR is marked as no nominees
      return (categoryData && categoryData.nominees?.length > 0 && categoryData.winner) ||
             (categoryData && categoryData.noNominees === true);
    },
    isCategoryDisabled (categoryKey) {
      // Check if there are no eligible options for this category
      if (categoryKey === 'bestAnimatedFeature') {
        const animatedFilms = this.getMoviesForYear().filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Animation')
        );
        return animatedFilms.length === 0;
      } else if (categoryKey === 'bestDocumentaryFeature') {
        const documentaries = this.getMoviesForYear().filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Documentary')
        );
        return documentaries.length === 0;
      }
      return false; // Other categories are never disabled
    },
    getCategoryDisabledReason (categoryKey) {
      if (!this.isCategoryDisabled(categoryKey)) {
        return null;
      }

      if (categoryKey === 'bestAnimatedFeature') {
        return 'No animated films rated this year';
      } else if (categoryKey === 'bestDocumentaryFeature') {
        return 'No documentaries rated this year';
      }

      return null;
    },
    getMoviesForYear () {
      try {
        if (!this.allEntriesWithFlatKeywordsAdded || !Array.isArray(this.allEntriesWithFlatKeywordsAdded)) {
          return [];
        }

        return this.allEntriesWithFlatKeywordsAdded.filter(entry => {
          try {
            if (!entry || !entry.movie || !entry.movie.release_date) {
              return false;
            }
            const yearMatch = new Date(entry.movie.release_date).getFullYear() === this.currentYear;
            const notShort = !entry.movie.runtime || entry.movie.runtime > 40; // Exclude shorts
            return yearMatch && notShort;
          } catch (error) {
            console.error('Error processing movie entry:', entry, error);
            ErrorLogService.error('Error processing movie entry:', entry, error);
            return false;
          }
        });
      } catch (error) {
        console.error('Error in getMoviesForYear:', error);
        ErrorLogService.error('Error in getMoviesForYear:', error);
        return [];
      }
    },
    async getEligibleOptions () {
      // Check cache first
      const cacheKey = `${this.currentYear}-${this.selectedCategory}`;
      if (this.optionsCache[cacheKey]) {
        return this.optionsCache[cacheKey];
      }

      const category = this.categories.find(cat => cat.key === this.selectedCategory);
      if (!category) {
        return [];
      }

      let moviesForYear = this.getMoviesForYear();

      // Apply genre filtering for specific categories
      if (this.selectedCategory === 'bestAnimatedFeature') {
        moviesForYear = moviesForYear.filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Animation')
        );
      } else if (this.selectedCategory === 'bestDocumentaryFeature') {
        moviesForYear = moviesForYear.filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Documentary')
        );
      }

      let options;
      if (category.type === 'movie') {
        options = moviesForYear;
      } else {
        // For person categories, extract people and filter by gender via API
        const allPeople = this.extractPeopleFromMovies(moviesForYear, this.selectedCategory);
        options = await this.filterPeopleByGender(allPeople);
      }

      // Sort by relevant rating category
      const sortedOptions = this.sortOptionsByRelevantRating(options, this.selectedCategory);

      // Cache the results to avoid expensive recomputation
      this.optionsCache[cacheKey] = sortedOptions;

      return sortedOptions;
    },
    async getEligibleOptionsByMovie () {
      // Check cache first
      const cacheKey = `${this.currentYear}-${this.selectedCategory}`;
      if (this.optionsCache[cacheKey]) {
        // For cached data, show all immediately (no API calls needed)
        return this.optionsCache[cacheKey];
      }

      const category = this.categories.find(cat => cat.key === this.selectedCategory);
      if (!category) {
        return {};
      }

      let moviesForYear = this.getMoviesForYear();

      // Apply genre filtering for specific categories
      if (this.selectedCategory === 'bestAnimatedFeature') {
        moviesForYear = moviesForYear.filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Animation')
        );
      } else if (this.selectedCategory === 'bestDocumentaryFeature') {
        moviesForYear = moviesForYear.filter(entry =>
          entry.movie.genres && entry.movie.genres.some(genre => genre.name === 'Documentary')
        );
      }

      // A person-type CUSTOM award returns a flat list of people, not the
      // movie-grouped shape below — that grouping exists for the acting grid,
      // with its per-movie "load more cast". These render in the simple grid,
      // each person over the poster of the film they did it on, exactly like
      // Best Director.
      if (isCustomAwardKey(this.selectedCategory) && category.type === 'person') {
        const people = this.extractCustomAwardPeople(moviesForYear);
        const sortedPeople = this.sortOptionsByRelevantRating(people, this.selectedCategory);
        this.optionsCache[cacheKey] = sortedPeople;
        return sortedPeople;
      }

      if (category.type === 'movie') {
        // For movie categories, use simple array (like old system)
        const sortedMovies = this.sortOptionsByRelevantRating(moviesForYear, this.selectedCategory);

        // Cache and return simple array
        this.optionsCache[cacheKey] = sortedMovies;
        return sortedMovies;
      } else {
        // For acting categories, use movie-grouped approach
        const optionsByMovie = await this.extractAndGroupPeopleByMovie(moviesForYear, this.selectedCategory);

        // Sort movies by their performance rating (same as old system)
        // First create array of movie entries for sorting
        const movieEntries = Object.keys(optionsByMovie).map(movieId => {
          const movieEntry = moviesForYear.find(entry => String(entry.movie.id) === movieId);
          return { movieId, movieEntry };
        }).filter(item => item.movieEntry);

        // Sort movie entries using the same logic as old system
        const sortCriteria = this.getCategorySortKey(this.selectedCategory);
        movieEntries.sort((a, b) => {
          return this.sortResultsLikeMainApp(a.movieEntry, b.movieEntry, sortCriteria);
        });

        // Convert to array to preserve sort order. The score each film was
        // ordered by rides along: the entry is in hand right here, and the
        // header shows it so the ordering is visible rather than looking
        // arbitrary (bug report, 2026-08-21).
        const scoreFor = (movieEntry) => {
          const rating = this.mostRecentRating(movieEntry);
          const raw = sortCriteria === 'rating' ? rating.calculatedTotal : rating[sortCriteria];
          const numeric = Number(raw);
          return Number.isFinite(numeric) ? numeric : null;
        };
        const sortedMovieArray = movieEntries.map(({ movieId, movieEntry }) => ({
          movieId,
          sortScore: scoreFor(movieEntry),
          ...optionsByMovie[movieId]
        }));

        // Cache the results
        this.optionsCache[cacheKey] = sortedMovieArray;

        return sortedMovieArray;
      }
    },
    async extractAndGroupPeopleByMovie (movies, categoryKey) {
      const isActress = categoryKey.includes('Actress');
      const movieGroups = {};

      // Group cast members by movie
      movies.forEach(entry => {
        if (categoryKey === 'bestDirector') {
          const crew = entry.movie.crew || [];
          const directors = crew.filter(person => person.job === 'Director');

          if (directors.length > 0) {
            const directorNames = directors.map(d => d.name);
            movieGroups[entry.movie.id] = {
              movie: entry.movie,
              allCast: [{
                id: `directors-${entry.movie.id}`,
                name: directorNames.join(' & '),
                directors,
                movie: entry.movie,
                movieId: entry.movie.id
              }],
              loadedCast: [],
              hasMore: false,
              isLoading: false
            };
          }
        } else if (categoryKey.includes('Actor') || categoryKey.includes('Actress')) {
          const cast = entry.movie.cast || [];

          // Use full cast list - no artificial limits
          const eligibleCast = cast.map((person, index) => {
            return {
              id: person.id || person.name, // Use name as fallback for grouping
              name: person.name,
              character: person.character,
              movie: entry.movie,
              movieId: entry.movie.id,
              castPosition: index,
              isActress,
              needsGenderCheck: true
            };
          });

          if (eligibleCast.length > 0) {
            movieGroups[entry.movie.id] = {
              movie: entry.movie,
              allCast: eligibleCast,
              loadedCast: [],
              processedIndex: 0, // Track how far into allCast we've processed
              hasMore: eligibleCast.length > 0,
              isLoading: false
            };
          }
        }
      });

      // Load initial cast for each movie (3 people per movie). Movies load
      // CONCURRENTLY through a small worker pool — bug report: "when I'm
      // nominating people... it takes a long time to load the actors." This
      // used to be one movie at a time, each awaiting one person at a time:
      // ~30 movies × 3+ lookups = 90+ back-to-back TMDB round trips, tens
      // of seconds on a phone. Six movies × a 3-person batch keeps peak
      // concurrency around 18 requests, well inside TMDB's limits.
      const movieIds = Object.keys(movieGroups);
      const CONCURRENT_MOVIES = 6;
      let nextMovieIndex = 0;

      const loadInitialCastForMovie = async (movieGroup) => {
        // Load people in batches until we get 3 valid ones (accounting for gender filtering)
        const processedCast = [];
        let currentIndex = 0;

        while (processedCast.length < 3 && currentIndex < movieGroup.allCast.length) {
          const batchSize = 3;
          const castBatch = movieGroup.allCast.slice(currentIndex, currentIndex + batchSize);
          if (castBatch.length === 0) break;

          const filteredBatch = await this.filterCastMembersByGender(castBatch);
          processedCast.push(...filteredBatch);
          currentIndex += batchSize;
        }

        movieGroup.loadedCast = processedCast.slice(0, 3); // Show first 3 valid people
        movieGroup.processedIndex = currentIndex;
        movieGroup.hasMore = currentIndex < movieGroup.allCast.length;
      };

      const workers = Array.from({ length: Math.min(CONCURRENT_MOVIES, movieIds.length) }, async () => {
        while (nextMovieIndex < movieIds.length) {
          const movieGroup = movieGroups[movieIds[nextMovieIndex++]];
          if (movieGroup.allCast.length > 0) {
            await loadInitialCastForMovie(movieGroup);
          }
        }
      });
      await Promise.all(workers);

      // Always surface already-nominated cast members, even when they sit deeper
      // in the cast than the initial 3 loaded above. They were explicitly chosen
      // by the user, so include them regardless of the gender heuristic — we only
      // fetch details for the profile image. Without this a saved nominee shows in
      // the top "Current Nominees" gallery but has no tile in the grid to light up.
      const categoryData = this.awardsData[categoryKey];
      const roleKeyFor = (person) => `${personNomineeKey(person)}-${person.movieId}`;
      const nominatedKeys = new Set(
        (categoryData && categoryData.nominees ? categoryData.nominees : [])
          .map(roleKeyFor)
      );

      if (nominatedKeys.size > 0) {
        for (const movieId of movieIds) {
          const movieGroup = movieGroups[movieId];
          const loadedIds = new Set(movieGroup.loadedCast.map(person => person.id));

          for (const person of movieGroup.allCast) {
            if (loadedIds.has(person.id)) continue;
            if (!nominatedKeys.has(roleKeyFor(person))) continue;

            const details = await this.getDetailsForCastMember(person.name);
            movieGroup.loadedCast.push({ ...person, details, needsGenderCheck: false });
            loadedIds.add(person.id);
          }
        }
      }

      return movieGroups;
    },
    async filterCastMembersByGender (castMembers) {
      // Process a specific set of cast members (same logic as filterPeopleByGender
      // but for subset). The batch's lookups run in PARALLEL (order preserved
      // by Promise.all) — awaiting one person at a time was the inner half of
      // the slow-actor-loading bug report.
      const results = await Promise.all(castMembers.map(async (person) => {
        try {
          if (!person.needsGenderCheck) return person;

          const details = await this.getDetailsForCastMember(person.name);

          // See genderEligibility.js - anything that isn't a definite
          // female/male reading counts for EVERY acting category.
          if (isEligibleForActingCategory(details?.gender, { isActress: person.isActress })) {
            return { ...person, details, needsGenderCheck: false };
          }
          return null;
        } catch (error) {
          console.error('Error filtering cast member by gender:', person.name, error);
          ErrorLogService.error('Error filtering cast member by gender:', person.name, error);
          return null;
        }
      }));

      return results.filter(Boolean);
    },
    // The number this film was ordered by, captured during the sort where
    // the library entry is already in hand. Null rather than a misleading 0
    // when the film has no score for that criterion.
    sortScoreFor (movieGroup) {
      const value = movieGroup?.sortScore;
      return Number.isFinite(value) ? value : null;
    },
    getCategorySortKey (categoryKey) {
      // Map awards categories to Cinema Roll sort keys
      const categoryMappings = {
        bestPicture: 'rating',
        bestDirector: 'direction',
        bestActor: 'performance',
        bestActress: 'performance',
        bestSupportingActor: 'performance',
        bestSupportingActress: 'performance',
        bestScreenplay: 'story',
        bestCinematography: 'imagery',
        bestEditing: 'direction',
        bestScore: 'soundtrack',
        bestVisualEffects: 'imagery',
        bestAnimatedFeature: 'rating',
        bestDocumentaryFeature: 'rating'
      };
      return categoryMappings[categoryKey] || 'rating';
    },
    async loadMoreForMovie (movieId) {
      const movieGroup = this.eligibleOptionsByMovie.find(group => group.movieId === movieId);
      if (!movieGroup || !movieGroup.hasMore || movieGroup.isLoading) return;

      movieGroup.isLoading = true;

      try {
        // Keep loading batches until we get 3 valid people (accounting for gender filtering)
        const newlyLoadedCast = [];
        const targetCount = 3;

        while (newlyLoadedCast.length < targetCount && movieGroup.processedIndex < movieGroup.allCast.length) {
          const batchSize = 3;
          const nextBatch = movieGroup.allCast.slice(movieGroup.processedIndex, movieGroup.processedIndex + batchSize);

          if (nextBatch.length === 0) break;

          const filteredBatch = await this.filterCastMembersByGender(nextBatch);
          newlyLoadedCast.push(...filteredBatch);
          movieGroup.processedIndex += batchSize;
        }

        // Add the new cast members (up to 3) to the loaded cast, skipping anyone
        // already shown — a nominated member deep in the cast may have been
        // surfaced early, so guard against a duplicate (and duplicate :key) here.
        const alreadyLoadedIds = new Set(movieGroup.loadedCast.map(person => person.id));
        movieGroup.loadedCast.push(
          ...newlyLoadedCast.slice(0, targetCount).filter(person => !alreadyLoadedIds.has(person.id))
        );
        movieGroup.hasMore = movieGroup.processedIndex < movieGroup.allCast.length;
      } catch (error) {
        console.error('Error loading more cast for movie:', movieId, error);
        ErrorLogService.error('Error loading more cast for movie:', movieId, error);
      } finally {
        movieGroup.isLoading = false;
      }
    },
    /**
     * Everyone who worked on a film that year — the pool for a person-type
     * custom award ("I definitely need to be able to do honorary awards to
     * people", 2026-08-20).
     *
     * Cast AND crew, because an honorary award is exactly the case the fixed
     * categories don't cover: the composer, the casting director, the stunt
     * double you want to single out. Crew is already trimmed to
     * KEPT_CREW_JOBS on the way into storage, so it is a dozen or so per film;
     * cast is deliberately untrimmed (Six Degrees walks the full billing
     * list), so it is capped here or a ten-film year would render hundreds of
     * tiles.
     *
     * The same person on two films that year appears twice, on purpose — you
     * are honouring them for a piece of work, the way the acting categories
     * already treat a person-plus-film as the unit.
     */
    extractCustomAwardPeople (movies) {
      const people = [];
      const seen = new Set();

      movies.forEach(entry => {
        const movie = entry.movie || {};
        const add = (person, role) => {
          if (!person?.name) return;
          const dedupeKey = `${person.name}|${movie.id}`;
          if (seen.has(dedupeKey)) return;
          seen.add(dedupeKey);
          people.push({
            id: person.id || person.name,
            name: person.name,
            role,
            movie,
            movieId: movie.id,
            // No gender check: that belongs to the four acting categories and
            // nothing else. filterPeopleByGender passes these straight
            // through, which is the point.
            needsGenderCheck: false
          });
        };

        (movie.cast || []).slice(0, CUSTOM_AWARD_CAST_DEPTH)
          .forEach((person) => add(person, person.character || 'Cast'));
        (movie.crew || []).forEach((person) => add(person, person.job || 'Crew'));
      });

      return people;
    },
    extractPeopleFromMovies (movies, categoryKey) {
      if (isCustomAwardKey(categoryKey)) {
        return this.extractCustomAwardPeople(movies);
      }

      const people = [];

      movies.forEach(entry => {
        if (categoryKey === 'bestDirector') {
          const crew = entry.movie.crew || [];
          const directors = crew.filter(person => person.job === 'Director');

          if (directors.length > 0) {
            // Check if we already have an entry for this movie
            const existingEntry = people.find(p => p.movieId === entry.movie.id);

            if (!existingEntry) {
              // Create a single entry for the movie with all directors
              const directorNames = directors.map(d => d.name);
              people.push({
                id: `directors-${entry.movie.id}`,
                name: directorNames.join(' & '), // Combine director names
                directors, // Store all director info
                movie: entry.movie,
                movieId: entry.movie.id
              });
            }
          }
        } else if (categoryKey.includes('Actor') || categoryKey.includes('Actress')) {
          const isActress = categoryKey.includes('Actress');
          const isSupporting = categoryKey.includes('Supporting');

          const cast = entry.movie.cast || [];

          // We'll need to make API calls to get proper gender and profile_path data
          // For now, store the cast members and we'll process them with API calls later
          cast.forEach((person, index) => {
            // Basic eligibility check by position first
            let eligible = false;
            if (isSupporting) {
              eligible = index < 10; // Top 8 for supporting
            } else {
              eligible = index < 5; // Top 4 for leads
            }

            if (eligible && !people.find(p => p.name === person.name && p.movieId === entry.movie.id)) {
              people.push({
                id: person.id || person.name, // Use name as fallback for grouping
                name: person.name,
                character: person.character,
                movie: entry.movie,
                movieId: entry.movie.id,
                castPosition: index,
                isActress, // Store which category this is for
                needsGenderCheck: true // Flag that we need to check gender via API
              });
            }
          });
        }
      });

      return people;
    },
    async getDetailsForCastMember (actorName) {
      // Check in-memory cache first
      if (this.personDetailsCache[actorName]) {
        return this.personDetailsCache[actorName];
      }

      // Concurrent callers share one request per name — the parallel grid
      // loading would otherwise fetch the same actor once per movie they
      // appear in, since the caches are only written after the response.
      if (!this.personDetailsInFlight[actorName]) {
        this.personDetailsInFlight[actorName] = this.fetchDetailsForCastMember(actorName)
          .finally(() => { delete this.personDetailsInFlight[actorName]; });
      }
      return this.personDetailsInFlight[actorName];
    },
    async fetchDetailsForCastMember (actorName) {
      // Check localStorage fallback (helpful for iOS PWAs with memory pressure)
      try {
        const cacheKey = `person_${actorName}_${this.currentYear}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsedData = JSON.parse(cached);
          const isExpired = Date.now() - parsedData.timestamp > (24 * 60 * 60 * 1000); // 24 hours
          if (!isExpired) {
            this.personDetailsCache[actorName] = parsedData.data;
            return parsedData.data;
          } else {
            localStorage.removeItem(cacheKey);
          }
        }
      } catch (error) {
        console.warn('LocalStorage cache read failed:', error);
      }

      // Fetch from TMDb API
      const query = encodeURIComponent(actorName);
      const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${query}`;
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to fetch from TMDB');
        }
        const data = await response.json();
        const personDetails = data.results && data.results.length > 0 ? data.results[0] : null;

        // Cache the result in memory
        this.personDetailsCache[actorName] = personDetails;

        // Also cache in localStorage for persistence (especially helpful on iOS PWAs)
        try {
          const cacheKey = `person_${actorName}_${this.currentYear}`;
          const cacheData = {
            data: personDetails,
            timestamp: Date.now()
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (error) {
          console.warn('LocalStorage cache write failed:', error);
        }

        return personDetails;
      } catch (error) {
        console.error('Error fetching TMDB person:', error);
        ErrorLogService.error('Error fetching TMDB person:', error);
        // Cache the null result to avoid retrying failed requests
        this.personDetailsCache[actorName] = null;

        // Also cache the failure in localStorage
        try {
          const cacheKey = `person_${actorName}_${this.currentYear}`;
          const cacheData = {
            data: null,
            timestamp: Date.now()
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheData));
        } catch (localStorageError) {
          console.warn('LocalStorage cache write failed:', localStorageError);
        }

        return null;
      }
    },
    cleanupLocalStorageCache () {
      // Clean up old person cache entries from localStorage
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('person_')) {
            try {
              const cached = localStorage.getItem(key);
              if (cached) {
                const parsedData = JSON.parse(cached);
                const isExpired = Date.now() - parsedData.timestamp > (24 * 60 * 60 * 1000); // 24 hours
                if (isExpired) {
                  keysToRemove.push(key);
                }
              }
            } catch {
              // Invalid entry, mark for removal
              keysToRemove.push(key);
            }
          }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
      } catch (error) {
        console.warn('LocalStorage cleanup failed:', error);
      }
    },
    async filterPeopleByGender (people) {
      // Filter people by gender using TMDb API calls (same as FavoriteActors.vue).
      // Parallel for the same reason as filterCastMembersByGender — this list
      // can be dozens of people, and one-at-a-time awaits were a visible wait.
      const results = await Promise.all(people.map(async (person) => {
        try {
          if (!person.needsGenderCheck) return person;

          const details = await this.getDetailsForCastMember(person.name);

          // Shared with the cast-grouping path above (genderEligibility.js).
          // This branch used to exclude TMDB gender 0 ("not specified") from
          // BOTH actor and actress categories, so those people could never
          // be nominated at all - while the other path included them.
          if (isEligibleForActingCategory(details?.gender, { isActress: person.isActress })) {
            return {
              ...person,
              details, // Include the full TMDb details
              needsGenderCheck: false
            };
          }
          return null;
        } catch (error) {
          console.error('Error filtering person by gender:', person.name, error);
          ErrorLogService.error('Error filtering person by gender:', person.name, error);
          // Skip this person - don't let one API failure crash everything
          return null;
        }
      }));

      return results.filter(Boolean);
    },
    getOptionId (option) {
      try {
        if (!option) return 'unknown';

        // Best Director options are identified by movie, regardless of object
        // shape. A freshly-computed option is a movie-group ({ movieId, movie,
        // allCast }) with no top-level `id`, but a nominee restored from saved
        // (minimal) storage carries a top-level `id` ("directors-<movieId>").
        // Without normalizing here, getOptionId would classify the two shapes
        // differently (movie-X vs person-...), so a saved Best Director
        // nominee/winner would not light up in the grid when the year is
        // reopened (it shows in the top gallery, which renders nominees directly).
        if (this.selectedCategory === 'bestDirector') {
          const movieId = (option.movie && option.movie.id) || option.movieId;
          return `movie-${movieId || 'unknown'}`;
        }

        if (option.movie && !option.id) {
          // This is a movie option
          return `movie-${option.movie.id || 'unknown'}`;
        } else {
          // This is a person option. Keyed through personNomineeKey, not the
          // raw id: a saved nominee and a freshly-computed grid option for
          // the same actor routinely carry DIFFERENT ids (see
          // samePersonNominee), and an id-keyed string made them two people.
          return `person-${personNomineeKey(option)}-${option.movieId || 'unknown'}`;
        }
      } catch (error) {
        console.error('Error getting option ID:', option, error);
        ErrorLogService.error('Error getting option ID:', option, error);
        return 'error';
      }
    },
    getOptionTitle (option) {
      try {
        if (!option) return 'Unknown';

        // Special case for Best Director - extract director name from movie-grouped data structure
        if (this.selectedCategory === 'bestDirector') {
          // For Best Director, option might be a movie group with allCast containing director info
          if (option.allCast && option.allCast.length > 0) {
            return option.allCast[0].name || 'Unknown Director';
          }
          // Fallback: if it's already a director object with name
          if (option.name) {
            return option.name;
          }
          // Fallback: extract from movie crew
          if (option.movie && option.movie.crew) {
            const directors = option.movie.crew.filter(person => person.job === 'Director');
            if (directors.length > 0) {
              return directors.map(d => d.name).join(' & ');
            }
          }
          return 'Unknown Director';
        }

        if (option.movie && !option.id) {
          // This is a movie option
          return option.movie.title || 'Unknown Movie';
        } else {
          // This is a person option
          return option.name || 'Unknown Person';
        }
      } catch (error) {
        console.error('Error getting option title:', option, error);
        ErrorLogService.error('Error getting option title:', option, error);
        return 'Error';
      }
    },
    getOptionMovie (option) {
      if (option.movie && !option.id) {
        // This is a movie option, no separate movie line needed
        return null;
      } else {
        // This is a person option, show just the movie title
        return option.movie.title;
      }
    },
    getOptionRole (option) {
      if (option.movie && !option.id) {
        // This is a movie option, no role to show
        return null;
      } else {
        // This is a person option, show just the character/role. `role` is
        // the custom-award pool's field — a character for cast, a job for
        // crew, since an honorary award can go to either.
        return option.character || option.role || null;
      }
    },
    // The sibling acting category (lead vs supporting) already holding this
    // person for this movie, or null — see personalAwards.js.
    siblingConflictFor (option) {
      if (!this.isActingCategory(this.selectedCategory)) return null;
      return actingSiblingConflict(this.selectedCategory, option, this.awardsData);
    },
    siblingConflictLabel (option) {
      const sibling = this.siblingConflictFor(option);
      const name = PERSONAL_AWARD_CATEGORIES.find((category) => category.key === sibling)?.name || sibling;
      return name ? name.replace(/^Best /, '') : '';
    },
    toggleNominee (option) {
      this.awardsDataDirty = true;
      const categoryData = this.awardsData[this.selectedCategory] || { nominees: [], winner: null };

      // Adding while the sibling category holds the same person+movie is
      // blocked (the tile's badge explains why); REMOVING an existing
      // nomination is always allowed, which is also how a historical
      // double-nomination gets cleaned up.
      if (this.isActingCategory(this.selectedCategory) && !this.isNominee(option) && this.siblingConflictFor(option)) {
        return;
      }

      if (this.isActingCategory(this.selectedCategory)) {
        // For acting categories, handle multi-role nominations
        this.toggleActorNomination(option, categoryData);
      } else {
        // For non-acting categories, use simple single nomination logic
        this.toggleSingleNomination(option, categoryData);
      }

      this.awardsData[this.selectedCategory] = categoryData;
    },

    toggleActorNomination (option, categoryData) {
      // Whether this person is already nominated is answered by the NOMINEE
      // LIST, never by whether we can still find them in the grid. It used
      // to be the latter: `getAllActorRolesInYear` scans the loaded grid,
      // and if it came back empty — their film is no longer among the year's
      // eligible movies, or the grid hadn't finished loading — the removal
      // branch was skipped and the add branch then pushed the empty list.
      // The × on a saved nominee's poster did nothing whatsoever, forever
      // (report -P1oV4wiVPs-5rAyJ9AN). Removal must not depend on the grid;
      // it is the one action a user can't work around.
      const hasAnyNomination = categoryData.nominees.some(nom => samePersonNominee(nom, option));

      if (hasAnyNomination) {
        // Remove all roles for this actor
        categoryData.nominees = categoryData.nominees.filter(nom => !samePersonNominee(nom, option));

        // If any of their roles was the winner, clear winner
        if (categoryData.winner && samePersonNominee(categoryData.winner, option)) {
          categoryData.winner = null;
        }
      } else {
        // Add all roles for this actor. Falling back to the tapped option
        // itself keeps a tap meaningful if the grid scan finds nothing.
        const allActorRoles = this.getAllActorRolesInYear(option);
        const rolesToAdd = allActorRoles.length > 0 ? allActorRoles : [option];
        const wasEmpty = categoryData.nominees.length === 0;

        rolesToAdd.forEach(role => {
          categoryData.nominees.push(role);
        });

        // Clear the "no nominees" flag if it was set
        if (categoryData.noNominees) {
          categoryData.noNominees = false;
        }

        // If we just added nominees, scroll to the right to show them
        if (!wasEmpty) {
          this.$nextTick(() => {
            this.scrollNomineesToRight();
          });
        }
      }
    },

    toggleSingleNomination (option, categoryData) {
      const optionId = this.getOptionId(option);
      const existingIndex = categoryData.nominees.findIndex(nom => this.getOptionId(nom) === optionId);

      if (existingIndex >= 0) {
        // Remove nominee
        categoryData.nominees.splice(existingIndex, 1);
        // If this was the winner, clear winner
        if (categoryData.winner && this.getOptionId(categoryData.winner) === optionId) {
          categoryData.winner = null;
        }
      } else {
        // Add nominee
        const wasEmpty = categoryData.nominees.length === 0;
        categoryData.nominees.push(option);
        // Clear the "no nominees" flag if it was set
        if (categoryData.noNominees) {
          categoryData.noNominees = false;
        }

        // If we just added a nominee, scroll to the right to show it
        if (!wasEmpty) {
          this.$nextTick(() => {
            this.scrollNomineesToRight();
          });
        }
      }
    },

    getAllActorRolesInYear (actor) {
      // Find all roles for this actor across all movies in the current year.
      // Takes the whole person, not an id — see samePersonNominee for why an
      // id alone doesn't identify anyone here.
      const allRoles = [];
      const seenRoles = new Set(); // Prevent duplicates

      if (this.isActingCategory(this.selectedCategory)) {
        // Search through the movie-grouped data
        this.eligibleOptionsByMovie.forEach(movieGroup => {
          const collect = (people) => {
            (people || []).forEach(person => {
              if (!samePersonNominee(person, actor)) return;
              const roleKey = `${person.movie.id}-${person.character || 'unknown'}`;
              if (seenRoles.has(roleKey)) return;
              allRoles.push(person);
              seenRoles.add(roleKey);
            });
          };
          // allCast holds cast we haven't surfaced yet; loadedCast the visible three.
          collect(movieGroup.allCast);
          collect(movieGroup.loadedCast);
        });
      }

      return allRoles;
    },
    scrollNomineesToRight () {
      // Find the nominees gallery and scroll to the right
      const gallery = document.querySelector('.current-nominees-gallery');
      if (gallery) {
        gallery.scrollTo({
          left: gallery.scrollWidth,
          behavior: 'smooth'
        });
      }
    },
    selectWinner (option) {
      this.awardsDataDirty = true;
      const categoryData = this.awardsData[this.selectedCategory] || { nominees: [], winner: null };
      categoryData.winner = option;
      this.awardsData[this.selectedCategory] = categoryData;

      // Save removed - will save on Back/Complete/Close only
    },
    isNominee (option) {
      const categoryData = this.awardsData[this.selectedCategory];
      if (!categoryData || !categoryData.nominees) return false;

      if (this.isActingCategory(this.selectedCategory)) {
        // For acting categories, check if any role for this actor is nominated
        return categoryData.nominees.some(nom => samePersonNominee(nom, option));
      } else {
        // For non-acting categories, check exact match
        const optionId = this.getOptionId(option);
        return categoryData.nominees.some(nom => this.getOptionId(nom) === optionId);
      }
    },
    isWinner (option) {
      const categoryData = this.awardsData[this.selectedCategory];
      if (!categoryData || !categoryData.winner) return false;

      if (this.isActingCategory(this.selectedCategory)) {
        // For acting categories, check if this actor is the winner (any role)
        return samePersonNominee(categoryData.winner, option);
      } else {
        // For non-acting categories, check exact match
        return this.getOptionId(categoryData.winner) === this.getOptionId(option);
      }
    },
    getCurrentNominees () {
      const categoryData = this.awardsData[this.selectedCategory];
      if (!categoryData || !categoryData.nominees) return [];

      if (this.isActingCategory(this.selectedCategory)) {
        // For acting categories, group by actor and show combined roles
        return this.getGroupedActorNominees(categoryData.nominees);
      } else {
        // For non-acting categories, return nominees as-is
        return categoryData.nominees;
      }
    },

    getGroupedActorNominees (nominees) {
      // Group nominees by actor ID
      const groupedByActor = {};

      nominees.forEach(nominee => {
        const actorId = personNomineeKey(nominee);

        // Try to find profile image from grid data if nominee doesn't have one
        if (!nominee.details || !nominee.details.profile_path) {
          // Look for this actor in the visible grid to get their profile image
          const gridActor = this.findActorInGrid(nominee.name);
          if (gridActor && gridActor.details && gridActor.details.profile_path) {
            nominee.details = gridActor.details;
          }
        }

        if (!groupedByActor[actorId]) {
          // Use the nominee with the best profile image as the base
          groupedByActor[actorId] = {
            ...nominee, // Base data from first role
            allRoles: [] // Array to store all roles
          };
        } else {
          // If this nominee has a better profile image, use it as the base
          if (nominee.details && nominee.details.profile_path &&
              (!groupedByActor[actorId].details || !groupedByActor[actorId].details.profile_path)) {
            groupedByActor[actorId].details = nominee.details;
          }
        }
        groupedByActor[actorId].allRoles.push(nominee);
      });

      const result = Object.values(groupedByActor);

      return result;
    },

    getGroupedRolesByMovie (roles) {
      // Group roles by movie to avoid duplicate movie titles
      const movieGroups = {};

      roles.forEach(role => {
        const movieId = role.movie.id;
        if (!movieGroups[movieId]) {
          movieGroups[movieId] = {
            movieId,
            movieTitle: role.movie.title,
            characters: []
          };
        }
        if (role.character && !movieGroups[movieId].characters.includes(role.character)) {
          movieGroups[movieId].characters.push(role.character);
        }
      });

      return Object.values(movieGroups);
    },

    findActorInGrid (actorName) {
      // Search through all visible actors in the grid to find profile image data
      for (const movieGroup of this.eligibleOptionsByMovie) {
        // Check loadedCast (visible actors)
        if (movieGroup.loadedCast) {
          const foundActor = movieGroup.loadedCast.find(actor => actor.name === actorName);
          if (foundActor && foundActor.details && foundActor.details.profile_path) {
            return foundActor;
          }
        }
        // Also check allCast in case it has better data
        if (movieGroup.allCast) {
          const foundActor = movieGroup.allCast.find(actor => actor.name === actorName);
          if (foundActor && foundActor.details && foundActor.details.profile_path) {
            return foundActor;
          }
        }
      }
      return null;
    },
    getCategoryNomineeCount (categoryKey) {
      const categoryData = this.awardsData[categoryKey];
      if (!categoryData) return 0;
      if (categoryData.noNominees) return 0; // Show 0 for "no nominees" categories
      // People, not nominations: an actor nominated in two films is one
      // nominee (bug report, 2026-08-21). The stored per-movie entries are
      // untouched - only the count reads differently.
      return distinctNomineeCount(categoryData.nominees);
    },
    getCategoryWinner (categoryKey) {
      const categoryData = this.awardsData[categoryKey];
      if (!categoryData || !categoryData.winner) return null;

      // Full title, never truncated — house rule: names and titles are not
      // clamped; there's a whole row of horizontal room here.
      return this.getOptionTitle(categoryData.winner);
    },
    // The winning movie's backdrop, laid behind the category row as a
    // banner (feedback: "the poster's always nicer... maybe the banner
    // image"). Movie winners ARE library entries (entry-level
    // customBackdropPath wins, same as Home's banner); person winners carry
    // their movie under .movie.
    categoryBannerStyle (categoryKey) {
      const winner = this.awardsData[categoryKey]?.winner;
      const backdrop = winner?.customBackdropPath || winner?.movie?.backdrop_path;
      if (!backdrop) return null;
      const url = `https://image.tmdb.org/t/p/w500${backdrop}`;
      // Left-heavy scrim keeps the text legible; the image reveals toward
      // the chevron end.
      return {
        backgroundImage: `linear-gradient(90deg, rgba(13, 13, 13, 0.94) 0%, rgba(13, 13, 13, 0.82) 45%, rgba(13, 13, 13, 0.35) 100%), url(${url})`,
        backgroundPosition: 'center',
        backgroundSize: 'cover'
      };
    },
    isCategoryMarkedAsNoNominees (categoryKey) {
      const categoryData = this.awardsData[categoryKey];
      return categoryData && categoryData.noNominees === true;
    },
    hasNewMoviesForYear (year, existingAwards) {
      // Check if there are new movies for this year since last awards completion
      if (!existingAwards.lastUpdated || !existingAwards.availableMovieIds) {
        return true; // Legacy data or no previous awards data
      }

      const currentMovieIds = this.allEntriesWithFlatKeywordsAdded
        .filter(entry => {
          const entryYear = new Date(entry.movie.release_date).getFullYear();
          const notShort = !entry.movie.runtime || entry.movie.runtime > 40;
          return entryYear === year && notShort;
        })
        .map(entry => entry.movie.id);

      // Check if any current movie IDs are missing from the stored list
      return currentMovieIds.some(id => !existingAwards.availableMovieIds.includes(id));
    },
    getNewMoviesForYear (year, existingAwards) {
      // Get the list of movies that weren't available when awards were last completed
      if (!existingAwards.availableMovieIds) {
        return []; // No stored movie list, can't determine what's new
      }

      return this.allEntriesWithFlatKeywordsAdded.filter(entry => {
        const entryYear = new Date(entry.movie.release_date).getFullYear();
        const notShort = !entry.movie.runtime || entry.movie.runtime > 40;
        const isNewMovie = !existingAwards.availableMovieIds.includes(entry.movie.id);
        return entryYear === year && notShort && isNewMovie;
      });
    },
    sortOptionsByRelevantRating (options, categoryKey) {
      // Map awards categories to Cinema Roll sort keys (same as dropdown)
      const categoryMappings = {
        bestPicture: 'rating', // Overall calculated total
        bestDirector: 'direction',
        bestActor: 'performance',
        bestActress: 'performance',
        bestSupportingActor: 'performance',
        bestSupportingActress: 'performance',
        bestScreenplay: 'story',
        bestCinematography: 'imagery',
        bestEditing: 'direction', // Close to direction
        bestScore: 'soundtrack',
        bestVisualEffects: 'imagery',
        bestAnimatedFeature: 'rating',
        bestDocumentaryFeature: 'rating'
      };

      const sortCriteria = categoryMappings[categoryKey] || 'rating';

      // Convert person options to their corresponding movie entries for sorting
      const optionsWithMovieData = options.map(option => {
        if (option.movie && !option.movieId) {
          // This is already a movie entry
          return option;
        } else {
          // This is a person option - find the movie entry
          const movieEntry = this.allEntriesWithFlatKeywordsAdded.find(entry => entry.movie.id === option.movieId);
          // Return the movie entry but keep the original option data
          return { ...movieEntry, originalOption: option };
        }
      }).filter(entry => entry); // Remove any null entries

      // Sort using the exact same logic as the main app
      const sortedMovieData = optionsWithMovieData.sort((a, b) => {
        return this.sortResultsLikeMainApp(a, b, sortCriteria);
      });

      // Convert back to original options (person or movie)
      return sortedMovieData.map(entry => entry.originalOption || entry);
    },
    sortResultsLikeMainApp (a, b, sortKey) {
      // Exact copy of Home.vue's sortResults method
      const sortValueA = this.getSortValue(a, sortKey);
      const sortValueB = this.getSortValue(b, sortKey);

      if (sortValueA === sortValueB) {
        const secondarySortValueA = this.mostRecentRating(a).calculatedTotal;
        const secondarySortValueB = this.mostRecentRating(b).calculatedTotal;

        if (secondarySortValueA < secondarySortValueB) {
          return 1; // Always sort best on top for awards
        }
        if (secondarySortValueA > secondarySortValueB) {
          return -1; // Always sort best on top for awards
        }
        return 0;
      }

      if (sortValueA < sortValueB) {
        return 1; // Always sort best on top for awards
      }
      if (sortValueA > sortValueB) {
        return -1; // Always sort best on top for awards
      }

      return 0;
    },
    getSortValue (item, key) {
      // Exact copy of Home.vue's getSortValue method
      if (key === "rating") {
        return this.mostRecentRating(item).calculatedTotal;
      } else if (key === "release") {
        return new Date(item.movie.release_date);
      } else if (key === "title") {
        return item.movie.title;
      } else if (key === "watched") {
        const date = this.mostRecentRating(item).date || "3/22/1982";
        return new Date(date);
      } else if (key === "views") {
        return item.ratings.length;
      } else {
        const keyScore = parseInt(this.mostRecentRating(item)[key]);
        const keysToCompare = ["direction", "imagery", "impression", "love", "performance", "soundtrack", "stickiness", "story"];
        const isKeyScoreHighestScore = keysToCompare.some((keyToCompare) => {
          const keyToCompareScore = parseInt(this.mostRecentRating(item)[keyToCompare]);
          return keyToCompareScore >= keyScore;
        });
        return isKeyScoreHighestScore ? keyScore : 0;
      }
    },
    mostRecentRating (media) {
      try {
        // Use the same mostRecentRating logic as the main app
        return getRating(media) || { calculatedTotal: 0 };
      } catch (error) {
        console.error('Error getting most recent rating:', media, error);
        ErrorLogService.error('Error getting most recent rating:', media, error);
        return { calculatedTotal: 0 };
      }
    },
    convertNomineeToMinimal (nominee) {
      // Convert nominees to minimal storage format while preserving role data
      if (!nominee) return null;

      // Handle director movie-group structure: { allCast: [{name, directors, movieId}], movie: {...} }
      if (nominee.allCast && nominee.allCast.length > 0 && nominee.movie) {
        const director = nominee.allCast[0];
        return {
          type: 'person',
          id: director.id,
          name: director.name,
          movieId: nominee.movie.id,
          directors: director.directors
        };
      }

      // Check if this is a person nominee (has name and movieId)
      if (nominee.name && nominee.movieId) {
        // This is a person (actor/actress/director)
        const minimal = {
          type: 'person',
          id: nominee.id,
          name: nominee.name,
          movieId: nominee.movieId
        };

        // Preserve role-specific data
        if (nominee.character) {
          minimal.character = nominee.character; // For actors/actresses
        }
        if (nominee.directors) {
          minimal.directors = nominee.directors; // For directors
        }
        if (nominee.details && nominee.details.profile_path) {
          minimal.profilePath = nominee.details.profile_path; // For display
        }

        return minimal;
      } else if (nominee.movie) {
        // Check if this is a movie nominee (has movie property)
        // This is a movie entry
        return {
          type: 'movie',
          movieId: nominee.movie.id
          // No additional role data needed for movies
        };
      }

      // Fallback - unknown structure
      console.warn('🤔 Unknown nominee structure:', nominee);
      return nominee;
    },
    expandNomineeFromMinimal (minimalNominee) {
      return expandNomineeFromMinimalShared(minimalNominee, this.allEntriesWithFlatKeywordsAdded);
    },
    isActingCategory (categoryKey) {
      // An invented award is never an acting category, whatever it is called.
      // Slugs are lowercase so `includes('Actor')` cannot match one today —
      // but "Best Actor Impression" relying on letter case for correctness is
      // luck, not design. Gender gating and the lead/supporting sibling
      // conflict both hang off this.
      if (isCustomAwardKey(categoryKey)) return false;
      return categoryKey && (categoryKey.includes('Actor') || categoryKey.includes('Actress'));
    },
    shouldShowTextOverlay (categoryKey) {
      // Show text overlay for Best Director, the acting categories, and any
      // person-type custom award — a tile showing a film's poster has to say
      // WHICH person it stands for. Hidden for movie categories, where the
      // poster is the answer.
      if (this.isCustomPersonCategory(categoryKey)) return true;
      return categoryKey === 'bestDirector' || this.isActingCategory(categoryKey);
    },
    isCustomPersonCategory (categoryKey) {
      if (!isCustomAwardKey(categoryKey)) return false;
      return this.categories.find((category) => category.key === categoryKey)?.type === 'person';
    },
  }
};
</script>

<style lang="scss">
@import '@/assets/scss/prompt-card';

.personal-awards {
  .awards-notice {
    text-align: center;

    .alert-link {
      cursor: pointer;
    }
  }

  .cinemaroll-modal-body {
    padding-top: 0 !important;
  }

  .awards-header {
    padding: 1rem 0;

    h2 {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .new-movies-card {
      background: #161616;
      border: 1px solid #2e2e2e;
      border-radius: 10px;
      margin-top: 0.75rem;
      padding: 0.75rem 1rem 0.25rem;
    }

    .new-movies-title {
      color: #eee;
      font-size: 0.95rem;
      margin-bottom: 0.75rem;
    }

    .new-movies-row {
      /* House poster-row shape: fixed image heights, tops and bottoms
         aligned, captions flow freely below, horizontal scroll as needed. */
      align-items: flex-start;
      display: flex;
      gap: 0.75rem;
      overflow-x: auto;
      padding-bottom: 0.25rem;
    }

    .new-movie-card {
      flex: 0 0 92px;
      width: 92px;
    }

    .new-movie-poster {
      border: 1px solid #2e2e2e;
      border-radius: 6px;
      display: block;
      height: 138px;
      object-fit: cover;
      width: 92px;
    }

    .new-movie-poster-blank {
      align-items: center;
      background: #222;
      color: #ccc;
      display: flex;
      font-size: 0.7rem;
      justify-content: center;
      padding: 0.25rem;
      text-align: center;
    }

  }

  .awards-form {
    min-height: 500px;

    .category-grid {
      .category-buttons {
        display: grid;
        gap: 8px;
        /* One full-width row per category — the list pane of the drill. */
        grid-template-columns: 1fr;
        padding: 0 4px;


        .category-btn {
          align-items: center;
          background: #161616;
          border: 1px solid #2e2e2e;
          border-radius: 10px;
          color: #eee;
          display: flex;
          gap: 0.75rem;
          justify-content: space-between;
          min-height: 60px;
          padding: 0.7rem 0.9rem;
          text-align: left;
          transition: transform 0.1s, background-color 0.1s;

          &:active {
            background: #1f1f1f;
            transform: scale(0.985);
          }

          &.has-banner {
            border-color: #3a3a3a;
            min-height: 72px;

            .category-name,
            .category-winner {
              text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
            }

            .category-chevron {
              color: rgba(255, 255, 255, 0.75);
            }

            &:active {
              /* background-image rows can't darken via background-color;
                 press feedback stays on the scale. */
              transform: scale(0.985);
            }
          }

          &.disabled {
            cursor: not-allowed;
            opacity: 0.4;
          }

          .category-row-main {
            display: flex;
            flex-direction: column;
            min-width: 0;
            row-gap: 2px;
          }

          .category-name {
            font-size: 0.9rem;
            font-weight: 600;
            line-height: 1.2;
          }

          .category-meta {
            color: #999;
            font-size: 0.75rem;
          }

          .category-winner {
            color: #ffd700;
            font-size: 0.75rem;
            line-height: 1.2;
          }

          .category-no-nominees {
            color: #999;
            font-size: 0.75rem;
            font-style: italic;
          }

          .category-row-side {
            align-items: center;
            column-gap: 0.5rem;
            display: flex;
            flex: 0 0 auto;
          }

          /* The slide-over affordance: every enabled row points right. */
          .category-chevron {
            color: #777;
            font-size: 0.9rem;
          }

          .green-checkmark {
            align-items: center;
            background-color: #28a745;
            border-radius: 50%;
            color: white;
            display: flex;
            font-size: 0.75rem;
            height: 16px;
            justify-content: center;
            width: 16px;
          }
        }
      }
    }

    .category-detail {
      display: flex;
      flex-direction: column;

      .section-title {
        font-size: 0.85em;
        font-weight: 600;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
        text-transform: uppercase;

        .instruction-text {
          font-size: 0.75em;
          font-style: italic;
          font-weight: 400;
          letter-spacing: normal;
          opacity: 0.8;
          text-transform: none;
        }
      }

      .nominees-grid {
        display: grid;
        gap: 6px;
        grid-template-columns: repeat(3, 1fr);
        margin-bottom: 16px;

        @media (min-width: 576px) {
          gap: 8px;
        }

        /* A tile blocked by its lead/supporting sibling reads as inert. */
        .nominee-tile.sibling-conflict:not(.winner) {
          cursor: default;
          filter: grayscale(0.6);
          opacity: 0.55;
        }

        .nominee-tile {
          aspect-ratio: 2/3;
          border-radius: 6px;
          cursor: pointer;
          overflow: hidden;
          position: relative;
          transition: border-color 0.1s, box-shadow 0.1s;
          will-change: border-color, box-shadow;

          &.text-bg-dark {
            border: 2px solid #6c757d;

            &.winner {
              border-color: #28a745;
              box-shadow: 0 0 0 2px rgba(40,167,69,0.4);
            }
          }

          .nominee-image {
            height: 100%;
            left: 0;
            position: absolute;
            top: 0;
            width: 100%;

            img {
              height: 100%;
              object-fit: cover;
              width: 100%;
            }
          }

          .nominee-status-overlay {
            position: absolute;
            right: 4px;
            top: 4px;
            z-index: 2;

            .status-icon {
              background: rgba(0,0,0,0.7);
              border-radius: 4px;
              color: white;
              font-size: 0.9em;
              padding: 2px 4px;

              &.winner {
                background: rgba(0, 0, 0, 0.75);
                color: #ffd700;
              }

              &.nominee {
                background: #28a745; // Green circle background
                color: white; // White checkmark
                border-radius: 50%; // Make it circular
                width: 20px; // Fixed width for circle
                height: 20px; // Fixed height for circle
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 0.8em; // Smaller checkmark to fit in circle
                font-weight: bold;
              }
            }
          }

          .nominee-info-overlay {
            background: linear-gradient(transparent, rgba(0,0,0,0.8));
            bottom: 0;
            color: white;
            left: 0;
            padding: 8px 6px 6px;
            position: absolute;
            right: 0;

            .nominee-title {
              font-size: 0.75em;
              font-weight: 600;
              line-height: 1.2;
              margin-bottom: 1px;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;

              &.allow-wrap {
                white-space: normal;
                text-overflow: unset;
                overflow: visible;
              }
            }

            .nominee-subtitle {
              font-size: 0.65em;
              opacity: 0.9;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .nominee-movie {
              font-size: 0.65em;
              opacity: 0.9;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              margin-bottom: 1px;
            }

            .nominee-conflict {
              color: #ffd54f;
              font-size: 0.6em;
              font-weight: 600;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .nominee-role {
              font-size: 0.6em;
              opacity: 0.8;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              font-style: italic;
            }
          }
        }
      }

      .sticky-top-section {
        background: #000000;
        border-bottom: 1px solid #333;
        /* Full-bleed within the drill pane (its 1rem inset is cancelled
           here and restored as inner padding), sticky against the page
           scroll so the nominees stay in view while browsing the grids. */
        margin: 0 -1rem;
        padding: 12px 1rem 8px;
        position: sticky;
        top: 0;
        z-index: 10;

        /* Was `.category-header h5`, styling a wrapper that no longer exists
           — a dead rule, which is how the category name came to be missing
           from this pane entirely. The h5 carries the class itself now. */
        .category-header-row {
          /* Link pinned to the left edge, titles block to the right edge -
             "put that on the right edge and keep the categories link on the
             left edge" (2026-08-21). Centered vertically rather than
             baseline-aligned: the right side is two stacked lines, and the
             link should sit level with the block, not with the first line's
             baseline. */
          align-items: center;
          display: flex;
          gap: 0.75rem;
          justify-content: space-between;
        }

        .category-header-titles {
          text-align: right;
        }

        /* Inside the header row the heading is one of two stacked lines on
           the right, not a section break - kill the section-title's own
           spacing so the pair reads as a unit. */
        .category-header-titles .section-title {
          margin: 0;
        }

        .nominees-instruction-row {
          align-items: center;
          display: flex;
          gap: 0.5rem;
          justify-content: flex-end;
        }

        /* Compact inside the pinned bar: the 40px panel-bar sizing would
           thicken the whole strip. The tap target stays honest - the icon
           only ever appears next to the text that was just tapped. */
        .sticky-trash {
          min-height: 0;
          min-width: 0;
          padding: 0 0.15rem;
        }

        /* Tighter than the panel-bar copy: it shares a row with the category
           name inside the pinned bar, where 40px of button height would
           thicken the whole strip. Still comfortably tappable via padding. */
        .sticky-back {
          flex: none;
          font-size: 0.8rem;
          min-height: 0;
          padding: 0.15rem 0.4rem 0.15rem 0;
        }

        .category-header {
          color: #fff;
          font-size: 1rem;
          font-weight: 600;
          margin: 0 0 0.1rem;
        }

        .category-title-clickable {
          cursor: pointer;
          transition: color 0.2s;

          &:hover {
            color: #ccc;
          }

          &.clicked {
            color: #ffc107;
          }
        }

        .trash-icon {
          position: absolute;
          top: 0;
          right: 0;
          font-size: 0.8rem;
          padding: 2px 6px;
          transition: all 0.2s;
          animation: fadeInScale 0.2s ease-out;
          color: white;

          &:hover {
            transform: scale(1.1);
            color: #ff6b6b;
          }
        }

        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.8);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        .section-title {
          color: white;
        }
      }

      .current-nominees-section {
        margin-bottom: 8px;

        .current-nominees-gallery {
          align-content: flex-start;
          align-items: flex-start;
          display: flex;
          flex-wrap: nowrap; // No wrapping for horizontal scroll
          gap: 4px;
          justify-content: flex-start;
          overflow-x: auto;
          overflow-y: visible;
          padding: 8px 4px;
          position: relative;

          .no-nominees-placeholder {
            align-items: center;
            color: #999;
            display: flex;
            flex-direction: column; // Stack vertically
            font-size: 0.8em;
            font-style: italic;
            gap: 8px; // Space between button and text
            height: 142px; // Match poster height (138 + borders) to prevent jumping
            justify-content: center;
            width: 100%;

            .no-nominees-btn {
              border-radius: 6px;
              font-size: 0.8em;
              padding: 6px 12px;
              transition: background-color 0.1s;

              i {
                margin-right: 6px;
              }
            }
          }

          .current-nominee-poster {
            cursor: pointer;
            flex-grow: 0;
            flex-shrink: 0;
            transition: opacity 0.1s;
            // House poster size (92x138), same as the Trophy Case shelves.
            width: 92px;

            &.winner {
              .nominee-poster-image {
                border: 2px solid #ffd700;
                box-shadow: 0 0 8px rgba(255, 215, 0, 0.5);
              }
            }

            .nominee-poster-image {
              aspect-ratio: 2/3; // True poster ratio, matching everywhere else
              border-radius: 4px;
              border: 2px solid #333;
              min-width: 40px;
              overflow: hidden;
              position: relative;
              width: 100%;

              img {
                height: 100%;
                object-fit: cover;
                width: 100%;
              }

              .winner-overlay {
                align-items: center;
                background: rgba(0,0,0,0.8);
                border-radius: 50%;
                display: flex;
                height: 18px;
                justify-content: center;
                position: absolute;
                right: 2px;
                top: 2px;
                width: 18px;

                .winner-crown {
                  color: #ffd700;
                  font-size: 0.7em;
                }
              }

              .remove-nominee-btn {
                align-items: center;
                background: rgba(0,0,0,0.8);
                border-radius: 50%;
                border: none;
                color: white;
                cursor: pointer;
                display: flex;
                font-size: 0.7em; // Slightly smaller for better fit
                height: 18px;
                justify-content: center;
                left: 2px;
                line-height: 1;
                opacity: 0.8;
                position: absolute;
                top: 2px;
                width: 18px;

                i {
                  display: flex;
                  align-items: center;
                  justify-content: center;
                }
              }
            }

            .nominee-poster-name {
              color: white;
              font-size: 0.6em;
              font-weight: 500;
              line-height: 1.2;
              margin-top: 4px;
              text-align: center;

              .actor-name {
                font-weight: 600;
                margin-bottom: 2px;
              }

              .all-roles {
                font-size: 0.9em;
                opacity: 0.8;
                margin-top: 2px;

                .role-entry {
                  margin-bottom: 1px;

                  .role-movie {
                    font-size: 0.85em;
                    font-weight: 500;
                  }

                  .role-character {
                    font-size: 0.8em;
                    font-style: italic;
                    opacity: 0.9;
                  }
                }
              }
            }
          }
        }
      }

      .available-options-section {
        display: flex;
        flex-direction: column;
        flex: 1;
        padding-top: 24px;

        .nominees-grid {
          flex: 1;
          overflow-y: auto;

          .loading-container {
            align-items: center;
            display: flex;
            flex-direction: column;
            grid-column: 1 / -1; // Span all grid columns
            height: 200px;
            justify-content: center;
            text-align: center;

            .spinner-border {
              margin: 0 auto;
            }

            p {
              color: #6c757d;
              font-size: 0.9em;
              margin-top: 8px;
            }
          }
        }

        .movie-groups {
          display: flex;
          flex-direction: column;
          gap: 24px;

          .movie-group {
            /* Says out loud what the ordering is. #ccc, not Bootstrap's .text-muted,
   which fails contrast on these dark panels (see .claude/rules/vue-ui.md). */
.options-sort-note {
  color: #ccc;
  font-size: 0.78rem;
  margin: 0 0 0.6rem;
}

.movie-sort-score {
  color: #ccc;
  font-size: 0.72rem;
  margin-left: auto;
  white-space: nowrap;
}

.movie-group-header {
              align-items: baseline;
              display: flex;
              gap: 8px;
              margin-bottom: 12px;

              .movie-title {
                color: #f8f9fa;
                font-size: 0.9em;
                font-weight: 600;
                margin: 0;
              }

              .movie-year {
                color: #adb5bd;
                font-size: 0.8em;
                font-weight: 400;
              }
            }

            .nominees-grid {
              display: grid;
              gap: 6px;
              grid-template-columns: repeat(3, 1fr);
              margin-bottom: 12px;

              @media (min-width: 576px) {
                gap: 8px;
              }
            }

            .load-more-section {
              text-align: center;

              .load-more-btn {
                border-color: #6c757d;
                color: #f8f9fa;
                font-size: 0.8em;
                padding: 4px 12px;
                transition: background-color 0.1s, transform 0.1s;

                &:hover {
                  background-color: rgba(255, 255, 255, 0.1);
                  border-color: #adb5bd;
                }

                &:active {
                  background-color: rgba(255, 255, 255, 0.2);
                  transform: scale(0.98);
                }

                &:disabled {
                  opacity: 0.6;
                  cursor: not-allowed;
                }

                i {
                  font-size: 0.9em;
                }
              }
            }
          }
        }

        .loading-container {
          align-items: center;
          display: flex;
          flex-direction: column;
          height: 200px;
          justify-content: center;
          text-align: center;

          .spinner-border {
            margin: 0 auto;
          }

          p {
            color: #6c757d;
            font-size: 0.9em;
            margin-top: 8px;
          }
        }
      }
    }
  }
}

// Make modal wider on larger screens
@media (min-width: 768px) {
  :deep(.cinemaroll-modal-content) {
    max-height: 85vh !important;
    max-width: 650px !important;
  }

  .awards-form {
    .category-grid,
    .category-detail {
      height: calc(85vh - 200px);
      max-height: 600px;
    }
  }
}

@media (min-width: 992px) {
  :deep(.cinemaroll-modal-content) {
    max-width: 750px !important;
  }
}

.awards-modal-footer {
  .saved-message {
    font-size: 0.9em;
    font-weight: 600;
  }

  .auto-save-note {
    font-size: 0.8em;
  }

  .completion-section {
    .btn {
      font-weight: 600;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      transition: transform 0.1s, box-shadow 0.1s;

      // Mobile touch feedback
      -webkit-tap-highlight-color: rgba(40, 167, 69, 0.3);
      touch-action: manipulation;

      &:active {
        transform: scale(0.98);
        box-shadow: 0 1px 2px rgba(0,0,0,0.2);
      }

      // Enhanced mobile touch states
      @media (hover: none) and (pointer: coarse) {
        &:active {
          transform: scale(0.95);
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }
      }

      i {
        color: #ffd700;
      }
    }
  }

  .progress-section {
    font-size: 0.8em;
    text-align: right;
    color: #f8f9fa; // Ensure text is visible on dark backgrounds
  }
}

// Black background for all themes on sticky section
.sticky-top-section {
  .btn-outline-secondary {
    border-color: #6c757d;
    color: #f8f9fa;
    transition: background-color 0.1s, transform 0.1s;

    // Mobile touch feedback
    -webkit-tap-highlight-color: rgba(255, 255, 255, 0.3);
    touch-action: manipulation;

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
      border-color: #adb5bd;
    }

    &:active {
      background-color: rgba(255, 255, 255, 0.2);
      transform: scale(0.98);
    }

    // Enhanced mobile touch states
    @media (hover: none) and (pointer: coarse) {
      &:active {
        background-color: rgba(255, 255, 255, 0.3);
        transform: scale(0.95);
      }
    }
  }
}
/* The drill slider: both panes live side by side on a double-wide track;
   selection slides the track one screen left. A single composited
   transform is the entire animation — nothing resizes, nothing reflows. */
.awards-slider {
  display: flex;
  /* clip, not hidden: an overflow-hidden ancestor becomes the sticky
     containing block and silently kills the nominees bar's position:
     sticky. clip paints identically but leaves stickiness against the
     page scroll intact. (hidden first as a fallback for old engines.) */
  overflow: hidden;
  overflow: clip;
  /* Bleed through the page's side padding so full-width children (the
     sticky nominees bar) can genuinely reach the screen edges… */
  margin: 0 -1rem;
}

.awards-pane {
  flex: 0 0 100%;
  min-width: 0;
  /* …while normal pane content keeps its 1rem inset. */
  padding: 0 1rem;
}

/* The slide is margin-left on the LIST pane, deliberately not transform:
   a transformed ancestor disables position:sticky in WebKit/Blink, which
   silently killed the pinned nominees bar. Margin animation relayouts two
   fixed-width panes per frame — cheap — and leaves the detail pane
   transform-free so its sticky bar actually sticks. */
.list-pane {
  transition: margin-left 0.35s cubic-bezier(0.25, 0.8, 0.35, 1);
}

.awards-slider.showing-detail .list-pane {
  margin-left: -100%;
  /* The hidden list can be taller than the detail — don't let it stretch
     the page while offscreen. */
  max-height: 70vh;
  overflow: hidden;
}

.panel-bar {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  /* flex-end, not space-between: the back link that used to anchor the left
     side moved into the sticky bar (2026-08-21), and Remove award / the
     trash were always right-edge controls. space-between with one child
     would silently drag them to the left edge. */
  justify-content: flex-end;
  margin-bottom: 0.5rem;
}

/* Understated: removing an award you invented is a real action but not one
   the pane should push you toward. #b9b9b9 on the dark pane is ~8:1, and the
   40px height is the house minimum tap target. */
.panel-remove {
  background: none;
  border: none;
  color: #b9b9b9;
  font-size: 0.75rem;
  min-height: 40px;
  padding: 0 0.25rem;
}

/* Mobile-first: press feedback only, never a hover state that sticks. */
.panel-remove:active {
  color: #fff;
}

.custom-award-add {
  margin-top: 0.6rem;
}

/* Dashed, and quieter than a category row — an invitation, not a fourteenth
   category. */
.custom-award-open {
  background: none;
  border: 1px dashed #3a3a3a;
  border-radius: 8px;
  color: #b9b9b9;
  font-size: 0.85rem;
  min-height: 44px;
  width: 100%;
}

.custom-award-open:active {
  background: #1f1f1f;
  color: #fff;
}

.custom-award-form {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  padding: 0.7rem;
}

.custom-award-input {
  background: #1f1f1f;
  border: 1px solid #3a3a3a;
  color: #fff;
  /* A UA-imposed minimum width beats width: 100% in a narrow column — see
     .claude/rules/vue-ui.md. */
  min-width: 0;
}

.custom-award-input::placeholder {
  color: #8a8a8a;
}

/* One connected two-segment control, the same shape Six Degrees' hint row
   uses. Selection is shown by the light fill, not a coloured outline. */
.custom-award-types {
  display: flex;
  margin-top: 0.6rem;
}

.custom-award-type {
  background: #1f1f1f;
  border: 1px solid #3a3a3a;
  color: #b9b9b9;
  flex: 1;
  font-size: 0.78rem;
  /* House minimum tap target. */
  min-height: 40px;
  padding: 0 0.5rem;
}

.custom-award-type:first-child {
  border-radius: 6px 0 0 6px;
}

.custom-award-type:last-child {
  border-left: none;
  border-radius: 0 6px 6px 0;
}

.custom-award-type.active {
  background: #e8e8e8;
  border-color: #e8e8e8;
  color: #111;
}

/* Mobile-first: press feedback only, never a hover state that sticks. */
.custom-award-type:active:not(.active) {
  background: #2b2b2b;
  color: #fff;
}

.custom-award-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  margin-top: 0.6rem;
}

.custom-award-error {
  color: #ff8a80;
  font-size: 0.75rem;
  margin: 0.5rem 0 0;
}

.sticky-sentinel {
  height: 1px;
  margin-top: -1px;
  visibility: hidden;
}

/* Teleported to <body>; covers the transparent iOS status-bar strip
   (Dynamic Island area) only while the nominees bar is pinned. Height is
   0 on non-notched devices, so it's a no-op everywhere else. */
.awards-safe-area-shade {
  background: #000000;
  height: env(safe-area-inset-top, 0px);
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 1100;
}

.panel-back {
  align-items: center;
  background: none;
  border: none;
  color: #adb5bd;
  display: flex;
  font-size: 0.9rem;
  gap: 0.25rem;
  min-height: 40px;
  padding: 0.25rem 0.5rem 0.25rem 0;
}

.panel-back:active {
  opacity: 0.6;
}

.panel-trash {
  background: none;
  border: none;
  color: #ff6a6a;
  font-size: 1rem;
  min-height: 40px;
  min-width: 40px;
}

.panel-trash:active {
  opacity: 0.6;
}
</style>