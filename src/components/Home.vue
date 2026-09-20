<template>
  <!-- px/pb only — top padding is set in CSS so the header→input gap
       exactly matches the input→rainbow gap (0.75rem). -->
  <div class="home px-3 pb-3 mx-auto">

    <div v-if="$store.state.dbLoaded" class="search-bar mx-auto">
      <div class="input-group search-input-group mb-1 col-12 md-col-6">
        <input
          class="form-control search-input-with-quick-links"
          ref="searchInput"
          type="text"
          autocapitalize="none"
          autocorrect="off"
          autocomplete="off"
          name="search"
          id="search"
          :placeholder="placeholder"
          style="font-size: 0.75rem;"
          @focus="focusOnSearchBar"
          @blur="blurSearchBar"
          @input="onInput"
          @keydown.esc="dismissTypeahead"
          :value="inputValue"
        >
        <!-- The quick-links lightning bolt, relocated from the rainbow bar
             (its slot went to the Circle). Same Bootstrap collapse trigger,
             miniaturized into the input's right edge. -->
        <button
          class="search-quick-links-toggle"
          type="button"
          data-bs-toggle="collapse"
          data-bs-target="#quick-links-accordion"
          aria-expanded="false"
          aria-controls="quick-links-accordion"
          @click="toggleQuickLinksAccordion"
          title="Quick filters"
          aria-label="Toggle quick filters"
        >
          <i class="bi bi-lightning-charge"/>
        </button>
      </div>
      <!-- Typeahead over the dimensions of your own library — the director,
           genre, studio or keyword you're part-way through typing — in the
           same panel shape the games use. It opens UPWARD, over the header
           image, for the reason CineplexityGame's does: on a phone the
           keyboard owns everything below the field, and here the results are
           re-filtering on every keystroke right underneath.

           A sibling of .input-group rather than a child of it: Bootstrap
           squares off the left corners of any non-first child of an
           .input-group, which would quietly flatten the panel's radius.

           mousedown.prevent keeps the tap from blurring the input first,
           which would otherwise commit the half-typed term as a general chip
           before the tap ever landed. -->
      <div v-if="typeaheadOpen" class="typeahead-panel" :style="{ maxHeight: `${typeaheadMaxHeight}px` }">
        <button
          v-for="suggestion in typeaheadSuggestions"
          :key="`${suggestion.kind}-${suggestion.value}`"
          type="button"
          class="typeahead-row"
          @mousedown.prevent
          @click="applyTypeaheadSuggestion(suggestion)"
        >
          <span class="typeahead-term">{{ suggestion.value }}</span>
          <span class="typeahead-meta">{{ describeSuggestion(suggestion) }}</span>
        </button>
      </div>
      <!-- Typo-tolerant "Did you mean...?" fallback from the user's own rated
           data. As many ranked suggestions as fit on one line (see
           didYouMeanFitCount/updateDidYouMeanFitCount) - a full row of chips
           between the search bar and the new-rating-suggestion UI was too
           prominent given how much more often a search is a genuinely new
           (unrated) movie than a typo, but a single link under-used the
           space once it was cut down to that. The CSS ellipsis is the real
           guarantee against overflow; the fit-count just decides how many
           terms to attempt. -->
      <p v-if="!typeaheadOpen && didYouMeanLineSuggestions.length" class="did-you-mean-inline mb-1">Did you mean?: <template v-for="(suggestion, index) in didYouMeanLineSuggestions" :key="`${suggestion.typeLabel}-${suggestion.value}`"><a href="#" class="did-you-mean-link" @click.prevent="applyDidYouMeanSuggestion(suggestion)">{{ suggestion.value }}</a><span v-if="index < didYouMeanLineSuggestions.length - 1">, </span></template></p>
    </div>

    <!-- Quick-links panel: expands here, between the search input and
         the rainbow bar (Matt), triggered by the bolt inside the input. -->
      <div ref="quickLinkTypes" class="quick-link-types d-flex align-items-center flex-wrap col-md-12">
        <div id="quick-links-accordion" class="col-12 mt-1 accordion-collapse collapse">
          <div class="quick-links-badges">
            <span
              class="badge mx-1 text-bg-secondary"
              @click="findRandomSearchValue"
            >
              <i class="bi bi-shuffle"></i> Surprise me
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'annual' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleAnnualBestFilter"
            >
              Annual Best
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'bestPicture' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleBestPicturesFilter"
            >
              Best Picture
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'thisYear' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleThisYearFilter"
            >
              This Year
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'lastYear' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleLastYearFilter"
            >
              Last Year
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'thisMonth' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleThisMonthFilter"
            >
              This Month
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'lastMonth' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleLastMonthFilter"
            >
              Last Month
            </span>
            <span
              class="badge mx-1"
              :class="activeListChip?.value === 'notOnLetterboxd' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleNotOnLetterboxdFilter"
            >
              Not on Letterboxd
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'genre' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('genre')"
            >
              Genres
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'keyword' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('keyword')"
            >
              Keywords
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'year' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('year')"
            >
              Years
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'director' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('director')"
            >
              Directors
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'cast/crew' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('cast/crew')"
            >
              Cast/Crew Members
            </span>
            <span
              class="badge mx-1"
              :class="activeQuickLinkList === 'studios' ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList('studios')"
            >
              Studios
            </span>
            <!-- Tags used to sit behind their own "Tags ▸" collapse below an
                 <hr>. They're in the same flow now: "at some point in the past
                 I separated out quick links from tags. I think I must've done
                 that because sometimes someone can have a lot of tags and then
                 the quick links become overwhelming. What if instead we
                 combine them into one list, but we make it scrollable if it
                 gets way too thick." (2026-08-17) The wrapper caps the height
                 and scrolls, which is what made separating them unnecessary. -->
            <span
              v-for="(tag, index) in tags"
              :key="`tag-${index}`"
              class="badge mx-1"
              :class="activeFilters.some((filter) => filter.type === 'tag' && filter.value === tag) ? 'text-bg-success' : 'text-bg-secondary'"
              @click="toggleQuickLinksList(tag)"
            >
              {{tag}}
            </span>
          </div>
          <div v-if="sortedDataForActiveQuickLinkList.length" class="quick-links-list-wrapper mt-2">
            <div class="accordion-body col-12">
              <button
                class="quick-links-list-sort"
                :class="darkOrLight"
                @click="toggleQuickLinksSort"
              >
                {{quickLinksSortType}}
              </button>
              <ul class="quick-link-list p-0 col-12">
                <li v-for="(value, index) in sortedDataForActiveQuickLinkList" :key="index" @click="updateSearchValue(value.name)">
                  <span class="badge mx-1" :class="darkOrLight">
                    {{ value.name }}<span v-if="quickLinksSortType === 'count' && value.count">&nbsp;({{value.count}})</span>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

    <!-- Movies rated offline that still need to be matched to a real TMDB
         movie (see AddRating.js/ReconcilePlaceholder.vue). Only actionable
         once online, since reconciliation needs a TMDB search. -->
    <div v-if="pendingReconciliations.length && $store.state.isOnline" class="pending-reconciliation-banner mx-auto my-2">
      <router-link :to="`/reconcile/${firstPendingReconciliationDbKey}`">
        {{ pendingReconciliations.length }} movie<span v-if="pendingReconciliations.length > 1">s</span> rated offline need{{ pendingReconciliations.length > 1 ? '' : 's' }} a match — Review
      </router-link>
    </div>

    <!-- Active Filter Chips - only show when filters are active -->
    <div v-if="activeFiltersMinusTemps.length || activeQuickLinkList !== 'title'" class="active-filters-section mx-auto my-2">
      <div class="d-flex flex-wrap align-items-center">
        <!-- Quick Link Filter Chip -->
        <transition name="chip-fade" mode="out-in">
          <span v-if="activeQuickLinkList !== 'title'" class="badge text-bg-primary me-2 my-1 d-inline-flex align-items-center chip-transition" style="padding: 0.25rem 0.4rem; font-weight: normal; font-size: 0.75rem; line-height: 1.2;">
            {{ getQuickLinkDisplayName(activeQuickLinkList) }}
            <button class="btn-close btn-close-white ms-1" @click="clearQuickLink" style="font-size: 0.5rem; line-height: 1;"></button>
          </span>
        </transition>

        <!-- Special case for an active year chip: instead of a plain
             badge, a horizontally-scrolling strip of every year present
             in the library, so you can swipe/tap your way between years
             instead of re-typing each one — feature request: "instead of
             showing all the chips across the bottom, I want some sort of
             UI that takes up the same amount of space... goes
             horizontally all the way across and lets me quickly travel
             between years." Works alongside OTHER filters too (e.g. year
             + genre) — follow-up: "I do want it to also be able to work
             with other filters... additional filter chips that just
             exist below the new year selector." flex-basis 100% (via
             .year-scroller) forces it onto its own full-width row in
             this flex-wrap container; since it comes BEFORE the other-
             filter badges below in DOM order, and it always consumes the
             whole row width, those badges naturally wrap onto the line
             right after it — no extra positioning needed for "below the
             year selector," that's just how flex-wrap lays out a
             full-width item followed by normal ones. -->
        <div v-if="hasActiveYearChip" ref="yearScroller" class="year-scroller">
          <button
            v-for="year in availableYearsAscending"
            :key="year"
            type="button"
            class="btn btn-sm year-scroller-pill"
            :class="year === activeYearChipValue ? 'btn-primary selected' : 'btn-outline-secondary'"
            @click="selectYear(year)"
          >{{ year }}</button>
        </div>

        <!-- Additional Filter Chips — every active chip EXCEPT a year one
             (which renders as the scroller above instead). When no year
             chip is active, otherActiveFilters is just
             activeFiltersMinusTemps unfiltered, so this behaves exactly
             as the plain chip row always has. -->
        <transition-group name="chip-fade" tag="div" class="d-inline-flex flex-wrap align-items-center">
          <!-- A list chip keeps the primary colour the quick-link badge
               always wore: a curated view reads differently from a filter,
               even now that it lives in the same row. -->
          <span v-for="filter in otherActiveFilters" :key="filter.id" class="badge me-2 my-1 d-inline-flex align-items-center chip-transition" :class="filter.type === 'list' ? 'text-bg-primary' : 'text-bg-secondary'" style="padding: 0.25rem 0.4rem; font-weight: normal; font-size: 0.75rem; line-height: 1.2;">
            {{ filter.display }}
            <button
              class="btn-close btn-close-white ms-1"
              @click.stop.prevent="removeFilter(filter.id)"
              style="font-size: 0.5rem; line-height: 1;"
              title="Remove filter">
            </button>
          </span>
        </transition-group>

        <!-- Wikipedia Button - only show when there's exactly one chip -->
        <button v-if="activeFiltersMinusTemps.length === 1" class="btn btn-link text-light p-0 my-1 d-inline-flex align-items-center" style="font-size: 0.9rem; text-decoration: none; opacity: 0.7;" @click="goToWikipediaForChip" title="Wikipedia Info">
          <i class="bi bi-wikipedia" style="font-size: 1rem;"></i>
        </button>

        <!-- Small Add Filter Button -->
        <button class="btn btn-link text-light p-0 my-1 d-inline-flex align-items-center ms-1" style="font-size: 0.9rem; text-decoration: none; opacity: 0.7;" @click="showAddFilterModal = true" title="Add Filter">
          <i class="bi bi-plus-circle" style="font-size: 1rem;"></i>
        </button>

        <!-- Small Clear All Button -->
        <button class="btn btn-link text-light p-0 my-1 d-inline-flex align-items-center ms-1" style="font-size: 0.9rem; text-decoration: none; opacity: 0.7;" @click="clearAllFilters" title="Clear All">
          <i class="bi bi-x-circle" style="font-size: 1rem;"></i>
        </button>
      </div>
    </div>

    <!-- Brand new (0-rated) user: a short welcome, then suggestions shown
         immediately - see shouldShowStartSuggestions for why no tap is
         required here specifically. -->
    <div v-if="$store.state.dbLoaded && isBrandNewUser && !dismissedWelcomeSuggestions && !value && !resultsAreFiltered" class="welcome-new-user text-center mt-3 mb-1">
      <p class="welcome-new-user-text">Welcome to Cinema Roll! This app is built entirely around movies you rate yourself.</p>
      <!-- The wrong-account case: the read SUCCEEDED but this account's
           library is genuinely empty — which is exactly what an established
           user sees if they signed in with a different Google account or a
           typo'd email. Naming the signed-in account is the diagnostic. -->
      <p v-if="$store.state.userEmail" class="welcome-account-note">
        You're signed in as <strong>{{ $store.state.userEmail }}</strong>.
        Already have rated movies? They live under the account you first
        used — sign in with that one to see them.
      </p>
    </div>

    <!-- Suggestions button below search bar if user has rated 1-9 movies -->
    <div v-if="$store.state.dbLoaded && !showSuggestionsOnly && userRatedMovieCount > 0 && userRatedMovieCount < 10 && !value && !resultsAreFiltered" class="text-center mt-2 mb-1">
      <button class="btn btn-success" @click="showSuggestionsOnly = true">{{ suggestionsButtonLabel }}</button>
    </div>
    <!-- THE notification space (Matt, 2026-08-21: "make that notification
         space a unified concept and use it for all notifications going
         forward"). Every prompt-card the app shows lives here, in one
         stack directly BELOW the rainbow bar (his call, same day) — and at
         the top level of Home, never nested inside the results area, which
         is the mistake the friend-request card had to be rescued from on
         2026-08-19: whether something needs your attention has nothing to
         do with what the results list is doing. When there are no results
         the rainbow hides and the stack simply sits under the search bar.

         Order is deliberate: a person waiting comes first, then news about
         your own reports, then app housekeeping, and the movie homework
         last — the chores expand in place into working UIs, so they sit
         closest to the library they act on. One chore at a time, chosen by
         activeModalType. Shared look in scss/_prompt-card.scss. -->
    <!-- The rainbow bar, above the notification space (Matt, 2026-08-21:
         "I don't want it above the rainbow bar. It should go below the
         rainbow"). Moved out of results-exist so it can sit above the
         notices while they stay in one always-rendered spot; the guard
         reproduces its old visibility exactly (not start-suggestions, a
         results list showing, at least one result). The .results wrapper is
         a CSS namespace only — all the bar's styling is nested under it. -->
    <div
      v-if="!shouldShowStartSuggestions && showResultsList && paginatedSortedResults.length"
      class="results"
    >
      <div class="results-actions col-12 md-col-6 d-flex justify-content-between flex-wrap mt-1">
        <div class="btn-group col-12" role="group" aria-label="Button group">
          <!-- Settings (gear) button replaces shorts toggle -->
          <button class="results-actions-button btn btn-secondary" @click="toggleSettingsPanel" title="Settings" aria-label="Open settings">
            <i class="bi bi-gear"></i>
          </button>
          <button class="results-actions-button btn btn-info" type="button" @click="goToGames" title="Games" aria-label="Go to games">
            <i class="bi" :class="gamesButtonIcon"/>
          </button>
          <button class="results-actions-button filtered-count-display btn btn-secondary" @click="toggleCountViewsAverage" title="Toggle count / average / views" aria-label="Toggle between result count, average rating, and view count">
            <span v-if="showAverage">
              <span class="average-label">(avg)</span>
              <span class="average-value">{{averageRating(displayedResults)}}</span>
            </span>
            <span v-else-if="showViewCount">
              <span class="average-label">(views)</span>
              <span class="average-value">{{viewsCount(displayedResults)}}</span>
            </span>
            <span v-else-if="showLogScore">
              <span class="average-label">(log)</span>
              <span class="average-value">{{filteredLogScore}}</span>
            </span>
            <span v-else-if="quickLinkContext === 'bestPicture'">{{bestPicturesWithRatings.length}}/{{unifiedFilteredResults.length}}</span>
            <span v-else>{{displayedResults.length}}</span>
          </button>
          <button class="results-actions-button btn btn-info" type="button" @click="goToInsights" title="Insights" aria-label="Go to insights">
            <i class="bi bi-lightbulb"/>
          </button>
          <!-- The Film Club takes the lightning bolt's rainbow slot and
               color; the quick-links trigger now lives inside the
               search input's right edge (Matt: "it really
               needs to be a first order page"). -->
          <button class="results-actions-button btn btn-warning btn-sm" type="button" @click="$router.push('/film-club')" title="Film Club" aria-label="Go to the Film Club">
            <!-- New friend ratings since the club was last opened. Always
                 the OUTLINE club: "I basically wanted it to always be the
                 outline icon not the solid one because that better matches
                 the other icons on the list" (2026-08-17) — the binoculars
                 and sort glyphs beside it are outlines. -->
            <span v-if="filmClubNewUpdateCount" class="film-club-badge">
              <i class="bi bi-suit-club film-club-glyph"/>
              <span class="film-club-badge-count">{{ filmClubNewUpdateCount > 9 ? '9+' : filmClubNewUpdateCount }}</span>
            </span>
            <i v-else class="bi bi-suit-club film-club-glyph"/>
          </button>
          <!-- Shuffle lives inside the quick-links panel now (feedback:
               the extra watchlist button broke the rainbow); watchlist
               takes shuffle's old slot and color. -->
          <button class="results-actions-button btn btn-info btn-sm" @click="$router.push('/watchlist')" title="Watchlist" aria-label="Go to watchlist">
            <i class="bi bi-binoculars watchlist-glyph"/>
          </button>
          <button class="results-actions-button btn btn-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Sort results" aria-label="Sort results">
            <i v-if="sortValue === 'rating'" class="bi bi-123"/>
            <i v-if="sortValue === 'watched'" class="bi bi-calendar3"/>
            <i v-if="sortValue === 'release'" class="bi bi-calendar-date"/>
            <i v-if="sortValue === 'title'" class="bi bi-alphabet"></i>
            <i v-if="sortValue === 'views'" class="bi bi-eye"></i>
            <i v-if="sortValue === 'direction'" class="bi bi-dpad"></i>
            <i v-if="sortValue === 'imagery'" class="bi bi-image"></i>
            <i v-if="sortValue === 'story'" class="bi bi-book"></i>
            <i v-if="sortValue === 'performance'" class="bi bi-speedometer"></i>
            <i v-if="sortValue === 'soundtrack'" class="bi bi-music-note-beamed"></i>
            <i v-if="sortValue === 'stickiness'" class="bi bi-sticky"></i>
            <i v-if="sortValue === 'budget'" class="bi bi-cash-stack"></i>
            <i v-if="sortValue === 'boxOffice'" class="bi bi-ticket-perforated"></i>
            <i v-if="sortValue === 'profit'" class="bi bi-graph-up-arrow"></i>
            <i v-if="sortValue === 'returnPct'" class="bi bi-percent"></i>
            <span class="order-arrow">
              <i v-if="sortOrder !== 'bestOrNewestOnTop'" class="bi bi-arrow-down-short"/>
              <i v-if="sortOrder === 'bestOrNewestOnTop'" class="bi bi-arrow-up-short"/>
            </span>
          </button>
          <!-- SIBLING of the toggle, not a child of it — Bootstrap's own
               btn-group + dropdown structure. It used to be nested inside the
               <button>, which is invalid HTML and had a real consequence:
               Bootstrap registers its delegated data-api handlers with
               useCapture TRUE, so the document-level [data-bs-toggle] handler
               runs BEFORE anything in the menu can stop the event. Every click
               inside the menu therefore reached the toggle and shut it, and no
               amount of @click.stop could prevent it (verified in an isolated
               Bootstrap 5.3.3 page, 2026-08-26).
               Only the </button> moved. Wrapping the toggle in a <div
               class="dropdown"> — the other way to fix this — would have
               broken the rainbow: these chips take their colours from
               .results-actions-button:nth-child(N), and flex: 1 1 0 sits on
               the button, not on a wrapper. The <ul> is safe here because the
               sort chip is the LAST button in the group, so no chip's index
               moves. -->
            <ul class="dropdown-menu dropdown-menu-end">
              <li value="rating">
                <button class="dropdown-item" :class="{active: sortValue === 'rating'}" @click="setOrToggleSortValue('rating')">
                  Rating
                </button>
              </li>
              <li value="watched">
                <button class="dropdown-item" :class="{active: sortValue === 'watched'}" @click="setOrToggleSortValue('watched')">
                  Watch Date
                </button>
              </li>
              <li value="release">
                <button class="dropdown-item" :class="{active: sortValue === 'release'}" @click="setOrToggleSortValue('release')">
                  Release Date
                </button>
              </li>
              <li value="title">
                <button class="dropdown-item" :class="{active: sortValue === 'title'}" @click="setOrToggleSortValue('title')">
                  Title
                </button>
              </li>
              <li value="views">
                <button class="dropdown-item" :class="{active: sortValue === 'views'}" @click="setOrToggleSortValue('views')">
                  Views
                </button>
              </li>
              <li value="direction">
                <button class="dropdown-item" :class="{active: sortValue === 'direction'}" @click="setOrToggleSortValue('direction')">
                  Direction
                </button>
              </li>
              <li value="imagery">
                <button class="dropdown-item" :class="{active: sortValue === 'imagery'}" @click="setOrToggleSortValue('imagery')">
                  Imagery
                </button>
              </li>
              <li value="story">
                <button class="dropdown-item" :class="{active: sortValue === 'story'}" @click="setOrToggleSortValue('story')">
                  Story
                </button>
              </li>
              <li value="performance">
                <button class="dropdown-item" :class="{active: sortValue === 'performance'}" @click="setOrToggleSortValue('performance')">
                  Performance
                </button>
              </li>
              <li value="soundtrack">
                <button class="dropdown-item" :class="{active: sortValue === 'soundtrack'}" @click="setOrToggleSortValue('soundtrack')">
                  Soundtrack
                </button>
              </li>
              <li value="stickiness">
                <button class="dropdown-item" :class="{active: sortValue === 'stickiness'}" @click="setOrToggleSortValue('stickiness')">
                  Stickiness
                </button>
              </li>
              <!-- The money sorts, kept together and last. Requested
                   2026-08-25. Films with no figures sink to the bottom
                   whichever way the sort points — see isSortValueUnknown. -->
              <li><hr class="dropdown-divider"></li>
              <li value="budget">
                <button class="dropdown-item" :class="{active: sortValue === 'budget'}" @click="setOrToggleSortValue('budget')">
                  Budget
                </button>
              </li>
              <li value="boxOffice">
                <button class="dropdown-item" :class="{active: sortValue === 'boxOffice'}" @click="setOrToggleSortValue('boxOffice')">
                  Box office
                </button>
              </li>
              <li value="profit">
                <button class="dropdown-item" :class="{active: sortValue === 'profit'}" @click="setOrToggleSortValue('profit')">
                  Profit
                </button>
              </li>
              <li value="returnPct">
                <button class="dropdown-item" :class="{active: sortValue === 'returnPct'}" @click="setOrToggleSortValue('returnPct')">
                  Return on budget
                </button>
              </li>
              <!-- A way of LOOKING at the money, not a fifth money sort —
                   budget and box office are both distorted by eighty years of
                   inflation, so one switch covers all of it. Requested
                   2026-08-26. Return on budget is left out on purpose: it's a
                   ratio of two same-year figures and doesn't move. -->
              <li>
                <button class="dropdown-item money-mode" :class="{active: moneyInTodaysDollars}" @click.stop="toggleMoneyInflation">
                  <i class="bi" :class="moneyInTodaysDollars ? 'bi-check-square' : 'bi-square'"></i>
                  In today's dollars
                </button>
              </li>
            </ul>
        </div>
      </div>
    </div>

    <section ref="homeNotices" class="home-notices">
      <!-- Friend requests: prominent ON PURPOSE. Bug report, 2026-08-19:
           "unless I think to look there I won't ever know that they're
           pending." -->
      <div
        v-if="incomingFriendRequests.length"
        class="prompt-card"
        @click="$router.push('/film-club')"
      >
        <span class="prompt-badge prompt-badge-friends"><i class="bi bi-people-fill"></i></span>
        <span class="prompt-body">
          <span class="prompt-label">Film Club</span>
          <p class="prompt-text">{{ friendRequestBannerText }}</p>
          <a class="prompt-action prompt-action-friends" @click.stop="$router.push('/film-club')">Review the request</a>
        </span>
      </div>

      <BugResolutionNotice/>

      <NewsletterNotice/>

      <UpdateAvailableBanner/>

      <StickinessInline
        :allEntriesWithFlatKeywordsAdded="allEntriesWithFlatKeywordsAdded"
        :showStickinessModal="showStickinessModal"
        :autoOpen="openChoreRequested"
        :now="promptNow"
        @stickiness-updated="onStickinessUpdated"
      />
      <TweakInline
        :allEntriesWithFlatKeywordsAdded="allEntriesWithFlatKeywordsAdded"
        :showTweakModal="showTweakModal"
        :autoOpen="openChoreRequested"
        @tweak-updated="onTweakUpdated"
      />
      <!-- Banner-only on Home: tapping the "year is ready" notice navigates
           to /awards (the overlay modal is retired — it "always feels a
           little bit janky"). No :selectedYear here, deliberately — see
           PersonalAwardsModal for why passing the persisted daily year
           through the explicit-intent override kept the banner naming a
           finished year. -->
      <PersonalAwardsModal
        v-if="showAwardsModal"
        :allEntriesWithFlatKeywordsAdded="allEntriesWithFlatKeywordsAdded"
        :personalAwardName="personalAwardName"
        :awardNameWithThe="getAwardNameWithThe()"
        :awardNameSingular="getAwardNameSingular()"
        :autoOpen="awardsPromptState === 'forced' || openChoreRequested"
        :navigateOnOpen="true"
      />
    </section>

    <NoResults
      v-if="shouldShowStartSuggestions"
      :value="searchValue || effectiveSearchTerm"
      :suggestionsMode="true"
      @cancel-suggestions="handleCancelSuggestions"
      style="margin-bottom: 2rem;"
    />
    <div v-else>
      <div v-if="showResultsList" class="results">
        <div v-if="paginatedSortedResults.length" class="results-exist">
          <!-- The rainbow bar and the chore prompts both used to render
               here. The bar now sits above .home-notices at the top level
               (its old spot in this flow hid nothing, but Matt wants the
               notices BELOW it); the prompts live inside .home-notices. -->
          <!-- Inline Settings Panel accordion, right after action buttons and before results list -->
          <div v-if="showSettingsPanel" :class="['settings-panel-inline', 'card', 'card-body', darkOrLight['text-bg-dark'] ? 'dark' : '']">
            <div class="settings-panel-header d-flex justify-content-between align-items-center mb-2">
              <h5 class="mb-0">Settings</h5>
            </div>
            <hr class="mt-0 mb-3">
            <div class="settings-panel-body">
              <!-- Grouped into consistent SettingsSection cards (feedback:
                   the pane had grown patchwork). Ordered by everyday
                   relevance; rarely-used groups collapse by default. -->
              <SettingsSection title="Library" hint="Short films, your rating curve, and personal awards" collapsible :startOpen="false">

                <!-- "I should be able to set a default sort order somewhere in
                     settings" (2026-08-17). Home already remembered a sort for
                     the session; this is the one it opens on. -->
                <h6 class="settings-subhead">Default sort</h6>
                <div class="mb-3">
                  <select class="form-select form-select-sm mb-2" :value="defaultSortValue" @change="updateDefaultSort($event.target.value, defaultSortOrder)">
                    <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                  <select class="form-select form-select-sm" :value="defaultSortOrder" @change="updateDefaultSort(defaultSortValue, $event.target.value)">
                    <option value="bestOrNewestOnTop">Best / newest first</option>
                    <option value="worstOrOldestOnTop">Worst / oldest first</option>
                  </select>
                  <p class="settings-note">Which order the library opens in.</p>
                </div>

                <div class="form-check form-switch mb-3">
                                <input class="form-check-input" type="checkbox" id="shortsToggle" :checked="showShorts" @change="updateShowShorts">
                                <label class="form-check-label" for="shortsToggle">Include short films</label>
                              </div>
                <h6 class="settings-subhead">Rating curve</h6>
                <RatingCurveSettings/>
                <h6 class="settings-subhead">Personal awards</h6>

                <div class="mb-3">
                                <label for="personalAwardName" class="form-label">Personal Award Name:</label>
                                <input
                                  type="text"
                                  class="form-control"
                                  id="personalAwardName"
                                  v-model="personalAwardName"
                                  placeholder="e.g., The Oscars, The Groskers, The Smithies"
                                  maxlength="50"
                                  @change="savePersonalAwardName"
                                >
                                <small class="form-text text-white">Use plural form like "The Oscars"</small>
                              </div>
                <div class="mb-3">
                                <label for="awardsYearThreshold" class="form-label">Movies needed before a year gets awards:</label>
                                <input
                                  type="number"
                                  class="form-control"
                                  id="awardsYearThreshold"
                                  v-model.number="awardsYearThresholdInput"
                                  min="1"
                                  max="100"
                                  step="1"
                                  @change="saveAwardsYearThreshold"
                                >
                                <small class="form-text text-white">Years with fewer rated movies stay out of the awards flow.</small>
                              </div>
              </SettingsSection>

              <SettingsSection title="Friends &amp; sharing" hint="Your Film Club profile and who can find you" collapsible :startOpen="false">
                <small class="form-text text-white d-block mb-2">
                  Friends see your ratings only after you both accept a request. The Film Club lives in the rainbow bar.
                </small>
                <div class="form-check form-switch mb-3">
                  <input class="form-check-input" type="checkbox" id="socialEnabledToggle" :checked="socialSettings.enabled" @change="updateSocialEnabled">
                  <label class="form-check-label" for="socialEnabledToggle">Share on Cinema Roll</label>
                </div>
                <div v-if="socialSettings.enabled" class="mb-2">
                  <label for="socialDisplayName" class="form-label">Display name</label>
                  <input
                    type="text"
                    class="form-control"
                    id="socialDisplayName"
                    :value="socialSettings.displayName || ''"
                    placeholder="How friends see you"
                    @change="updateSocialDisplayName"
                  >
                </div>
                <template v-if="socialSettings.enabled">
                  <div class="form-check form-switch mt-3 mb-1">
                    <input class="form-check-input" type="checkbox" id="crossAppDiscoveryToggle" :checked="crossAppDiscovery" @change="updateCrossAppDiscovery">
                    <label class="form-check-label" for="crossAppDiscoveryToggle">Let people on other apps find me</label>
                  </div>
                  <small class="form-text text-white d-block">
                    Publishes your display name and a request inbox to a public list, so friends using a different movie app can add you. Your ratings stay private until you accept someone.
                  </small>
                </template>
              </SettingsSection>

              <SettingsSection title="Movie Hat" hint="Send movies to your hats, and draw from them here" collapsible :startOpen="false">
                <p class="settings-note">
                  Movie Hat stays its own app — this just lets Cinema Roll put movies into your hats and draw from them.
                </p>

                <!-- Movie Hat is a separate Firebase project, so it needs its
                     own sign-in: a Cinema Roll token means nothing there. Once
                     its database is locked down this is what grants access, and
                     only to the hats you're a member of. -->
                <div class="settings-hat-account">
                  <template v-if="movieHatEmail">
                    <p class="settings-note settings-hat-connected">
                      <i class="bi bi-check-circle"></i>
                      Connected as {{ movieHatEmail }}
                    </p>
                    <button type="button" class="btn btn-outline-secondary btn-sm" @click="disconnectMovieHat">Disconnect</button>
                  </template>
                  <template v-else>
                    <button type="button" class="btn btn-warning btn-sm" :disabled="connectingHat" @click="connectMovieHat">
                      <span v-if="connectingHat" class="spinner-border spinner-border-sm me-1" role="status"></span>
                      Connect to Movie Hat
                    </button>
                    <p class="settings-note mt-2">
                      Sign in with whichever Google account owns your hats.
                    </p>
                  </template>
                  <p v-if="hatConnectError" class="settings-hat-error">{{ hatConnectError }}</p>
                </div>

                <button type="button" class="btn btn-outline-info btn-sm" :disabled="findingHats" @click="findMovieHats">
                  <span v-if="findingHats" class="spinner-border spinner-border-sm me-1" role="status"></span>
                  {{ linkedMovieHats.length ? 'Look for more hats' : 'Find my hats' }}
                </button>
                <p v-if="hatLookupError" class="settings-hat-error">{{ hatLookupError }}</p>

                <div v-for="hat in hatChoices" :key="hat.title" class="form-check form-switch mt-2">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    :id="`hat-${hat.title}`"
                    :checked="isHatLinked(hat.title)"
                    @change="toggleHat(hat)"
                  >
                  <label class="form-check-label" :for="`hat-${hat.title}`">
                    {{ hat.title }}
                    <span class="settings-hat-count">{{ hat.movies }} waiting</span>
                  </label>
                </div>

                <p v-if="searchedForHats && !hatChoices.length" class="settings-note">
                  No hats found for {{ movieHatEmail || userEmail }} — that's the address Movie Hat knows you by.
                </p>
              </SettingsSection>

              <SettingsSection title="Prompts" hint="How often Cinema Roll asks you things" collapsible :startOpen="false">
                <div class="mb-3">
                                <label for="tieBreakTweak" class="form-label">Max daily tiebreak prompts:</label>
                                <input
                                  type="number"
                                  class="form-control"
                                  id="tieBreakTweak"
                                  v-model.number="tieBreakTweak"
                                  min="0"
                                  max="1"
                                  step="1"
                                  @change="saveTieBreakTweak"
                                >
                              </div>
                <div class="mb-3">
                                <label for="awardsPromptsPerDay" class="form-label">Max daily personal awards prompts:</label>
                                <input
                                  type="number"
                                  class="form-control"
                                  id="awardsPromptsPerDay"
                                  :value="awardsPromptsPerDayInput"
                                  min="0"
                                  max="24"
                                  step="1"
                                  @change="saveAwardsPromptsPerDay($event.target.value)"
                                >
                                <small class="form-text text-white">Spaced evenly through the day. 0 turns them off.</small>
                              </div>
                <div class="mb-3">
                                <label for="stickinessPromptsPerDay" class="form-label">Max daily stickiness prompts:</label>
                                <input
                                  type="number"
                                  class="form-control"
                                  id="stickinessPromptsPerDay"
                                  :value="stickinessPromptsPerDayInput"
                                  min="0"
                                  max="24"
                                  step="1"
                                  placeholder="No limit"
                                  @change="saveStickinessPromptsPerDay($event.target.value)"
                                >
                                <small class="form-text text-white">Leave blank for no limit. 0 turns them off.</small>
                              </div>
                <template v-if="isMatt">
                  <ThreeStateToggle
                                    id="stickinessPromptState"
                                    label="Stickiness Prompts"
                                    :value="stickinessPromptState"
                                    @input="saveStickinessPromptState"
                                  />
                                  <ThreeStateToggle
                                    id="tieBreakPromptState"
                                    label="Tie-break Prompts"
                                    :value="tieBreakPromptState"
                                    @input="saveTieBreakPromptState"
                                  />
                                  <ThreeStateToggle
                                    id="awardsPromptState"
                                    label="Personal Awards Prompts"
                                    :value="awardsPromptState"
                                    @input="saveAwardsPromptState"
                                  />
                </template>
              </SettingsSection>

              <SettingsSection v-if="pushConfigured" title="Notifications" hint="Push notifications for prompts and friends" collapsible :startOpen="false">
                <!-- iOS only allows web push for Home-Screen-installed apps,
                     and permission may only be requested from a real tap
                     (see the parallax post-mortem in vue-ui.md: never ask
                     spontaneously, degrade silently). -->
                <small v-if="pushSupportInfo.needsInstall" class="form-text text-white d-block mb-2">
                  To get notifications on iOS, first add Cinema Roll to your Home Screen
                  (Share <i class="bi bi-box-arrow-up"></i> → Add to Home Screen), then come back here.
                </small>
                <small v-else-if="!pushSupportInfo.supported" class="form-text text-white d-block mb-2">
                  This browser doesn't support push notifications.
                </small>
                <template v-else>
                  <div v-if="!pushDeviceSubscribed" class="mb-2">
                    <button class="btn btn-primary" :disabled="pushBusy" @click="enablePushOnThisDevice">
                      <i class="bi bi-bell me-1"></i>Turn on notifications on this device
                    </button>
                    <small class="form-text text-white d-block mt-2">
                      A daily nudge when films are waiting on stickiness, a tiebreak, or
                      personal awards — and a ping when a friend logs a movie.
                    </small>
                  </div>
                  <template v-else>
                    <div class="form-check form-switch mb-1">
                      <input class="form-check-input" type="checkbox" id="pushStickinessToggle" :checked="pushPrefs.stickiness" @change="updatePushPref('stickiness', $event)">
                      <label class="form-check-label" for="pushStickinessToggle">Stickiness ratings waiting</label>
                    </div>
                    <div class="form-check form-switch mb-1">
                      <input class="form-check-input" type="checkbox" id="pushTiebreakToggle" :checked="pushPrefs.tiebreak" @change="updatePushPref('tiebreak', $event)">
                      <label class="form-check-label" for="pushTiebreakToggle">Tiebreaks to settle</label>
                    </div>
                    <div class="form-check form-switch mb-1">
                      <input class="form-check-input" type="checkbox" id="pushAwardsToggle" :checked="pushPrefs.awards" @change="updatePushPref('awards', $event)">
                      <label class="form-check-label" for="pushAwardsToggle">Award years needing input</label>
                    </div>
                    <div class="form-check form-switch" :class="pushPrefs.friendLogs ? 'mb-1' : 'mb-3'">
                      <input class="form-check-input" type="checkbox" id="pushFriendLogsToggle" :checked="pushPrefs.friendLogs" @change="updatePushPref('friendLogs', $event)">
                      <label class="form-check-label" for="pushFriendLogsToggle">A friend logs a movie</label>
                    </div>
                    <!-- Only meaningful while friend logs are on. The score is
                         the reader's call (2026-09-06: "turn off the score so
                         you see that they watched it, but you don't see their
                         score"); whether one exists at all is the rater's. -->
                    <div v-if="pushPrefs.friendLogs" class="form-check form-switch mb-3 push-sub-toggle">
                      <input class="form-check-input" type="checkbox" id="pushFriendLogScoresToggle" :checked="pushPrefs.friendLogScores" @change="updatePushPref('friendLogScores', $event)">
                      <label class="form-check-label" for="pushFriendLogScoresToggle">Include what they rated it</label>
                    </div>
                    <!-- Off by default (2026-09-07: "an optional notification,
                         one that defaults to off ... that reminds you to play
                         the games every day, maybe even you can choose per
                         game"). Only names games not yet played that day. -->
                    <div class="form-check form-switch" :class="pushPrefs.games ? 'mb-1' : 'mb-3'">
                      <input class="form-check-input" type="checkbox" id="pushGamesToggle" :checked="pushPrefs.games" @change="updatePushPref('games', $event)">
                      <label class="form-check-label" for="pushGamesToggle">A daily reminder to play the games</label>
                    </div>
                    <div v-if="pushPrefs.games" class="mb-3 push-sub-toggle">
                      <label for="pushGamesHour" class="form-label">Remind me around</label>
                      <select class="form-select mb-2" id="pushGamesHour" :value="pushPrefs.gamesHour" @change="updatePushPrefNumber('gamesHour', $event.target.value)">
                        <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ formatPushHour(hour - 1) }}</option>
                      </select>
                      <small class="form-text text-white d-block mb-2">
                        Only the games you haven't played yet that day — nothing on a day you've played them all.
                      </small>
                      <div v-for="game in gameReminderRows" :key="game.key" class="form-check form-switch mb-1">
                        <input class="form-check-input" type="checkbox" :id="`pushGame-${game.key}`" :checked="game.on" @change="updateGameReminderPick(game.key, $event)">
                        <label class="form-check-label" :for="`pushGame-${game.key}`">{{ game.name }}</label>
                      </div>
                    </div>
                    <div class="mb-3">
                      <label for="pushCadenceSelect" class="form-label">When to tell me</label>
                      <select class="form-select" id="pushCadenceSelect" :value="pushPrefs.cadence" @change="updatePushPrefValue('cadence', $event.target.value)">
                        <option value="asTheyCome">As things come up</option>
                        <option value="daily">Once a day</option>
                      </select>
                    </div>
                    <template v-if="pushPrefs.cadence === 'asTheyCome'">
                      <div class="row g-2 mb-3">
                        <div class="col-6">
                          <label for="pushWindowStart" class="form-label">Not before</label>
                          <select class="form-select" id="pushWindowStart" :value="pushPrefs.windowStart" @change="updatePushPrefNumber('windowStart', $event.target.value)">
                            <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ formatPushHour(hour - 1) }}</option>
                          </select>
                        </div>
                        <div class="col-6">
                          <label for="pushWindowEnd" class="form-label">Not after</label>
                          <select class="form-select" id="pushWindowEnd" :value="pushPrefs.windowEnd" @change="updatePushPrefNumber('windowEnd', $event.target.value)">
                            <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ formatPushHour(hour - 1) }}</option>
                          </select>
                        </div>
                      </div>
                      <div class="mb-3">
                        <label for="pushesPerDay" class="form-label">At most, per day</label>
                        <input
                          type="number"
                          class="form-control"
                          id="pushesPerDay"
                          :value="pushPrefs.pushesPerDay"
                          min="1"
                          max="12"
                          step="1"
                          @change="updatePushPrefNumber('pushesPerDay', $event.target.value)"
                        >
                        <small class="form-text text-white">
                          A ceiling, not a target — you only hear from Cinema Roll when something
                          new is waiting, never twice about the same backlog. Friend logs arrive
                          as they happen and don't count against this.
                        </small>
                      </div>
                    </template>
                    <div v-else class="mb-3">
                      <label for="pushHourSelect" class="form-label">Daily nudge around</label>
                      <select class="form-select" id="pushHourSelect" :value="pushPrefs.hour" @change="updatePushPrefNumber('hour', $event.target.value)">
                        <option v-for="hour in 24" :key="hour - 1" :value="hour - 1">{{ formatPushHour(hour - 1) }}</option>
                      </select>
                      <small class="form-text text-white">Only sent on days something is actually waiting. Friend logs arrive as they happen.</small>
                    </div>
                    <div class="d-flex gap-2 flex-wrap">
                      <button class="btn btn-outline-light btn-sm" :disabled="pushBusy" @click="sendTestPush">
                        {{ pushTestSent ? 'Sent — check your notifications' : 'Send a test notification' }}
                      </button>
                      <button class="btn btn-outline-danger btn-sm" :disabled="pushBusy" @click="disablePushOnThisDevice">
                        Turn off on this device
                      </button>
                    </div>
                  </template>
                  <small v-if="pushError" class="form-text d-block mt-2" style="color: #ff8f8f;">{{ pushError }}</small>
                </template>
              </SettingsSection>

              <SettingsSection title="Letterboxd" hint="Link your account for deep links and imports" collapsible :startOpen="false">
                <div class="mb-3">
                                <label for="letterboxdUsername" class="form-label">Letterboxd Username:</label>
                                <div class="input-group">
                                  <span class="input-group-text">letterboxd.com/</span>
                                  <input
                                    type="text"
                                    class="form-control"
                                    id="letterboxdUsername"
                                    v-model="letterboxdUsername"
                                    placeholder="username"
                                    @blur="saveLetterboxdUsername"
                                  >
                                  <button v-if="letterboxdUsername" class="btn btn-outline-info" @click="scrapeLetterboxd" :disabled="scrapingTest.loading" title="Refresh Letterboxd Data">
                                    <span v-if="scrapingTest.loading">
                                      <span class="spinner-border spinner-border-sm" role="status"></span>
                                    </span>
                                    <span v-else>
                                      <i class="bi bi-arrow-clockwise"></i>
                                    </span>
                                  </button>
                                </div>
                                <div v-if="letterboxdUsername">
                                  <div v-if="scrapingTest.result" class="mt-2">
                                    <div v-if="scrapingTest.success" class="alert alert-success alert-sm">
                                      ✅ Found {{ scrapingTest.result.films?.length || 0 }} films in your Letterboxd profile!
                                    </div>
                                    <div v-else class="alert alert-warning alert-sm">
                                      ⚠️ {{ scrapingTest.error || 'Testing failed, using mock data instead' }}
                                    </div>
                                  </div>

                                  <div class="text-end">
                                    <a href="#" @click.prevent="showOverridePanel = !showOverridePanel" class="text-light text-decoration-none opacity-75" title="Manual overrides" style="font-size: 0.75rem;">
                                      overrides <i class="bi bi-plus"></i>
                                    </a>
                                  </div>

                                  <div v-if="showOverridePanel" class="mt-2 border rounded p-2" style="background-color: rgba(255,255,255,0.1);">
                                    <small class="text-light opacity-75 d-block mb-2">Mark movies as logged on Letterboxd when auto-detection fails</small>
                                    <div class="row g-2 mb-2">
                                      <div class="col-7">
                                        <input
                                          type="text"
                                          class="form-control form-control-sm"
                                          v-model="newOverrideTitle"
                                          placeholder="Movie title (exact match)"
                                        />
                                      </div>
                                      <div class="col-3">
                                        <input
                                          type="number"
                                          class="form-control form-control-sm"
                                          v-model="newOverrideYear"
                                          placeholder="Year"
                                        />
                                      </div>
                                      <div class="col-2">
                                        <button
                                          class="btn btn-success btn-sm w-100"
                                          @click="addLetterboxdOverride"
                                          :disabled="!newOverrideTitle || !newOverrideYear"
                                          title="Mark as logged on Letterboxd"
                                        >
                                          <i class="bi bi-plus"></i>
                                        </button>
                                      </div>
                                    </div>

                                    <div v-if="letterboxdOverrides && Object.keys(letterboxdOverrides).length" class="mt-2">
                                      <div class="override-list">
                                        <div v-for="(override, key) in letterboxdOverrides" :key="key" class="d-flex justify-content-between align-items-center py-1 px-2 mb-1 rounded border" style="background-color: rgba(255,255,255,0.1);">
                                          <small class="text-light">{{ override.title }} ({{ override.year }})</small>
                                          <a href="#" @click.prevent="removeLetterboxdOverride(key)" class="text-danger text-decoration-none opacity-75" title="Remove override">
                                            <i class="bi bi-x" style="font-size: 1rem;"></i>
                                          </a>
                                        </div>
                                      </div>
                                    </div>

                                    <div v-else class="text-light text-center py-2 opacity-75">
                                      <small><em>No manual overrides set</em></small>
                                    </div>
                                  </div>
                                </div>
                              </div>
              </SettingsSection>

              <SettingsSection title="Data &amp; account" hint="Offline posters, backfills, export, sign out" collapsible :startOpen="false">
                <h6 class="settings-subhead">Offline access</h6>
                <div class="mb-3">
                                <small class="form-text text-white d-block mb-2">
                                  Downloads every poster/backdrop in your library so they're viewable without a connection. Only needs to be run again after rating a batch of new movies.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="downloadForOffline"
                                  :disabled="offlineDownload.status === 'running'"
                                >
                                  <span v-if="offlineDownload.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Downloading {{ offlineDownload.completed }}/{{ offlineDownload.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-cloud-download"></i> Download all posters for offline
                                  </span>
                                </button>
                                <div v-if="offlineDownload.status === 'done'" class="text-success mt-2">
                                  <small><i class="bi bi-check-circle"></i> {{ offlineDownload.total }} images cached{{ offlineDownload.failed ? ` (${offlineDownload.failed} failed — check your connection and try again)` : '' }}.</small>
                                </div>
                              </div>
                <h6 class="settings-subhead">Maintenance</h6>

                <div class="mb-3">
                                <label class="form-label d-block">Library sync</label>
                                <small class="form-text text-white d-block mb-2">
                                  The app normally downloads only what changed since your last visit. If a movie ever looks stale or missing, this re-downloads the whole library fresh from the server.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="refreshLibraryFromServer"
                                >
                                  <i class="bi bi-arrow-repeat"></i> Refresh library from server
                                </button>
                              </div>

                <div class="mb-3">
                                <label class="form-label d-block">Box office data</label>
                                <small class="form-text text-white d-block mb-2">
                                  Fetches budget/box office numbers for movies rated before that data started being saved automatically. Safe to run again anytime — it only fetches whatever's still missing.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="backfillBoxOfficeData"
                                  :disabled="boxOfficeBackfill.status === 'running'"
                                >
                                  <span v-if="boxOfficeBackfill.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Fetching {{ boxOfficeBackfill.completed }}/{{ boxOfficeBackfill.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-cash-coin"></i> Fill in box office data for all movies
                                  </span>
                                </button>
                                <div v-if="boxOfficeBackfill.status === 'done'" class="text-success mt-2">
                                  <small v-if="boxOfficeBackfill.total"><i class="bi bi-check-circle"></i> {{ boxOfficeBackfill.total }} movie{{ boxOfficeBackfill.total === 1 ? '' : 's' }} updated{{ boxOfficeBackfill.failed ? ` (${boxOfficeBackfill.failed} failed — check your connection and try again)` : '' }}.</small>
                                  <small v-else><i class="bi bi-check-circle"></i> Everything's already filled in.</small>
                                </div>
                              </div>
                <div class="mt-4">
                                <label class="form-label d-block">Production countries</label>
                                <small class="form-text text-white d-block mb-2">
                                  Fetches which countries produced each movie, and the languages spoken in it. Safe to run again anytime.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="backfillProductionCountriesData"
                                  :disabled="countriesBackfill.status === 'running'"
                                >
                                  <span v-if="countriesBackfill.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Fetching {{ countriesBackfill.completed }}/{{ countriesBackfill.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-globe-americas"></i> Fill in production countries
                                  </span>
                                </button>
                                <div v-if="countriesBackfill.status === 'done'" class="text-success mt-2">
                                  <small v-if="countriesBackfill.total"><i class="bi bi-check-circle"></i> {{ countriesBackfill.total }} movie{{ countriesBackfill.total === 1 ? '' : 's' }} updated{{ countriesBackfill.failed ? ` (${countriesBackfill.failed} failed — check your connection and try again)` : '' }}.</small>
                                  <small v-else><i class="bi bi-check-circle"></i> Everything's already filled in.</small>
                                </div>
                              </div>
                <div class="mt-4">
                                <label class="form-label d-block">Filming &amp; story locations</label>
                                <small class="form-text text-white d-block mb-2">
                                  Looks up where each movie was filmed and where its story is set, from Wikidata. New ratings fetch this on their own; this catches up the rest. Safe to run again anytime.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="backfillLocationsData"
                                  :disabled="locationsBackfill.status === 'running'"
                                >
                                  <span v-if="locationsBackfill.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Looking up {{ locationsBackfill.completed }}/{{ locationsBackfill.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-geo-alt"></i> Fill in locations for all movies
                                  </span>
                                </button>
                                <div v-if="locationsBackfill.status === 'done'" class="text-success mt-2">
                                  <small v-if="locationsBackfill.total"><i class="bi bi-check-circle"></i> Checked {{ locationsBackfill.total }} movie{{ locationsBackfill.total === 1 ? '' : 's' }}; {{ locationsBackfill.withLocations }} had locations{{ locationsBackfill.failed ? ` (${locationsBackfill.failed} failed — check your connection and try again)` : '' }}.</small>
                                  <small v-else><i class="bi bi-check-circle"></i> Everything's already been checked.</small>
                                </div>
                              </div>
                <div class="mt-4">
                                <label class="form-label d-block">Slim down stored data</label>
                                <small class="form-text text-white d-block mb-2">
                                  Removes crew the app never shows (stunts, hair, makeup and so on) plus a few fields that get recalculated anyway. Cuts what has to download each time you open the app by roughly 40%. Nothing you can see in the app changes. Safe to run again anytime.
                                </small>
                                <button
                                  class="btn btn-outline-info btn-sm"
                                  @click="trimLibraryData"
                                  :disabled="libraryTrim.status === 'running'"
                                >
                                  <span v-if="libraryTrim.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Slimming {{ libraryTrim.completed }}/{{ libraryTrim.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-file-zip"></i> Slim down stored data
                                  </span>
                                </button>
                                <div v-if="libraryTrim.status === 'done'" class="text-success mt-2">
                                  <small v-if="libraryTrim.total"><i class="bi bi-check-circle"></i> {{ libraryTrim.total }} movie{{ libraryTrim.total === 1 ? '' : 's' }} slimmed{{ libraryTrim.failed ? ` (${libraryTrim.failed} failed — check your connection and try again)` : '' }}.</small>
                                  <small v-else><i class="bi bi-check-circle"></i> Already as small as it goes.</small>
                                </div>

                                <button
                                  class="btn btn-outline-light btn-sm w-100 mt-2"
                                  @click="backfillSyncStamps"
                                  :disabled="syncStampBackfill.status === 'running'"
                                >
                                  <span v-if="syncStampBackfill.status === 'running'">
                                    <span class="spinner-border spinner-border-sm me-1" role="status"></span>
                                    Timestamping {{ syncStampBackfill.completed }}/{{ syncStampBackfill.total }}...
                                  </span>
                                  <span v-else>
                                    <i class="bi bi-clock-history"></i> Add change timestamps
                                  </span>
                                </button>
                                <div v-if="syncStampBackfill.status === 'done'" class="text-success mt-2">
                                  <small v-if="syncStampBackfill.total"><i class="bi bi-check-circle"></i> {{ syncStampBackfill.total }} movie{{ syncStampBackfill.total === 1 ? '' : 's' }} timestamped{{ syncStampBackfill.failed ? ` (${syncStampBackfill.failed} failed — check your connection and try again)` : '' }}.</small>
                                  <small v-else><i class="bi bi-check-circle"></i> Every movie already has one.</small>
                                </div>
                              </div>
                <h6 class="settings-subhead">Account</h6>

                <p v-if="$store.state.userEmail" class="signed-in-as small mb-2">
                                  Signed in as {{ $store.state.userEmail }}
                                </p>
                                <button
                                  class="btn btn-outline-light btn-sm w-100 mb-2"
                                  @click="exportMyData"
                                >
                                  <i class="bi bi-download"></i> Download my data
                                </button>
                                <small class="form-text text-white d-block mb-2">Your whole library and settings as a JSON file.</small>
                                <button
                                  class="btn btn-outline-light btn-sm w-100"
                                  @click="signOut"
                                >
                                  <i class="bi bi-box-arrow-right"></i> Sign out
                                </button>
              </SettingsSection>

              <SettingsSection title="Magic Mirror" hint="Publish a small feed for the hallway display" v-if="isMatt" collapsible :startOpen="false">
                <small class="form-text text-white d-block mb-2">
                  Publishes a few KB of display data (recent watches, this month's best, and your rated movie ids) for the Magic Mirror to read. Your library itself stays private. Paste this URL into the mirror's config.
                </small>
                <button v-if="!mirrorFeedKey" type="button" class="btn btn-outline-info btn-sm" @click="enableMirrorFeed">
                  <i class="bi bi-display"></i> Turn on the mirror feed
                </button>
                <template v-else>
                  <input class="form-control mb-2" readonly :value="mirrorFeedUrl" @focus="$event.target.select()">
                  <button type="button" class="btn btn-outline-info btn-sm" @click="copyMirrorFeedUrl">
                    <i class="bi bi-clipboard"></i> {{ mirrorFeedCopied ? 'Copied' : 'Copy URL' }}
                  </button>
                </template>
              </SettingsSection>
              <SettingsSection title="Developer" hint="Dev mode, error logs, diagnostics" collapsible :startOpen="false">
                <div class="form-check form-switch mb-3">
                                <input class="form-check-input" type="checkbox" id="errorLogsToggle" :checked="showErrorLogs" @change="updateShowErrorLogs">
                                <label class="form-check-label" for="errorLogsToggle">Show error logs</label>
                              </div>
                              <div v-if="showErrorLogs" class="mb-3">
                                <button @click="testErrorLogging" class="btn btn-sm btn-outline-secondary">
                                  <i class="bi bi-bug"></i> Test Error Logging
                                </button>
                              </div>

                              <!-- Inline Error Log Viewer -->
                              <div v-if="showErrorLogs" class="error-logs-section mt-3 p-3 border rounded">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                  <h6 class="mb-0">
                                    <i class="bi bi-bug me-2"></i>Error Logs ({{ errorLogs.length }})
                                  </h6>
                                  <div>
                                    <button @click="copyErrorLogs" class="btn btn-sm btn-outline-primary me-2" :disabled="errorLogs.length === 0">
                                      <i class="bi bi-clipboard"></i> Copy
                                    </button>
                                    <button @click="clearErrorLogs" class="btn btn-sm btn-outline-danger" :disabled="errorLogs.length === 0">
                                      <i class="bi bi-trash"></i> Clear
                                    </button>
                                  </div>
                                </div>

                                <div v-if="errorLogs.length === 0" class="text-center text-muted py-3">
                                  <i class="bi bi-check-circle"></i> No logs to display
                                </div>

                                <div v-else class="error-logs-list" style="max-height: 300px; overflow-y: auto;">
                                  <div
                                    v-for="log in errorLogs.slice(0, 20)"
                                    :key="log.id"
                                    :class="['log-entry', 'p-2', 'mb-2', 'rounded', `log-${log.level}`]"
                                    style="font-size: 0.8rem; border-left: 3px solid;"
                                  >
                                    <div class="d-flex justify-content-between align-items-start mb-1">
                                      <span :class="['badge', `bg-${log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : log.level === 'info' ? 'info' : 'secondary'}`]">
                                        {{ log.level.toUpperCase() }}
                                      </span>
                                      <small class="text-muted">{{ formatLogTime(log.timestamp) }}</small>
                                    </div>
                                    <div class="log-message">{{ log.message }}</div>
                                    <div v-if="log.context && Object.keys(log.context).length > 0" class="mt-1">
                                      <small class="text-muted">Context: {{ JSON.stringify(log.context) }}</small>
                                    </div>
                                  </div>
                                  <div v-if="errorLogs.length > 20" class="text-center text-muted mt-2">
                                    <small>Showing first 20 of {{ errorLogs.length }} logs</small>
                                  </div>
                                </div>

                                <div v-if="copySuccess" class="alert alert-success mt-2 py-2">
                                  <i class="bi bi-check-circle"></i> Copied to clipboard!
                                </div>
                              </div>
              </SettingsSection>
            </div>
          </div>
          <!-- Results list follows the settings panel -->
          <!-- Group order panel: reorder the grouped result hierarchy for the day -->
          <div v-if="showGroupOrderPanel && groupedByAllCategories" ref="groupOrderPanel" class="group-order-panel card card-body mb-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <h6 class="mb-0 text-light">Group order</h6>
              <button class="btn btn-sm btn-outline-light" @click="toggleGroupOrderPanel">Done</button>
            </div>
            <ul class="list-unstyled mb-0">
              <li
                v-for="(group, index) in reorderableGroups"
                :key="group.category"
                class="group-order-row d-flex justify-content-between align-items-center py-1"
              >
                <span class="text-light">{{ group.categoryDisplay }} <span class="text-muted">({{ group.count }})</span></span>
                <span class="group-order-controls">
                  <button
                    class="btn btn-sm btn-secondary me-1"
                    :disabled="index === 0"
                    @click="moveGroupUp(group.category)"
                    aria-label="Move group up"
                  >
                    <i class="bi bi-arrow-up"/>
                  </button>
                  <button
                    class="btn btn-sm btn-secondary"
                    :disabled="index === reorderableGroups.length - 1"
                    @click="moveGroupDown(group.category)"
                    aria-label="Move group down"
                  >
                    <i class="bi bi-arrow-down"/>
                  </button>
                </span>
              </li>
            </ul>
          </div>
          <!-- Multi-category grouped results -->
          <div v-if="groupedByAllCategories" class="pb-3">
            <div v-for="group in groupedByAllCategories" :key="group.category" class="my-4 role-section">
              <h6
                class="bg-dark text-white text-end mb-2 group-header"
                role="button"
                title="Reorder result groups"
                aria-label="Reorder result groups"
                @click="openGroupOrderPanel"
              >
                {{ group.categoryDisplay }}
                <i class="bi bi-arrow-down-up group-header-icon"></i>
              </h6>
              <ul class="grid-layout" :class="getGridClassesForGroup(group.movies.length)">
                <DBGridLayoutSearchResult
                  v-for="(result, index) in group.movies"
                  :key="result.movie.id"
                  :result="result"
                  :keywordCounts="allCounts.keywords"
                  :allCounts="allCounts"
                  :index="index"
                  :resultsAreFiltered="resultsAreFiltered"
                  :sortValue="sortValue"
                  :activeQuickLinkList="quickLinkContext"
                  @updateSearchValue="updateSearchValue"
                />
              </ul>
            </div>
          </div>
          <!-- Regular results list -->
          <ul v-else class="grid-layout pb-3" :class="listCountClasses">
            <DBGridLayoutSearchResult
              v-for="(result, index) in paginatedSortedResults"
              :key="result.movie.id"
              :result="result"
              :keywordCounts="allCounts.keywords"
              :allCounts="allCounts"
              :index="index"
              :resultsAreFiltered="resultsAreFiltered"
              :sortValue="sortValue"
              :activeQuickLinkList="quickLinkContext"
              @updateSearchValue="updateSearchValue"
            />
          </ul>
          <!-- Infinite-scroll sentinel: the observer auto-loads the next batch as
               this nears the viewport. The button is a tap fallback if auto-load
               doesn't fire (e.g. observer unsupported, or a very tall viewport). -->
          <div v-if="canLoadMore" ref="loadMoreSentinel" class="load-more-sentinel d-flex justify-content-center mb-5">
            <button
              class="btn btn-secondary"
              @click="addMoreResults"
            >
              More...
            </button>
          </div>
          <!-- Suggestions button/component at the very bottom, only if not searching/filtering and all results are shown and user has rated 10+ movies -->
          <div v-else-if="!value && !resultsAreFiltered && sortedResults.length <= numberOfResultsToShow && userRatedMovieCount >= 10" class="mt-4 mb-5 text-center">
            <button v-if="!showSuggestionsOnly" class="btn btn-success" @click="showSuggestionsOnly = true">{{ suggestionsButtonLabel }}</button>
            <NoResults
              v-if="showSuggestionsOnly"
              :value="searchValue || effectiveSearchTerm"
              :suggestionsMode="true"
              @cancel-suggestions="showSuggestionsOnly = false"
              style="margin-bottom: 2rem;"
            />
          </div>
          <div v-else-if="noResults" class="button-wrapper d-flex justify-content-end mb-5">
            <div class="alert alert-warning text-center" style="flex: 1; margin-bottom: 0;">
              <p class="mb-2">No movies found on TMDB for "{{effectiveSearchTerm}}"</p>
              <button class="btn btn-sm btn-outline-dark" @click="startNewSearch">Try Another Search</button>
            </div>
          </div>
          <div v-else-if="$store.state.isOnline" class="button-wrapper d-flex justify-content-end mb-5">
            <button class="btn btn-primary" @click="searchTMDB" id="new-rating-button">Search TMDB for {{titleCase(effectiveSearchTerm)}}</button>
          </div>
          <div v-else class="button-wrapper d-flex justify-content-end mb-5">
            <button class="btn btn-primary" @click="rateOffline" id="rate-offline-button">Rate "{{titleCase(effectiveSearchTerm)}}" from memory</button>
          </div>
        </div>
        <div v-else class="no-results-but-search-type">
          <p class="text-center">No movies found for your search.</p>
          <button class="btn btn-link col-12" @click="toggleQuickLinksList(null)">Clear quick filters?</button>
        </div>
      </div>
      <div v-else-if="$store.state.dbLoaded">
        <!-- The "Did you mean...?" link itself now lives right under the
             search bar (see top of template) so it doesn't sit between the
             search bar and this new-rating-suggestion UI. -->
        <NoResults
          :class="{'no-results-buffer': !activeFiltersMinusTemps.length}"
          :value="searchValue || effectiveSearchTerm"
          @startNewSearch="startNewSearch"
        />
      </div>
      <!-- The spinner waits ~0.7s before showing: a warm launch (auth restore
           and the IndexedDB snapshot overlap, see initializeDB) paints the
           library well inside that, so the loading screen is only ever seen
           on a load that's genuinely slow — never as a flash on the way in
           (bug report 2026-09-05: notification tap "flashes to the loading
           screen and then shows it again"). -->
      <div v-else class="loading-screen d-flex justify-content-center align-items-center my-5">
        <div v-if="libraryLoadIsSlow" class="spinner-border text-light" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
      </div>
      <InsetBrowserModal :show="showInsetBrowserModal" :url="insetBrowserUrl" @close="showInsetBrowserModal = false" />
    </div>
    <!-- "More from…": things matching the current filter that aren't in the
         library yet. Rebuilt 2026-08-18 — "I've never been that pleased with
         how that section was built but I like the concept. Let's bring that
         section into our modern styles and make it possible to add movies
         from there to a hat" (report -P-HV1bfduJBFvmSGM-b).
         Now the same language as the watchlist rows: one sideways row of
         poster cards however many there are, each with a hat button, rather
         than a wall of bare col-3 posters under a bg-dark bar. -->
    <div v-if="displayableUnratedMovies.length && !unratedMoviesError && paginatedSortedResults.length" class="more-from">
      <h3 class="more-from-title">{{ moreFromTitle }}</h3>
      <div class="more-from-row">
        <div
          v-for="movie in displayableUnratedMovies"
          :key="movie.id"
          class="more-from-card"
          role="button"
          :aria-label="movie.title"
          @click="showMovieInfo(movie)"
        >
          <img
            :src="'https://image.tmdb.org/t/p/w185' + movie.poster_path"
            :alt="movie.title"
            class="more-from-poster"
            loading="lazy"
          >
          <div class="more-from-actions" @click.stop>
            <SendToHat variant="icon" :movies="movie" :note="moreFromHatNote"/>
          </div>
          <!-- The poster says the title; the year is what it can't. -->
          <span v-if="movie.release_date" class="more-from-meta">{{ movie.release_date.slice(0, 4) }}</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Add Filter Modal -->
  <div v-if="showAddFilterModal" class="modal-overlay" @click="showAddFilterModal = false">
    <div class="modal-content" @click.stop>
      <div class="modal-header">
        <h5>Add Filter</h5>
        <button class="btn-close" @click="showAddFilterModal = false"></button>
      </div>
      <div class="modal-body">

        <!-- Director Filter -->
        <div class="filter-section mb-3">
          <label class="form-label">Director</label>
          <select class="form-select" @change="addDirectorFilter($event)">
            <option value="">Select a director...</option>
            <option v-for="director in topDirectors" :key="director.name" :value="director.name">
              {{ director.name }} ({{ director.count }})
            </option>
          </select>
        </div>

        <!-- Year Filter -->
        <div class="filter-section mb-3">
          <label class="form-label">Year</label>
          <select class="form-select" @change="addYearFilter($event)">
            <option value="">Select a year...</option>
            <option v-for="year in availableYears" :key="year" :value="year">
              {{ year }}
            </option>
          </select>
        </div>

        <!-- Genre Filter -->
        <div class="filter-section mb-3">
          <label class="form-label">Genre</label>
          <select class="form-select" @change="addGenreFilter($event)">
            <option value="">Select a genre...</option>
            <option v-for="genre in topGenres" :key="genre.name" :value="genre.name">
              {{ genre.name }} ({{ genre.count }})
            </option>
          </select>
        </div>
        <div class="filter-section mb-3">
          <label class="form-label">Place</label>
          <select class="form-select" @change="addPlaceFilter($event)">
            <option value="">Select a place...</option>
            <option v-for="place in topPlaces" :key="place.name" :value="place.name">
              {{ place.name }} ({{ place.count }})
            </option>
          </select>
        </div>

        <!-- Tag Filter -->
        <div class="filter-section mb-3" v-if="userTags.length">
          <label class="form-label">Tag</label>
          <select class="form-select" @change="addTagFilter($event)">
            <option value="">Select a tag...</option>
            <option v-for="tag in userTags" :key="tag" :value="tag">
              {{ tag }}
            </option>
          </select>
        </div>

      </div>
    </div>
  </div>

  <!-- Movie Info Modal -->
  <div v-if="showMovieInfoModal" class="modal-overlay" @click="closeMovieInfoModal">
    <div class="modal-content movie-info-modal" @click.stop>
      <div class="modal-header">
        <button class="btn-close btn-close-white" @click="closeMovieInfoModal"></button>
      </div>
      <div class="modal-body movie-info-body">
        <div v-if="selectedMovieInfo" class="movie-info-content">
          <div class="movie-poster-section">
            <img
              v-if="selectedMovieInfo.poster_path"
              :src="`https://image.tmdb.org/t/p/w300${selectedMovieInfo.poster_path}`"
              :alt="selectedMovieInfo.title"
              class="movie-poster"
            >
          </div>
          <div class="movie-details-section">
            <h6 class="movie-title">{{ selectedMovieInfo.title }}</h6>
            <p v-if="selectedMovieInfo.release_date" class="movie-year">
              <strong>Year:</strong> {{ new Date(selectedMovieInfo.release_date).getFullYear() }}
            </p>
            <p v-if="selectedMovieInfo.genres && selectedMovieInfo.genres.length" class="movie-genres">
              <strong>Genres:</strong> {{ selectedMovieInfo.genres.map(g => g.name).join(', ') }}
            </p>
            <p v-if="selectedMovieInfo.overview" class="movie-overview">
              <strong>Synopsis:</strong> {{ selectedMovieInfo.overview }}
            </p>
            <p v-if="selectedMovieInfo.vote_average" class="movie-rating">
              <strong>TMDB Rating:</strong> {{ selectedMovieInfo.vote_average }}/10
            </p>
            <div class="mt-3">
              <button class="btn btn-primary" @click="rateMovieFromModal">
                Rate Movie
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
import { scrollWindowTo } from '../utils/scrollWindowTo.js';
import { indexOfMovie, resultElementId, resultsNeededToReveal, scrollOffsetFor } from '../assets/javascript/revealInList.js';
import { arrivedFromMovieDetail } from '../router/scrollBehavior.js';
import minBy from 'lodash/minBy';
import debounce from 'lodash/debounce';
import cloneDeep from 'lodash/cloneDeep';
import Fuse from 'fuse.js';
import DBGridLayoutSearchResult from './DBGridLayoutSearchResult.vue';
import TweakInline from "./TweakInline.vue";
import StickinessInline from "./StickinessInline.vue";
import PersonalAwardsModal from "./PersonalAwardsModal.vue";
import BugResolutionNotice from "./BugResolutionNotice.vue";
import NewsletterNotice from './NewsletterNotice.vue';
import UpdateAvailableBanner from "./UpdateAvailableBanner.vue";
import RatingCurveSettings from "./RatingCurveSettings.vue";
import SettingsSection from "./SettingsSection.vue";
import NoResults from "./NoResults.vue";
import InsetBrowserModal from './InsetBrowserModal.vue';
import ThreeStateToggle from './ThreeStateToggle.vue';
import SendToHat from './SendToHat.vue';
import { isQaAccountKey } from '../assets/javascript/databaseKey.js';
import { rankMoreFrom, genreAffinity } from "../assets/javascript/moreFromRanking.js";
import { genreIdFor } from "../assets/javascript/tmdbGenres.js";
import { createCache } from "../assets/javascript/moreFromCache.js";
import {
  partitionFilters,
  hasDiscoverableFilters,
  releaseWindow,
  discoverParams,
  matchesLocalConstraints,
  intersectById,
  pickResolvedId,
  describeFilters
} from "../assets/javascript/moreFromQuery.js";

// One cache for the app, not one per Home mount — navigating away and back
// should not throw away what TMDB already told us.
const moreFromCache = createCache();

// Name → TMDB id, for people, companies and keywords. These answers don't
// change, so they outlive the candidate cache and cost one request each,
// once.
const tmdbIdCache = new Map();
import { getRating } from "../assets/javascript/GetRating.js";
import { awardsYearThreshold, yearsMeetingAwardsThreshold } from "../assets/javascript/personalAwards.js";
import { promptsPerDay, dueForPrompt, lastAwardsPromptAt } from "../assets/javascript/promptQuota.js";
import { stickinessCandidates } from "../assets/javascript/stickinessCandidates.js";
import { titleMatchesValue } from "../assets/javascript/numberWords.js";
import { pushApiConfigured, pushSupport, subscribeThisDevice, unsubscribeThisDevice, sendTestNotification } from "../utils/push.js";
import { pushPrefsWithDefaults, gameReminderOn } from "../assets/javascript/pushPrefs.js";
import { logScore, globalAverage, logScoreSettings } from "../assets/javascript/logScore.js";
import ErrorLogService from '../services/ErrorLogService.js';
import { computeFlatKeywords } from '../utils/keywords.js';
import {
  buildSearchFields as buildSearchFieldsUtil,
  applyFilter as applyFilterUtil,
  getListOfYearsFromRange as getListOfYearsFromRangeUtil,
  getSortValue as getSortValueUtil,
  sortResultsFast as sortResultsFastUtil,
  sortResults as sortResultsUtil,
  countDidYouMeanSuggestionsThatFit,
  normalizeSearchText,
  titleNamedByFilters
} from '../assets/javascript/searchFiltering.js';
import {
  rankTypeahead,
  describeSuggestion,
  TYPEAHEAD_MIN_CHARS
} from '../assets/javascript/searchSuggestions.js';
import { buildCatalog, typeaheadEntries, CATALOG_KINDS } from '../assets/javascript/catalog.js';
import { interpretationsFor, discoverFilterFor } from '../assets/javascript/searchInterpretations.js';
import {
  awardNameWithThe,
  awardNameWithoutThe,
  awardNameSingular
} from '../assets/javascript/personalAwards.js';
import { groupByPersonRole } from '../assets/javascript/personRoleGroups.js';
import { findTiedGroup } from '../assets/javascript/tieBreakTournament.js';
import { GAME_ICONS, GAME_NAMES, gameWinKey, lastPlayedGamePath } from '../mixins/gameData.js';
import { collectImageUrls, warmImageCache } from '../assets/javascript/offlinePosterCache.js';
import { backfillBoxOffice, collectMoviesNeedingBoxOffice } from '../assets/javascript/backfillBoxOffice.js';
import { backfillProductionCountries, collectMoviesNeedingCountries } from '../assets/javascript/backfillProductionCountries.js';
import { backfillMovieLocations, collectMoviesNeedingLocations } from '../assets/javascript/movieLocations.js';
import { trimStoredEntries, collectEntriesNeedingTrim, entryForStorage } from '../assets/javascript/storedEntry.js';
import { collectEntriesNeedingStamp, stampBackfillUpdates } from '../assets/javascript/syncStamp.js';
import { makePlaceholderId } from '../utils/placeholderId.js';
import {
  countDirectors as countDirectorsUtil,
  countCastCrew as countCastCrewUtil,
  countGenres as countGenresUtil,
  countKeywords as countKeywordsUtil,
  countStudios as countStudiosUtil, countPlaces as countPlacesUtil } from '../assets/javascript/entityCounts.js';

// Default priority order for the grouped search view. The order decides which
// group claims a movie that matches multiple categories. Users can reorder this
// for the day via the group-order panel; it reverts to this default next day.
const DEFAULT_GROUP_ORDER = [
  'title',
  'director',
  'cast',
  'producer',
  'company',
  'keyword-genre',
  'place',
  'tag',
  'writer',
  'music',
  'editor',
  'cinematographer',
  'crew',
  'other'
];

// Display labels for groups in the reorder panel. Used for groups that are not
// currently rendered (and so have no live categoryDisplay to read).
const GROUP_DISPLAY_NAMES = {
  title: 'Title Matches',
  director: 'Director',
  cast: 'Cast',
  producer: 'Producer',
  company: 'Production Companies',
  'keyword-genre': 'Keywords & Genres',
  place: 'Places',
  tag: 'Tags',
  writer: 'Writer',
  music: 'Music',
  editor: 'Editor',
  cinematographer: 'Cinematographer',
  crew: 'Crew',
  other: 'Other'
};

// How long the library may take to arrive before Home shows a spinner.
// A warm launch reads the last snapshot from IndexedDB in well under this.
export const LOADING_SPINNER_DELAY_MS = 700;

export default {
  components: {
    DBGridLayoutSearchResult,
    InsetBrowserModal,
    TweakInline,
    StickinessInline,
    PersonalAwardsModal,
    BugResolutionNotice,
    NewsletterNotice,
    UpdateAvailableBanner,
    RatingCurveSettings,
    SettingsSection,
    NoResults,
    ThreeStateToggle,
    SendToHat,
  },
  data () {
    return {
      // True when the app was opened from a chore notification (`?open=`,
      // set by the push Lambda). The prompt cards read it and expand
      // themselves instead of waiting for a tap — bug report, 2026-09-13:
      // "took me to the home screen with the applicable notification
      // already opened and ready to go." Read once in mounted() and the
      // query stripped, so a refresh doesn't re-open anything.
      openChoreRequested: false,
      // True once the library has taken long enough to load that a spinner
      // is worth showing. See the loading-screen comment in the template.
      libraryLoadIsSlow: false,
      libraryLoadTimer: null,
      // Movie Hat linking (settings pane).
      findingHats: false,
      searchedForHats: false,
      hatLookupError: null,
      connectingHat: false,
      hatConnectError: null,
      mirrorFeedCopied: false,
      // Push notifications (settings pane). Whether THIS device holds a
      // subscription is an async browser question, so it lives in data and
      // is refreshed by checkPushDevice(), not computed.
      pushDeviceSubscribed: false,
      pushBusy: false,
      pushError: null,
      pushTestSent: false,
      activeFilters: [], // New multi-filter system
      activeQuickLinkList: "title",
      debouncedSetSearchValue: debounce(function (value) {
        this.searchValue = value;
      }, 300),
      // How many ranked "Did you mean?" suggestions currently fit on one line
      // next to the label, given the search input's actual width - see
      // updateDidYouMeanFitCount. Starts conservative; recalculated once the
      // input is actually mounted/measurable.
      didYouMeanFitCount: 1,
      debouncedUpdateDidYouMeanFitCount: debounce(function () {
        this.updateDidYouMeanFitCount();
      }, 200),
      // The typeahead panel is only ever open while the input has focus — a
      // panel floating over the header with nothing focused behind it is a
      // dropdown that has lost its input.
      searchInputFocused: false,
      // Escape closes the panel without closing the search, and stays closed
      // until the next keystroke says otherwise.
      typeaheadDismissed: false,
      // How tall the panel may be. It opens upward, so its ceiling is however
      // much room there is above the input — a full six rows is taller than
      // some banners, and rows that open off the top of the screen cannot be
      // tapped. Measured when it opens rather than assumed, since the banner
      // is a natural-aspect image whose height depends on the phone.
      typeaheadMaxHeight: 220,
      // True while the current sort is only the default as it looked at
      // mount — nobody has chosen one. Lets the saved default be applied
      // when settings finally load, without ever overriding a real choice.
      sortCameFromDefault: false,
      // Sequence number for the "More from…" fetches, so a slow earlier
      // filter can't paint over a newer one (see
      // fetchUnratedMoviesBySearchFilter).
      unratedRequestId: 0,
      filterTypes: ['general', 'person', 'year', 'yearRange', 'genre', 'company', 'keyword', 'place', 'tag'],
      hasAutoRandomChip: false, // Track if current chip was added by auto random search

      inputValue: "", // Visual input value (can be different from internal value)
      insetBrowserUrl: "",
      forceModalReevaluation: 0, // Dummy value to force modal computed properties to recalculate
      modalReevalInterval: null, // Timer for automatic modal re-evaluation
      // The clock the chore prompts are judged against. A REACTIVE now, not
      // Date.now() inside a computed: a film becomes due for its stickiness
      // score purely because time passed, and Vue does not re-run a computed
      // for that (see stickinessCandidates.js for the bug this caused).
      // Refreshed by refreshPromptClock() — on the re-eval interval, when the
      // app comes back to the foreground, and on a chore-notification tap.
      promptNow: Date.now(),
      letterboxdOverrides: {},
      letterboxdUserData: null,
      loadMoreObserver: null, // IntersectionObserver for infinite-scroll result loading
      newOverrideTitle: '',
      newOverrideYear: null,
      noResults: false, // Show no results message for TMDB search
      numberOfResultsToShow: 25,
      offlineDownload: { status: 'idle', completed: 0, total: 0, failed: 0 },
      boxOfficeBackfill: { status: 'idle', completed: 0, total: 0, failed: 0 },
      countriesBackfill: { status: 'idle', completed: 0, total: 0, failed: 0 },
      locationsBackfill: { status: 'idle', completed: 0, total: 0, failed: 0, withLocations: 0 },
      libraryTrim: { status: 'idle', completed: 0, total: 0, failed: 0 },
      syncStampBackfill: { status: 'idle', completed: 0, total: 0, failed: 0 },
      quickLinksSortType: "count",
      scrapingTest: {
        loading: false,
        result: null,
        success: false,
        error: null
      },
      searchValue: '',
      selectedMovieInfo: null, // Movie data for the info modal
      showAddFilterModal: false,
      showAverage: false,
      showGroupOrderPanel: false,
      showInsetBrowserModal: false,
      showMovieInfoModal: false, // Show/hide movie info modal
      showOverridePanel: false,
      showSettingsPanel: false, // controls settings panel visibility
      errorLogs: [], // error log entries
      copySuccess: false, // copy to clipboard success indicator
      errorLogRefreshInterval: null, // interval for refreshing error logs
      showSuggestionsOnly: false,
      dismissedWelcomeSuggestions: false, // a 0-rated user can cancel out of the auto-shown welcome suggestions
      showViewCount: false,
      showLogScore: false,
      sortOrder: "bestOrNewestOnTop",
      sortValue: null,
      unratedMovies: [],
      unratedMoviesDebounceTimeout: null,
      unratedMoviesError: null,
      unratedMoviesQuery: '',
      unratedMoviesSearchType: null, // 'person', 'year', 'yearRange', 'genre', 'general'
      value: "",
    }
  },
  watch: {
    // Tapping a chore notification is NOT always a fresh launch. The push
    // Lambda's navigate URL differs from the running app's only in the hash
    // (`.../#/?open=tiebreak`), so an installed PWA that is already in
    // memory does not reload: iOS focuses it, the hash changes, vue-router
    // routes it in place, and Home — already mounted — never re-runs
    // mounted(). Bug report, 2026-09-14: "I just tapped on a notification...
    // It brought me to the app and then just show me the home screen.
    // There's no indication that there actually is a stickiness rating I
    // need to do." The giveaway was the URL he reported it from, still
    // carrying `?open=tiebreak` — mounted() strips that, so mounted() had
    // not run. Watching the query covers the warm case; mounted() still
    // covers the cold one, where the watcher's first fire predates the
    // router being usable.
    '$route.query.open' () {
      this.readChoreOpenRequest();
    },
    // Report -P-HHWRf-WATy1lEwdYP: "We set up the default viewing order for
    // the homepage, but it doesn't seem to be respected. I chose to have it
    // be based on recent watch, but it's still showing me in order by
    // rating."
    //
    // mounted() reads defaultSortValue, but settings load from Firebase
    // AFTER mount — so it saw the 'rating' fallback rather than the saved
    // choice, and nothing re-applied it when the real value arrived. These
    // watchers do, and only while the current sort is still the untouched
    // default: an explicit sort this session sets DBSortValue, and that
    // must never be overridden.
    defaultSortValue (value) {
      if (!this.sortCameFromDefault || this.DBSortValue || !value) return;
      this.setSortValue(value);
      this.sortOrder = this.defaultSortOrder;
    },
    defaultSortOrder (order) {
      if (!this.sortCameFromDefault || this.DBSortValue || !order) return;
      this.sortOrder = order;
    },
    // Report -P-Hzqoq_yUQjNnqtc2-: "I find that I want the default sort to
    // be watch order but if I filter the results at all I want it to sort
    // by rating."
    //
    // Filtering is asking "which of these is best"; an unfiltered library
    // is a diary, and reads best in the order you saved. So narrowing the
    // list switches to rating and clearing it goes back to the default —
    // but only while the sort is still one nobody asked for. An explicit
    // sort always wins, filtered or not.
    hasActiveFilters (filtered) {
      if (!this.sortCameFromDefault || this.DBSortValue) return;

      if (filtered) {
        this.setSortValue('rating');
        this.sortOrder = 'bestOrNewestOnTop';
      } else {
        this.setSortValue(this.defaultSortValue);
        this.sortOrder = this.defaultSortOrder;
      }
    },
    // Edges arrive from the listener after mount, so the first fetch above
    // can run against an empty friend list. Same watcher WatchlistScreen and
    // FilmClubScreen use.
    socialFriendKeys: {
      handler (keys) {
        if (keys?.length) this.$store.dispatch('fetchFriendProfiles');
      }
    },
    // Refresh the published social profile once the library and settings
    // have both arrived, at most every 6 hours. A component watcher (not
    // $store.watch) so mounted mock stores in tests don't need the API.
    // Film Club feed for friends on other apps: republished on launch,
    // throttled to every 6 hours. Without this the feed would freeze at
    // whatever the library looked like when the invite was created, and a
    // Movie Log friend would silently see a stale library forever.
    clubFeedReady: {
      immediate: true,
      handler (ready) {
        if (!ready) return;
        if (!this.$store.state.settings?.clubFeedKey) return;
        const last = Number(localStorage.getItem('cinemaRoll.clubFeed.lastPublish') || 0);
        if (Date.now() - last < 6 * 60 * 60 * 1000) return;
        this.$store.dispatch('publishClubFeed');
        localStorage.setItem('cinemaRoll.clubFeed.lastPublish', String(Date.now()));
      }
    },
    // Magic Mirror feed: republished on the same readiness signal, throttled
    // to every 6 hours. No-ops unless the user has a feed key (Matt does).
    mirrorFeedReady: {
      immediate: true,
      handler (ready) {
        if (!ready) return;
        const last = Number(localStorage.getItem('cinemaRoll.mirrorFeed.lastPublish') || 0);
        if (Date.now() - last < 6 * 60 * 60 * 1000) return;
        if (!this.$store.state.settings?.mirrorFeedKey) return;
        this.$store.dispatch('publishMirrorFeed');
        localStorage.setItem('cinemaRoll.mirrorFeed.lastPublish', String(Date.now()));
      }
    },
    socialPublishReady: {
      immediate: true,
      handler (ready) {
        if (!ready) return;
        const social = this.$store.getters?.socialSettings;
        if (!social?.enabled) return;
        // The six-hour throttle is about not republishing a ~100KB profile
        // for no reason. A changed NAME is a reason: friends see a mention
        // by whatever was last published, so waiting up to six hours to stop
        // calling someone by their email handle would be the bug report
        // (2026-08-20) still on screen. Same for anyone signing in on a new
        // device, where the stamp is absent and this publishes anyway.
        const lastPublish = Number(localStorage.getItem('cinemaRoll.social.lastPublish') || 0);
        const lastName = localStorage.getItem('cinemaRoll.social.lastPublishName');
        const nameChanged = social.displayName !== lastName;
        if (!nameChanged && Date.now() - lastPublish < 6 * 60 * 60 * 1000) return;
        this.$store.dispatch('publishSocialProfile');
        localStorage.setItem('cinemaRoll.social.lastPublish', String(Date.now()));
        localStorage.setItem('cinemaRoll.social.lastPublishName', social.displayName);
      }
    },
    // Publishes a small summary of what's actually on screen to the store,
    // purely so in-app bug reports can include it (see bugReports.js). Added
    // after an "the entire list of movies is empty" report that couldn't be
    // diagnosed: the snapshot only had the PERSISTED navigation fields,
    // which mounted() clears on restore, so it showed an empty search and
    // no chips no matter what was really filtering the list. Nothing reads
    // this for behaviour.
    liveDebugState: {
      immediate: true,
      handler (value) {
        this.$store.commit('setHomePageLiveState', value);
      }
    },
    allEntriesWithFlatKeywordsAdded (newVal, oldval) {
      if (!oldval.length && newVal.length) {
        this.resolveBanner(); // data just loaded → set the initial banner
      }
    },
    canLoadMore () {
      // (Re)wire the infinite-scroll observer whenever the sentinel appears or
      // disappears — its element is recreated each time this flips true.
      this.$nextTick(() => this.setupLoadMoreObserver());
    },
    didYouMeanSuggestions () {
      // Candidate terms changed (new search value) - re-measure since
      // different terms have different lengths, so how many fit will vary.
      this.$nextTick(() => this.updateDidYouMeanFitCount());
    },
    typeaheadOpen (isOpen) {
      if (isOpen) {
        this.measureTypeaheadRoom();
      }
    },
    // Watches EVERY active chip, not just the highest-priority one.
    // effectiveSearchFilter returns the first chip by type priority, so
    // filtering by horror and comedy used to fetch horror and ignore the
    // rest — "sometimes I have more than one chip... can we filter the more
    // from list for more than one chip?" (2026-08-18).
    moreFromSignature (newVal, oldVal) {
      if (newVal && newVal !== oldVal) {
        this.debouncedFetchUnratedMoviesForFilters(this.moreFromFilters);
      } else if (!newVal) {
        this.unratedMovies = [];
        this.unratedMoviesError = null;
      }
    },
    // Covers both "the year-scroller just appeared" (null -> a year, e.g.
    // typing a year into the search bar, or state restored on mount) and
    // "a different year was tapped while it was already showing" — in
    // both cases the newly-active pill should be scrolled into view.
    activeYearChipValue (newYear) {
      if (newYear != null) {
        this.$nextTick(() => this.centerYearScrollerPill());
      }
    },
  },
  mounted () {
    this.armLoadingSpinner();

    // Which state the Notifications settings card should render in.
    this.checkPushDevice();

    // `?hatToken=` connects Movie Hat from a minted token instead of the
    // Google popup, which an automated browser cannot complete. Mirrors the
    // app's own ?testToken= sign-in hook; the token only ever grants the Dev
    // Hat (see mint-hat-token.mjs in the movie-hat repo).
    // `?revealMovie=<dbKey>` scrolls the list to that film in place, keeping
    // whatever sort is already set. Set by the rank badge on MovieDetail.
    if (this.$route?.query?.revealMovie) {
      this.revealMovieInList(String(this.$route.query.revealMovie));
    }

    // Opened from a chore notification. Also watched, not only read here —
    // see readChoreOpenRequest.
    this.readChoreOpenRequest();

    const hatToken = this.$route?.query?.hatToken;
    if (hatToken) {
      this.$store.dispatch('connectMovieHat', hatToken)
        .catch((error) => ErrorLogService.error('Movie Hat token sign-in failed', error));
    }

    // Social: keep the inbox live. Publishing happens via the
    // socialPublishReady watcher below once the library and settings are in.
    this.$store.dispatch('attachSocialListeners');
    // The badge counts ratings in friends' PROFILES, and Home never fetched
    // them — only the edges. So countNewFriendUpdates always ran over an empty
    // object and the badge could never appear at all: "maybe we can add the
    // number of updates... I'm not sure that's working. I haven't seen it in a
    // while" (2026-08-17). Profiles are a few KB each.
    this.$store.dispatch('fetchFriendProfiles');
    // External friends are a SEPARATE fetch -- their profiles come from other
    // apps' feeds, not from social/profiles -- and Home used to load only the
    // native half. Anything outside Film Club, Watchlist and Friend
    // Comparison therefore saw a club with the external members missing:
    // Brian had rated The Odyssey 6.78 and his pill never appeared on the
    // movie page (2026-08-25). Both halves load together now, the same
    // pairing WatchlistScreen and FriendComparison already use.
    this.$store.dispatch('syncExternalFriends');

    // Capture navigation intent at the start - needed for various logic below
    const navigationIntent = this.$store.state.homePageNavigationIntent;

    // Set by the restore below, and read by the sort initialization further
    // down — which used to key off `navigationIntent === 'close'`, a value
    // only MovieDetail ever sets, and so happily overwrote a sort restored
    // from anywhere else.
    let restoredSort = false;

    // Check if we have any state to restore
    const hasStateToRestore = this.$store.state.homePageScrollPosition > 0 ||
                             this.$store.state.homePageSearchChips.length > 0 ||
                             this.$store.state.homePageSearchValue ||
                             this.$store.state.homePageNumberOfResults > 25 ||
                             this.$store.state.homePageSortOrder ||
                             this.$store.state.homePageSortValue;

    if (hasStateToRestore) {
      // Restore search state
      if (this.$store.state.homePageSearchChips.length > 0) {
        this.activeFilters = [...this.$store.state.homePageSearchChips];
      }
      if (this.$store.state.homePageSearchValue) {
        this.inputValue = this.$store.state.homePageSearchValue;
      }
      if (this.$store.state.homePageNumberOfResults > 25) {
        this.numberOfResultsToShow = this.$store.state.homePageNumberOfResults;
      }

      // Restore the sort for any return EXCEPT a search handoff, which is
      // asking for a specific list and shouldn't inherit the old ordering.
      // Previously this required intent === 'close', which only MovieDetail
      // ever sets — so coming back from anywhere else silently dropped it.
      if (navigationIntent !== 'search') {
        if (this.$store.state.homePageSortValue) {
          this.sortValue = this.$store.state.homePageSortValue;
          restoredSort = true;
        }
        if (this.$store.state.homePageSortOrder) {
          this.sortOrder = this.$store.state.homePageSortOrder;
        }
      }

      // Captured NOW, not read inside the $nextTick below. This restore has
      // never actually worked: the callback used to read
      // this.$store.state.homePageScrollPosition, but the "clear stored
      // state" block a few lines down sets that to 0 SYNCHRONOUSLY - i.e.
      // always before the deferred callback runs - so the `> 0` guard was
      // false every single time and the page never moved. (A second,
      // independent bug was hiding behind it: the restore used
      // `documentElement.scrollTop = x`, which this app's
      // `scroll-behavior: smooth` silently swallows - see
      // utils/scrollWindowTo.js.)
      const scrollPositionToRestore = this.$store.state.homePageScrollPosition;

      // Restore scroll position after DOM updates and result rendering.
      //
      // Gated on having actually come back from a movie's detail page
      // (2026-08-17). Every navigation now lands at the top of its page, and
      // this is the single exception: "if you start on the Home Screen, click
      // a poster to go to a movie detail page, and then click back, it should
      // return you to where it was scrolled on the home page."
      //
      // The navigation intent alone can't carry that. `beforeRouteLeave`
      // saves the scroll position on the way out to ANY screen, and both
      // 'close' and null reach here — null covering both BackLink's
      // router.back() from a movie AND arriving at Home from Insights. So
      // returning from Insights used to drop you into the middle of the grid.
      // The router knows the previous route; it records the answer for us.
      this.$nextTick(() => {
        const restoring = arrivedFromMovieDetail() &&
          navigationIntent !== 'search' &&
          scrollPositionToRestore > 0;

        if (restoring) {
          scrollWindowTo(scrollPositionToRestore);
        } else {
          // Belt and braces with the router's own scroll-to-top: Home renders
          // its grid asynchronously, so the page can grow taller after the
          // router has already scrolled.
          scrollWindowTo(0);
        }
      });

      // Clear stored state after restoring (unless it's a new search from MovieDetail)
      const isNewSearch = this.$store.state.homePageSearchValue && this.$store.state.homePageSearchChips.length === 0;
      if (!isNewSearch) {
        this.$store.commit('setHomePageScrollPosition', 0);
        this.$store.commit('setHomePageSearchChips', []);
        this.$store.commit('setHomePageSearchValue', '');
        this.$store.commit('setHomePageNavigationIntent', null); // Clear navigation intent
        this.$store.commit('setHomePageSortOrder', null); // Clear sort order
        this.$store.commit('setHomePageSortValue', null); // Clear sort value
        // Don't reset numberOfResults - preserve the expanded results
        // this.$store.commit('setHomePageNumberOfResults', 25);
      } else if (isNewSearch) {
        // Handle new search from MovieDetail - convert search value to chip immediately
        this.convertSearchToChip();
        // If the clicked value carried a group type, promote that group to the
        // top of the hierarchy for the day (clicks win over manual ordering).
        this.applyPromoteGroup();
        // Clear the stored state after conversion
        this.$store.commit('setHomePageScrollPosition', 0);
        this.$store.commit('setHomePageSearchChips', []);
        this.$store.commit('setHomePageSearchValue', '');
        this.$store.commit('setHomePageNavigationIntent', null); // Clear navigation intent
        this.$store.commit('setHomePageSortOrder', null); // Clear sort order
        this.$store.commit('setHomePageSortValue', null); // Clear sort value
      }
    } else {
      // Normal behavior - scroll to top instantly
      scrollWindowTo(0);
      // Clear navigation intent and sort order
      this.$store.commit('setHomePageNavigationIntent', null);
      this.$store.commit('setHomePageSortOrder', null);
      this.$store.commit('setHomePageSortValue', null);
    }

    if (this.$route.query.search) {
      // Bug report: links from Insights (an actor in Outliers, a year in
      // Best Years) "type the search term into the input but don't
      // actually search". Setting inputValue only fills the box — the
      // search itself runs through updateSearchValue, same as typing.
      const incomingSearch = decodeURIComponent(this.$route.query.search);
      this.inputValue = incomingSearch;
      this.$nextTick(() => this.updateSearchValue(incomingSearch));
    }

    // Handle new search from MovieDetail page
    if (this.$store.state.homePageSearchValue && this.$store.state.homePageSearchChips.length === 0) {
      // Clear the search state from store after processing
      this.$store.commit('setHomePageSearchValue', '');
    }

    // Only pick a default sort when the restore above didn't already put one
    // back. This used to ask whether the intent was 'close', which meant a
    // sort restored from anywhere other than a movie page was immediately
    // overwritten with the default — the actual reason sort didn't survive
    // the trip.
    if (!restoredSort) {
      // The session's last sort wins, then the saved default, then rating.
      if (this.DBSortValue) {
        this.setSortValue(this.DBSortValue)
      } else {
        this.setSortValue(this.defaultSortValue)
        this.sortOrder = this.defaultSortOrder;
        // Remember that nobody asked for this sort — it is just the default
        // as it looked at mount. Settings arrive from Firebase a moment
        // later, and the watcher below uses this to swap in the real saved
        // default once it lands.
        this.sortCameFromDefault = true;
      }
    }

    if (this.$route.query.movieDbKey) {
      // Arriving with a movie to highlight sorts by recency — unless a sort
      // was restored, which is the more specific intent.
      if (!restoredSort) {
        this.$store.commit("setDBSortValue", "watched");
        this.setSortValue("watched");
        this.sortOrder = "bestOrNewestOnTop";
      }
    }

    // Note: showShorts, showErrorLogs, and enableRandomSearch are now computed properties

    // Initialize letterboxdOverrides from store
    if (this.$store.state.settings.letterboxdOverrides) {
      this.letterboxdOverrides = this.$store.state.settings.letterboxdOverrides;
    }

    // Initialize error logs
    this.refreshErrorLogs();
    if (this.showErrorLogs) {
      this.startErrorLogRefresh();
    }

    // Pick the header banner based on how we arrived (context-aware). Runs after
    // any incoming search/chip has been applied above so 'fromResults' can sample
    // the visible results. If data isn't loaded yet this no-ops and the
    // allEntriesWithFlatKeywordsAdded watcher resolves it once the library lands.
    this.resolveBanner();

    // Keep the time-based chore prompts honest as the clock moves.
    //
    // The interval alone used to be the whole mechanism, at 30 minutes, and
    // that is not enough on this app's actual platform: an installed PWA
    // sits in memory for days, and iOS suspends its timers the moment it is
    // backgrounded — so the tick that should have noticed a film maturing
    // never fires, and the one after it can be half an hour late. The
    // foreground handler below is what actually carries this on a phone; the
    // interval covers a session left open in the foreground.
    this.modalReevalInterval = setInterval(this.refreshPromptClock, 300000); // 5 minutes
    document.addEventListener('visibilitychange', this.refreshPromptClockIfVisible);

    // Wire infinite-scroll in case results are already present at mount (e.g.
    // restored navigation state). The canLoadMore watcher covers the later
    // case where the library loads in after mount.
    this.$nextTick(() => this.setupLoadMoreObserver());

    // "Did you mean?" fit-count depends on the search input's actual
    // rendered width, so it needs a real DOM measurement (not just reactive
    // state) once mounted, and again on resize (e.g. rotating a phone).
    this.$nextTick(() => this.updateDidYouMeanFitCount());
    window.addEventListener('resize', this.debouncedUpdateDidYouMeanFitCount);
  },
  beforeUnmount () {
    window.removeEventListener('resize', this.debouncedUpdateDidYouMeanFitCount);
    document.removeEventListener('visibilitychange', this.refreshPromptClockIfVisible);
    clearTimeout(this.libraryLoadTimer);

    // Clean up error log refresh interval
    this.stopErrorLogRefresh();

    // Clean up modal re-evaluation interval
    if (this.modalReevalInterval) {
      clearInterval(this.modalReevalInterval);
      this.modalReevalInterval = null;
    }

    // Clean up infinite-scroll observer
    if (this.loadMoreObserver) {
      this.loadMoreObserver.disconnect();
      this.loadMoreObserver = null;
    }
  },

  // Combined beforeRouteLeave method
  beforeRouteLeave (to, from, next) {
    // Save wherever you're going. This used to save ONLY for MovieDetail and
    // /games and deliberately reset sorting for everywhere else, which meant
    // searching, sorting, tapping Insights and coming back lost the lot
    // ("we need to maintain sort order and filters when we come back to the
    // home page", Matt 2026-08-16).
    //
    // It became much more obvious once back actually returned you to Home
    // instead of pushing a fresh one, but it was never right: popping over to
    // Wordle kept your search while popping over to the watchlist didn't, and
    // nothing about the destination explains the difference.
    //
    // Note this only ever touches the STORE, never the live component state.
    // Bug report ("the whole bar seems to shift a little bit to the right...
    // the icon for the sort order is disappearing"): an earlier version
    // nulled the visible sortValue, which unmounted the sort icon's v-if for
    // one frame before navigating and visibly reflowed the rainbow bar.
    this.$store.commit('setHomePageScrollPosition', window.pageYOffset);
    this.$store.commit('setHomePageSearchChips', [...this.activeFilters]);
    this.$store.commit('setHomePageSearchValue', this.inputValue);
    this.$store.commit('setHomePageNumberOfResults', this.numberOfResultsToShow);
    this.$store.commit('setHomePageSortValue', this.sortValue);
    this.$store.commit('setHomePageSortOrder', this.sortOrder);
    next();
  },
  computed: {
    userEmail () {
      return this.$store.state.userEmail;
    },
    movieHatEmail () {
      return this.$store.state.movieHatEmail;
    },
    linkedMovieHats () {
      return this.$store.getters.linkedMovieHats;
    },
    // Everything found by the lookup, plus anything already linked, so a
    // linked hat still shows (and can be unlinked) before any lookup runs.
    hatChoices () {
      const found = this.$store.state.availableMovieHats || [];
      const extras = this.linkedMovieHats.filter(
        (linked) => !found.some((hat) => hat.title === linked.title)
      );
      return [...found, ...extras.map((hat) => ({ ...hat, movies: '—' }))];
    },
    // Diagnostic only - see the liveDebugState watcher above.
    liveDebugState () {
      return {
        quickLink: this.quickLinkContext,
        typedSearch: this.inputValue || '',
        chips: this.activeFilters.map((filter) => `${filter.type}:${filter.value}`),
        resultsRendered: this.paginatedSortedResults.length,
        resultsMatched: this.sortedResults.length,
        libraryEntries: this.allEntriesWithFlatKeywordsAdded.length,
        numberToShow: this.numberOfResultsToShow,
        grouped: Boolean(this.groupedByAllCategories),
        sort: `${this.sortValue}/${this.sortOrder}`
      };
    },
    pendingReconciliations () {
      return this.$store.state.pendingReconciliations || [];
    },
    firstPendingReconciliationDbKey () {
      const entry = this.pendingReconciliations[0];
      return entry ? entry.dbEntry.path.split('movieLog/')[1] : '';
    },
    // The Games entry-point button shows the specific game's own icon (via
    // GAME_ICONS) whenever goToGames() would jump straight back into it, or
    // the generic controller icon whenever it would land on the hub
    // instead — same LAST_PLAYED_KEY lookup goToGames() itself does. A
    // plain computed (not reactive to localStorage) is fine here: the only
    // way LAST_PLAYED_KEY changes is by visiting a game and coming back,
    // which necessarily remounts Home.vue anyway.
    gamesButtonIcon () {
      const lastPlayed = lastPlayedGamePath(this.$router);
      return (lastPlayed && GAME_ICONS[lastPlayed]) || 'bi-dice-5';
    },
    tieBreakTweak () {
      const value = this.$store.state.settings?.tieBreakTweak;
      return typeof value === 'number' ? value : 1;
    },
    // Prompt quotas. Awards default to one a day (what they have always
    // done); stickiness defaults to no limit, also what it has always done —
    // a blank box means "as often as there's something to rate" rather than
    // quietly capping a prompt that never was capped. See promptQuota.js.
    awardsPromptsPerDayInput () {
      const value = this.$store.state.settings?.awardsPromptsPerDay;
      return typeof value === 'number' ? value : 1;
    },
    stickinessPromptsPerDayInput () {
      const value = this.$store.state.settings?.stickinessPromptsPerDay;
      return typeof value === 'number' ? value : null;
    },
    awardsPromptDue () {
      // eslint-disable-next-line no-unused-vars
      const _ = this.forceModalReevaluation;
      const settings = this.$store.state.settings || {};
      return dueForPrompt({
        lastAt: lastAwardsPromptAt(settings),
        perDay: promptsPerDay(settings.awardsPromptsPerDay, 1)
      });
    },
    stickinessPromptDue () {
      // eslint-disable-next-line no-unused-vars
      const _ = this.forceModalReevaluation;
      const settings = this.$store.state.settings || {};
      return dueForPrompt({
        lastAt: settings.lastStickinessPromptAt,
        perDay: promptsPerDay(settings.stickinessPromptsPerDay, null)
      });
    },
    personalAwardName () {
      const value = this.$store.state.settings?.personalAwardName;
      return (typeof value === 'string' && value.length > 0) ? value : 'Oscar';
    },
    // Cached (computed, not a method): walks the whole matched set through
    // getRating, so it must only recompute when results/toggle change.
    filteredLogScore () {
      if (!this.showLogScore) return null;
      const scores = (this.sortedResults || [])
        .map((entry) => getRating(entry)?.calculatedTotal)
        .filter(Number.isFinite);
      const globalAvg = globalAverage(this.$store.getters.allMoviesAsArray || [], getRating);
      const score = logScore(scores, globalAvg, logScoreSettings(this.$store.state.settings));
      return score == null ? '—' : score;
    },
    awardsYearThresholdInput () {
      return awardsYearThreshold(this.$store.state.settings);
    },
    showShorts () {
      const value = this.$store.state.settings?.includeShorts;
      return typeof value === 'boolean' ? value : false;
    },
    // Every field the sort dropdown offers, in the order it offers them.
    sortOptions () {
      return [
        { value: 'rating', label: 'Rating' },
        { value: 'watched', label: 'Date watched' },
        { value: 'release', label: 'Release date' },
        { value: 'title', label: 'Title' },
        { value: 'views', label: 'Times seen' },
        { value: 'direction', label: 'Direction' },
        { value: 'imagery', label: 'Imagery' },
        { value: 'story', label: 'Story' },
        { value: 'performance', label: 'Performance' },
        { value: 'soundtrack', label: 'Soundtrack' },
        { value: 'stickiness', label: 'Stickiness' },
        { value: 'budget', label: 'Budget' },
        { value: 'boxOffice', label: 'Box office' },
        { value: 'profit', label: 'Profit' },
        { value: 'returnPct', label: 'Return on budget' }
      ];
    },
    moneyInTodaysDollars () {
      return this.$store.state.moneyInTodaysDollars;
    },
    defaultSortValue () {
      return this.$store.state.settings?.defaultSort?.value || 'rating';
    },
    defaultSortOrder () {
      return this.$store.state.settings?.defaultSort?.order || 'bestOrNewestOnTop';
    },
    socialSettings () {
      return this.$store.getters.socialSettings || {};
    },
    crossAppDiscovery () {
      return this.$store.getters?.crossAppDiscoveryEnabled || false;
    },
    mirrorFeedKey () {
      return this.$store.state.settings?.mirrorFeedKey || null;
    },
    mirrorFeedUrl () {
      const account = this.$store.state.databaseTopKey;
      if (!account || !this.mirrorFeedKey) return '';
      return `https://movie-log-8c4d5-default-rtdb.firebaseio.com/mirrorFeed/${account}/${this.mirrorFeedKey}.json`;
    },
    socialPublishReady () {
      return Boolean(this.$store.state.dbLoaded && this.$store.state.settingsLoaded);
    },
    mirrorFeedReady () {
      return Boolean(this.$store.state.dbLoaded && this.$store.state.settingsLoaded);
    },
    clubFeedReady () {
      return Boolean(this.$store.state.dbLoaded && this.$store.state.settingsLoaded);
    },
    incomingFriendRequests () {
      const requests = this.$store.state.socialRequests || {};
      const me = this.$store.getters?.socialUserKey;
      const edges = this.$store.state.socialEdges || {};
      // A request from someone already befriended is stale noise, same
      // filter the Circle inbox applies — as is hiding the QA tester, which
      // this banner was missing, so it could have announced a request the
      // Film Club screen then refused to show.
      return Object.entries(requests)
        .filter(([key]) => !(edges[me]?.[key] && edges[key]?.[me]))
        .filter(([key]) => !isQaAccountKey(key))
        .map(([key, request]) => ({ key, name: request?.name || key }));
    },
    socialFriendKeys () {
      return this.$store.getters?.socialFriendKeys || [];
    },
    filmClubNewUpdateCount () {
      return this.$store.getters?.filmClubNewUpdateCount || 0;
    },
    friendRequestBannerText () {
      const requests = this.incomingFriendRequests;
      if (requests.length === 1) return `${requests[0].name} sent you a friend request.`;
      return `You have ${requests.length} friend requests.`;
    },
    showErrorLogs () {
      const value = this.$store.state.settings?.showErrorLogs;
      return typeof value === 'boolean' ? value : false;
    },
    letterboxdConnected: {
      get () {
        const value = this.$store.state.settings?.letterboxdConnected;
        return typeof value === 'boolean' ? value : false;
      },
      set (value) {
        // Writable so `this.letterboxdConnected = true` (auto-connect) takes effect;
        // saveLetterboxdConnection() persists it to Firebase.
        this.$store.commit('setSettings', { ...(this.$store.state.settings || {}), letterboxdConnected: value });
      }
    },
    letterboxdUsername: {
      get () {
        const value = this.$store.state.settings?.letterboxdUsername;
        return typeof value === 'string' ? value : '';
      },
      set (value) {
        // Was getter-only, so v-model on the settings input couldn't write back —
        // a NEW user's typed username was dropped and saved as '' on blur. The
        // setter stores it in local settings; @blur saveLetterboxdUsername persists.
        this.$store.commit('setSettings', { ...(this.$store.state.settings || {}), letterboxdUsername: value });
      }
    },
    pushConfigured () {
      return pushApiConfigured();
    },
    pushSupportInfo () {
      return pushSupport();
    },
    pushPrefs () {
      return pushPrefsWithDefaults(this.$store.state.pushPrefs);
    },
    // One switch per game for the reminder, in the hub's own roster order.
    gameReminderRows () {
      return Object.entries(GAME_NAMES).map(([path, name]) => {
        const key = gameWinKey(path);
        return { key, name, on: gameReminderOn(this.pushPrefs, key) };
      });
    },
    stickinessPromptState () {
      const value = this.$store.state.settings?.stickinessPromptState;
      return (typeof value === 'string' && ['disabled', 'normal', 'forced'].includes(value)) ? value : 'normal';
    },
    tieBreakPromptState () {
      const value = this.$store.state.settings?.tieBreakPromptState;
      return (typeof value === 'string' && ['disabled', 'normal', 'forced'].includes(value)) ? value : 'normal';
    },
    awardsPromptState () {
      const value = this.$store.state.settings?.awardsPromptState;
      return (typeof value === 'string' && ['disabled', 'normal', 'forced'].includes(value)) ? value : 'normal';
    },
    dailyAwardsYear () {
      return this.$store.state.settings?.dailyAwardsYear;
    },

    activeFiltersMinusTemps () {
      // Return only non-temporary filters
      return this.activeFilters.filter((filter) => !filter.temp);
    },
    // Drives the year-scroller special case (see the chip row template) —
    // true whenever ANY active chip is a plain 'year' type (not
    // 'yearRange'/decades). Follow-up: "I do want it to also be able to
    // work with other filters" — combining a year with e.g. a genre chip
    // still shows the scroller, with the genre chip rendered as a normal
    // badge below it (see otherActiveFilters).
    hasActiveYearChip () {
      return this.activeFiltersMinusTemps.some((filter) => filter.type === 'year');
    },
    activeYearChipValue () {
      const yearChip = this.activeFiltersMinusTemps.find((filter) => filter.type === 'year');
      if (!yearChip) return null;
      const parsed = parseInt(yearChip.value, 10);
      return Number.isNaN(parsed) ? null : parsed;
    },
    // Everything the chip row still shows as a plain badge — every active
    // chip EXCEPT a 'year' one, which the scroller above represents
    // instead. Equals activeFiltersMinusTemps unchanged whenever no year
    // chip is active, so the plain chip row's existing behavior is
    // preserved exactly in that case.
    otherActiveFilters () {
      return this.activeFiltersMinusTemps.filter((filter) => filter.type !== 'year');
    },
    // The chips More from can answer: every active chip except a curated
    // list. TMDB cannot be asked about "Best Picture", and a heading that
    // named it while the fetch ignored it would lie about the row below.
    moreFromFilters () {
      return this.allActiveFilters.filter((filter) => filter?.type !== 'list');
    },
    // Every answerable chip, in a stable string — both the watch trigger for
    // the suggestions row and its cache key. Sorted, so re-adding the same
    // two chips in the other order is recognised as the same question.
    moreFromSignature () {
      return this.moreFromFilters
        .map((filter) => {
          const value = filter?.value && typeof filter.value === 'object'
            ? `${filter.value.startYear ?? ''}-${filter.value.endYear ?? ''}`
            : String(filter?.value ?? '').trim().toLowerCase();
          return `${filter?.type}|${value}`;
        })
        .sort()
        .join('&');
    },
    // The signature plus the reading the fetch will actually use, so a plain
    // search and the same words as a deliberate chip can't share a cached
    // answer — they ask TMDB different questions.
    moreFromCacheKey () {
      const lead = this.searchInterpretations[0];
      return lead
        ? `${this.moreFromSignature}#${lead.kind}|${lead.norm}`
        : this.moreFromSignature;
    },
    /**
     * What the plain text being searched could REFER TO, best reading first.
     *
     * Empty unless the whole question is one free-text chip — with a typed
     * chip in play the user has already said what they mean, and with several
     * chips the combined question is theirs, not ours to reinterpret.
     *
     * This is what lets "More from" survive typed text becoming a plain
     * search. A `general` chip carries no TMDB id, so before this the row
     * could only ask /search/movie for the words — typing "Thriller" would
     * have offered films CALLED Thriller instead of more thrillers. Now the
     * text still leads and the leading interpretation adds the question the
     * old genre chip used to ask, so the row answers both readings at once.
     */
    searchInterpretations () {
      return this.interpretationsFrom(this.moreFromFilters);
    },
    // Any narrowing at all — a chip or typed text. Watched above, because
    // a filtered list wants rating order and a whole library doesn't.
    hasActiveFilters () {
      return this.allActiveFilters.length > 0;
    },
    allActiveFilters () {
      const filters = [];

      // Add input text as a general search filter if it exists AND no chips are active at all
      // (avoid double filtering when any chips exist, temp or permanent)
      if (this.searchValue && this.searchValue.trim() && this.activeFilters.length === 0) {
        filters.push({
          id: '__input__',
          type: 'general',
          value: this.searchValue.trim(),
          display: this.searchValue.trim(),
          source: 'input'
        });
      }

      // Add all existing chips
      this.activeFilters.forEach(chip => {
        filters.push({
          ...chip,
          source: 'chip'
        });
      });

      return filters;
    },
    allCastCrew () {
      return Object.keys(this.countCastCrew).map((keyword) => {
        return {
          name: this.titleCase(keyword),
          count: this.countCastCrew[keyword]
        }
      });
    },
    allCounts () {
      return {
        keywords: this.countedKeywords,
        places: this.countedPlaces,
        genres: this.countedGenres,
        years: this.countedYears,
        directors: this.countDirectors,
        castCrew: this.countCastCrew,
        studios: this.countStudios,
        mediums: this.allMediums,
        filmographies: this.allDirectors
      };
    },
    allDirectors () {
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
    allEntriesWithFlatKeywordsAdded () {
      return this.$store.getters.allMediaAsArray.map((result) => {
        // Use the shared keyword util so Home matches the detail page exactly,
        // including manually-added (customKeywords) and removed (removedKeywords)
        // keywords. An inline version here previously omitted those, so e.g. a
        // user-added "Star Wars" keyword was invisible to grouping/filtering.
        const movie = {
          ...result.movie,
          flatKeywords: computeFlatKeywords(result.movie)
        };
        // Precompute lowercased search fields ONCE here (memoized with this
        // computed) so applyFilter doesn't re-lowercase every movie per keystroke.
        return {
          ...result,
          movie,
          _search: this.buildSearchFields(movie, result.ratings)
        }
      });
    },
    allGenres () {
      return Object.keys(this.countedGenres).map((keyword) => {
        return {
          name: this.titleCase(keyword),
          count: this.countedGenres[keyword]
        }
      });
    },
    allKeywords () {
      return Object.keys(this.countedKeywords).map((keyword) => {
        return {
          name: this.titleCase(keyword),
          count: this.countedKeywords[keyword]
        }
      });
    },
    allMediums () {
      const mediums = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        result.ratings.forEach((rating) => {
          if (!rating.medium) {
            return;
          } else if (mediums[rating.medium]) {
            mediums[rating.medium]++;
          } else {
            mediums[rating.medium] = 1;
          }
        });
      });

      return Object.keys(mediums).map((medium) => {
        return {
          name: this.titleCase(medium),
          count: mediums[medium]
        }
      });
    },
    allStudios () {
      return Object.keys(this.countStudios).map((keyword) => {
        return {
          name: this.titleCase(keyword),
          count: this.countStudios[keyword]
        }
      });
    },
    allYears () {
      return Object.keys(this.countedYears).map((keyword) => {
        return {
          name: this.titleCase(keyword),
          count: this.countedYears[keyword]
        }
      });
    },
    availableYears () {
      const years = this.allEntriesWithFlatKeywordsAdded
        .map(movie => new Date(movie.movie.release_date).getFullYear())
        .filter(year => !isNaN(year));
      return [...new Set(years)].sort((a, b) => b - a);
    },
    // Bug report: "I want the years to go ascending to the right, not
    // descending... the next year should be to the right of the current
    // year, not the other way around." Reversed here rather than flipping
    // availableYears itself, because that same list also fills the "Add
    // Filter" Year <select>, where newest-first is the right default for
    // picking a recent year. Still one source of truth for WHICH years
    // exist - only the display order differs.
    availableYearsAscending () {
      return [...this.availableYears].reverse();
    },
    bestMovieFromEachYear () {
      const years = {};

      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        const year = new Date(result.movie.release_date).getFullYear();

        if (!years[year]) {
          years[year] = result;
        } else if (this.mostRecentRating(result).calculatedTotal > this.mostRecentRating(years[year]).calculatedTotal) {
          years[year] = result;
        }
      })

      return Object.keys(years).map((year) => years[year]);
    },
    bestPictures () {
      const bestPictureWinners = this.$store.state.academyAwardWinners.bestPicture;

      const allEntryIds = this.allEntriesWithFlatKeywordsAdded.map((result) => {
        return result.movie.id;
      });

      const bestPictureWinnersWithRatingStatus = [];

      bestPictureWinners.forEach((movie) => {
        if (allEntryIds.includes(movie.id)) {
          bestPictureWinnersWithRatingStatus.push({
            ...this.allEntriesWithFlatKeywordsAdded.find((entry) => entry.movie.id === movie.id),
            ...{
              movie: {
                ...this.allEntriesWithFlatKeywordsAdded.find((entry) => entry.movie.id === movie.id).movie,
                academyAwardsYear: movie.academyAwardsYear
              }
            }
          });
        } else {
          bestPictureWinnersWithRatingStatus.push({
            falseEntry: true,
            movie,
            ratings: [
              {
                date: Date.now(),
                direction: 0,
                id: movie.id,
                imagery: 0,
                impression: 0,
                love: 0,
                medium: "",
                overall: 0,
                performance: 0,
                soundtrack: 0,
                stickiness: 0,
                story: 0,
                title: movie.title,
                year: new Date(movie.release_date).getFullYear()
              }
            ]
          });
        }
      });

      return bestPictureWinnersWithRatingStatus;
    },
    bestPicturesWithRatings () {
      return this.bestPictures.filter((result) => !result.falseEntry);
    },
    countCastCrew () {
      return countCastCrewUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    countDirectors () {
      return countDirectorsUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    countedGenres () {
      return countGenresUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    countedKeywords () {
      return countKeywordsUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    countedPlaces () {
      return countPlacesUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
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
    countStudios () {
      return countStudiosUtil(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    darkOrLight () {
      const inDarkMode = document.querySelector("body").classList.contains('bg-dark');

      return { 'text-bg-dark': inDarkMode, 'text-bg-light': !inDarkMode };
    },
    datalistForActiveQuickLink () {
      if (this.activeQuickLinkList === "keyword") {
        return this.allKeywords;
      } else if (this.activeQuickLinkList === "genre") {
        return this.allGenres;
      } else if (this.activeQuickLinkList === "year") {
        return this.allYears;
      } else if (this.activeQuickLinkList === "director") {
        return this.allDirectors;
      } else if (this.activeQuickLinkList === "cast/crew") {
        return this.allCastCrew;
      } else if (this.activeQuickLinkList === "studios") {
        return this.allStudios;
      } else if (this.activeQuickLinkList === "mediums") {
        return this.allMediums;
      } else {
        return [];
      }
    },
    DBSortValue () {
      return this.$store.state.DBSortValue;
    },
    displayableUnratedMovies () {
      const filtered = this.unratedMovies.filter(movie => movie.id && movie.poster_path);
      return filtered;
    },
    // How you rate each genre against your own average — the part of a
    // suggestion TMDB can't know. Computed from the whole library, so it is
    // cached here rather than rebuilt per filter change.
    genreTaste () {
      return genreAffinity(
        this.allEntriesWithFlatKeywordsAdded,
        (entry) => getRating(entry)?.calculatedTotal
      );
    },
    // One heading instead of seven near-identical spans — and it now names
    // every chip, because the row below it answers all of them.
    moreFromTitle () {
      const filters = this.moreFromFilters;
      if (filters.length > 1) {
        return `More from ${describeFilters(filters)}`;
      }

      const term = this.effectiveSearchTerm;

      switch (this.unratedMoviesSearchType) {
        case 'yearRange': return 'More from this time period';
        case 'genre': return `More ${String(term || '').toLowerCase()} movies`;
        case 'search': return `Movies matching “${term}”`;
        default: return `More from ${term}`;
      }
    },
    // Provenance written onto the hat movie, so a draw can say where it came
    // from months later — Movie Hat shows it on the drawn-movie screen.
    moreFromHatNote () {
      const term = this.effectiveSearchTerm;
      return term ? `Found under ${term}` : 'Found in Cinema Roll';
    },
    effectiveSearchFilter () {
      const typePriority = this.filterTypes;

      for (const type of typePriority) {
        const chipOfType = this.allActiveFilters.find(filter => filter.type === type);
        if (chipOfType) {
          return chipOfType;
        }
      }

      return null;
    },
    effectiveSearchTerm () {
      if (this.effectiveSearchFilter) {
        return this.effectiveSearchFilter.value;
      } else {
        return '';
      }
    },
    searchableTerms () {
      // The fuzzy-match index: every distinct, typed term drawn from the user's
      // OWN rated library. Reuses the count maps that are already computed for
      // the counts/filtering features, so building this is cheap. Each entry
      // carries the `expectedType` string that createFilterByType() understands
      // (NOT the internal applyFilter type), so a tapped suggestion builds the
      // correct chip. Titles have no expectedType and commit as a general chip,
      // matching how a typed title behaves today.
      // Entity terms come from the catalog — the same index the typeahead
      // ranks — so the two features can never know different libraries.
      const terms = this.libraryCatalog.entries.map((entry) => ({
        value: entry.name,
        expectedType: CATALOG_KINDS[entry.kind]?.expectedType ?? null,
        typeLabel: entry.kind
      }));

      // Titles: distinct, committed as general (expectedType null).
      const seenTitles = new Set();
      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        const title = result.movie.title;
        if (title && !seenTitles.has(title)) {
          seenTitles.add(title);
          terms.push({ value: title, expectedType: null, typeLabel: 'title' });
        }
      });

      // Deliberately NOT carrying a precomputed normalized copy of each term:
      // that is one extra object and string per director, actor, keyword, genre,
      // studio and title in the library, retained for a fallback that only ever
      // fires on zero results. It measured as a doubling of an unrelated library
      // sort. Fuse is fuzzy enough that an accent costs a little edit distance
      // and nothing more.
      return terms;
    },
    fuzzyIndex () {
      // Build the Fuse index ONCE per library change, not per keystroke. Vue
      // memoizes this computed, so it only rebuilds when searchableTerms changes
      // (i.e. when the rated library changes), turning a ~40ms-per-keystroke cost
      // into a one-time cost. didYouMeanSuggestions reuses this instance.
      if (this.searchableTerms.length === 0) {
        return null;
      }
      return new Fuse(this.searchableTerms, {
        keys: ['value'],
        threshold: 0.4, // Fuse default; loose enough for typos, tight enough to avoid noise
        ignoreLocation: true,
        minMatchCharLength: 3
      });
    },
    didYouMeanSuggestions () {
      // Typo-tolerant "Did you mean...?" fallback. Deliberately gated so the
      // fuzzy work NEVER runs on the common (has-results) path: it only fires
      // when the user has typed a non-trivial term that produced zero local
      // results. This keeps search fast and leaves the exact-match behavior of
      // groupedByAllCategories / unifiedFilteredResults completely unchanged.
      // Only ever suggest from the RAW typed input — never from effectiveSearchTerm
      // (a chip's value). The suggestions are typo-correction for what the user is
      // typing; firing them off a structured chip (e.g. a `year` chip "2010" that
      // legitimately matches no rated movies) showed nonsensical name/title
      // suggestions in place of the normal zero-results UI.
      const term = (this.searchValue || '').trim();

      if (term.length < 3) {
        return [];
      }
      // Only suggest when there are no local results to show. (showResultsList
      // is false here, which is the same branch that renders the "Search TMDB"
      // button — suggestions sit above it, never replacing it.)
      if (this.paginatedSortedResults.length > 0 || this.activeListChip || this.activeQuickLinkList !== 'title') {
        return [];
      }
      const fuse = this.fuzzyIndex;
      if (!fuse) {
        return [];
      }

      const results = fuse.search(term);
      const suggestions = [];
      const seen = new Set();

      for (const { item } of results) {
        // Skip a "suggestion" identical to what was typed (case-insensitive).
        if (normalizeSearchText(item.value) === normalizeSearchText(term)) {
          continue;
        }
        const dedupeKey = `${item.expectedType || 'title'}:${item.value.toLowerCase()}`;
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        suggestions.push(item);
        if (suggestions.length >= 5) {
          break;
        }
      }

      return suggestions;
    },
    // As many of the ranked suggestions (best first) as fit on one line next
    // to the "Did you mean?:" label, per didYouMeanFitCount - see
    // updateDidYouMeanFitCount for how that's kept in sync with the actual
    // rendered width. didYouMeanSuggestions itself stays a full ranked list
    // of up to 5 since the blur-guard and tests rely on its full shape.
    didYouMeanLineSuggestions () {
      return this.didYouMeanSuggestions.slice(0, this.didYouMeanFitCount);
    },
    libraryCatalog () {
      // THE index of everything filterable — names, counts, and crucially
      // the TMDB ids the library already stores (see catalog.js). Memoized
      // per library change; every consumer that used to build its own
      // index (typeahead, fuzzy terms, More from's id resolution) reads
      // this one, so they can no longer drift apart.
      return buildCatalog(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    typeaheadIndex () {
      // The dimensions of your own library you could filter by. Deliberately
      // NOT titles — the results list below the bar is already matching those
      // live, so the row would be spent telling you what is already on screen
      // (see searchSuggestions.js). The catalog projection dedupes a
      // director out of the cast bucket and carries the tmdbId the eventual
      // chip will need.
      return typeaheadEntries(this.libraryCatalog);
    },
    typeaheadSuggestions () {
      // Gated on inputValue (synchronous) but SEARCHED on searchValue (300ms
      // debounced): the scan stays debounced while typing, and the line still
      // disappears the instant a suggestion is tapped rather than lingering
      // for the length of one more debounce.
      if (this.inputValue.trim().length < TYPEAHEAD_MIN_CHARS) {
        return [];
      }

      // Deliberately NOT gated on didYouMeanSuggestions. A part-typed genre or
      // keyword returns zero results — `general` matches those by exact
      // equality (see applyFilter), so "thril" finds nothing until the "ler"
      // arrives — which means the fuzzy line is already up. Both lines would
      // then offer "Thriller" and both would build the same genre chip; the
      // template picks which one shows, and it picks this one, because a
      // prefix match is a stronger signal than a fuzzy one and "Filter by:
      // Thriller genre" says what a tap will do. didYouMeanSuggestions itself
      // is left exactly as it was, since blurSearchBar's guard depends on it.
      return rankTypeahead(this.typeaheadIndex, this.searchValue, {
        exclude: this.activeFilters.filter((filter) => !filter.temp).map((filter) => filter.value)
      });
    },
    typeaheadOpen () {
      return this.searchInputFocused &&
        !this.typeaheadDismissed &&
        this.typeaheadSuggestions.length > 0;
    },
    groupOrder () {
      // Returns the active group hierarchy. Uses the user's daily override from
      // settings if it was saved today (local calendar day); otherwise reverts
      // to the default. Always returns every known group key so the full
      // hierarchy is preserved even when only some groups are reordered.
      const override = this.$store.state.settings.groupOrderOverride;

      if (override && Array.isArray(override.order) && override.date === new Date().toDateString()) {
        // Start from the saved order, then append any default keys it is missing
        // (e.g. a group type added after the override was saved) so nothing is
        // stranded out of the hierarchy.
        const saved = override.order.filter(key => DEFAULT_GROUP_ORDER.includes(key));
        const missing = DEFAULT_GROUP_ORDER.filter(key => !saved.includes(key));
        return [...saved, ...missing];
      }

      return [...DEFAULT_GROUP_ORDER];
    },
    // Sections for a person chip, built by splitting the results already on
    // screen rather than searching again. Null when there's nothing to split
    // or only one role to split into — a lone "Cast" header over the same
    // list is a heading, not a grouping.
    personRoleGroups () {
      const filter = this.effectiveSearchFilter;
      if (!filter || filter.type !== 'person') return null;

      const sections = groupByPersonRole(this.unifiedFilteredResults, filter.value, {
        order: this.groupOrder,
        sort: (movies) => this.sortResultsFast(movies)
      });

      return sections.length > 1 ? sections : null;
    },
    groupedByAllCategories () {
      // Use debounced search for typing performance, but fall back to effectiveSearchTerm for chips
      let searchTerm;
      if (this.searchValue) {
        // User is typing - use debounced value for performance
        searchTerm = this.searchValue;
      } else if (this.activeFilters.length > 0) {
        // User has chips active - use effectiveSearchTerm
        searchTerm = this.effectiveSearchTerm;
      } else {
        return null;
      }

      if (!searchTerm || !searchTerm.toLowerCase) return null;
      const normalizedSearchTerm = searchTerm.toLowerCase();

      // Only show grouped results when we have a simple search term
      // Skip if we have multiple chips or quick links active
      if (this.activeFilters.filter(f => !f.temp && f.type !== 'list').length > 1 ||
        this.activeListChip || this.activeQuickLinkList !== 'title') {
        return null;
      }

      // Grouping is a FREE-TEXT feature. It answers "where did this word
      // match?" — Title, Director, Cast, Producer, Production Companies,
      // Keywords & Genres — by taking the search term and re-searching it
      // across all six. A typed chip has already answered that question, and
      // grouping throws its type away (effectiveSearchTerm is just the chip's
      // VALUE), so the grouped view stops being a filter at all: it shows
      // whatever contains the word in any field, including movies the chip
      // itself excludes.
      //
      // Natalie, 2026-08-19: "I just tried to click on a tag on a movie and it
      // brought me back to the home screen, but it didn't actually filter
      // correctly. It didn't show me other movies with that tag." Her chip was
      // tag:DARK; the flat filter found her five tagged movies, and the
      // grouped view she was looking at showed whatever had "dark" in its
      // title instead.
      //
      // Tags are the worst case, having no group at all, but this is NOT
      // tag-specific — verified with a genre chip on a two-movie library: the
      // Horror film rendered nowhere and a Comedy called "Horror Story Night"
      // rendered instead. Every typed chip leaks this way, because Title is
      // always one of the groups being searched.
      // ...with ONE exception, and it is the case the sections exist for. A
      // person chip is a question about roles — Matt, 2026-08-23: "I've
      // searched for Stephen Spielberg and his direction, acting, and
      // production are all smooshed." Answering it needs no re-search and so
      // leaks nothing: personRoleGroups partitions the flat filtered results
      // instead of going back to the library. See personRoleGroups.js.
      if (this.effectiveSearchFilter && this.effectiveSearchFilter.type === 'person') {
        return this.personRoleGroups;
      }

      if (this.effectiveSearchFilter && this.effectiveSearchFilter.type !== 'general') {
        return null;
      }

      // Skip if the search term is too short or too generic
      if (normalizedSearchTerm.length < 3) {
        return null;
      }

      // There used to be a blocklist here — war, love, man, black, red,
      // american… — that fell back to the flat list for "very common/generic
      // terms that will match too many movies". Removed 2026-08-29, when
      // typed text stopped becoming a typed chip: those words are now exactly
      // the ones the sections are for. "War" is a genre AND a word in a dozen
      // titles, and answering it with one undifferentiated list is the
      // failure the sections exist to prevent. Grouping costs ~2.4ms against
      // the flat list's ~0.6ms over a 1,300-film library (Performance.bench),
      // so the guard was never carrying its weight in speed either.

      // Check if this is a year search - if so, bypass grouping and use normal results
      if (this.detectYearTypes(searchTerm)) {
        return null; // Let normal filtering handle years
      }

      // Performance optimization: Skip expensive computation if we have no results to group
      if (!this.allEntriesWithFlatKeywordsAdded || this.allEntriesWithFlatKeywordsAdded.length === 0) {
        return null;
      }

      // The grouped sections respect includeShorts the same way the flat
      // pipeline does: hidden shorts are out UNLESS the search names one by
      // title. This filter didn't exist for years and mostly didn't matter,
      // because the results area only renders when the flat pipeline is
      // non-empty — but the moment the title-named rescue opened that gate
      // more often, "moon" put A Grand Day Out (24 min, keyword "moon") in
      // the Keywords & Genres section with shorts switched off (Matt,
      // 2026-08-31, the day after the rescue shipped). Same predicate as
      // step 3 of unifiedFilteredResults, so the two pipelines can't disagree
      // about which shorts exist.
      const groupSearchFilters = [{ type: 'general', value: searchTerm }];
      const allResults = this.showShorts
        ? this.allEntriesWithFlatKeywordsAdded
        : this.allEntriesWithFlatKeywordsAdded.filter(result =>
          !(result.movie.runtime && result.movie.runtime <= 40) ||
            titleNamedByFilters(result, groupSearchFilters));

      // Step 1: Compute candidate matches for each fixed-type group. Done in a
      // SINGLE pass over the library instead of one full filter() pass per group
      // (previously ~7 passes). The candidate SETS are identical to before — a
      // movie is still a candidate in every group whose filter it matches — so
      // the later priority-claiming behavior is unchanged. We only collapse the
      // iteration so applyFilter is evaluated per movie in one loop.
      const groupConfigs = [
        { key: 'title', displayName: 'Title Matches', filter: { type: 'title', value: searchTerm } },
        { key: 'director', displayName: 'Director', filter: { type: 'director', value: searchTerm } },
        { key: 'cast', displayName: 'Cast', filter: { type: 'cast', value: searchTerm } },
        { key: 'producer', displayName: 'Producer', filter: { type: 'producer', value: searchTerm } },
        { key: 'company', displayName: 'Production Companies', filter: { type: 'company', value: searchTerm } }
      ];

      const candidatesByKey = {};
      groupConfigs.forEach(config => {
        candidatesByKey[config.key] = { displayName: config.displayName, movies: [] };
      });
      candidatesByKey['keyword-genre'] = { displayName: 'Keywords & Genres', movies: [] };
      candidatesByKey.place = { displayName: 'Set or Filmed There', movies: [] };
      candidatesByKey.tag = { displayName: 'Tags', movies: [] };

      // Inlined matcher (perf): instead of 7 dispatched applyFilter calls per
      // movie (each re-reading/re-deriving the same data), read each movie's
      // precomputed _search ONCE and evaluate all group conditions against it.
      // Every condition below mirrors the corresponding applyFilter case EXACTLY,
      // so candidate sets are identical — GroupOrdering.test.js guards this.
      // Everything compares through the same normalization applyFilter uses:
      // `term` (accents and punctuation folded) for the exact-equality groups,
      // and `titleMatchesValue` — the same helper FILTER_KINDS.general calls —
      // for the title bucket, so the number-word bridge can't reach one and
      // not the other.
      const term = normalizeSearchText(searchTerm);
      const titleBucket = candidatesByKey.title.movies;
      const directorBucket = candidatesByKey.director.movies;
      const castBucket = candidatesByKey.cast.movies;
      const producerBucket = candidatesByKey.producer.movies;
      const companyBucket = candidatesByKey.company.movies;
      const keywordGenreBucket = candidatesByKey['keyword-genre'].movies;
      const placeBucket = candidatesByKey.place.movies;
      const tagBucket = candidatesByKey.tag.movies;

      allResults.forEach(media => {
        const s = media._search || this.buildSearchFields(media.movie, media.ratings);

        if (titleMatchesValue(s, searchTerm)) titleBucket.push(media);
        if (s.crew.some(p => p.job === 'Director' && p.name.includes(term))) directorBucket.push(media);
        if (s.cast.some(n => n.includes(term))) castBucket.push(media);
        if (s.crew.some(p => p.jobLower.includes('producer') && p.name.includes(term))) producerBucket.push(media);

        if (s.companies.some(c => c === term)) companyBucket.push(media);

        // Keywords and Genres are merged into a single "Keywords & Genres" group.
        if (s.keywords.some(k => k === term) || s.genres.some(g => g === term)) {
          keywordGenreBucket.push(media);
        }

        // Mirrors FILTER_KINDS.place exactly (exact match on the normalized
        // name), so "Paris" typed gets its own section — the ask behind the
        // whole feature: "see what movies are set where".
        if (s.places.some(p => p === term)) placeBucket.push(media);

        // Mirrors the tag clause of FILTER_KINDS.general (substring, since
        // tags are the user's own words), so a typed "back focus" gets a
        // Tags section instead of no films at all.
        if (s.tags.some(t => t.includes(term))) tagBucket.push(media);
      });

      // Step 2: Walk groupOrder and claim movies in priority order. A movie claimed
      // by an earlier group will not appear in a later one.
      const categories = [];
      const usedMovieIds = new Set();

      this.groupOrder.forEach(key => {
        const candidate = candidatesByKey[key];
        if (!candidate) return; // role-detected keys (writer/music/etc.) handled below

        const matches = candidate.movies.filter(media => !usedMovieIds.has(media.movie.id));
        if (matches.length > 0) {
          const sortedMatches = this.sortResultsFast(matches);
          categories.push({
            category: key,
            categoryDisplay: candidate.displayName,
            movies: sortedMatches
          });
          sortedMatches.forEach(movie => usedMovieIds.add(movie.movie.id));
        }
      });

      // Add catchall section with intelligent role detection for remaining movies
      const uncategorizedMovies = allResults.filter(media =>
        !usedMovieIds.has(media.movie.id) &&
        this.applyFilter(media, { type: 'general', value: searchTerm })
      );

      if (uncategorizedMovies.length > 0) {
        // Try to intelligently categorize the uncategorized movies by person role
        const adHocCategories = {};
        const trulyUncategorized = [];

        uncategorizedMovies.forEach(media => {
          const movie = media.movie;
          let foundRole = false;

          // Helper function for full-word matching
          // Normalized on both sides like every other comparison, so an
          // accented or apostrophe'd name still lands in its role category.
          const searchWords = normalizeSearchText(searchTerm).split(' ');
          const hasFullWordMatch = (personName) => {
            if (!personName) return false;
            const personWords = normalizeSearchText(personName).split(' ');
            return searchWords.some(searchWord =>
              personWords.some(personWord => personWord === searchWord)
            );
          };

          // Check if person appears in cast
          if (movie.cast) {
            const castMatch = movie.cast.find(person => hasFullWordMatch(person.name));
            if (castMatch) {
              if (!adHocCategories.cast) adHocCategories.cast = [];
              adHocCategories.cast.push(media);
              foundRole = true;
            }
          }

          // Check if person appears in crew (only if not already found in cast)
          if (!foundRole && movie.crew) {
            const crewMatch = movie.crew.find(person => hasFullWordMatch(person.name));
            if (crewMatch) {
              let roleCategory = 'Crew';

              // Categorize specific crew roles
              if (crewMatch.job === 'Director') {
                roleCategory = 'Director';
              } else if (crewMatch.job && crewMatch.job.toLowerCase().includes('producer')) {
                roleCategory = 'Producer';
              } else if (crewMatch.job && ['Writer', 'Screenplay', 'Story', 'Novel'].includes(crewMatch.job)) {
                roleCategory = 'Writer';
              } else if (crewMatch.job && (crewMatch.job.toLowerCase().includes('composer') ||
                        crewMatch.job.toLowerCase().includes('music') ||
                        crewMatch.job.toLowerCase().includes('score'))) {
                roleCategory = 'Music';
              } else if (crewMatch.job && crewMatch.job.toLowerCase().includes('editor')) {
                roleCategory = 'Editor';
              } else if (crewMatch.job && (crewMatch.job.toLowerCase().includes('photo') ||
                                        crewMatch.job.toLowerCase().includes('cinematographer') ||
                                        crewMatch.job.toLowerCase().includes('director of photography'))) {
                roleCategory = 'Cinematographer';
              }

              if (!adHocCategories[roleCategory]) adHocCategories[roleCategory] = [];
              adHocCategories[roleCategory].push(media);
              foundRole = true;
            }
          }

          // If no specific role found, add to truly uncategorized
          if (!foundRole) {
            trulyUncategorized.push(media);
          }
        });

        // Add ad-hoc categories to the results, but avoid duplicating existing categories
        Object.keys(adHocCategories).forEach(roleCategory => {
          const movies = adHocCategories[roleCategory];
          const categoryKey = roleCategory.toLowerCase();

          // Check if this category already exists
          const existingCategory = categories.find(cat => cat.category === categoryKey);

          if (movies.length > 0) {
            if (existingCategory) {
              // Merge movies into existing category
              existingCategory.movies.push(...movies);
              // Re-sort the combined movies
              existingCategory.movies = this.sortResultsFast(existingCategory.movies);
            } else {
              // Create new category
              const sortedMovies = this.sortResultsFast(movies);
              categories.push({
                category: categoryKey,
                categoryDisplay: roleCategory.charAt(0).toUpperCase() + roleCategory.slice(1),
                movies: sortedMovies
              });
            }
          }
        });

        // Add truly uncategorized movies as "Other" if any remain
        if (trulyUncategorized.length > 0) {
          const sortedUncategorized = this.sortResultsFast(trulyUncategorized);
          categories.push({
            category: 'other',
            categoryDisplay: 'Other',
            movies: sortedUncategorized
          });
        }
      }

      if (categories.length === 0) {
        return null;
      }

      // Order all categories (including role-detected ones) by the user's
      // chosen hierarchy. Any key not present in groupOrder sorts to the end.
      const orderIndex = (key) => {
        const idx = this.groupOrder.indexOf(key);
        return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
      };
      categories.sort((a, b) => orderIndex(a.category) - orderIndex(b.category));

      return categories;
    },
    reorderableGroups () {
      // The list shown in the reorder panel. It must include every group that
      // COULD be visible under some ordering — not just the ones that survived
      // claiming under the current order — otherwise a group that another group
      // emptied would vanish from the panel and you couldn't move it back up.
      const grouped = this.groupedByAllCategories;
      if (!grouped) {
        return [];
      }

      // Counts for the groups that are actually rendered right now.
      const currentCountByKey = {};
      grouped.forEach(group => {
        currentCountByKey[group.category] = group.movies.length;
      });

      // Fixed-type groups (title/director/cast/producer/company/keyword-genre)
      // have order-independent candidate sets, so any with candidates could be
      // shown if prioritized. We surface all of them; role-detected groups
      // (writer/music/etc./other) are leftover-derived and naturally reappear
      // when movies free up, so we include those only while currently present.
      const searchTerm = this.searchValue || this.effectiveSearchTerm;
      const fixedCandidateKeys = new Set();
      if (searchTerm) {
        const allResults = this.allEntriesWithFlatKeywordsAdded;
        const fixedFilters = [
          { key: 'title', filter: { type: 'title', value: searchTerm } },
          { key: 'director', filter: { type: 'director', value: searchTerm } },
          { key: 'cast', filter: { type: 'cast', value: searchTerm } },
          { key: 'producer', filter: { type: 'producer', value: searchTerm } },
          { key: 'company', filter: { type: 'company', value: searchTerm } }
        ];
        fixedFilters.forEach(({ key, filter }) => {
          if (allResults.some(media => this.applyFilter(media, filter))) {
            fixedCandidateKeys.add(key);
          }
        });
        const hasKeywordOrGenre = allResults.some(media =>
          this.applyFilter(media, { type: 'keyword', value: searchTerm }) ||
          this.applyFilter(media, { type: 'genre', value: searchTerm })
        );
        if (hasKeywordOrGenre) {
          fixedCandidateKeys.add('keyword-genre');
        }
        const term = normalizeSearchText(searchTerm);
        if (allResults.some(media => (media._search || this.buildSearchFields(media.movie, media.ratings)).tags.some(t => t.includes(term)))) {
          fixedCandidateKeys.add('tag');
        }
      }

      // Union: every currently-rendered group + every fixed group with candidates.
      const keys = new Set([...Object.keys(currentCountByKey), ...fixedCandidateKeys]);

      const displayName = (key) => {
        const present = grouped.find(g => g.category === key);
        if (present) return present.categoryDisplay;
        return GROUP_DISPLAY_NAMES[key] || (key.charAt(0).toUpperCase() + key.slice(1));
      };

      return [...keys]
        .sort((a, b) => this.groupOrder.indexOf(a) - this.groupOrder.indexOf(b))
        .map(key => ({
          category: key,
          categoryDisplay: displayName(key),
          count: currentCountByKey[key] || 0
        }));
    },
    isMatt () {
      return this.$store.state.databaseTopKey === "mattgrosso-gmail-com" || !this.$store.state.databaseTopKey;
    },
    lastMonthsMovies () {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth();
      const currentYear = currentDate.getFullYear();

      // Adjust for January
      const lastMonth = currentMonth === 0 ? 11 : currentMonth - 1;
      const lastMonthYear = currentMonth === 0 ? currentYear - 1 : currentYear;

      return this.allEntriesWithFlatKeywordsAdded.filter((result) => {
        const mostRecentRating = this.mostRecentRating(result);

        if (mostRecentRating && mostRecentRating.date) {
          const ratingDate = new Date(parseInt(mostRecentRating.date));
          const ratingMonth = ratingDate.getMonth();
          const ratingYear = ratingDate.getFullYear();
          return ratingMonth === lastMonth && ratingYear === lastMonthYear;
        }

        return false;
      });
    },
    lastYearsMovies () {
      const lastYear = new Date().getFullYear() - 1;

      return this.allEntriesWithFlatKeywordsAdded.filter((result) => {
        const mostRecentRating = this.mostRecentRating(result);

        if (mostRecentRating && mostRecentRating.date) {
          const ratingYear = new Date(parseInt(mostRecentRating.date)).getFullYear();
          return ratingYear === lastYear;
        }

        return false;
      });
    },
    listCountClasses () {
      const count = this.paginatedSortedResults.length;

      return {
        "count-is-1": count === 1,
        "count-is-2": count === 2,
        "count-is-3": count === 3,
        "count-is-4": count === 4,
        "count-more-than-4-remainder-0": count > 4 & count % 4 === 0,
        "count-more-than-4-remainder-1": count > 4 & count % 4 === 1,
        "count-more-than-4-remainder-2": count > 4 & count % 4 === 2,
        "count-more-than-4-remainder-3": count > 4 & count % 4 === 3
      }
    },
    notOnLetterboxdMovies () {
      if (!this.$store.state.settings.letterboxdConnected || !this.$store.state.settings.letterboxdUsername) {
        return [];
      }

      // If we don't have letterboxd data yet, return empty array
      if (!this.letterboxdUserData) {
        return [];
      }

      // Filter movies that are NOT in the user's Letterboxd films
      return this.allEntriesWithFlatKeywordsAdded.filter((result) => {
        const movie = result.movie;

        // First check manual overrides
        const overrides = this.$store.state.settings.letterboxdOverrides || {};
        const overrideKey = `${movie.title.toLowerCase().replace(/[^a-z0-9]/g, '')}_${new Date(movie.release_date).getFullYear()}`;

        if (overrides[overrideKey]) {
          return false; // Manual override says this movie is logged, so exclude from "not on letterboxd"
        }

        // Check if this movie exists in the user's Letterboxd films (automatic detection)
        const movieExists = this.letterboxdUserData.films.some(film => {
          const normalizedFilmTitle = this.normalizeMovieTitle(film.title);
          const normalizedSearchTitle = this.normalizeMovieTitle(movie.title);
          return normalizedFilmTitle === normalizedSearchTitle;
        });

        // Return movies that are NOT on Letterboxd
        return !movieExists;
      });
    },
    paginatedSortedResults () {
      return this.sortedResults.slice(0, this.numberOfResultsToShow);
    },
    canLoadMore () {
      return !this.groupedByAllCategories && this.sortedResults.length > this.numberOfResultsToShow;
    },
    placeholder () {
      if (this.quickLinkContext === 'annual') {
        return "The best of each year";
      } else if (this.quickLinkContext === 'bestPicture') {
        return "The Best Picture winners";
      } else {
        return "Search...";
      }
    },
    // Phase 4: a curated view (Best Picture, This Month…) is a CHIP, not a
    // parallel mode. One at a time — two base sets at once has no meaning —
    // so toggling one on replaces another, exactly as the old single-valued
    // mode did. Living in activeFilters buys everything chips already have:
    // the chip row renders it, removeFilter clears it, navigation restore
    // brings it back, and it composes with other chips ("Best Picture +
    // horror") instead of awkwardly coexisting with them.
    activeListChip () {
      return this.activeFilters.find((filter) => filter.type === 'list' && !filter.temp) || null;
    },
    // What curated context the results are being shown in — the list chip's
    // value, or a browse-mode picker still tracked in activeQuickLinkList.
    // DBGridLayoutSearchResult and the counts line read this where they used
    // to read activeQuickLinkList directly.
    quickLinkContext () {
      return this.activeListChip?.value ?? this.activeQuickLinkList;
    },
    resultsAreFiltered () {
      return this.activeFilters.length > 0 || this.activeQuickLinkList !== 'title';
    },
    // Judged against `promptNow`, never Date.now() — the clock has to be a
    // reactive dependency or this list goes stale the moment the app is left
    // open (stickinessCandidates.js has the full story).
    resultsThatNeedStickiness () {
      return stickinessCandidates(this.allEntriesWithFlatKeywordsAdded, {
        ratingOf: this.mostRecentRating,
        now: this.promptNow
      });
    },
    // Stickiness inline computed properties
    firstStickinessResult () {
      return this.resultsThatNeedStickiness[0];
    },
    allMoviesRanked () {
      const movies = [...this.$store.getters.allMoviesAsArray];
      return movies.sort(this.sortByRating);
    },
    ratingWithoutStickiness () {
      if (!this.firstStickinessResult) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = null;
      return getRating(this.firstStickinessResult).calculatedTotal;
    },
    ratingWithStickiness () {
      if (!this.stickinessRating && this.stickinessRating !== 0 && this.stickinessRating !== "0") {
        return null;
      }
      if (!this.firstStickinessResult) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = parseFloat(this.stickinessRating);
      return getRating(tempResult).calculatedTotal;
    },
    rankWithoutStickiness () {
      if (!this.firstStickinessResult) return null;
      return this.allMoviesRanked.findIndex((movie) => movie.dbKey === this.firstStickinessResult.dbKey) + 1;
    },
    rankWithStickiness () {
      if (!this.firstStickinessResult || !this.stickinessRating) return null;
      const tempResult = cloneDeep(this.firstStickinessResult);
      tempResult.ratings[this.mostRecentRatingIndex].stickiness = parseFloat(this.stickinessRating);
      const movies = [...this.$store.getters.allMoviesAsArray];
      const movieIndex = movies.findIndex((movie) => movie.dbKey === this.firstStickinessResult.dbKey);
      movies[movieIndex] = tempResult;
      const sortedMovies = movies.sort(this.sortByRating);
      return sortedMovies.findIndex((movie) => movie.dbKey === tempResult.dbKey) + 1;
    },
    mostRecentRatingIndex () {
      if (!this.firstStickinessResult) return 0;
      let mostRecentRating = this.firstStickinessResult.ratings[0];
      let mostRecentRatingIndex = 0;
      this.firstStickinessResult.ratings.forEach((rating, index) => {
        const ratingDate = rating.date ? new Date(rating.date).getTime() : 0;
        const mostRecentRatingDate = mostRecentRating.date ? new Date(mostRecentRating.date).getTime() : 0;
        if (!mostRecentRating.date) {
          mostRecentRating = rating;
          mostRecentRatingIndex = index;
        } else if (ratingDate && ratingDate > mostRecentRatingDate) {
          mostRecentRating = rating;
          mostRecentRatingIndex = index;
        }
      })
      return mostRecentRatingIndex;
    },
    showSixMonthMessage () {
      if (!this.firstStickinessResult) return false;
      return this.mostRecentRating(this.firstStickinessResult).userAddedStickiness;
    },
    currentLogIsTVLog () {
      return this.$store.state.currentLog === "tvLog";
    },
    showResultsList () {
      return Boolean(this.paginatedSortedResults.length) || Boolean(this.activeListChip) || this.activeQuickLinkList !== "title";
    },
    // Determine which modal should be active (eliminates circular dependencies)
    activeModalType () {
      // Check forced states first (highest priority)
      if (this.stickinessPromptState === 'forced') {
        return 'stickiness';
      }
      if (this.tieBreakPromptState === 'forced') {
        return 'tieBreak';
      }
      if (this.awardsPromptState === 'forced') {
        return 'awards';
      }

      // Check disabled states
      const stickinessDisabled = this.stickinessPromptState === 'disabled';
      const tieBreakDisabled = this.tieBreakPromptState === 'disabled';
      const awardsDisabled = this.awardsPromptState === 'disabled';

      // Bug report, 2026-08-19: "Sometimes the prompt on the home screen will
      // tell me that I need to do some tiebreakers and then as soon as I
      // choose the first one in the tournament, it hides itself, and then the
      // prompt turns into a stickiness rating instead of a tiebreaker rating
      // and then once I do the stickiness resume the tournament it's awkward
      // like this."
      //
      // Matt's two acceptable outcomes, and both are implemented because they
      // fix different halves of it: "either for the tiebreak prompt to not
      // even have shown up if there was also a stickiness prompt, which is
      // what I would have expected, or else if I start in the tiebreak
      // prompt, then it should let me go through the whole tournament before
      // it replaces itself with a stickiness prompt."
      //
      // FIRST HALF — stickiness already outranks tiebreak below, so the
      // ordering was never the problem. The problem is that this is decided
      // before the library has arrived: with no entries loaded,
      // shouldShowStickiness is false no matter how many films are waiting,
      // so a tiebreak wins a race it would lose a moment later. Deciding
      // nothing until there is something to decide from removes the flip at
      // its source.
      if (!this.allEntriesWithFlatKeywordsAdded.length) {
        return null;
      }

      // SECOND HALF — once a tournament exists, it is a piece of work the
      // user is in the middle of, and nothing may take the screen from it.
      // The record is created only when the prompt is actually opened and is
      // cleared on "Done" (or automatically for a 2-way tie), so this pins
      // the prompt for exactly as long as there are matches left to play.
      // A disabled tiebreak still wins, since that is an explicit choice.
      if (!tieBreakDisabled && this.$store.state.settings?.tieBreakTournament) {
        return 'tieBreak';
      }

      // Check if stickiness should show (highest priority in normal mode).
      // `stickinessPromptDue` is the daily quota and is unlimited unless the
      // user sets one (bug report 2026-08-22: "maybe we ought to go ahead and
      // set that for stickiness and personal awards").
      const shouldShowStickiness = !stickinessDisabled && this.stickinessPromptDue &&
        Boolean(this.allEntriesWithFlatKeywordsAdded.length && this.resultsThatNeedStickiness.length);

      // Check if tie break should show (second priority)
      const shouldShowTieBreak = !tieBreakDisabled && this.shouldShowTieBreakModal;

      // Check if awards should show (lowest priority)
      const shouldShowAwards = !awardsDisabled && this.shouldShowAwardsModal;

      // Return the highest priority modal that should be shown
      if (shouldShowStickiness) return 'stickiness';
      if (shouldShowTieBreak) return 'tieBreak';
      if (shouldShowAwards) return 'awards';

      return null;
    },

    showStickinessModal () {
      return this.activeModalType === 'stickiness';
    },
    showTweakModal () {
      return this.activeModalType === 'tieBreak';
    },

    shouldShowTieBreakModal () {
      // Include forceModalReevaluation to make this computed re-evaluate on the periodic modal re-check
      // eslint-disable-next-line no-unused-vars
      const _ = this.forceModalReevaluation;

      // A tournament record existing at all (whether mid-tournament or just
      // completed and awaiting acknowledgment — see tieBreakTournament.js)
      // always has something to show next; it's only cleared once the user
      // taps "Done" on the results screen. Only fall back to a fresh tie
      // scan when there's no record, so a movie rated mid-tournament that
      // happens to also tie never gets swept into it (TweakInline.vue owns
      // actually starting a new one).
      const hasTiedResults = Boolean(this.$store.state.settings?.tieBreakTournament) ||
        findTiedGroup(this.sortedByRating, (movie) => getRating(movie).calculatedTotal).length >= 2;

      if (!hasTiedResults) {
        return false;
      }

      const lastTweak = this.$store.state.settings.lastTweak || Date.now();
      const oneDay = 24 * 60 * 60 * 1000;
      const maxDailyTieBreaks = this.$store.state.settings.tieBreakTweak || 1;
      const dueForTieBreak = Date.now() - lastTweak > (oneDay / maxDailyTieBreaks);

      return dueForTieBreak;
    },
    showAwardsModal () {
      return this.activeModalType === 'awards';
    },

    shouldShowAwardsModal () {
      // Include forceModalReevaluation to make this computed re-evaluate on the periodic modal re-check
      // eslint-disable-next-line no-unused-vars
      const _ = this.forceModalReevaluation;

      // Don't show until database is loaded to prevent flash
      if (!this.$store.state.dbLoaded) {
        console.log('❌ Database not loaded yet');
        return false;
      }

      // Check if a specific year is manually requested (e.g., from Resume Awards button)
      const settings = this.$store.state.settings;
      if (!settings) {
        return false; // Settings not loaded yet
      }

      const today = new Date().toDateString();
      const dailyAwardsYear = settings.dailyAwardsYear;
      const dailyAwardsYearDate = settings.dailyAwardsYearDate;

      // If a specific year is requested for today, bypass the daily limit
      if (dailyAwardsYear && dailyAwardsYearDate === today) {
        return true;
      }

      const lastAwardDate = settings.lastAwardCompletionDate;

      // If lastAwardDate is undefined, we need to determine if this is because:
      // 1. Settings haven't loaded yet (return false to prevent flash)
      // 2. User has never completed awards (continue with normal logic)
      if (lastAwardDate === undefined && !settings.lastAwardsPromptAt) {
        // Check if there are any existing personal awards - if so, settings are loaded
        const hasExistingAwards = settings.personalAwards && Object.keys(settings.personalAwards).length > 0;

        if (!hasExistingAwards) {
          // No existing awards data suggests settings might not be fully loaded yet
          // or this is truly a new user. To be safe, check if other expected settings exist
          const hasOtherSettings = Object.prototype.hasOwnProperty.call(settings, 'includeShorts') ||
                                    Object.prototype.hasOwnProperty.call(settings, 'normalizationTweak') ||
                                    Object.prototype.hasOwnProperty.call(settings, 'letterboxdUsername') ||
                                    Object.prototype.hasOwnProperty.call(settings, 'personalAwardName');

          if (!hasOtherSettings) {
            return false; // Settings likely not loaded yet
          }
        }
        // If we get here, settings are loaded but user just hasn't done awards before
      }

      // The daily quota — one a day by default, `awardsPromptsPerDay` to
      // change it (bug report 2026-08-22, "will I see more than one prompt for
      // personal awards per day... maybe that's a setting"). Outside the
      // settings-loaded branch above, not inside it: someone who has never
      // completed a year still gets to turn the prompt off.
      if (!this.awardsPromptDue) {
        return false;
      }

      // Which years are big enough to have awards at all. Reads the user's
      // own `awardsYearThreshold` — this used to be a hardcoded 10, so
      // lowering the setting changed the modal and the /awards strip but not
      // the prompt that offers the work (bug report 2026-08-22, Natalie).
      const eligibleYears = yearsMeetingAwardsThreshold(
        this.allEntriesWithFlatKeywordsAdded,
        settings
      );

      // Check if any eligible years need awards (either new or have new movies)
      const hasEligibleYears = eligibleYears.some(year => {
        const existingAwards = this.$store.state.settings.personalAwards?.[year];
        if (!existingAwards) return true; // New year needs awards

        // CRITICAL FIX: If awards exist but were NOT explicitly completed via "Complete Awards" button,
        // the year should still be eligible (this covers partial progress)
        if (!existingAwards.completed) {
          return true;
        }

        // If explicitly completed, check if there are new movies since last awards update
        if (!existingAwards.lastUpdated) return true;

        const newMovies = this.allEntriesWithFlatKeywordsAdded.filter(entry => {
          const entryYear = new Date(entry.movie.release_date).getFullYear();
          if (entryYear !== year) return false;

          const movieDate = new Date(entry.ratings[0]?.date || entry.movie.release_date);
          return movieDate.getTime() > existingAwards.lastUpdated;
        });

        return newMovies.length > 0;
      });

      return hasEligibleYears;
    },
    sortedByRating () {
      const allMediaSortedByRating = this.$store.getters.allMediaSortedByRating;

      if (this.sortOrder === 'bestOrNewestOnTop') {
        return allMediaSortedByRating;
      } else {
        return allMediaSortedByRating.slice().reverse();
      }
    },
    sortedDataForActiveQuickLinkList () {
      const data = [...this.datalistForActiveQuickLink];

      if (this.quickLinksSortType === "a-z") {
        return data.sort((a, b) => a.name.localeCompare(b.name));
      } else {
        return data.sort((a, b) => b.count - a.count);
      }
    },
    sortedResults () {
      return this.sortResultsFast(this.unifiedFilteredResults);
    },
    suggestionsButtonLabel () {
      return this.userRatedMovieCount === 0
        ? 'Suggest some movies to rate'
        : 'Suggest more movies to rate';
    },
    tags () {
      if (this.$store.state?.settings?.tags?.['viewing-tags']) {
        return Object.values(this.$store.state.settings.tags['viewing-tags']).map(tag => tag.title);
      } else {
        return [];
      }
    },
    thisMonthsMovies () {
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();

      return this.allEntriesWithFlatKeywordsAdded.filter((result) => {
        const mostRecentRating = this.mostRecentRating(result);

        if (mostRecentRating && mostRecentRating.date) {
          const ratingMonth = new Date(parseInt(mostRecentRating.date)).getMonth();
          const ratingYear = new Date(parseInt(mostRecentRating.date)).getFullYear();
          return ratingMonth === currentMonth && ratingYear === currentYear;
        }

        return false;
      });
    },
    thisYearsMovies () {
      const currentYear = new Date().getFullYear();

      return this.allEntriesWithFlatKeywordsAdded.filter((result) => {
        const mostRecentRating = this.mostRecentRating(result);

        if (mostRecentRating && mostRecentRating.date) {
          const ratingYear = new Date(parseInt(mostRecentRating.date)).getFullYear();
          return ratingYear === currentYear;
        }

        return false;
      });
    },
    topDirectors () {
      return Object.entries(this.allCounts.directors || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    },
    topGenres () {
      return Object.entries(this.allCounts.genres || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    },
    topPlaces () {
      return Object.entries(this.allCounts.places || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20);
    },
    displayedResults () {
      // The cards actually on screen. When the grouped view is active the grid
      // renders groupedByAllCategories (which layers in title/cast matches on
      // top of the keyword chip), so the badge/avg/views should reflect those
      // unique movies. Otherwise fall back to the filtered set.
      if (this.groupedByAllCategories) {
        const seen = new Set();
        const unique = [];
        this.groupedByAllCategories.forEach(group => {
          group.movies.forEach(result => {
            if (!seen.has(result.movie.id)) {
              seen.add(result.movie.id);
              unique.push(result);
            }
          });
        });
        return unique;
      }
      return this.unifiedFilteredResults;
    },
    unifiedFilteredResults () {
      // Step 1: the base result set. A list CHIP selects it (Phase 4) —
      // lists aggregate or add placeholder entries, which no per-movie
      // predicate can express, so they act here, before the chip loop, and
      // are neutral inside it (see filterKinds.js's `list`). Everything
      // else starts from the whole library.
      const baseSets = {
        annual: () => this.bestMovieFromEachYear,
        bestPicture: () => this.bestPictures,
        thisYear: () => this.thisYearsMovies,
        lastYear: () => this.lastYearsMovies,
        thisMonth: () => this.thisMonthsMovies,
        lastMonth: () => this.lastMonthsMovies,
        notOnLetterboxd: () => this.notOnLetterboxdMovies
      };

      let results = baseSets[this.activeListChip?.value]?.() ?? this.allEntriesWithFlatKeywordsAdded;

      // Step 2: Apply all filters from allActiveFilters (input + chips)
      if (this.allActiveFilters.length > 0) {
        results = results.filter(result => {
          // ALL filters must match (AND logic)
          return this.allActiveFilters.every(filter => {
            return this.applyFilter(result, filter);
          });
        });
      }

      // Step 3: Exclude shorts if showShorts is false — UNLESS a filter names
      // the short by title. The setting keeps 15-minute films out of browsing
      // and stats; it must never make a film you ask for by name unfindable
      // (typing "A Trip to the Moon" — rated, in the library — found nothing;
      // report -P0Jz3pTqFQuw). A genre/person/decade chip is still browsing,
      // so those don't resurface hidden shorts — only naming one does.
      if (!this.showShorts) {
        results = results.filter(result => {
          // Consider as short if runtime <= 40 min
          return !(result.movie.runtime && result.movie.runtime <= 40) ||
            titleNamedByFilters(result, this.allActiveFilters);
        });
      }

      return results;
    },
    userRatedMovieCount () {
      // Count the number of movies the user has rated (not TV shows)
      return this.allEntriesWithFlatKeywordsAdded.length;
    },
    isBrandNewUser () {
      // dbLoaded is load-bearing, not belt-and-braces: until the library
      // arrives userRatedMovieCount is 0, which is indistinguishable from a
      // genuinely new account. Without this an established user sees a flash
      // of the "want help getting started?" onboarding on every fresh load.
      // (The window widened when initializeDB started awaiting authReady.)
      // A denied read is NOT a new user — LibraryAccessBanner owns that
      // case, and welcoming someone whose library exists but can't be read
      // would send exactly the wrong message.
      return this.$store.state.dbLoaded && !this.$store.state.dbReadDenied && this.userRatedMovieCount === 0;
    },
    // A genuinely 0-rated user has nothing else to look at, so the "rate
    // something to get started" suggestions show immediately - no reason to
    // make them tap a button first, unlike the 1-9 range below (where they've
    // already started and a standing button would be more nag than help).
    shouldShowStartSuggestions () {
      if (this.userRatedMovieCount >= 10) {
        return false;
      }
      return this.showSuggestionsOnly || (this.isBrandNewUser && !this.dismissedWelcomeSuggestions);
    },
    userTags () {
      return this.tags.slice(0, 20); // Limit to 20 most recent tags
    },
  },
  methods: {
    /**
     * Opened from a chore notification (`?open=<chore>`, set by the push
     * Lambda): expand the prompt rather than just showing its card, and put
     * it where the eye is.
     *
     * Any value counts — the Lambda names the chore, but Home's own priority
     * order decides which prompt is on screen, and the notification's
     * headline follows the same order.
     *
     * Called from mounted() AND from a watcher on the query, because a
     * notification tap only reloads the page when the app wasn't already
     * running (see the watcher).
     */
    /**
     * Move the chore prompts' clock forward.
     *
     * `promptNow` drives the stickiness queue; `forceModalReevaluation` is
     * the older dummy dependency the tiebreak/awards/quota gates hang off,
     * which read Date.now() directly. Both have to move together or the
     * prompts disagree about what time it is.
     */
    refreshPromptClock () {
      this.promptNow = Date.now();
      this.forceModalReevaluation++;
    },

    /**
     * The one that matters on a phone. An installed PWA is almost never
     * cold-launched: tapping a notification focuses a process that has been
     * suspended — with its timers — since the last time it was looked at.
     * Coming back to the foreground is the honest moment to re-read the
     * clock, and it is the moment a chore notification always produces.
     */
    refreshPromptClockIfVisible () {
      if (document.visibilityState === 'visible') this.refreshPromptClock();
    },

    readChoreOpenRequest () {
      if (!this.$route?.query?.open) return;

      // The notification fires at the instant a film matures, so the queue
      // this is about to open may be one the app has not yet noticed exists.
      // Re-read the clock BEFORE the flag is set: `autoOpen` only opens a
      // card whose prompt is on screen, and the prompt is only on screen if
      // the queue is non-empty.
      this.refreshPromptClock();

      // Flip rather than assign. The cards open off a watcher on `autoOpen`,
      // so a second notification in the same session — arriving while the
      // flag is already true, after the user closed the card — would change
      // nothing at all.
      this.openChoreRequested = false;
      this.$nextTick(() => {
        this.openChoreRequested = true;
        this.scrollChorePromptIntoView();
      });

      // Read once: a refresh, or a back navigation, must not re-open
      // anything.
      this.$router.replace({ query: { ...this.$route.query, open: undefined } });
    },

    /**
     * A warm launch keeps whatever scroll position the app was left at, and
     * the prompts live at the TOP of Home — so on the phone the expanded
     * card can be several screens above the fold, which reads exactly like
     * the notification having done nothing. A cold launch is already at the
     * top and this is a no-op.
     */
    scrollChorePromptIntoView () {
      this.$nextTick(() => {
        const notices = this.$refs.homeNotices;
        if (!notices?.scrollIntoView) return;
        notices.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },

    // The loading spinner only earns its place on a genuinely slow load.
    // Under this it stays hidden, so a warm launch goes straight from the
    // header to the library with nothing flashing in between.
    armLoadingSpinner () {
      clearTimeout(this.libraryLoadTimer);
      if (this.$store.state.dbLoaded) return;
      this.libraryLoadTimer = setTimeout(() => {
        this.libraryLoadIsSlow = true;
      }, LOADING_SPINNER_DELAY_MS);
    },
    async connectMovieHat () {
      this.connectingHat = true;
      this.hatConnectError = null;
      try {
        await this.$store.dispatch('connectMovieHat');
        this.searchedForHats = true;
      } catch (error) {
        // Closing the popup is a choice, not a failure worth shouting about.
        if (error?.code !== 'auth/popup-closed-by-user') {
          this.hatConnectError = "Couldn't sign in to Movie Hat.";
          ErrorLogService.error('Movie Hat sign-in failed', error);
        }
      } finally {
        this.connectingHat = false;
      }
    },
    disconnectMovieHat () {
      this.searchedForHats = false;
      this.$store.dispatch('disconnectMovieHat');
    },
    async findMovieHats () {
      this.findingHats = true;
      this.hatLookupError = null;
      try {
        await this.$store.dispatch('findMovieHats');
        this.searchedForHats = true;
      } catch (error) {
        this.hatLookupError = "Couldn't reach Movie Hat just now.";
        ErrorLogService.error('Movie Hat lookup failed', error);
      } finally {
        this.findingHats = false;
      }
    },
    isHatLinked (title) {
      return this.linkedMovieHats.some((hat) => hat.title === title);
    },
    toggleHat (hat) {
      const linked = this.isHatLinked(hat.title)
        ? this.linkedMovieHats.filter((linkedHat) => linkedHat.title !== hat.title)
        : [...this.linkedMovieHats, { title: hat.title, dbKey: hat.dbKey }];
      this.$store.dispatch('linkMovieHats', linked);
    },

    // Event handlers for form changes (replaces watchers)
    onStickinessUpdated () {
      // Force reactivity update for stickiness-related computed properties
      this.$forceUpdate();
    },
    onTweakUpdated () {
      // Force reactivity update for tweak-related computed properties
      this.$forceUpdate();
    },
    updateShowShorts (event) {
      const newVal = event.target.checked;
      ErrorLogService.debug('updateShowShorts handler fired', { newVal, component: 'Home' });
      this.$store.dispatch('writeDurably', { path: 'settings/includeShorts', value: newVal });
    },
    async enableMirrorFeed () {
      await this.$store.dispatch('ensureMirrorFeedKey');
      await this.$store.dispatch('publishMirrorFeed');
    },
    copyMirrorFeedUrl () {
      navigator.clipboard?.writeText(this.mirrorFeedUrl);
      this.mirrorFeedCopied = true;
      setTimeout(() => { this.mirrorFeedCopied = false; }, 2000);
    },
    // ---- Push notifications (settings pane) --------------------------
    async checkPushDevice () {
      try {
        const registration = await navigator.serviceWorker?.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        this.pushDeviceSubscribed = Boolean(subscription) && Notification.permission === 'granted';
      } catch {
        this.pushDeviceSubscribed = false;
      }
    },
    async enablePushOnThisDevice () {
      this.pushBusy = true;
      this.pushError = null;
      try {
        await subscribeThisDevice(this.$store);
        this.pushDeviceSubscribed = true;
      } catch (error) {
        // subscribeThisDevice throws human-readable messages by contract.
        this.pushError = error.message;
      } finally {
        this.pushBusy = false;
      }
    },
    async disablePushOnThisDevice () {
      this.pushBusy = true;
      this.pushError = null;
      try {
        await unsubscribeThisDevice(this.$store);
        this.pushDeviceSubscribed = false;
      } catch {
        this.pushError = 'Could not unsubscribe this device.';
      } finally {
        this.pushBusy = false;
      }
    },
    updatePushPref (key, event) {
      this.$store.dispatch('savePushPrefs', { [key]: event.target.checked });
    },
    updatePushPrefValue (key, value) {
      this.$store.dispatch('savePushPrefs', { [key]: value });
    },
    updatePushPrefNumber (key, value) {
      const number = Number(value);
      if (Number.isFinite(number)) this.$store.dispatch('savePushPrefs', { [key]: number });
    },
    // Stores only the muted games (`false`); a game switched back on is
    // removed from the map rather than written as `true`, so "absent = on"
    // stays the one rule and a fully re-enabled map disappears entirely.
    updateGameReminderPick (gameKey, event) {
      const picks = { ...(this.pushPrefs.gamePicks || {}) };
      if (event.target.checked) delete picks[gameKey];
      else picks[gameKey] = false;
      this.$store.dispatch('savePushPrefs', { gamePicks: picks });
    },
    formatPushHour (hour) {
      const twelve = hour % 12 === 0 ? 12 : hour % 12;
      return `${twelve}:00 ${hour < 12 ? 'AM' : 'PM'}`;
    },
    async sendTestPush () {
      this.pushBusy = true;
      this.pushError = null;
      try {
        await sendTestNotification();
        this.pushTestSent = true;
        setTimeout(() => { this.pushTestSent = false; }, 5000);
      } catch {
        this.pushError = 'Test notification failed — check your connection and try again.';
      } finally {
        this.pushBusy = false;
      }
    },
    updateSocialEnabled (event) {
      const enabled = event.target.checked;
      this.$store.dispatch('writeDurably', { path: 'settings/social/enabled', value: enabled });
      if (enabled) {
        this.$nextTick(() => this.$store.dispatch('publishSocialProfile'));
      } else {
        // Opting out takes the published copies down, not just future ones.
        this.$store.dispatch('unpublishSocialProfile');
      }
    },
    updateCrossAppDiscovery (event) {
      this.$store.dispatch('setCrossAppDiscovery', event.target.checked);
    },
    updateSocialDisplayName (event) {
      const value = event.target.value.trim();
      if (!value) return;
      this.$store.dispatch('writeDurably', { path: 'settings/social/displayName', value });
      this.$nextTick(() => this.$store.dispatch('publishSocialProfile'));
    },
    updateShowErrorLogs (event) {
      const newVal = event.target.checked;
      ErrorLogService.debug('updateShowErrorLogs handler fired', { newVal, component: 'Home' });
      this.$store.dispatch('setDBValue', { path: 'settings/showErrorLogs', value: newVal });
      if (newVal) {
        this.refreshErrorLogs();
        // Start auto-refresh when logs are visible
        this.startErrorLogRefresh();
      } else {
        this.stopErrorLogRefresh();
      }
    },

    // Search/filter/sort logic lives in ../assets/javascript/searchFiltering.js
    // (pure, unit-tested in isolation). These thin wrappers feed it component state.
    buildSearchFields (movie, ratings) {
      return buildSearchFieldsUtil(movie, ratings);
    },
    applyFilter (result, filter) {
      return applyFilterUtil(result, filter);
    },
    getListOfYearsFromRange (yearRange) {
      return getListOfYearsFromRangeUtil(yearRange);
    },
    toggleSettingsPanel () {
      this.showSettingsPanel = !this.showSettingsPanel;
    },
    handleCancelSuggestions () {
      // Covers both paths that can land here: a 1-9-rated user tapping the
      // "Suggest more movies" button closed again, and a brand new (0-rated)
      // user dismissing the auto-shown welcome suggestions to search directly
      // instead (falls through to the plain "Search for a movie..." prompt).
      this.showSuggestionsOnly = false;
      this.dismissedWelcomeSuggestions = true;
    },
    toggleGroupOrderPanel () {
      this.showGroupOrderPanel = !this.showGroupOrderPanel;
    },
    // Entry point for reordering groups is now each group's own header
    // (the dedicated button was removed to make room for the Games button
    // in the results-actions bar) — always opens (rather than toggling) and
    // scrolls the panel into view, since the tapped header is very likely
    // scrolled well below it.
    openGroupOrderPanel () {
      this.showGroupOrderPanel = true;
      this.$nextTick(() => {
        this.$refs.groupOrderPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    moveGroupUp (categoryKey) {
      this.swapGroupWithNeighbor(categoryKey, -1);
    },
    moveGroupDown (categoryKey) {
      this.swapGroupWithNeighbor(categoryKey, 1);
    },
    swapGroupWithNeighbor (categoryKey, direction) {
      // The panel shows every group that could be visible under some ordering
      // (reorderableGroups), so moving swaps within that list and absent master
      // keys keep their slots. direction: -1 = up, 1 = down.
      const presentKeys = this.reorderableGroups.map(group => group.category);
      const presentIndex = presentKeys.indexOf(categoryKey);
      const neighborIndex = presentIndex + direction;
      if (presentIndex === -1 || neighborIndex < 0 || neighborIndex >= presentKeys.length) {
        return; // already at an edge of the visible list
      }
      const neighborKey = presentKeys[neighborIndex];

      const newOrder = [...this.groupOrder];
      const from = newOrder.indexOf(categoryKey);
      const to = newOrder.indexOf(neighborKey);
      if (from === -1 || to === -1) {
        return;
      }
      newOrder.splice(from, 1);
      newOrder.splice(to, 0, categoryKey);

      this.persistGroupOrder(newOrder);
    },
    resolveBanner () {
      // Pick the header banner from how the user arrived (store.bannerRequest, set
      // by MovieDetail / RateMovie / search links). Runs on each home arrival and
      // once when the library first loads. Context picks ignore the rating floor;
      // the no-context fresh pick keeps the >6 floor and only fires when no banner
      // is set yet, so contextless returns to home don't re-randomize.
      const entries = this.allEntriesWithFlatKeywordsAdded;
      if (!entries || !entries.length) return; // data not ready; watcher retries

      const req = this.$store.state.bannerRequest;
      this.$store.commit('setBannerRequest', null); // consume

      let media = null;
      if (req && req.type === 'movie' && req.movieId != null) {
        media = entries.find(e => e.movie && e.movie.id === req.movieId) || null;
      } else if (req && req.type === 'fromResults') {
        const pool = this.displayedResults;
        if (pool && pool.length) {
          media = pool[Math.floor(Math.random() * pool.length)];
        }
      }

      if (!media) {
        // No resolvable context: keep the current banner if we have one (don't
        // swap on a plain return home); otherwise pick a fresh movie rated > 6.
        if (this.$store.state.bannerUrl) return;
        const overSix = entries.filter(e => this.mostRecentRating(e).calculatedTotal > 6);
        const pool = overSix.length ? overSix : entries;
        if (pool.length) {
          media = pool[Math.floor(Math.random() * pool.length)];
        }
      }

      if (media && media.movie) {
        // customBackdropPath is stored at the entry level (sibling of movie),
        // matching MovieDetail.selectBackdrop + getBackdropPath. Reading it from
        // media.movie left the home banner on the default after a custom pick.
        const backdrop = media.customBackdropPath || media.movie.backdrop_path;
        const url = backdrop
          ? `https://image.tmdb.org/t/p/w500${backdrop}`
          : 'https://www.solidbackgrounds.com/images/1920x1080/1920x1080-black-solid-color-background.jpg';
        this.$store.commit('setBannerUrl', url);
      }
    },
    applyPromoteGroup () {
      const promoteKey = this.$store.state.homePagePromoteGroup;
      this.$store.commit('setHomePagePromoteGroup', null); // consume it
      if (!promoteKey || !DEFAULT_GROUP_ORDER.includes(promoteKey)) {
        return;
      }
      // Move the promoted key to the front of the current order and persist it
      // as today's override.
      const newOrder = [promoteKey, ...this.groupOrder.filter(key => key !== promoteKey)];
      this.persistGroupOrder(newOrder);
    },
    persistGroupOrder (order) {
      // Save as a daily override in settings. Reverts to default automatically
      // tomorrow because groupOrder ignores overrides whose date isn't today.
      const override = { order, date: new Date().toDateString() };

      // Update local store state optimistically so the grouped view re-evaluates
      // immediately, rather than waiting for the Firebase write to echo back.
      this.$store.commit('setSettings', {
        ...this.$store.state.settings,
        groupOrderOverride: override
      });

      this.$store.dispatch('setDBValue', {
        path: 'settings/groupOrderOverride',
        value: override
      });
    },
    getGridClassesForGroup (count) {
      return {
        "count-is-1": count === 1,
        "count-is-2": count === 2,
        "count-is-3": count === 3,
        "count-is-4": count === 4,
        "count-more-than-4-remainder-0": count > 4 & count % 4 === 0,
        "count-more-than-4-remainder-1": count > 4 & count % 4 === 1,
        "count-more-than-4-remainder-2": count > 4 & count % 4 === 2,
        "count-more-than-4-remainder-3": count > 4 & count % 4 === 3
      }
    },
    findRandomSearchValue () {
      this.$router.push({ query: { ...this.$route.query, returnFromRating: undefined } });
      const countedLists = ["keyword", "genre", "year", "director", "cast/crew", "studios"];
      const randomList = countedLists[Math.floor(Math.random() * countedLists.length)];

      const minimumCount = 3;

      let counts;
      switch (randomList) {
        case "keyword":
          counts = this.countedKeywords;
          break;
        case "genre":
          counts = this.countedGenres;
          break;
        case "year":
          counts = this.countedYears;
          break;
        case "director":
          counts = this.countDirectors;
          break;
        case "cast/crew":
          counts = this.countCastCrew;
          break;
        case "studios":
          counts = this.countStudios;
          break;
      }

      const valuesFromRandomCountedList = Object.keys(counts || {});
      let randomValue;
      let safetyLimit = 100;

      do {
        const randomIndex = Math.floor(Math.random() * valuesFromRandomCountedList.length);
        randomValue = valuesFromRandomCountedList[randomIndex];
        safetyLimit--;
      } while (counts[randomValue] <= minimumCount && safetyLimit > 0);

      if (randomValue && safetyLimit > 0) {
        this.clearAllFilters();
        this.updateSearchValue(randomValue, false, randomList);
        this.sortOrder = "bestOrNewestOnTop";
      } else {
        const allValues = Object.keys(counts || {}).filter(key => counts[key] > 0);
        if (allValues.length > 0) {
          const randomIndex = Math.floor(Math.random() * allValues.length);
          const fallbackValue = allValues[randomIndex];
          this.clearAllFilters();
          this.updateSearchValue(fallbackValue, true, randomList);
          this.sortOrder = "bestOrNewestOnTop";
        } else {
          this.clearInput();
        }
      }
    },
    async wikiLinkFor (searchValue) {
      let wiki;
      try {
        wiki = await axios.get(`https://en.wikipedia.org/w/api.php?action=query&origin=*&format=json&generator=search&gsrnamespace=0&gsrlimit=5&gsrsearch=%27${searchValue}%27`);
      } catch {
        return ''; // offline/blocked: the chip just doesn't open (2026-08-15 audit)
      }
      if (!wiki || !wiki.data || !wiki.data.query || !wiki.data.query.pages) {
        return '';
      }
      const pages = wiki.data.query.pages;
      const pagesArray = Object.keys(pages).map((page) => pages[page]);
      const bestMatch = minBy(pagesArray, (page) => page.index);

      return `https://en.m.wikipedia.org/w/index.php?curid=${bestMatch.pageid}`;
    },
    async goToWikipediaForChip () {
      if (this.activeFilters.length === 1) {
        const chip = this.activeFilters[0];
        this.insetBrowserUrl = await this.wikiLinkFor(chip.value);
        this.showInsetBrowserModal = true;
      }
    },
    showMovieInfo (movie) {
      this.selectedMovieInfo = movie;
      this.showMovieInfoModal = true;
      document.body.classList.add('no-scroll');
    },
    closeMovieInfoModal () {
      this.showMovieInfoModal = false;
      this.selectedMovieInfo = null;
      document.body.classList.remove('no-scroll');
    },
    rateMovieFromModal () {
      if (this.selectedMovieInfo) {
        this.$store.commit('setMovieToRate', this.selectedMovieInfo);
        // Remove the modal's scroll-lock before navigating away — otherwise
        // body.no-scroll leaks onto every subsequent screen (see router afterEach).
        this.closeMovieInfoModal();
        this.$router.push('/rate-movie');
        // Scroll to top when navigating to rate movie page
        this.$nextTick(() => {
          scrollWindowTo(0);
        });
      }
    },
    async fetchLetterboxdData () {
      if (!this.$store.state.settings.letterboxdConnected || !this.$store.state.settings.letterboxdUsername) {
        return;
      }

      const username = this.$store.state.settings.letterboxdUsername;

      try {
        // Import the LetterboxdScrapingService dynamically
        const LetterboxdScrapingService = (await import('../services/LetterboxdScrapingService.js')).default;

        // Get user's Letterboxd data (this will use cache if available)
        this.letterboxdUserData = await LetterboxdScrapingService.getUserData(username);
      } catch (error) {
        console.error('Error fetching Letterboxd data:', error);
        ErrorLogService.error('Failed to fetch Letterboxd data', {
          username,
          error: error.message,
          stack: error.stack
        });
        this.letterboxdUserData = null;
      }
    },
    normalizeMovieTitle (title) {
      // Use the same normalization logic as LetterboxdScrapingService
      return title
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    },
    updateSearchValue (value, isAutoRandom = false, expectedType = null) {
      // If we have a value, clear existing filters first then add the new search
      if (value && value.trim()) {
        this.replaceAllFiltersWithSearch(value, isAutoRandom, expectedType);
      } else {
        this.clearInput();
      }

      window.scroll({
        top: 0,
        left: 0,
        behavior: 'instant'
      });
    },
    replaceAllFiltersWithSearch (value, isAutoRandom = false, expectedType = null) {
      // Blur the search input first to prevent layout shifts
      if (this.$refs.searchInput) {
        this.$refs.searchInput.blur();
      }

      if (!value || !value.trim()) return;

      const trimmedTerm = value.trim();

      // If we know the expected type (from random search), use it directly
      let searchType;
      if (expectedType) {
        searchType = this.createFilterByType(expectedType, trimmedTerm);
      } else {
        // Otherwise detect what type of filter this should be
        searchType = this.detectFilterType(trimmedTerm);
      }

      // Create the new filter
      const newFilter = {
        id: `${searchType.type}-${Date.now()}`,
        type: searchType.type,
        value: searchType.value,
        display: searchType.display,
        temp: isAutoRandom // Mark as temporary if it's from auto-random
      };

      // Replace all filters with this single new one in one operation
      this.activeFilters = [newFilter];
      this.activeQuickLinkList = 'title';
      this.inputValue = '';
      this.hasAutoRandomChip = isAutoRandom;
    },
    toggleQuickLinksSort () {
      if (this.quickLinksSortType === "a-z") {
        this.quickLinksSortType = "count";
      } else {
        this.quickLinksSortType = "a-z";
      }
    },
    toggleQuickLinksAccordion (event) {
      if (event.delegateTarget.classList.contains("collapsed")) {
        this.updateSearchValue(null);
        this.activeQuickLinkList = "title";
      }
    },
    toggleQuickLinksList (value) {
      // A curated list is a chip now — route it through the chip toggle so
      // this entry point and the dedicated handlers cannot disagree.
      const listSorts = {
        annual: 'release',
        bestPicture: 'release',
        thisYear: 'rating',
        lastYear: 'rating',
        thisMonth: 'rating',
        lastMonth: 'rating',
        notOnLetterboxd: 'rating'
      };
      if (value && listSorts[value]) {
        this.toggleListChip(value, listSorts[value]);
        return;
      }

      if (this.activeQuickLinkList === value || !value) {
        this.activeQuickLinkList = "title";
        // Clearing the quick-filter panel also clears its list chip.
        if (!value && this.activeListChip) {
          this.activeFilters = this.activeFilters.filter((filter) => filter.type !== 'list');
        }
        this.updateSearchValue("");
        this.$refs.QuickLinksAccordion?.classList.remove("show");
      } else if (this.tags?.includes(value)) {
        // Add tag as a chip instead of using activeQuickLinkList for multi-tag support
        this.activeFilters.push({
          id: `tag-${Date.now()}`,
          type: 'tag',
          value,
          display: `${value}`
        });
        this.sortOrder = "bestOrNewestOnTop";
      } else {
        this.activeQuickLinkList = value;

        this.$refs.QuickLinksAccordion?.classList.add("show");
      }
    },
    // One toggle for every curated list (Phase 4). Toggling the active one
    // removes its chip; toggling another replaces it — a single list at a
    // time, exactly the semantics the old single-valued mode had. Other
    // chips are left alone, which is the point: "Best Picture + horror" is
    // now just two chips.
    toggleListChip (value, sortValue) {
      this.clearInput();

      const wasActive = this.activeListChip?.value === value;
      this.activeFilters = this.activeFilters.filter((filter) => filter.type !== 'list');

      if (!wasActive) {
        this.activeFilters.push({
          id: `list-${value}-${Date.now()}`,
          type: 'list',
          value,
          display: this.getQuickLinkDisplayName(value)
        });
        this.$store.commit("setDBSortValue", sortValue);
      }
    },
    toggleAnnualBestFilter () {
      this.toggleListChip('annual', 'release');
    },
    toggleBestPicturesFilter () {
      this.toggleListChip('bestPicture', 'release');
    },
    toggleThisYearFilter () {
      this.toggleListChip('thisYear', 'rating');
    },
    toggleLastYearFilter () {
      this.toggleListChip('lastYear', 'rating');
    },
    toggleThisMonthFilter () {
      this.toggleListChip('thisMonth', 'rating');
    },
    toggleLastMonthFilter () {
      this.toggleListChip('lastMonth', 'rating');
    },
    async toggleNotOnLetterboxdFilter () {
      this.toggleListChip('notOnLetterboxd', 'rating');

      // Fetch Letterboxd data if we don't have it yet
      if (this.activeListChip?.value === 'notOnLetterboxd') {
        await this.fetchLetterboxdData();
      }
    },
    toggleSortOrder () {
      if (this.sortOrder === "bestOrNewestOnTop") {
        this.setSortOrder("worstOrOldestOnTop");
      } else {
        this.setSortOrder("bestOrNewestOnTop");
      }
      // Save sort order to store for potential restoration
      this.$store.commit('setHomePageSortOrder', this.sortOrder);
    },
    setSortOrder (order) {
      this.sortOrder = order;
    },
    // Leaf writes, per the write-path rule — never the whole object.
    updateDefaultSort (value, order) {
      this.$store.dispatch('writeDurably', { path: 'settings/defaultSort/value', value });
      this.$store.dispatch('writeDurably', { path: 'settings/defaultSort/order', value: order });
    },
    setSortValue (value) {
      this.sortValue = value;
    },
    setOrToggleSortValue (value) {
      if (this.sortValue === value) {
        this.toggleSortOrder();
      } else {
        this.setSortValue(value);
        this.setSortOrder("bestOrNewestOnTop");
      }
      // Save sort state to store for potential restoration
      this.$store.commit('setHomePageSortValue', this.sortValue);
      this.$store.commit('setHomePageSortOrder', this.sortOrder);
    },
    getSortValue (item, key) {
      return getSortValueUtil(item, key, this.mostRecentRating, { adjusted: this.moneyInTodaysDollars });
    },
    sortResultsFast (array) {
      return sortResultsFastUtil(array, {
        sortValue: this.sortValue,
        sortOrder: this.sortOrder,
        getRating: this.mostRecentRating,
        adjusted: this.moneyInTodaysDollars
      });
    },
    toggleMoneyInflation () {
      this.$store.commit('setMoneyInTodaysDollars', !this.moneyInTodaysDollars);
    },
    sortResults (a, b) {
      return sortResultsUtil(a, b, {
        sortValue: this.sortValue,
        sortOrder: this.sortOrder,
        getRating: this.mostRecentRating
      });
    },
    toggleCountViewsAverage () {
      // Cycle: count -> average -> views -> log score -> count (log score
      // added 2026-08-15 — Brian-survey item C2, per Matt: "let's just add
      // more things to that cycle").
      if (this.showAverage) {
        this.showAverage = false;
        this.showViewCount = true;
      } else if (this.showViewCount) {
        this.showViewCount = false;
        this.showLogScore = true;
      } else if (this.showLogScore) {
        this.showLogScore = false;
      } else {
        this.showAverage = true;
      }
    },

    averageRating (results) {
      if (!Array.isArray(results) || results.length === 0) return '0.00';
      const ratedMovies = results.filter((result) => this.mostRecentRating(result).calculatedTotal);
      if (ratedMovies.length === 0) return '0.00';
      const ratings = ratedMovies.map((result) => parseFloat(this.mostRecentRating(result).calculatedTotal));
      const total = ratings.reduce((a, b) => a + b, 0);
      return (total / ratings.length).toFixed(2);
    },
    viewsCount (results) {
      if (!Array.isArray(results)) return 0;
      return results.reduce((total, result) => {
        return total + (Array.isArray(result.ratings) ? result.ratings.length : 0);
      }, 0);
    },
    getYear (media) {
      const date = media.movie.release_date;

      return new Date(date).getFullYear();
    },
    mostRecentRating (media) {
      if (!media || typeof media !== 'object') {
        return { calculatedTotal: null, date: null };
      }
      return getRating(media);
    },
    async searchTMDB () {
      if (!this.effectiveSearchTerm) {
        return;
      }
      let resp;
      try {
        resp = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${process.env.VUE_APP_TMDB_API_KEY}&language=en-US&query=${this.effectiveSearchTerm}`);
      } catch {
        return; // network failure mid-flight: no unhandled rejection (2026-08-15 audit)
      }
      if (resp.data.results.length) {
        this.newEntrySearch(resp.data.results);

        window.scroll({
          top: 0,
          left: 0,
          behavior: 'instant'
        });
      } else {
        this.showNoResultsMessage();
      }
    },
    newEntrySearch (results) {
      this.$store.commit('setNewEntrySearchResults', results)

      this.$router.push(`/pick-media/${this.effectiveSearchTerm}`);
    },
    // Offline counterpart to searchTMDB - bypasses TMDB search entirely with
    // a placeholder movieToRate. See AddRating.js/placeholderId.js for how
    // the save is queued and later reconciled against a real TMDB match.
    rateOffline () {
      if (!this.effectiveSearchTerm) {
        return;
      }
      const media = {
        id: makePlaceholderId(),
        title: this.effectiveSearchTerm,
        release_date: null,
        poster_path: null,
        backdrop_path: null
      };
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
    showNoResultsMessage () {
      // No auto-revert timer - it used to silently dismiss this message and
      // flip the UI back after 30s, which read as stressful/unpredictable.
      // It now only clears via startNewSearch (explicit "Try Another Search"
      // tap) or a fresh keystroke (see onInput) invalidating the stale term.
      this.noResults = true;
    },
    startNewSearch () {
      // Clear current search state
      this.noResults = false;
      this.inputValue = '';
      this.activeFilters = [];

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });

      // Focus the search input after a short delay for smooth scrolling
      setTimeout(() => {
        if (this.$refs.searchInput) {
          this.$refs.searchInput.focus();
        }
      }, 500);
    },
    loadMoreResults () {
      // Add movies in increments of 48 for stable grid layout. (Persistence of
      // numberOfResultsToShow happens in beforeRouteLeave on navigation away.)
      this.numberOfResultsToShow = this.numberOfResultsToShow + 48;
    },
    addMoreResults () {
      // Manual tap on the fallback button: load the next batch and nudge the
      // page down so the new rows come into view.
      this.loadMoreResults();

      this.$nextTick(() => {
        window.scrollBy({
          top: 500,
          behavior: 'smooth'
        })
      });
    },
    setupLoadMoreObserver () {
      // Tear down any prior observer before (re)wiring — the sentinel is v-if'd,
      // so its element is recreated whenever canLoadMore flips false→true.
      if (this.loadMoreObserver) {
        this.loadMoreObserver.disconnect();
        this.loadMoreObserver = null;
      }

      if (!this.canLoadMore || typeof IntersectionObserver === 'undefined') {
        return;
      }

      const sentinel = this.$refs.loadMoreSentinel;
      if (!sentinel) {
        return;
      }

      // rootMargin pre-triggers the load ~600px before the sentinel is on-screen,
      // so the next batch is rendering before the user reaches the end. A batch of
      // 48 posters is far taller than 600px, so each scroll fires exactly once and
      // the sentinel naturally re-arms when it scrolls back into the zone.
      this.loadMoreObserver = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          this.loadMoreResults();
        }
      }, { rootMargin: '600px 0px', threshold: 0 });

      this.loadMoreObserver.observe(sentinel);
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
    focusOnSearchBar (event) {
      this.searchInputFocused = true;
      this.typeaheadDismissed = false;
      event.target.classList.add('font-size-increased');
      event.target.style.fontSize = '16px';

      // If user focuses input and we have an auto random chip, clear it
      if (this.hasAutoRandomChip) {
        requestAnimationFrame(() => {
          this.clearAllFilters();
          this.hasAutoRandomChip = false;
          // Clear the input value so user can start fresh
          event.target.value = '';
          this.inputValue = '';
          // Ensure focus remains on the input
          event.target.focus();
        });
        return; // Don't select text since we're about to clear everything
      }

      // Select the text if there is any text in the input
      if (event.target.value) {
        event.target.select();
      }
    },
    blurSearchBar (event) {
      this.searchInputFocused = false;
      this.convertSearchToChip();
      event.target.classList.remove('font-size-increased');
      event.target.style.fontSize = '12px';
    },
    goToInsights () {
      this.$router.push('/insights');
    },
    // Jumps back into whichever individual game was last played (see
    // gameData.js's LAST_PLAYED_KEY, set on every game route's mount) rather
    // than always landing on the hub — per bug report, popping in and out of
    // a game (e.g. Wordle) to check something on the search screen shouldn't
    // mean re-picking the game from the hub every time.
    goToGames () {
      // Falls back to the hub when nothing is stored OR when the stored game
      // no longer exists — see lastPlayedGamePath for the dead-button bug
      // that second case caused.
      this.$router.push(lastPlayedGamePath(this.$router) || '/games');
    },
    // Brian-survey G1: self-service export, no admin tooling needed.
    async exportMyData () {
      const payload = {
        exportedAt: new Date().toISOString(),
        account: this.$store.state.userEmail || null,
        movieLog: this.$store.state.movieLog || {},
        settings: this.$store.state.settings || {}
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const file = new File([blob], 'cinema-roll-export.json', { type: 'application/json' });
      // Share sheet first (the reliable path on the iOS PWA), anchor as
      // the desktop fallback.
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        try {
          await navigator.share({ files: [file], title: 'Cinema Roll export' });
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'cinema-roll-export.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    saveTieBreakTweak () {
      this.$store.dispatch('writeDurably', { path: 'settings/tieBreakTweak', value: this.tieBreakTweak });
    },
    // Blank clears the setting rather than writing 0 — for stickiness that is
    // "no limit", and for awards it falls back to the default of one a day.
    // `<input type="number">` gives '' for both an empty box and unparseable
    // text, which is the answer we want in either case.
    savePromptsPerDay (path, raw) {
      const value = raw === '' || raw == null ? null : Number(raw);
      this.$store.dispatch('writeDurably', {
        path,
        value: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
      });
    },
    saveAwardsPromptsPerDay (raw) {
      this.savePromptsPerDay('settings/awardsPromptsPerDay', raw);
    },
    saveStickinessPromptsPerDay (raw) {
      this.savePromptsPerDay('settings/stickinessPromptsPerDay', raw);
    },
    savePersonalAwardName () {
      this.$store.dispatch('writeDurably', { path: 'settings/personalAwardName', value: this.personalAwardName });
    },
    saveAwardsYearThreshold (event) {
      const raw = Number(event?.target?.value);
      const value = Number.isFinite(raw) ? Math.min(100, Math.max(1, Math.floor(raw))) : 10;
      this.$store.dispatch('writeDurably', { path: 'settings/awardsYearThreshold', value });
    },
    // Grammar helper methods for award names — delegate to the shared
    // pure functions (assets/javascript/personalAwards.js) so MovieDetail.vue
    // can reuse the exact same logic instead of a hardcoded "My Awards" label.
    getAwardNameWithThe () {
      return awardNameWithThe(this.personalAwardName);
    },
    getAwardNameWithoutThe () {
      return awardNameWithoutThe(this.personalAwardName);
    },
    getAwardNameSingular () {
      return awardNameSingular(this.personalAwardName);
    },
    saveLetterboxdConnection () {
      this.$store.dispatch('writeDurably', { path: 'settings/letterboxdConnected', value: this.letterboxdConnected });
    },
    saveLetterboxdUsername () {
      this.$store.dispatch('writeDurably', { path: 'settings/letterboxdUsername', value: this.letterboxdUsername });
      // Auto-enable integration when username is provided
      if (this.letterboxdUsername && !this.letterboxdConnected) {
        this.letterboxdConnected = true;
        this.saveLetterboxdConnection();
      }
    },
    async downloadForOffline () {
      if (this.offlineDownload.status === 'running') {
        return;
      }

      const urls = collectImageUrls(this.$store.state.movieLog);
      this.offlineDownload = { status: 'running', completed: 0, total: urls.length, failed: 0 };

      const result = await warmImageCache(urls, {
        onProgress: (progress) => {
          this.offlineDownload = { ...this.offlineDownload, ...progress };
        }
      });

      this.offlineDownload = { status: 'done', ...result };
    },
    async signOut () {
      await this.$store.dispatch('logout');
    },
    // Shared write path for every metadata backfill (box office, production
    // countries, locations). `fieldsFor(item)` returns the movie fields that
    // item contributes, e.g. { budget, revenue }.
    //
    // Batched, not one write per movie (bug report, Jul 2026: a per-item
    // design froze/crashed the tab on a real library - see tmdbBackfill.js's
    // own comment for the full story). Each batch becomes ONE combined local
    // commit (setMovieLogEntries) and ONE combined remote multi-path update,
    // instead of N of each.
    async writeMovieFieldBatch (batch, fieldsFor) {
      const entries = [];
      const updates = {};

      batch.forEach((item) => {
        // Read fresh from state (not a captured closure) so this reflects
        // whatever else might be true of the entry right now.
        const existingEntry = this.$store.state.movieLog[item.dbKey];
        if (!existingEntry) return;

        const fields = fieldsFor(item);
        entries.push({ key: item.dbKey, value: { ...existingEntry, movie: { ...existingEntry.movie, ...fields } } });
        // Individual leaf-path keys (not the whole `movie` object) so this
        // can never clobber sibling fields like cast/crew/genres with a
        // possibly-stale local snapshot.
        Object.entries(fields).forEach(([field, value]) => {
          updates[`movieLog/${item.dbKey}/movie/${field}`] = value;
        });
      });

      if (entries.length) {
        this.$store.commit('setMovieLogEntries', entries);
      }
      if (Object.keys(updates).length) {
        // No durable-queue treatment needed here (unlike a user-authored
        // rating) - this is re-fetchable metadata, not irreplaceable data,
        // and the whole operation is naturally safe to just re-run if a
        // batch write fails.
        await this.$store.dispatch('updateDatabaseEntriesNow', updates);
      }
    },
    refreshLibraryFromServer () {
      this.$store.dispatch('forceFullLibraryRefresh');
    },
    async backfillBoxOfficeData () {
      if (this.boxOfficeBackfill.status === 'running') {
        return;
      }

      const candidateCount = collectMoviesNeedingBoxOffice(this.$store.state.movieLog).length;
      this.boxOfficeBackfill = { status: 'running', completed: 0, total: candidateCount, failed: 0 };

      const result = await backfillBoxOffice(
        this.$store.state.movieLog,
        (batch) => this.writeMovieFieldBatch(batch, (item) => item.boxOffice),
        {
          onProgress: (progress) => {
            this.boxOfficeBackfill = { ...this.boxOfficeBackfill, ...progress };
          }
        }
      );

      this.boxOfficeBackfill = { status: 'done', ...result };
    },
    async trimLibraryData () {
      if (this.libraryTrim.status === 'running') {
        return;
      }

      const candidateCount = collectEntriesNeedingTrim(this.$store.state.movieLog).length;
      this.libraryTrim = { status: 'running', completed: 0, total: candidateCount, failed: 0 };

      const result = await trimStoredEntries(this.$store.state.movieLog, async (batch) => {
        const entries = [];
        let updates = {};

        batch.forEach(({ dbKey, updates: entryUpdates }) => {
          const existingEntry = this.$store.state.movieLog[dbKey];
          if (!existingEntry) return;
          // Keep local state in step with what's being written, so the grid
          // doesn't briefly disagree with the database.
          entries.push({ key: dbKey, value: entryForStorage(existingEntry) });
          updates = { ...updates, ...entryUpdates };
        });

        if (entries.length) {
          this.$store.commit('setMovieLogEntries', entries);
        }
        if (Object.keys(updates).length) {
          // A multi-path update, where a null value DELETES that path. Writing
          // whole entries instead is what put the junk there originally.
          await this.$store.dispatch('updateDatabaseEntriesNow', updates);
        }
      }, {
        onProgress: (progress) => {
          this.libraryTrim = { ...this.libraryTrim, ...progress };
        }
      });

      this.libraryTrim = { status: 'done', ...result };
    },
    // One-time catch-up so entries rated before change tracking existed also
    // carry an updatedAt. Strictly optional — an unstamped entry is simply
    // never returned by a future delta query, which is correct as long as the
    // local snapshot already holds it — but making the library uniform removes
    // a whole category of "why is this movie invisible to sync" reasoning.
    async backfillSyncStamps () {
      if (this.syncStampBackfill.status === 'running') {
        return;
      }

      const candidates = collectEntriesNeedingStamp(this.$store.state.movieLog);
      this.syncStampBackfill = { status: 'running', completed: 0, total: candidates.length, failed: 0 };

      const batchSize = 100;
      let completed = 0;
      let failed = 0;

      for (let index = 0; index < candidates.length; index += batchSize) {
        const batch = candidates.slice(index, index + batchSize);
        try {
          // The server assigns the actual timestamps — see stampBackfillUpdates.
          await this.$store.dispatch('updateDatabaseEntriesNow', stampBackfillUpdates(batch));
        } catch {
          failed += batch.length;
        }
        completed += batch.length;
        this.syncStampBackfill = { ...this.syncStampBackfill, completed, failed };
      }

      // Local state is deliberately left alone: the real timestamps arrive via
      // the onValue listener, and committing the placeholder here would put a
      // value in state that was never actually stored.
      this.syncStampBackfill = { status: 'done', total: candidates.length, completed, failed };
    },
    async backfillLocationsData () {
      if (this.locationsBackfill.status === 'running') {
        return;
      }

      const candidateCount = collectMoviesNeedingLocations(this.$store.state.movieLog).length;
      this.locationsBackfill = { status: 'running', completed: 0, total: candidateCount, failed: 0, withLocations: 0 };

      // Wikidata rather than TMDB, and queried in large batches rather than
      // per movie - ~1,400 films is about 7 requests, not 1,400.
      const result = await backfillMovieLocations(
        this.$store.state.movieLog,
        (batch) => this.writeMovieFieldBatch(batch, (item) => ({ locations: item.locations })),
        {
          onProgress: (progress) => {
            this.locationsBackfill = { ...this.locationsBackfill, ...progress };
          }
        }
      );

      this.locationsBackfill = { status: 'done', ...result };
    },
    async backfillProductionCountriesData () {
      if (this.countriesBackfill.status === 'running') {
        return;
      }

      const candidateCount = collectMoviesNeedingCountries(this.$store.state.movieLog).length;
      this.countriesBackfill = { status: 'running', completed: 0, total: candidateCount, failed: 0 };

      const result = await backfillProductionCountries(
        this.$store.state.movieLog,
        (batch) => this.writeMovieFieldBatch(batch, (item) => item.countries),
        {
          onProgress: (progress) => {
            this.countriesBackfill = { ...this.countriesBackfill, ...progress };
          }
        }
      );

      this.countriesBackfill = { status: 'done', ...result };
    },
    saveStickinessPromptState (value) {
      this.stickinessPromptState = value;
      this.$store.dispatch('setDBValue', { path: 'settings/stickinessPromptState', value });
    },
    saveTieBreakPromptState (value) {
      this.tieBreakPromptState = value;
      this.$store.dispatch('setDBValue', { path: 'settings/tieBreakPromptState', value });
    },
    saveAwardsPromptState (value) {
      this.awardsPromptState = value;
      this.$store.dispatch('setDBValue', { path: 'settings/awardsPromptState', value });
    },
    // Test function for Letterboxd URL generation (call from browser console)
    // Test function for Letterboxd scraping (UI button)
    async scrapeLetterboxd () {
      const username = this.letterboxdUsername || this.$store.state.settings.letterboxdUsername;

      if (!username) {
        this.scrapingTest.error = 'No Letterboxd username set';
        this.scrapingTest.success = false;
        this.scrapingTest.result = null;
        return;
      }

      this.scrapingTest.loading = true;
      this.scrapingTest.result = null;
      this.scrapingTest.error = null;

      try {
        // Import the scraping service dynamically
        const LetterboxdScrapingService = (await import('../services/LetterboxdScrapingService.js')).default;
        const result = await LetterboxdScrapingService.testScraping(username);

        this.scrapingTest.result = result;
        this.scrapingTest.success = result && result.films && result.films.length > 0;
        this.scrapingTest.loading = false;
      } catch (error) {
        this.scrapingTest.error = error.message || 'Scraping failed';
        this.scrapingTest.success = false;
        this.scrapingTest.loading = false;
        ErrorLogService.error('Letterboxd scraping test failed', {
          username,
          error: error.message,
          stack: error.stack
        });
      }
    },
    addLetterboxdOverride () {
      if (!this.newOverrideTitle || !this.newOverrideYear) return;

      // Create a unique key for this override (title + year)
      const overrideKey = `${this.newOverrideTitle.toLowerCase().replace(/[^a-z0-9]/g, '')}_${this.newOverrideYear}`;

      // Add to local state
      this.letterboxdOverrides[overrideKey] = {
        title: this.newOverrideTitle,
        year: this.newOverrideYear,
        addedAt: new Date().toISOString()
      };

      // Durable leaf write: whole-map setDBValue writes could be silently
      // swallowed by the same-path debounce on a quick add-then-remove, and
      // were lost entirely offline (2026-08-15 offline audit).
      this.$store.dispatch('writeDurably', {
        path: `settings/letterboxdOverrides/${overrideKey}`,
        value: this.letterboxdOverrides[overrideKey]
      });

      // Clear the form
      this.newOverrideTitle = '';
      this.newOverrideYear = null;
    },
    removeLetterboxdOverride (overrideKey) {
      // Remove from local state
      delete this.letterboxdOverrides[overrideKey];

      this.$store.dispatch('writeDurably', {
        path: `settings/letterboxdOverrides/${overrideKey}`,
        value: null
      });
    },
    // New multi-filter system methods
    getQuickLinkDisplayName (quickLinkKey) {
      const displayNames = {
        annual: 'Annual Best',
        bestPicture: 'Best Picture',
        thisYear: 'This Year',
        lastYear: 'Last Year',
        thisMonth: 'This Month',
        lastMonth: 'Last Month',
        notOnLetterboxd: 'Not on Letterboxd'
      };
      return displayNames[quickLinkKey] || quickLinkKey;
    },
    clearQuickLink () {
      this.activeQuickLinkList = 'title';
    },
    removeFilter (filterId) {
      // Blur the search input first to prevent layout shifts from interfering with the click
      if (this.$refs.searchInput) {
        this.$refs.searchInput.blur();
      }

      this.activeFilters = this.activeFilters.filter(f => f.id !== filterId);

      if (this.activeFilters.length === 0) {
        // No filters remain, clear search values
        this.inputValue = '';
      }
    },
    addDirectorFilter (event) {
      const director = event.target.value;
      if (director) {
        this.activeFilters.push({
          id: `director-${Date.now()}`,
          type: 'director',
          value: director,
          display: `Director: ${director}`
        });
        this.hasAutoRandomChip = false; // Reset auto chip flag
        event.target.value = '';
        this.showAddFilterModal = false;
      }
    },
    addYearFilter (event) {
      const year = event.target.value;
      if (year) {
        this.activeFilters.push({
          id: `year-${Date.now()}`,
          type: 'year',
          value: year,
          display: `Year: ${year}`
        });
        this.hasAutoRandomChip = false; // Reset auto chip flag
        event.target.value = '';
        this.showAddFilterModal = false;
      }
    },
    // year-scroller tap handler — drops any existing year chip(s) (incl. a
    // stray temp one) and appends a fresh one, but LEAVES every other
    // active chip alone, so tapping around the scroller doesn't clear a
    // combined filter like year + genre.
    selectYear (year) {
      const yearChip = {
        id: `year-${Date.now()}`,
        type: 'year',
        value: year.toString(),
        display: year.toString()
      };
      this.activeFilters = [...this.activeFilters.filter((filter) => filter.type !== 'year'), yearChip];
      this.hasAutoRandomChip = false;
    },
    // Keeps the currently-selected year pill scrolled into view — both when
    // the scroller first appears and again each time a different year is
    // tapped, so the current selection never drifts out of sight as you
    // "travel between years." scrollIntoView is guarded (jsdom/older
    // browsers may not implement it) rather than assumed present.
    centerYearScrollerPill () {
      const activePill = this.$refs.yearScroller?.querySelector('.year-scroller-pill.selected');
      if (activePill && typeof activePill.scrollIntoView === 'function') {
        activePill.scrollIntoView({ inline: 'center', block: 'nearest' });
      }
    },
    addGenreFilter (event) {
      const genre = event.target.value;
      if (genre) {
        this.activeFilters.push({
          id: `genre-${Date.now()}`,
          type: 'genre',
          value: genre,
          display: `Genre: ${genre}`
        });
        this.hasAutoRandomChip = false; // Reset auto chip flag
        event.target.value = '';
        this.showAddFilterModal = false;
      }
    },
    // Same shape as the genre/director pickers: a typed chip, exact match.
    addPlaceFilter (event) {
      const place = event.target.value;
      if (place) {
        this.activeFilters.push({ id: `place-${Date.now()}`, type: 'place', value: place, display: place });
        this.hasAutoRandomChip = false;
        event.target.value = '';
        this.showAddFilterModal = false;
      }
    },
    addTagFilter (event) {
      const tag = event.target.value;
      if (tag) {
        this.activeFilters.push({
          id: `tag-${Date.now()}`,
          type: 'tag',
          value: tag,
          display: `Tag: ${tag}`
        });
        this.hasAutoRandomChip = false; // Reset auto chip flag
        event.target.value = '';
        this.showAddFilterModal = false;
      }
    },
    setSearchValue (value) {
      this.debouncedSetSearchValue(value);
    },
    onInput (event) {
      const newVal = event.target.value;

      // A new keystroke invalidates any "no results for X" message about
      // whatever the OLD term was - without this, since the auto-revert
      // timer was removed, that alert could otherwise get stuck showing a
      // stale term until the user explicitly hit "Try Another Search".
      this.noResults = false;

      // A new keystroke is a new question, so a panel closed by Escape comes
      // back rather than staying shut for the rest of the search.
      this.typeaheadDismissed = false;

      this.overwriteCurrentlyTypingSearchFilter(newVal);
      this.inputValue = newVal;
      this.setSearchValue(newVal);
    },
    overwriteCurrentlyTypingSearchFilter (value) {
      // Find any existing temp filter and remove it
      this.activeFilters = this.activeFilters.filter(filter => !filter.temp);

      if (value.trim()) {
        // Detect filter type while typing for consistent results. Same
        // identity resolution as a committed chip — a temp chip drives the
        // same fetches, so it deserves the same certainty about itself.
        const searchType = this.resolveChipIdentity(this.detectFilterType(value.trim()));
        const tempFilter = {
          ...searchType,
          id: `temp-${Date.now()}`,
          temp: true // Mark as temporary
        };

        this.activeFilters.push(tempFilter);
      }
    },
    clearInput () {
      this.inputValue = '';
      this.setSearchValue('');

      // Clear and blur the input
      const inputElement = this.$refs.searchInput;
      if (inputElement) {
        inputElement.blur();
      } // Small delay to show the fade effect
    },
    convertSearchToChip () {
      // Find any existing temp filter and remove it
      this.activeFilters = this.activeFilters.filter(filter => !filter.temp);

      const currentSearch = this.inputValue;
      if (!currentSearch || !currentSearch.trim()) {
        return;
      }
      const searchTerm = currentSearch.trim();

      // The fuzzy "Did you mean?" blur-guard applies ONLY to free-text (general)
      // terms — a probable typo we don't want to auto-chip into a dead general
      // chip (the user should tap a suggestion instead). A STRUCTURED filter
      // (year, genre, director, company, keyword, ...) is an intended filter and
      // must always be committed.
      //
      // Without this type check, typing a year like "2010" — which shows results
      // via a temp `year` chip while focused — lost them on blur: removing the
      // temp chip above fell back to a `general` match (which does NOT match by
      // release year), found nothing, surfaced suggestions, and bailed before
      // ever creating the year chip.
      const detected = this.detectFilterType(searchTerm);
      if (detected.type === 'general' && this.didYouMeanSuggestions.length > 0) {
        return;
      }

      // Add the chip immediately and clear the input
      this.addSearchFilter(searchTerm);
    },
    // Phase 2 of the redesign: a chip's identity is decided HERE, at
    // creation, and carried on the chip — never re-derived downstream. The
    // old push rebuilt the chip from four named fields, which silently
    // stripped anything else a detector attached (detectGenreTypes' genreId
    // never actually survived onto the chip; only a fetch-time fallback
    // saved the horror fix). Now the resolved chip is spread whole.
    resolveChipIdentity (searchType) {
      if (!searchType || searchType.tmdbId != null) return searchType;

      const kindByType = { genre: 'genre', company: 'company', keyword: 'keyword' };
      const kind = kindByType[searchType.type];
      if (!kind) return searchType;

      const tmdbId = this.libraryCatalog.idFor(kind, searchType.value);
      return tmdbId != null ? { ...searchType, tmdbId } : searchType;
    },
    addSearchFilter (searchTerm, isAutoRandom = false, expectedType = null, knownTmdbId = null) {
      if (!searchTerm || !searchTerm.trim()) return;

      const trimmedTerm = searchTerm.trim();

      // If we know the expected type (from random search), use it directly
      let searchType;
      if (expectedType) {
        searchType = this.createFilterByType(expectedType, trimmedTerm);
      } else {
        // Otherwise detect what type of filter this should be
        searchType = this.detectFilterType(trimmedTerm);
      }

      // Check if this exact filter already exists
      const existingFilter = this.activeFilters.find(filter =>
        filter.type === searchType.type && filter.value === searchType.value
      );

      if (existingFilter) {
        return;
      }

      if (knownTmdbId != null) {
        searchType = { ...searchType, tmdbId: knownTmdbId };
      }

      // Add the appropriate filter chip, with everything its detector and
      // the catalog know about what it refers to.
      this.activeFilters.push({
        ...this.resolveChipIdentity(searchType),
        id: `${searchType.type}-${Date.now()}`
      });

      this.clearInput();

      // Track if this chip was added by automatic random search
      this.hasAutoRandomChip = isAutoRandom;
    },
    applyDidYouMeanSuggestion (suggestion) {
      // Commit a tapped fuzzy suggestion as a real chip. We pass the known
      // expectedType so addSearchFilter -> createFilterByType builds the exact
      // chip with no re-guessing. Titles have a null expectedType and commit
      // through detectFilterType (i.e. as a general chip), matching a typed title.
      this.addSearchFilter(suggestion.value, false, suggestion.expectedType);
    },
    // Decides how many ranked "Did you mean?" suggestions to attempt to show
    // on one line, given the search input's actual current width. The DOM
    // measurement lives here; the pure fit-counting math is
    // countDidYouMeanSuggestionsThatFit (searchFiltering.js) so it's directly
    // unit-testable without mounting the component.
    updateDidYouMeanFitCount () {
      const input = this.$refs.searchInput;
      const maxWidth = input ? input.offsetWidth : 0;
      this.didYouMeanFitCount = countDidYouMeanSuggestionsThatFit(this.didYouMeanSuggestions, maxWidth);
    },
    describeSuggestion,
    dismissTypeahead () {
      this.typeaheadDismissed = true;
    },
    measureTypeaheadRoom () {
      const input = this.$refs.searchInput;
      if (!input) return;
      // 8px of breathing room above, and never so short that the panel
      // becomes a one-row peephole.
      const room = input.getBoundingClientRect().top - 8;
      this.typeaheadMaxHeight = Math.max(96, Math.min(220, room));
    },
    applyTypeaheadSuggestion (suggestion) {
      // The whole point: commit the chip the term actually IS, rather than
      // letting detectFilterType's exact-match cascade fall through to a
      // `general` chip because you typed a surname instead of a full name.
      // The row carries the id from the catalog, so the chip does too.
      this.addSearchFilter(suggestion.value, false, suggestion.expectedType, suggestion.tmdbId ?? null);
    },
    /**
     * Scroll the list to one film, without changing how the list is sorted.
     *
     * Bug report (2026-08-20): a quick way to see a film's neighbours in the
     * rankings. The sort and order are left exactly as they are - that was the
     * explicit ask - so this only has to render far enough down the list and
     * put the row on screen.
     */
    async revealMovieInList (dbKey) {
      const locate = () => indexOfMovie(this.sortedResults, dbKey);

      let index = locate();

      // A search or a set of chips can exclude the film entirely, and then
      // there is nothing to scroll to. Clearing them is the only way to honour
      // "where does this live in the overall list" - and silently doing
      // nothing is exactly the failure mode of the pin button just fixed.
      if (index === -1) {
        this.clearAllFilters();
        await this.$nextTick();
        index = locate();
      }
      if (index === -1) return false;

      // Home renders a slice; a film at #134 is not in the document until
      // enough of the list is. The margin is the neighbours below it.
      this.numberOfResultsToShow = resultsNeededToReveal(index, this.numberOfResultsToShow);
      await this.$nextTick();

      const element = document.getElementById(resultElementId(dbKey));
      if (!element) return false;

      // `<html>` has scroll-behavior: smooth, which makes a bare
      // window.scrollTo a silent no-op here (see .claude/rules/vue-ui.md).
      const top = element.getBoundingClientRect().top + window.scrollY;
      scrollWindowTo(scrollOffsetFor(top, window.innerHeight));

      // A brief highlight, or you arrive at a wall of posters with no idea
      // which one you came for.
      element.classList.add('revealed-result');
      setTimeout(() => element.classList.remove('revealed-result'), 2400);

      // Drop the param so a refresh, or a later back-navigation, doesn't
      // yank the list around again.
      const query = { ...this.$route.query };
      delete query.revealMovie;
      this.$router.replace({ query }).catch(() => {});
      return true;
    },
    clearAllFilters () {
      // Blur the search input first to prevent layout shifts
      if (this.$refs.searchInput) {
        this.$refs.searchInput.blur();
      }

      // Clear all active filters
      this.activeFilters = [];
      // Clear quick link filter
      this.activeQuickLinkList = 'title';
      // Clear search values
      this.inputValue = '';
    },
    debouncedFetchUnratedMoviesForFilters (filters) {
      clearTimeout(this.unratedMoviesDebounceTimeout);
      const snapshot = [...(filters || [])];
      this.unratedMoviesDebounceTimeout = setTimeout(() => {
        this.fetchUnratedMoviesForFilters(snapshot);
      }, 800);
    },
    detectYearTypes (searchValue) {
      // Year patterns
      if (/^\d{4}$/.test(searchValue)) {
        const year = parseInt(searchValue);
        if (year >= 1900 && year <= new Date().getFullYear() + 5) {
          return { type: 'year', value: year.toString(), display: year.toString() };
        }
      }

      // 2-digit year (e.g., "95" → 1995)
      if (/^\d{2}$/.test(searchValue)) {
        const shortYear = parseInt(searchValue);
        const currentYear = new Date().getFullYear();
        const currentCentury = Math.floor(currentYear / 100) * 100;
        const fullYear = shortYear <= (currentYear % 100) + 10 ? currentCentury + shortYear : currentCentury - 100 + shortYear;
        return { type: 'year', value: fullYear.toString(), display: fullYear.toString() };
      }

      // Year range (e.g., "1990-1995")
      const rangeMatch = searchValue.match(/^(\d{4})-(\d{4})$/);
      if (rangeMatch) {
        const startYear = parseInt(rangeMatch[1]);
        const endYear = parseInt(rangeMatch[2]);
        if (startYear >= 1900 && endYear <= new Date().getFullYear() + 5 && startYear <= endYear) {
          return { type: 'yearRange', value: { startYear, endYear }, display: `${startYear}-${endYear}` };
        }
      }

      // Decade patterns (e.g., "90s", "1990s")
      const decadeMatch = searchValue.match(/^(\d{2,4})s$/i);
      if (decadeMatch) {
        let decade = parseInt(decadeMatch[1]);
        if (decade < 100) {
          // Convert 2-digit to 4-digit (e.g., "90" → "1990")
          const currentYear = new Date().getFullYear();
          const currentCentury = Math.floor(currentYear / 100) * 100;
          decade = decade <= (currentYear % 100) + 10 ? currentCentury + decade : currentCentury - 100 + decade;
        }
        decade = Math.floor(decade / 10) * 10; // Round down to decade
        return { type: 'yearRange', value: { startYear: decade, endYear: decade + 9 }, display: `${decade}s` };
      }

      // If no year types matched, return null
      return null;
    },
    createFilterByType (expectedType, value) {
      const trimmed = value.trim();

      switch (expectedType) {
        case "keyword":
          return { type: 'keyword', value: trimmed, display: trimmed };
        case "genre":
          // Same identity as the typed path (detectGenreTypes): a genre chip
          // carries its id however it was created.
          return { type: 'genre', genreId: genreIdFor(trimmed), value: trimmed, display: trimmed };
        case "year":
          return { type: 'year', value: trimmed, display: trimmed };
        case "director":
          return { type: 'person', value: trimmed, display: trimmed };
        case "cast/crew":
          return { type: 'person', value: trimmed, display: trimmed };
        case "studios":
          return { type: 'company', value: trimmed, display: trimmed };
        case "place":
          return { type: 'place', value: trimmed, display: trimmed };
        default:
          // Fall back to detection if unknown type
          return this.detectFilterType(trimmed);
      }
    },
    /**
     * What a TYPED term becomes. Since 2026-08-29: a plain search, always.
     *
     * Matt: "I don't really understand why we have to have different types of
     * searches... Don't we have all those sections within our search results
     * for exactly this reason? Everything that comes up under a name will be
     * under the person... and everything that comes up under a title will be
     * under title, and then I can sort those sections as needed."
     *
     * He was right, and this used to be a six-step cascade that guessed which
     * ONE thing a word named — director, genre, cast, company, keyword — and
     * committed that as a typed chip. Two things went wrong with that. It had
     * to choose, so "Alice" became the actress Mary Alice and hid three
     * Alice-titled films; and a typed chip TURNS THE SECTIONS OFF
     * (groupedByAllCategories renders only for `general`), so the guess also
     * removed the tool that would have made the ambiguity a non-issue.
     *
     * Now the sections do the sorting, and what the word could refer to is
     * kept as a LIST instead of a verdict — see searchInterpretations.js,
     * which is what keeps "More from" asking TMDB precise questions.
     *
     * Years are the one exception and stay above this line: `general` does
     * not match a release year at all, so a typed "2010" has to become a year
     * chip or it finds nothing. A year chip also reads as a year on screen,
     * where a person chip that had eaten a title search looked like a bug.
     *
     * Precise filters are still entirely available — deliberately, rather
     * than by guess: the Add Filter menu, the typeahead under the search bar
     * (which passes an expectedType and skips this), the links on a movie's
     * detail page, quick links and tags all build typed chips directly.
     */
    detectFilterType (value) {
      const trimmed = value.trim();

      const asYear = this.detectYearTypes(trimmed);
      if (asYear) return asYear;

      return { type: 'general', value: trimmed, display: `${trimmed}` };
    },
    async fetchUnratedMoviesByKeyword (keyword) {
      // Filter out movies newer than 6 months to avoid current buzz, but be more lenient
      const maxDate = new Date();
      maxDate.setMonth(maxDate.getMonth() - 6);
      const maxYear = maxDate.getFullYear();

      // First try movie search
      const movieSearchResp = await axios.get('https://api.themoviedb.org/3/search/movie', {
        params: {
          api_key: process.env.VUE_APP_TMDB_API_KEY,
          language: 'en-US',
          query: keyword,
          page: 1,
          include_adult: false, // Explicitly exclude adult content
        }
      });

      let allResults = (movieSearchResp.data.results || []).filter(movie => {
        const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : 0;
        // More lenient filtering: allow more recent movies and lower vote counts for niche keywords
        return releaseYear <= maxYear + 1 && movie.vote_count >= 10; // Relaxed criteria
      });

      // If we don't get enough results, try keyword search
      if (allResults.length < 10) {
        try {
          const keywordSearchResp = await axios.get('https://api.themoviedb.org/3/search/keyword', {
            params: {
              api_key: process.env.VUE_APP_TMDB_API_KEY,
              language: 'en-US',
              query: keyword,
            }
          });

          if (keywordSearchResp.data.results && keywordSearchResp.data.results.length > 0) {
            const keywordId = keywordSearchResp.data.results[0].id;

            // Get movies with this keyword, filtered by age
            const maxDateString = maxDate.toISOString().split('T')[0]; // YYYY-MM-DD format
            const keywordMoviesResp = await axios.get('https://api.themoviedb.org/3/discover/movie', {
              params: {
                api_key: process.env.VUE_APP_TMDB_API_KEY,
                language: 'en-US',
                with_keywords: keywordId,
                sort_by: 'popularity.desc',
                page: 1,
                'vote_count.gte': 20, // Lower threshold for keyword searches
                'primary_release_date.lte': maxDateString, // No movies newer than 6 months
                include_adult: false, // Explicitly exclude adult content
              }
            });

            const keywordResults = keywordMoviesResp.data.results || [];
            // Merge results, prioritizing direct movie search results
            allResults = [...allResults, ...keywordResults];
          }
        } catch (keywordError) {
          console.log('Keyword search failed, using movie search results only:', keywordError);
        }
      }

      return allResults;
    },
    /** TMDB id for a name, looked up once and remembered. */
    async resolveTmdbId (kind, name) {
      const key = `${kind}:${String(name || '').trim().toLowerCase()}`;
      if (!key.split(':')[1]) return null;
      if (tmdbIdCache.has(key)) return tmdbIdCache.get(key);

      try {
        const response = await axios.get(`https://api.themoviedb.org/3/search/${kind}`, {
          params: { api_key: process.env.VUE_APP_TMDB_API_KEY, language: 'en-US', query: name }
        });
        const id = pickResolvedId(response.data?.results, name, normalizeSearchText);
        tmdbIdCache.set(key, id);
        return id;
      } catch {
        return null;
      }
    },

    /** Pages of /discover for one set of parameters. */
    async discoverMovies (params, pages = 3) {
      const results = [];

      for (let page = 1; page <= pages; page++) {
        const response = await axios.get('https://api.themoviedb.org/3/discover/movie', {
          params: { ...params, api_key: process.env.VUE_APP_TMDB_API_KEY, page }
        });

        results.push(...(response.data?.results || []));
        if (page >= (response.data?.total_pages || 0)) break;
      }

      return results;
    },

    /**
     * Candidates for EVERY active chip at once.
     *
     * The combined question goes to /discover in a single call, because its
     * parameters AND natively — `with_genres=27,35` is horror AND comedy.
     * Fetching each chip separately and intersecting would usually come back
     * empty: horror's top 60 by popularity and comedy's top 60 rarely
     * overlap, even though TMDB knows hundreds of horror-comedies.
     *
     * Free text is the exception, since /discover has no text search. There
     * the title search leads and the rest narrows it — locally for genre and
     * release date (both ride along on search results), and by intersecting
     * with a discover call for cast, company and keyword, which do not.
     */
    async fetchUnratedMoviesForFilters (filters) {
      // Offline: skip the whole fan-out rather than letting every request
      // fail individually (2026-08-15 offline audit).
      if (!this.$store.state.isOnline) {
        this.unratedMovies = [];
        return;
      }

      const active = (filters || []).filter((filter) => filter?.type);
      if (!active.length) {
        this.unratedMovies = [];
        this.unratedMoviesError = null;
        return;
      }

      this.unratedMoviesError = null;
      this.unratedMovies = [];

      // Only the NEWEST set of chips may write results. These fetches are
      // several sequential TMDB pages, so switching filters leaves two in
      // flight; without this, whichever finished last won regardless of
      // what you were looking at ("I tried horror... it gave me Spiderman").
      const requestId = (this.unratedRequestId || 0) + 1;
      this.unratedRequestId = requestId;
      const isStale = () => this.unratedRequestId !== requestId;

      const cacheKey = this.moreFromCacheKey;

      // What the typed words could refer to — read from the filters this
      // fetch was STARTED for, never from what is on screen by the time it
      // finishes. Only ever populated for a lone free-text chip, so this
      // cannot reinterpret a question the user has already made precise.
      const readings = this.interpretationsFrom(active);
      const lead = readings[0] || null;

      try {
        const groups = partitionFilters(active);
        // Kept for the heading's wording when a single chip is in play. A
        // plain search that clearly names one thing is described as that
        // thing — typing "thriller" still reads "More thriller movies",
        // which is what the row is actually showing.
        this.unratedMoviesSearchType = active.length === 1
          ? (lead && lead.exact && lead.kind === 'genre' ? 'genre' : active[0].type)
          : 'multiple';

        const cached = moreFromCache.get(cacheKey);
        let relevantList = cached || [];

        if (!cached) {
          const window = releaseWindow(groups);

          // Chips that cannot all be true at once — 1994 AND 1997 — have no
          // answer, and saying so beats quietly honouring one of them.
          if (window.impossible) {
            if (isStale()) return;
            this.unratedMovies = [];
            return;
          }

          // Identity comes from the chip itself, then the catalog, and only
          // then from a /search round trip. A chip built from the library
          // carries an id that is attached to at least the film it came
          // from, so the Spiderland failure mode (search leading with a
          // similarly-named orphan) cannot arise for anything the library
          // already knows. /search remains only for people — stored
          // name-only, deliberately — and for hand-typed names from outside
          // the library.
          const catalog = this.libraryCatalog;
          const resolveChip = async (kind, searchKind, chip) => {
            if (chip.tmdbId != null) return chip.tmdbId;
            const known = catalog.idFor(kind, chip.value);
            if (known != null) return known;
            return this.resolveTmdbId(searchKind, chip.value);
          };

          const genreIds = groups.genres
            .map((chip) => chip.genreId ?? catalog.idFor('genre', chip.value))
            .filter((id) => id != null);

          const [personIds, companyIds, keywordIds] = await Promise.all([
            Promise.all(groups.people.map((chip) => this.resolveTmdbId('person', chip.value))),
            Promise.all(groups.companies.map((chip) => resolveChip('company', 'company', chip))),
            Promise.all(groups.keywords.map((chip) => resolveChip('keyword', 'keyword', chip)))
          ]).then((sets) => sets.map((ids) => ids.filter((id) => id != null)));

          // A chip we couldn't resolve would silently widen the search to
          // everything, which is how "horror" once returned Spider-Man.
          const unresolved =
            genreIds.length !== groups.genres.length ||
            personIds.length !== groups.people.length ||
            companyIds.length !== groups.companies.length ||
            keywordIds.length !== groups.keywords.length;

          // One chip, looked up by name, and TMDB either doesn't know the
          // name or knows an entity with nothing attached to it: ask the
          // same question as free text instead of showing an empty section.
          // This is not the widening that broke "horror" — the term is still
          // the whole question, it is just being asked of /search/movie
          // rather than of an id. Only for a lone chip: quietly turning one
          // half of "horror + comedy" into a title search would be a lie
          // about what is on screen.
          const soleSearchChip = active.length === 1 && !groups.texts.length &&
            (groups.people.length + groups.companies.length + groups.keywords.length) === 1
            ? active[0]
            : null;

          if (unresolved && !soleSearchChip) {
            if (isStale()) return;
            this.unratedMovies = [];
            return;
          }

          // "Nothing too new" still applies to plain genre browsing, where
          // it exists to keep current buzz out — but never over an explicit
          // year chip, and not when you asked about a person or a studio,
          // where their latest is the interesting part.
          const genreOnly = Boolean(genreIds.length) &&
            !personIds.length && !companyIds.length && !keywordIds.length &&
            !groups.years.length && !groups.ranges.length;
          const notNewerThan = genreOnly ? this.twoYearsAgoDate() : null;

          if (unresolved) {
            relevantList = await this.fetchUnratedMoviesByKeyword(soleSearchChip.value);
          } else if (groups.texts.length) {
            // Text leads; everything else narrows it.
            const text = groups.texts[0].value;
            relevantList = await this.fetchUnratedMoviesByKeyword(text);
            relevantList = relevantList.filter((movie) =>
              matchesLocalConstraints(movie, { genreIds, window }));

            if (personIds.length || companyIds.length || keywordIds.length) {
              const constrained = await this.discoverMovies(
                discoverParams({ genreIds, personIds, companyIds, keywordIds, window }), 2);
              relevantList = intersectById(relevantList, constrained);
            }

            // The words also name something the library knows — a genre, a
            // person, a studio, a keyword. Ask that question too and ADD the
            // answers, because both readings are legitimate: "Alice" means
            // the films called Alice and the ones with Mary Alice in them.
            //
            // A union, never an intersection. Intersecting would answer
            // "films called Thriller that are also thrillers", which is
            // nearly nothing — the same mistake fetching two chips
            // separately and intersecting them made for horror + comedy.
            // Only the LEADING reading is asked: several ANDed together
            // would over-narrow the same way, and a second discover call per
            // keystroke-settled search is enough network as it is.
            if (lead) {
              const alsoMeans = await this.discoverForInterpretation(lead, window);
              const seen = new Set(relevantList.map((movie) => movie?.id));
              relevantList = [...relevantList, ...alsoMeans.filter((movie) => !seen.has(movie?.id))];
            }
          } else if (hasDiscoverableFilters(groups)) {
            relevantList = await this.discoverMovies(discoverParams({
              genreIds, personIds, companyIds, keywordIds, window, notNewerThan
            }));
          } else {
            // Only chips TMDB knows nothing about (your own tags).
            relevantList = [];
          }

          // Resolved to a real id that simply has no films behind it — the
          // other half of the "spiderman" report, since /search/keyword
          // happily returns keywords no film carries. Indistinguishable from
          // a genuine empty until you ask the question the other way.
          if (!relevantList.length && soleSearchChip && !unresolved) {
            relevantList = await this.fetchUnratedMoviesByKeyword(soleSearchChip.value);
          }
        }

        // A filter the user has already moved on from must not paint over
        // the one they are looking at now.
        if (isStale()) return;

        if (!cached) moreFromCache.set(cacheKey, relevantList);

        // Everything already accounted for: rated, or waiting in a hat.
        // Suggesting something you have already decided to watch is the one
        // thing a per-filter watchlist must not do.
        const exclude = new Set(this.allEntriesWithFlatKeywordsAdded.map(r => r.movie.id));
        Object.keys(this.$store.state.movieHatMovieIds || {}).forEach((id) => {
          exclude.add(Number(id));
        });

        this.unratedMovies = rankMoreFrom(relevantList, {
          exclude,
          affinity: this.genreTaste,
          limit: 18
        });
      } catch (err) {
        console.error('Error fetching unrated movies:', err);
        ErrorLogService.error('Failed to fetch unrated movies', {
          filters: active.map((filter) => `${filter.type}:${filter.value}`),
          error: err.message,
          stack: err.stack
        });
        if (isStale()) return;
        this.unratedMoviesError = 'Error fetching from TMDB.';
      }
    },
    /**
     * What a set of filters' plain text could refer to.
     *
     * Takes the filters explicitly rather than reading component state,
     * because the fetch it feeds is asynchronous and is handed the filters it
     * was started for — the whole point of the stale-request guard. Reading
     * "what is on screen now" halfway through would be the same class of bug
     * that guard exists to prevent.
     */
    interpretationsFrom (filters) {
      const list = (filters || []).filter((filter) => filter?.type);
      if (list.length !== 1 || list[0].type !== 'general') return [];
      return interpretationsFor(this.libraryCatalog, list[0].value);
    },
    /**
     * The unrated films behind ONE reading of the typed words.
     *
     * Never throws: this runs alongside a text search that has already
     * succeeded, so a failed lookup here should quietly add nothing rather
     * than empty a row that already has an answer.
     *
     * People are looked up rather than read from a chip — the library stores
     * cast and crew name-only on purpose (see catalog.js), so an id has to be
     * fetched, and `resolveTmdbId` already insists the name match exactly,
     * which is what keeps a search for a person from landing on an extra
     * credited on nothing.
     */
    async discoverForInterpretation (interpretation, window) {
      try {
        const filter = discoverFilterFor(interpretation);
        if (!filter) return [];

        const params = { window };
        if (filter.type === 'genre') {
          const id = filter.genreId ?? this.libraryCatalog.idFor('genre', filter.value);
          if (id == null) return [];
          params.genreIds = [id];
          // Same "nothing too new" rule plain genre browsing has always had:
          // it exists to keep current buzz out of a broad browse, and this is
          // the same broad browse arrived at by typing.
          params.notNewerThan = this.twoYearsAgoDate();
        } else if (filter.type === 'person') {
          const id = await this.resolveTmdbId('person', filter.value);
          if (id == null) return [];
          params.personIds = [id];
        } else if (filter.type === 'company') {
          const id = filter.tmdbId ?? this.libraryCatalog.idFor('company', filter.value) ??
            await this.resolveTmdbId('company', filter.value);
          if (id == null) return [];
          params.companyIds = [id];
        } else if (filter.type === 'keyword') {
          const id = filter.tmdbId ?? this.libraryCatalog.idFor('keyword', filter.value) ??
            await this.resolveTmdbId('keyword', filter.value);
          if (id == null) return [];
          params.keywordIds = [id];
        } else {
          return [];
        }

        return await this.discoverMovies(discoverParams(params), 2);
      } catch (error) {
        // Deliberately quiet — the text half of the answer is already good.
        ErrorLogService.warn('Interpretation lookup failed', {
          kind: interpretation?.kind,
          value: interpretation?.name,
          error: error?.message
        });
        return [];
      }
    },
    /** The section's "nothing too new" line, as YYYY-MM-DD. */
    twoYearsAgoDate () {
      const date = new Date();
      date.setFullYear(date.getFullYear() - 2);
      return date.toISOString().split('T')[0];
    },
    // Test function for error logging (for development)
    testErrorLogging () {
      ErrorLogService.info('Test info message', { timestamp: Date.now() });
      ErrorLogService.warn('Test warning message', { component: 'Home' });
      ErrorLogService.error('Test error message', { testData: 'sample error' });
      ErrorLogService.debug('Test debug message', { debugInfo: 'detailed information' });
    },
    // Error log management methods
    refreshErrorLogs () {
      this.errorLogs = ErrorLogService.getLogs();
    },
    clearErrorLogs () {
      ErrorLogService.clearLogs();
      this.refreshErrorLogs();
    },
    async copyErrorLogs () {
      try {
        const logText = ErrorLogService.getLogsAsText();
        await navigator.clipboard.writeText(logText);
        this.showCopySuccess();
      } catch {
        // Fallback for older browsers
        this.fallbackCopyToClipboard(ErrorLogService.getLogsAsText());
      }
    },
    fallbackCopyToClipboard (text) {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        this.showCopySuccess();
      } catch (error) {
        console.error('Failed to copy logs:', error);
        ErrorLogService.error('Failed to copy logs to clipboard', { error: error.message });
      } finally {
        document.body.removeChild(textArea);
      }
    },
    showCopySuccess () {
      this.copySuccess = true;
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    },
    formatLogTime (timestamp) {
      return new Date(timestamp).toLocaleTimeString();
    },
    startErrorLogRefresh () {
      if (this.errorLogRefreshInterval) return; // Already running
      this.errorLogRefreshInterval = setInterval(() => {
        this.refreshErrorLogs();
      }, 1000); // Refresh every second
    },
    stopErrorLogRefresh () {
      if (this.errorLogRefreshInterval) {
        clearInterval(this.errorLogRefreshInterval);
        this.errorLogRefreshInterval = null;
      }
    },

    // Stickiness inline methods
    topStructure (result) {
      if (this.currentLogIsTVLog) {
        return result.tvShow;
      } else {
        return result.movie;
      }
    },
    sortByRating (a, b) {
      const aRating = getRating(a)?.calculatedTotal;
      const bRating = getRating(b)?.calculatedTotal;

      if (aRating < bRating) {
        return 1;
      }
      if (aRating > bRating) {
        return -1;
      }

      return 0;
    },
  },
}
</script>

<style lang="scss">
/* Brief marker on the row you jumped to via a rank badge. Without it you
   arrive at a wall of posters with no idea which one you came for. Purely a
   box-shadow animation - nothing about the layout changes, so the list does
   not shift under your thumb the moment you land. Unscoped, because the row
   itself belongs to DBGridLayoutSearchResult. */
.revealed-result {
  animation: reveal-pulse 2.4s ease-out;
  border-radius: 6px;
}

@keyframes reveal-pulse {
  0%, 55% { box-shadow: 0 0 0 3px #ffd700, 0 0 14px 4px rgba(255, 215, 0, 0.45); }
  100% { box-shadow: 0 0 0 3px rgba(255, 215, 0, 0), 0 0 14px 4px rgba(255, 215, 0, 0); }
}

@import '@/assets/scss/prompt-card';

/* Quick links and tags are one combined list now, capped and scrolling —
   "what if instead we combine them into one list, but we make it scrollable
   if it gets way too thick" (2026-08-17). The cap is exactly what made
   separating tags out unnecessary in the first place.

   Top level on purpose: #quick-links-accordion is a child of the search row,
   NOT of .quick-link-types, so a rule nested in there never matches it. */
#quick-links-accordion .quick-links-badges {
  max-height: 40vh;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

  .home {
    width: 100%;
    max-width: 832px;
    min-height: calc(100vh - 140px);

    .search-bar {
      width: 100%;
      max-width: 416px;
      /* The containing block for the typeahead panel, which opens upward out
         of the input. Anchored here rather than on .input-group so Bootstrap
         doesn't square off its corners as a non-first input-group child. */
      position: relative;

      input#search {
        border-bottom-right-radius: .375rem;
        border-top-right-radius: .375rem;

        &.font-size-increased {
          margin: -6px 0 0;
        }
      }

      svg {
        height: 18px;
        width: 18px;
      }
    }

    .results {
      .results-count {
        font-size: 1rem;
      }

      .results-actions {
        /* The bottom of the rainbow, top of the notification space: the
           same 0.5rem as every other gap in the header->input->rainbow->
           notices->results chain. (Top spacing is the mt-1 class, pairing
           with the search bar's interior 0.25rem.) */
        margin-bottom: 0.5rem;

        /* The sort menu has to opt OUT of `.home .results ul { width: 100% }`
           a few rules up, which is meant for the results list.
           It caught this menu all along and was invisible: while the <ul>
           lived inside the toggle <button>, 100% meant 100% of a 157px chip,
           which looks exactly like a compact dropdown. Moving the menu out of
           the button (so it would stop closing itself) re-parented it to the
           full-width .btn-group, and the same rule stretched it to 800px.
           Reported 2026-08-26: "it goes full width, and it's way too big."
           `ul.dropdown-menu` here is (0,4,1) against that rule's (0,2,1) —
           the type selector is load-bearing, not decoration. Measured on the
           live page: 800px -> 160px, right-aligned under the toggle. */
        ul.dropdown-menu {
          width: max-content;
          /* A phone still has to be able to see the whole thing. */
          max-width: 80vw;
        }

        .dropdown-item {
          &.active,
          &:active {
            color: #1e2125;
            background-color: #e9ecef;
          }
        }

        .dropdown-toggle {
          position: relative;

          &::after {
            display: none;
          }

          > i {
            margin-right: 6px;
          }

          /* Inline beside the glyph, not pinned to the chip's right edge.
             Absolute positioning meant the glyph stayed centred while the
             arrow sat against the edge, so widening the sort chip (flex-grow
             1.6) pulled them apart: "when we adjusted the width of the
             rainbow segments the icon and then the up or down arrow got
             separated a little bit. I'd like them to tighten back up."
             (2026-08-17) Inline, they travel together at any width. */
          .order-arrow {
            display: inline-flex;
            margin-left: -2px;
          }
        }

        button {
          svg {
            height: 14px;
            width: 14px;
          }

          border: none;

          &.results-actions-button {
            /* flex-basis 0 makes every chip's width come from the grow
               ratio alone, not its glyph's natural width (they varied:
               different icon widths + mixed btn/btn-sm padding). Single-
               icon chips are all 1 unit; the two with real content (the
               count and the sort) get 1.6. */
            flex: 1 1 0;
            min-width: 0;
            padding-left: 0;
            padding-right: 0;

            &.filtered-count-display,
            &.dropdown-toggle {
              flex-grow: 1.6;
            }

            &:nth-child(1) {
              background-color: #E71D36; /* Red */
              color: white;
            }

            &:nth-child(2) {
              background-color: #FF9F1C; /* Orange */
              color: black;
            }

            &:nth-child(3) {
              background-color: #FFD700; /* Yellow */
              color: black;
            }

            &:nth-child(4) {
              background-color: #24d776; /* Green */
              color: black;
            }

            &:nth-child(5) {
              background-color: #1D8BF1; /* Blue */
              color: black;
            }

            &:nth-child(6) {
              background-color: #5A189A; /* Indigo */
              color: white;
            }

            &:nth-child(7) {
              background-color: #cd7fe8; /* Violet */
              color: white;
            }

            &:nth-child(8) {
              background-color: #00FFFF; /* Cyan */
              color: white;
            }
          }
        }

        .filtered-count-display {
          .average-label {
            font-size: 0.5rem;
            position: absolute;
            bottom: 4px;
            left: 50%;
            transform: translateX(-50%);
          }

          .average-value {
            position: relative;
            top: -4px;
          }
        }

        .quick-link-types {
          row-gap: 6px;

          span {
            cursor: pointer;
            font-size: 0.75rem;
          }

          hr {
            margin: 14px 0 10px;
          }

          .tags-quicklinks {
            position: relative;

            p {
              background: #212529;
              cursor: pointer;
              font-size: 0.75rem;
              padding: 0 10px 0 7px;
              position: absolute;
              right: 0;
              top: -22px;

              &[aria-expanded="true"] {
                .bi-caret-right-fill::before {
                  transform: rotate(90deg);
                }
              }

              .bi-caret-right-fill::before {
                transition: transform .5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
              }
            }
          }

          .quick-links-list-wrapper {
            border: 1px solid #c0c2c3;
            max-height: 150px;
            overflow-y: scroll;
            position: relative;

            .quick-links-list-sort {
              position: sticky;
              top: 4px;
              left: 100%;
              border: 1px solid #c0c2c3;
              border-bottom-left-radius: 2px;
              padding: 2px 4px;
              background: white;
              font-size: 0.65rem;
              margin: 4px 8px;
            }

            .quick-link-list {
              column-count: 2;
              column-gap: 0;
              list-style: none;
              margin-top: -20px;

              li {
                .badge {
                  align-items: center;
                  cursor: pointer;
                  display: flex;
                  text-align: start;
                  white-space: break-spaces;

                  span {
                    font-size: 0.5rem;
                  }
                }
              }
            }
          }
        }
      }

      ul {
        list-style: none;
        width: 100%;
        padding: 0;
        margin: 0;

        &.grid-layout {
          display: grid;
          grid-gap: 0;

          li {
            overflow: hidden;
            display: flex;
            justify-content: center;
            align-items: center;
            transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);

            &.highlight {
              border: 2px solid #54b448;
              transform: scale(1.2);
              z-index: 1;
            }

            img {
              width: 100%;
              height: auto;
              object-fit: cover;
            }
          }

          &.count-is-1 {
            grid-template-columns: repeat(4, 1fr);

            li {
              grid-column: span 4;
              grid-row: span 2;

              @media screen and (min-width: 832px) {
                grid-column: 2 / span 2;
                grid-row: span 2;
              }
            }
          }

          &.count-is-2 {
            grid-template-columns: repeat(4, 1fr);

            li {
              grid-column: span 2;
              grid-row: span 2;
            }
          }

          &.count-is-3 {
            grid-template-columns: repeat(4, 1fr);

            @media screen and (min-width: 832px) {
              grid-template-columns: repeat(3, 1fr);
            }

            li {
              &:first-child {
                grid-column: span 4;
                grid-row: span 2;
              }

              &:nth-child(n+1) {
                grid-column-end: span 2;
              }

              @media screen and (min-width: 832px) {
                /* Override the first-child settings for larger screens */
                &:first-child {
                  grid-column: span 1; /* Corrected to span only 1 column */
                }
                /* Ensure each li takes up 1/3 of the width */
                &:nth-child(n+1) {
                  grid-column-end: span 1;
                }
              }
            }
          }

          &.count-is-4 {
            grid-template-columns: repeat(12, 1fr);

            li {
              &:first-child {
                grid-column: span 12;
                grid-row: span 12;
              }

              &:nth-child(2),
              &:nth-child(3),
              &:nth-child(4) {
                grid-column: span 4;
                grid-row: span 4;
              }

              @media screen and (min-width: 832px) {
                &:first-child,
                &:nth-child(2),
                &:nth-child(3),
                &:nth-child(4) {
                  grid-column: span 3;
                  grid-row: span 4;
                }
              }
            }
          }

          &.count-more-than-4-remainder-0 {
            grid-template-columns: repeat(12, 1fr);

            li {
              &:first-child {
                grid-column: span 12;
                grid-row: span 12;
              }

              &:nth-child(2),
              &:nth-child(3),
              &:nth-child(4) {
                grid-column: span 4;
                grid-row: span 4;
              }

              &:nth-child(n+5) {
                grid-column: span 3;
              }

              @media screen and (min-width: 832px) {
                &:first-child,
                &:nth-child(2),
                &:nth-child(3),
                &:nth-child(4),
                &:nth-child(n+5) {
                  grid-column: span 3;
                  grid-row: span 4;
                }
              }
            }
          }

          &.count-more-than-4-remainder-1 {
            grid-template-columns: repeat(4, 1fr);

            li {
              &:first-child {
                grid-column: span 2;
                grid-row: span 2;
              }

              &:nth-child(n+2) {
                grid-column: span 1;
                grid-row: span 1;
              }
            }
          }

          &.count-more-than-4-remainder-2 {
            grid-template-columns: repeat(4, 1fr);

            li {
              &:first-child {
                grid-column: span 2;
                grid-row: span  2;
              }

              &:nth-child(2) {
                grid-column: span 2;
                grid-row: span 2;
              }

              &:nth-child(n+2) {
                grid-column-end: span 1;
              }
            }
          }

          &.count-more-than-4-remainder-3 {
            grid-template-columns: repeat(4, 1fr);

            @media screen and (min-width: 832px) {
              grid-template-columns: repeat(12, 1fr);
            }

            li {
              &:first-child {
                grid-column: span 4;
                grid-row: span 4;
              }

              &:nth-child(2),
              &:nth-child(3) {
                grid-column: span 2;
                grid-row: span 2;
              }

              &:nth-child(n+4) {
                grid-column: span 1;
                grid-row: span 2;
              }

              @media screen and (min-width: 832px) {
                &:first-child,
                &:nth-child(2),
                &:nth-child(3) {
                  grid-column: span 4;
                  grid-row: span 2;
                }

                &:nth-child(n+4) {
                  grid-column: span 3;
                  grid-row: span 2;
                }
              }
            }
          }

        }
      }
    }

    // "More from…" — the watchlist-row language rather than the old
    // centred-label-on-a-rule treatment, which needed absolute positioning
    // and a bg-dark bar to punch a hole in its own border.
    .more-from {
      border-top: 1px solid rgba(255, 255, 255, 0.25);
      margin-top: 1.5rem;
      padding: 1rem 0 3rem;
    }

    .more-from-title {
      color: #eee;
      font-size: 1rem;
      font-weight: 700;
      margin: 0 0 0.6rem;
    }

    .more-from-row {
      display: flex;
      gap: 0.5rem;
      // Sideways rather than a wall: the section is one row tall however
      // many movies match.
      overflow-x: auto;
      padding-bottom: 0.25rem;
      -webkit-overflow-scrolling: touch;
    }

    .more-from-card {
      cursor: pointer;
      flex: 0 0 auto;
      position: relative;
      width: 104px;
    }

    .more-from-poster {
      border-radius: 4px;
      display: block;
      // Fixed height at the poster's own ratio, so the row lines up top and
      // bottom whatever TMDB returns.
      height: 156px;
      object-fit: cover;
      width: 104px;
    }

    /* Top-RIGHT, matching every other hat button (bug report: "It should
       always be in the top right corner no matter where that is in the
       app"). This one was the odd corner out. */
    /* Flush: the hat control is a corner ribbon. */
    .more-from-actions {
      position: absolute;
      right: 0;
      top: 0;
    }

    .more-from-meta {
      color: #bbb;
      display: block;
      font-size: 0.7rem;
      padding-top: 0.2rem;
      text-align: center;
    }

    .no-results-buffer {
      // This is here to deal with the jump in position when the input is deblurred and a chip is automatically added
      margin-top: 29px;
    }

    .loading-screen {
      height: 75vh;
    }

    .btn {
      .spinner-border {
        height: 18px;
        width: 18px;
      }
    }

    .settings-panel-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.3);
      z-index: 2000;
      display: flex;
      align-items: flex-start;
      justify-content: flex-end;
    }
    .settings-panel {
      width: 320px;
      max-width: 90vw;
      background: var(--bs-light, #fff);
      box-shadow: 0 2px 16px rgba(0,0,0,0.15);
      border-radius: 8px;
      margin: 2rem 2rem 0 0;
      animation: slideInRight 0.2s;
    }
    @keyframes slideInRight {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
  }

  .bg-dark {
    .home {
      color: white;

      ul {
        .media-result {
          border-color: white;
        }
      }
    }
  }

  .settings-panel {
  position: fixed;
  top: 0;
  right: 0;
  width: 320px;
  height: 100vh;
  background: var(--bs-light, #fff);
  box-shadow: -2px 0 8px rgba(0,0,0,0.15);
  z-index: 2000;
  padding: 1.5rem 1.25rem 1.25rem 1.25rem;
  transition: transform 0.3s cubic-bezier(.4,0,.2,1);
}
.slide-enter-active, .slide-leave-active {
  transition: transform 0.3s cubic-bezier(.4,0,.2,1);
}
.slide-enter, .slide-leave-to {
  transform: translateX(100%);
}

.role-section {
  border-top: 1px solid white;
  padding: 16px 0 0;
  position: relative;

  h6 {
    font-size: 0.75rem;
    right: 12px;
    padding: 0 12px;
    position: absolute;
    top: -2px;
    transform: translateY(-50%);
    white-space: nowrap;
  }

  .group-header {
    cursor: pointer;

    &:active {
      opacity: 0.7;
    }

    .group-header-icon {
      font-size: 0.7rem;
      margin-left: 4px;
      opacity: 0.6;
    }
  }
}

/* Group order panel */
.group-order-panel {
  background: #2b3035;
  border: 1px solid #444;

  .group-order-row {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

    &:last-child {
      border-bottom: none;
    }
  }

  // Always-visible controls (no hover) for mobile-first use.
  .group-order-controls .btn:disabled {
    opacity: 0.35;
  }
}

/* Error logs styling */
.error-logs-section {
  background: rgba(0, 0, 0, 0.05);
  border-color: #444 !important;
  color: #ffffff !important;
}

.settings-panel-inline.dark .error-logs-section {
  background: rgba(255, 255, 255, 0.05);
  color: #ffffff !important;
}

.error-logs-section h6,
.error-logs-section .text-muted,
.error-logs-section small {
  color: #ffffff !important;
}

.log-entry {
  color: #ffffff !important;
}

.log-entry.log-error {
  border-left-color: #dc3545 !important;
  background: rgba(220, 53, 69, 0.1);
  color: #ffffff !important;
}

.log-entry.log-warn {
  border-left-color: #ffc107 !important;
  background: rgba(255, 193, 7, 0.1);
  color: #ffffff !important;
}

.log-entry.log-info {
  border-left-color: #0dcaf0 !important;
  background: rgba(13, 202, 240, 0.1);
  color: #ffffff !important;
}

.log-entry.log-debug {
  border-left-color: #6c757d !important;
  background: rgba(108, 117, 125, 0.1);
  color: #ffffff !important;
}

.log-message {
  word-break: break-word;
  line-height: 1.3;
  color: #ffffff !important;
}

.log-entry .text-muted {
  color: #cccccc !important;
}

.error-logs-section .text-center {
  color: #ffffff !important;
}
</style>

<style scoped>
/* A toggle that only applies while its parent toggle is on: indented under it. */
.push-sub-toggle {
  margin-left: 1.75rem;
}

.welcome-new-user-text {
  color: #ccc;
  font-size: 0.9rem;
  margin: 0 auto;
  max-width: 26rem;
  padding: 0 1rem;
}
.welcome-account-note {
  color: #ccc;
  font-size: 0.78rem;
  margin: 0.5rem auto 0;
  max-width: 26rem;
  padding: 0 1rem;
}
.did-you-mean-inline {
  font-size: 0.75rem;
  margin-top: 0.35rem;
  /* Hard guarantee against wrapping/overflow regardless of how close
     updateDidYouMeanFitCount's character-count estimate gets - worst case
     is an ellipsis mid-last-term, never a wrapped or overflowing line. */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Same panel the games use (CineplexityGame's, which also opens upward). */
.typeahead-panel {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  /* Above the input: the keyboard owns the bottom of a phone, and the
     results below are re-filtering on every keystroke. Over the header
     image is the empty space this can have. */
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  /* Overridden inline by measureTypeaheadRoom with the room actually above
     the input; this is the ceiling and the value before it is measured. */
  max-height: 220px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  position: absolute;
  right: 0;
  /* Clears the header (position: relative, z-index auto) without going
     anywhere near the modals at 1050+. */
  z-index: 20;
}
.typeahead-row {
  align-items: baseline;
  background: none;
  border: none;
  color: #eee;
  display: flex;
  font-size: 0.85rem;
  gap: 0.5rem;
  justify-content: space-between;
  /* A finger-sized target, matching the games' rows. */
  min-height: 40px;
  padding: 0.4rem 0.8rem;
  text-align: left;
  width: 100%;
}
.typeahead-row:active {
  /* Mobile-first press feedback, flat rather than nested: this style block
     is plain CSS (see .did-you-mean-link:active beside it), so an `&` here
     compiles to a literal ampersand and the rule silently never applies. */
  background: #1f1f1f;
}
.typeahead-term {
  /* A long studio name truncates rather than pushing the kind off the row. */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.typeahead-meta {
  /* Quieter than the term — it answers "what kind of chip will this make,
     and why is it this high up", not something to read first. */
  color: #8b8b8b;
  flex-shrink: 0;
  font-size: 0.68rem;
}
.did-you-mean-link {
  color: #adb5bd;
  text-decoration: underline;
}
.did-you-mean-link:active {
  /* Mobile-first: no-hover affordance, visible press feedback */
  opacity: 0.7;
}
.pending-reconciliation-banner {
  background-color: #332701;
  border: 1px solid #ffc107;
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  text-align: center;
  max-width: 500px;

  a {
    color: #ffe69c;
    font-weight: 600;
    text-decoration: underline;
  }
}
.pending-reconciliation-banner a:active {
  opacity: 0.7;
}
.signed-in-as {
  color: #ccc; /* .text-muted is illegible on the dark panel (house rule) */
}

.settings-panel-inline {
  background: var(--bs-light, #fff);
  border: 1px solid var(--bs-border-color, #dee2e6);
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  max-width: 600px;
  margin: 0 auto 1.5rem auto;
  color: var(--bs-body-color, #212529);
  /* The section cards carry their own padding; the card-body default was
     inset inside an inset, which visibly narrowed every group. */
  padding: 0.75rem 0.5rem;
}

/* Group label inside a section. Sized down and set in caps deliberately:
   the item titles beneath it are full-size form labels, so a same-size
   bold heading read as a sibling rather than a header. */
.settings-note {
  /* #b9b9b9 on the section card, ~8:1. */
  color: #b9b9b9;
  font-size: 0.75rem;
  line-height: 1.35;
  margin: 0 0 0.6rem;
}

.settings-hat-account {
  border-bottom: 1px solid #2e2e2e;
  margin-bottom: 0.7rem;
  padding-bottom: 0.7rem;
}

.settings-hat-connected {
  /* #7fd6a2 on the section card is ~8:1. */
  color: #7fd6a2;
  margin-bottom: 0.4rem;
}

.settings-hat-count {
  color: #9a9a9a;
  font-size: 0.72rem;
  margin-left: 0.35rem;
}

.settings-hat-error {
  color: #ff9f9f;
  font-size: 0.75rem;
  margin: 0.5rem 0 0;
}

.settings-subhead {
  border-top: 1px solid #2e2e2e;
  color: #b9c6e6;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  margin: 1.25rem 0 0.6rem;
  padding-top: 0.85rem;
  text-transform: uppercase;
}

.settings-section-body > .settings-subhead:first-child {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}
.settings-panel-inline.dark {
  background: #23272b !important;
  border-color: #343a40 !important;
  color: #f8f9fa !important;
}
.settings-panel-inline.dark .form-check-label,
.settings-panel-inline.dark h5,
.settings-panel-inline.dark .settings-panel-header,
.settings-panel-inline.dark .settings-panel-body {
  color: #f8f9fa !important;
}
.settings-panel-inline.dark .form-check-input:checked {
  background-color: #0d6efd;
  border-color: #0d6efd;
}
.settings-panel-inline.dark .form-range {
  background-color: #343a40;
}
.settings-panel-inline .form-range {
  accent-color: #0d6efd;
}

/* Chip Close Button Styles */
.badge .btn-close {
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.badge .btn-close:hover {
  opacity: 1;
}

.badge .btn-close:focus {
  outline: none;
  box-shadow: none;
}

/* Filter Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1050;
}

.modal-content {
  background: #212529;
  color: white;
  border-radius: 8px;
  max-width: 90%;
  width: 400px;
  max-height: 80vh;
  overflow-y: auto;
}

.modal-header {
  padding: 0.5rem 1rem 0 1rem;
  border-bottom: none;
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  position: relative;
}

.modal-header h5 {
  margin: 0;
  flex-grow: 1;
}

.modal-body {
  padding: 1rem;
}

/* Movie Info Modal Specific Styles */
.movie-info-modal {
  max-width: 90%;
  width: 500px;
}

.movie-info-content {
  display: flex;
  gap: 1rem;
  flex-direction: column;
}

@media (min-width: 576px) {
  .movie-info-content {
    flex-direction: row;
  }
}

.movie-poster-section {
  flex-shrink: 0;
  text-align: center;
}

.movie-poster {
  max-width: 150px;
  width: 100%;
  height: auto;
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.movie-details-section {
  flex: 1;
}

.movie-title {
  margin-bottom: 0.75rem;
  color: #f8f9fa;
  font-weight: 600;
}

.movie-year,
.movie-genres,
.movie-overview,
.movie-rating {
  margin-bottom: 0.5rem;
  line-height: 1.4;
}

.movie-overview {
  margin-bottom: 0.75rem;
}

.filter-section {
  margin-bottom: 1rem;
}

/* Active Filter Chips */
.active-filters-section {
  max-width: 600px;
}

.active-filters-section .badge {
  font-size: 0.75rem;
  padding: 0.375rem 0.5rem;
  margin-right: 0.25rem;
  margin-bottom: 0.25rem;
}

.active-filters-section .btn-close {
  width: 0.75rem;
  height: 0.75rem;
  margin-left: 0.25rem;
}

/* Year-scroller special case (see hasActiveYearChip). flex-basis 100%
   forces it onto its own full-width row within the chip row's flex-wrap
   container ("goes horizontally all the way across"); min-width: 0 is the
   standard flexbox fix that lets it actually shrink to that row width
   instead of growing to fit all its pills (without it, overflow-x: auto
   would have nothing to ever actually overflow). */
.year-scroller {
  display: flex;
  flex: 1 1 100%;
  min-width: 0;
  gap: 0.4rem;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.15rem 0.1rem;
}

.year-scroller-pill {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Mobile-first: no reliable :hover device, so press feedback is an :active
   opacity dip only — same convention as .did-you-mean-link/.group-header
   elsewhere in this file. */
.year-scroller-pill:active {
  opacity: 0.7;
}

/* Chip Animation Transitions */
.chip-fade-enter-active,
.chip-fade-leave-active {
  transition: all 0.3s ease;
}

.chip-fade-enter-from {
  opacity: 0;
  transform: scale(0.8) translateY(-10px);
}

.chip-fade-leave-to {
  opacity: 0;
  transform: scale(0.8) translateY(-10px);
}

.chip-fade-move {
  transition: transform 0.3s ease;
}

.chip-transition {
  transition: all 0.2s ease;
}

/* Unrated Movie Posters */
/* Header→input gap matched to the input→rainbow gap (Matt) — and the whole
   chain runs on 0.5rem now ("I wanted them all small", 2026-08-21). */
.home {
  padding-top: 0.5rem;
}

/* The quick-links bolt inside the search input: a plain dark glyph on the
   input's own background, no chrome (Matt: "it should just match the
   input exactly"). The input reserves right padding so typed text never
   runs underneath it. */
.search-input-group {
  position: relative;
  /* Confines the bolt's z-index to this group (bug report: "the lightning
     bolt has a z-index that's too high so it's appearing over some other
     things — the sort order dropdown can pop up and be in that same spot
     but the lightning bolt is still visible on top of it").

     position: relative with z-index auto does NOT create a stacking
     context, so the bolt's z-index: 5 was competing page-wide and painting
     over any overlay that stacks below 5 — everything with z-index auto
     included. Isolating means the bolt only ever stacks against the input
     beside it, which is all it needed the 5 for. The typeahead panel is a
     sibling of this group (on .search-bar) at z-index 20, so it still opens
     above the input. */
  isolation: isolate;

  .search-input-with-quick-links {
    padding-right: 2.4rem;
  }

  .search-quick-links-toggle {
    align-items: center;
    background: none;
    border: none;
    bottom: 0;
    color: #212529;
    display: flex;
    justify-content: center;
    position: absolute;
    right: 0;
    top: 0;
    width: 2.4rem;
    z-index: 5;

    &:active {
      opacity: 0.5;
    }
  }
}

/* The Film Club chip's glyph runs ~30% larger than the other rainbow
   icons at ALL times, so nothing resizes when the new-updates count
   appears inside it (Matt, tuned by eye over three rounds). */
.film-club-glyph {
  /* White, not the chip's inherited black (bug report). */
  color: #fff;
  font-size: 1.32em;
}

/* The binoculars had no size of its own and so ran visibly smaller than the
   club beside it: "make it like 10% bigger or else maybe make it just match
   the club icon next to it" (2026-08-17). Matching is the tidier of the two
   options he offered — one number for both, and they stay level. */
.watchlist-glyph {
  font-size: 1.32em;
}

/* The new-updates badge: solid club with a white count knocked out. */
.film-club-badge {
  display: inline-flex;
  position: relative;

  .film-club-badge-count {
    /* Knocked out of the now-white club. */
    color: #212529;
    font-size: 0.5rem;
    font-weight: 700;
    left: 50%;
    line-height: 1;
    position: absolute;
    top: calc(40% + 2px);
    transform: translate(-50%, -50%);
  }
}

/* Friend-request notice — same visual language as the stickiness/tiebreak
   prompt banners it shares the slot with. */
.friend-request-banner {
  background: #4a4a4a;
  border: 1px solid #666;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
  color: #fff;
  cursor: pointer;

  &:active {
    background: #565656;
  }

  .friend-request-content {
    align-items: center;
    display: flex;
    font-size: 1.1rem;

    .bi-people-fill {
      color: #ffc107;
    }

    .alert-link {
      color: #9ec5fe;
      cursor: pointer;
      font-weight: 700;
    }
  }
}

</style>