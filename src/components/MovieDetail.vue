<template>
  <div class="movie-detail-page">
    <!-- Header with backdrop and title -->
    <div class="movie-header">
      <div class="home-link" :class="{'loading': isLoading}" @click="goBack" role="button" :aria-label="`Back to ${backLabel}`">
        <div v-if="isLoading" class="spinner-border spinner-border-sm text-light" role="status">
          <span class="visually-hidden">Loading...</span>
        </div>
        <template v-else>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-caret-left-fill" viewBox="0 0 16 16">
            <path d="m3.86 8.753 5.482 4.796c.646.566 1.658.106 1.658-.753V3.204a1 1 0 0 0-1.659-.753l-5.48 4.796a1 1 0 0 0 0 1.506z"/>
          </svg>
          <span>{{ backLabel }}</span>
        </template>
      </div>
      <img v-if="movie && getBackdropPath()"
           :src="`https://image.tmdb.org/t/p/w1280${getBackdropPath()}`"
           :alt="`${movie.title} backdrop`"
           class="backdrop-image">
      <div class="header-overlay">
        <h1 v-if="movie">{{ movie.title }}</h1>
      </div>
    </div>

    <!-- Movie details content -->
    <div class="movie-content" v-if="movie">
      <div class="container">
        <div v-if="movie.isPendingReconciliation" class="pending-reconciliation-notice">
          Rated offline - not yet matched to a real movie.
          <router-link :to="`/reconcile/${result.dbKey}`">Find the match</router-link>
        </div>
        <div class="rating-runtime-and-date">
          <div class="line-one">
            <h3>
              <a class="link" @click.stop="searchFor(`${getYear(result)}`)">{{getYear(result)}}</a>
            </h3>
            <!-- Rank rides with the score as a small parenthetical, in the
                 same spot as "(normalized rating)". It used to be a button
                 that jumped to the rank in Home, and that was the problem:
                 the score is itself a three-way toggle, so a link sitting
                 inside it caught taps meant for the toggle. Bug report
                 2026-08-25: "get rid of the link and move the rank info so
                 that it mimics the placement of the normalized
                 parenthetical." -->
            <span class="rating-with-rank">
              <ToggleableRating
                :rating="ratingForMedia(result)"
                :normalizedRating="normalizedRatingForMedia(result)"
                :rankLabel="ordinalRank || ''"
              />
            </span>
          </div>
          <div class="line-two">
            <h3>{{prettifyRuntime(result)}}</h3>
          </div>
        </div>

        <div class="details-actions d-flex align-items-center mb-4">
          <div v-if="$store.state.settings.letterboxdConnected"
               @click="logOnLetterboxd"
               role="button"
               :title="isMovieLoggedOnLetterboxd() ? 'View movie on Letterboxd' : 'Log on Letterboxd'"
               :aria-label="isMovieLoggedOnLetterboxd() ? 'View movie on Letterboxd' : 'Log on Letterboxd'"
               :class="['letterboxd-status-button', { 'logged': isMovieLoggedOnLetterboxd(), 'not-logged': !isMovieLoggedOnLetterboxd() }]">
            <img :src="isMovieLoggedOnLetterboxd() ? 'https://a.ltrbxd.com/logos/letterboxd-decal-dots-pos-rgb-500px.png' : 'https://a.ltrbxd.com/logos/letterboxd-decal-dots-pos-mono-500px.png'"
                 alt="Letterboxd"
                 class="letterboxd-icon">
          </div>
          <button class="btn btn-sm btn-success me-2" @click="rateMedia(topStructure(result))">Add New Rating</button>
          <button class="btn btn-sm btn-info me-2" @click="goToWikipedia()">Wikipedia</button>
        </div>

        <!-- Previous ratings if any -->
        <div v-if="getAllRatings(previousEntry)" class="ratings-and-comparison-wrapper mb-3">
          <div class="ratings-section">
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
                      <!-- Edit sits BEFORE delete, and is the safer of the two
                           on purpose. Bug report 2026-08-25 (Natalie): "I rate
                           a movie and then I don't feel like it's right so I
                           go to rewrite it, so I delete the rating, but then I
                           forget to." Delete-and-retype was the only way to
                           change a rating; the gap between the two steps is
                           where the rating went missing. -->
                      <div class="btn btn-sm btn-secondary me-1" @click="editRating(index)">Edit Rating</div>
                      <div :id="`delete-button-${result.dbKey}-${index}`" class="delete-button btn btn-sm btn-warning" @click="showConfimDeleteButton(result.dbKey, index)">Delete Rating</div>
                      <div :id="`confirm-delete-button-${result.dbKey}-${index}`" class="confirm-delete-button d-none col-12 d-flex justify-content-between align-items-center">
                        <p class="m-0">Are you sure?</p>
                        <div>
                          <div class="btn btn-sm btn-info me-1" @click="showDeleteButton(result.dbKey, index)">Nevermind</div>
                          <div class="btn btn-sm btn-danger" @click="deleteRating(previousEntry, index)">Yes, Delete</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Last Higher Rated Movie Poster -->
          <div v-if="lastHigherRatedMovie" class="comparison-poster-section">
            <h4>Best since</h4>
            <div class="poster-with-overlay" @click="navigateToMovie(lastHigherRatedMovie.movie.id)">
              <img
                :src="`https://image.tmdb.org/t/p/w342${getPosterPath(lastHigherRatedMovie)}`"
                :alt="lastHigherRatedMovie.movie.title"
                class="comparison-poster">
            </div>
            <div class="time-below-poster">({{ formatTimeDifference(lastHigherRatedMovie.movie.release_date, movie.release_date) }} prior)</div>
          </div>
        </div>

        <!-- Directors -->
        <div class="directors mb-3">
          <h4>
            Director<span v-if="multipleEntries(getCrewMember('Director', true))">s</span>
          </h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Director', 'strict')" :key="index" class="link" @click.stop="searchFor(name, 'director')">
              {{name}}<span v-if="countDirector(name)" class="small-count-bubble">&nbsp;({{ countDirector(name) }})</span><span v-if="index !== getCrewMember('Director', 'strict').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Genres -->
        <div class="genres mb-3">
          <h4>Genre<span v-if="multipleEntries(turnArrayIntoList(topStructure(result).genres, 'name'))">s</span></h4>
          <p class="long-list">
            <a
              v-for="(genre, index) in topStructure(result).genres"
              :key="index"
              class="link me-2"
              @click.stop="searchFor(genre.name, 'genre')"
            >
              {{genre.name}}<span v-if="countGenre(genre.name)" class="small-count-bubble">&nbsp;({{ countGenre(genre.name) }})</span>
            </a>
          </p>
        </div>

        <!-- Club friends who have rated this, as pills. Sits directly above
             Awards by request (2026-08-25). -->
        <FriendsWhoSaw :tmdbId="movie && movie.id" />

        <!-- Awards -->
        <div v-if="academyAwardWins.length || academyAwardNominations.length || personalAwardWins.length || personalAwardNominations.length || otherAwardWins.length || otherAwardNominations.length" class="awards mb-3">
          <h4>Awards</h4>
          <div class="awards-body">
            <div v-if="personalAwardWins.length || personalAwardNominations.length" class="award-group personal-awards">
              <h5>{{ personalAwardSectionTitle }}</h5>
              <h6 v-if="personalAwardWins.length">Won</h6>
              <div v-if="personalAwardWins.length" class="winners">
                <a v-for="award in personalAwardWins" :key="award.id" class="link col-12" @click="openPersonalAwardsYear(award.year)">
                  {{award.category}}
                  <span v-if="award.names">({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
              <h6 v-if="personalAwardNominations.length">Nominated</h6>
              <div v-if="personalAwardNominations.length" class="nominees">
                <a v-for="award in personalAwardNominations" :key="award.id" class="link col-12" @click="openPersonalAwardsYear(award.year)">
                  {{award.category}}
                  <span v-if="award.names">({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
            </div>

            <div v-if="academyAwardWins.length || academyAwardNominations.length" class="award-group academy-awards">
              <h5>Academy Awards</h5>
              <h6 v-if="academyAwardWins.length">Won</h6>
              <div v-if="academyAwardWins.length" class="winners">
                <a v-for="award in academyAwardWins" :key="award.id" class="link col-12" @click="goToWikipedia(award.ceremony)">
                  {{award.category}}
                  <span v-if="award.isActing" >({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
              <h6 v-if="academyAwardNominations.length">Nominated</h6>
              <div v-if="academyAwardNominations.length" class="nominees">
                <a v-for="award in academyAwardNominations" :key="award.id" class="link col-12" @click="goToWikipedia(award.ceremony)">
                  {{award.category}}
                  <span v-if="award.isActing" >({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
            </div>

            <div v-if="otherAwardWins.length || otherAwardNominations.length" class="award-group other-awards">
              <h5>Other Ceremonies</h5>
              <h6 v-if="otherAwardWins.length">Won</h6>
              <div v-if="otherAwardWins.length" class="winners">
                <a v-for="award in otherAwardWins" :key="award.id" class="link col-12" @click="goToWikipedia(award.wikipediaQuery)">
                  {{award.ceremony}} &middot; {{award.category}}
                  <span v-if="award.names">({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
              <h6 v-if="otherAwardNominations.length">Nominated</h6>
              <div v-if="otherAwardNominations.length" class="nominees">
                <a v-for="award in otherAwardNominations" :key="award.id" class="link col-12" @click="goToWikipedia(award.wikipediaQuery)">
                  {{award.ceremony}} &middot; {{award.category}}
                  <span v-if="award.names">({{parseNamesToList(award.names)}})</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Cast -->
        <div v-if="topStructure(result).cast && topStructure(result).cast.length" class="cast mb-3">
          <h4 class="d-flex align-items-center">
            Cast
            <!-- The Web (2026-09-08): this film's people and their other
                 films, as a picture you can walk. -->
            <button type="button" class="web-link btn btn-sm btn-link p-0 ms-2" aria-label="See this film's web" @click.stop="openWeb">
              <i class="bi bi-diagram-3"></i>
            </button>
          </h4>
          <p class="long-list">
            <a v-for="(castMember, index) in topStructure(result).cast" :key="index" class="link" @click.stop="searchFor(castMember.name, 'cast')">
              {{castMember.name}}<span v-if="countCastCrew(castMember.name)" class="small-count-bubble">&nbsp;({{ countCastCrew(castMember.name) }})</span><span v-if="index !== topStructure(result).cast.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Keywords -->
        <div v-if="(topStructure(result).flatKeywords && topStructure(result).flatKeywords.length) || isEditingKeywords" class="keywords mb-3">
          <div class="keywords-header d-flex align-items-center">
            <h4 class="mb-0 me-2">Keyword<span v-if="multipleEntries(topStructure(result).flatKeywords)">s</span></h4>
            <button
              type="button"
              class="keyword-edit-toggle btn btn-sm btn-link p-0"
              :aria-label="isEditingKeywords ? 'Close keyword editor' : 'Edit keywords'"
              @click.stop="toggleKeywordEditor">
              <i :class="isEditingKeywords ? 'bi bi-check-lg' : 'bi bi-pencil'"></i>
            </button>
          </div>

          <p v-if="!isEditingKeywords" class="long-list">
            <a v-for="(keyword, index) in sortedFlatKeywords" :key="index" class="link" @click.stop="searchFor(keyword, 'keyword')">
              {{keyword}}<span class="small-count-bubble">&nbsp;({{ keywordCounts[keyword] }})</span><span v-if="index !== topStructure(result).flatKeywords.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>

          <div v-else class="keyword-editor">
            <div class="keyword-chip-list">
              <span v-for="(keyword, index) in sortedFlatKeywords" :key="`chip-${index}`" class="keyword-chip">
                <span class="keyword-chip-label">{{ keyword }}</span>
                <button
                  type="button"
                  class="keyword-chip-remove"
                  :aria-label="`Remove ${keyword}`"
                  @click.stop="removeKeyword(keyword)">
                  <i class="bi bi-x"></i>
                </button>
              </span>
              <span v-if="!sortedFlatKeywords.length" class="text-muted small">No keywords yet — add one below.</span>
            </div>

            <div class="keyword-add-row">
              <input
                v-model="keywordInput"
                type="text"
                class="form-control form-control-sm keyword-add-input"
                placeholder="Add keyword…"
                autocomplete="off"
                @keydown.enter.prevent="addTypedKeyword"
                @keydown.esc.prevent="closeKeywordEditor"/>
            </div>

            <ul v-if="keywordSuggestions.length" class="keyword-suggestion-list">
              <li
                v-for="suggestion in keywordSuggestions"
                :key="`sug-${suggestion.name}`"
                class="keyword-suggestion-item"
                @click.stop="addKeyword(suggestion.name)">
                <span class="keyword-suggestion-name">{{ suggestion.name }}</span>
                <span class="small-count-bubble">({{ suggestion.count }})</span>
              </li>
            </ul>

            <button
              v-if="canCreateTypedKeyword"
              type="button"
              class="btn btn-sm btn-outline-light keyword-create-new"
              @click.stop="addTypedKeyword">
              Add new keyword "{{ trimmedKeywordInput }}"
            </button>
          </div>
        </div>

        <!-- Box Office -->
        <div v-if="hasBoxOfficeInfo" class="box-office mb-3">
          <h4>Box Office</h4>
          <p class="long-list mb-0">
            <span v-if="movieBudget">Budget: {{ formatCurrency(movieBudget) }}</span>
            <br v-if="movieBudget && movieRevenue">
            <span v-if="movieRevenue">Box Office: {{ formatCurrency(movieRevenue) }}</span>
          </p>
        </div>

        <!-- Production countries (TMDB): whose film industry made it, which is
             a different fact from where the cameras were. Matt read "Made In"
             next to "Filmed In" and couldn't tell them apart (2026-09-08), so
             this uses the term IMDb and Letterboxd use. -->
        <div v-if="productionCountries.length" class="production-countries mb-3">
          <h4>Countr<span v-if="productionCountries.length > 1">ies</span><span v-else>y</span> of Origin</h4>
          <p class="long-list mb-0">{{ productionCountries.join(' · ') }}</p>
        </div>

        <!-- Where the story is set and where it was shot (Wikidata, see
             places.js). Plain text and a search, no map: tapping "Paris"
             runs a Cinema Roll search (Matt, 2026-09-08). -->
        <div v-if="narrativePlaces.length" class="places mb-3">
          <h4>Set In</h4>
          <p class="long-list mb-0">
            <a v-for="(place, index) in narrativePlaces" :key="`set-${index}`" class="link" @click.stop="searchFor(place, 'place')">
              {{ place }}<span class="small-count-bubble">&nbsp;({{ placeCounts[place] || 1 }})</span><span v-if="index !== narrativePlaces.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>
        <div v-if="filmingPlaces.length" class="places mb-3">
          <h4>Filmed In</h4>
          <p class="long-list mb-0">
            <a v-for="(place, index) in filmingPlaces" :key="`filmed-${index}`" class="link" @click.stop="searchFor(place, 'place')">
              {{ place }}<span class="small-count-bubble">&nbsp;({{ placeCounts[place] || 1 }})</span><span v-if="index !== filmingPlaces.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Tags -->
        <div v-if="(viewingTags && viewingTags.length) || isEditingTags" class="tags mb-3">
          <div class="tags-header d-flex align-items-center">
            <h4 class="mb-0 me-2">Tag<span v-if="multipleEntries(viewingTags)">s</span></h4>
            <button
              v-if="result && result.ratings && result.ratings.length"
              type="button"
              class="tag-edit-toggle btn btn-sm btn-link p-0"
              :aria-label="isEditingTags ? 'Close tag editor' : 'Edit tags'"
              @click.stop="toggleTagEditor">
              <i :class="isEditingTags ? 'bi bi-check-lg' : 'bi bi-pencil'"></i>
            </button>
          </div>

          <p v-if="!isEditingTags && viewingTags.length" class="long-list">
            <a v-for="(tag, index) in sortedTags" :key="index" class="link" @click.stop="searchForTag(tag)">
              {{tag}}<span class="small-count-bubble">&nbsp;({{ tagCounts[tag] }})</span><span v-if="index !== viewingTags.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>

          <div v-else-if="isEditingTags" class="tag-editor">
            <div v-for="(rating, ratingIndex) in orderedRatingsForEditor" :key="rating._editorKey" class="viewing-block">
              <button
                type="button"
                class="viewing-header"
                :aria-expanded="expandedViewingKeys[rating._editorKey] ? 'true' : 'false'"
                @click.stop="toggleViewingExpansion(rating._editorKey)">
                <span class="viewing-header-label">
                  <i :class="expandedViewingKeys[rating._editorKey] ? 'bi bi-chevron-down' : 'bi bi-chevron-right'"></i>
                  <span v-if="rating.medium" class="viewing-medium">{{ rating.medium }}</span>
                  <span v-if="rating.medium && rating.date">&nbsp;on&nbsp;</span>
                  <span v-if="rating.date">{{ formattedDate(rating.date) }}</span>
                  <span v-if="!rating.medium && !rating.date">Viewing {{ ratingIndex + 1 }}</span>
                </span>
                <span v-if="!expandedViewingKeys[rating._editorKey] && tagsForRating(rating).length" class="viewing-tag-preview">
                  {{ tagsForRating(rating).join(', ') }}
                </span>
              </button>

              <div v-if="expandedViewingKeys[rating._editorKey]" class="viewing-body">
                <div class="tag-chip-list">
                  <span v-for="tagTitle in tagsForRating(rating)" :key="`chip-${rating._editorKey}-${tagTitle}`" class="tag-chip">
                    <span class="tag-chip-label">{{ tagTitle }}</span>
                    <button
                      type="button"
                      class="tag-chip-remove"
                      :aria-label="`Remove ${tagTitle}`"
                      @click.stop="removeTagFromViewing(rating._editorKey, tagTitle)">
                      <i class="bi bi-x"></i>
                    </button>
                  </span>
                  <span v-if="!tagsForRating(rating).length" class="text-muted small">No tags on this viewing yet.</span>
                </div>

                <div class="tag-add-row">
                  <input
                    v-model="tagInputs[rating._editorKey]"
                    type="text"
                    class="form-control form-control-sm tag-add-input"
                    placeholder="Add tag…"
                    autocomplete="off"
                    @keydown.enter.prevent="addTypedTag(rating._editorKey)"
                    @keydown.esc.prevent="closeTagEditor"/>
                </div>

                <ul v-if="tagSuggestionsFor(rating._editorKey).length" class="tag-suggestion-list">
                  <li
                    v-for="suggestion in tagSuggestionsFor(rating._editorKey)"
                    :key="`sug-${rating._editorKey}-${suggestion.name}`"
                    class="tag-suggestion-item"
                    @click.stop="addTagToViewing(rating._editorKey, suggestion.name)">
                    <span class="tag-suggestion-name">{{ suggestion.name }}</span>
                    <span v-if="suggestion.count" class="small-count-bubble">({{ suggestion.count }})</span>
                  </li>
                </ul>

                <button
                  v-if="canCreateTypedTagFor(rating._editorKey)"
                  type="button"
                  class="btn btn-sm btn-outline-light tag-create-new"
                  @click.stop="addTypedTag(rating._editorKey)">
                  Add new tag "{{ trimmedTagInputFor(rating._editorKey) }}"
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Writers -->
        <div v-if="writers.length" class="writers mb-3">
          <h4>Writer<span v-if="multipleEntries(writers)">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in writers" :key="index" class="link" @click.stop="searchFor(name, 'writer')">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== writers.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Composers -->
        <div v-if="getCrewMember('Composer').length" class="composers mb-3">
          <h4>Composer<span v-if="multipleEntries(getCrewMember('Composer'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Composer')" :key="index" class="link" @click.stop="searchFor(name, 'composer')">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Composer').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Editors -->
        <div v-if="getCrewMember('Editor').length" class="editors mb-3">
          <h4>Editor<span v-if="multipleEntries(getCrewMember('Editor'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Editor')" :key="index" class="link" @click.stop="searchFor(name, 'editor')">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Editor').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Cinematographers -->
        <div v-if="getCrewMember('Photo').length" class="cinematographers mb-3">
          <h4>Cinematographer<span v-if="multipleEntries(getCrewMember('Photo'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Photo')" :key="index" class="link" @click.stop="searchFor(name, 'photo')">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Photo').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Production Companies -->
        <div v-if="topStructure(result).production_companies && topStructure(result).production_companies.length" class="production-companies mb-3">
          <h4>Production <span v-if="multipleEntries(turnArrayIntoList(topStructure(result).production_companies, 'name'))">Companies</span><span v-else>Company</span></h4>
          <p class="long-list">
            <a v-for="(productionCompany, index) in topStructure(result).production_companies" :key="index" class="link" @click.stop="searchFor(productionCompany.name, 'company')">
              {{productionCompany.name}}<span v-if="countStudios(productionCompany.name)" class="small-count-bubble">&nbsp;({{ countStudios(productionCompany.name) }})</span><span v-if="index !== topStructure(result).production_companies.length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Producers -->
        <div v-if="getCrewMember('Producer').length" class="producers mb-3">
          <h4>Producer<span v-if="multipleEntries(getCrewMember('Producer'))">s</span></h4>
          <p class="long-list">
            <a v-for="(name, index) in getCrewMember('Producer')" :key="index" class="link" @click.stop="searchFor(name, 'producer')">
              {{name}}<span v-if="countCastCrew(name)" class="small-count-bubble">&nbsp;({{ countCastCrew(name) }})</span><span v-if="index !== getCrewMember('Producer').length - 1">&nbsp;&nbsp;</span>
            </a>
          </p>
        </div>

        <!-- Choose Alternate Poster & Backdrop Section -->
        <div class="alternate-media-section mt-4 mb-4">
          <div class="text-center mb-3 d-flex justify-content-center gap-2">
            <button class="btn btn-sm btn-secondary" @click="togglePosterOptions">
              {{ showPosterOptions ? 'Hide' : 'Choose' }} Alternate Poster
            </button>
            <button class="btn btn-sm btn-secondary" @click="toggleBackdropOptions">
              {{ showBackdropOptions ? 'Hide' : 'Choose' }} Alternate Backdrop
            </button>
          </div>

          <!-- Poster Options Grid -->
          <div v-if="showPosterOptions">
            <div v-if="loadingPosters" class="text-center">
              <div class="spinner-border text-light" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
            </div>
            <div v-else-if="posterOptions.length === 0" class="text-center text-light">
              <p>No alternate posters available for this movie.</p>
            </div>
            <div v-else class="poster-options-grid">
              <div v-for="(poster, index) in posterOptions" :key="index"
                   class="poster-option"
                   :class="{ 'selected': isSelectedPoster(poster.file_path) }"
                   @click="selectPoster(poster.file_path)">
                <img :src="`https://image.tmdb.org/t/p/w342${poster.file_path}`"
                     :alt="`Poster option ${index + 1}`">
              </div>
            </div>
          </div>

          <!-- Backdrop Options Grid -->
          <div v-if="showBackdropOptions">
            <div v-if="loadingBackdrops" class="text-center">
              <div class="spinner-border text-light" role="status">
                <span class="visually-hidden">Loading...</span>
              </div>
            </div>
            <div v-else-if="backdropOptions.length === 0" class="text-center text-light">
              <p>No alternate backdrops available for this movie.</p>
            </div>
            <div v-else class="backdrop-options-grid">
              <div v-for="(backdrop, index) in backdropOptions" :key="index"
                   class="backdrop-option"
                   :class="{ 'selected': isSelectedBackdrop(backdrop.file_path) }"
                   @click="selectBackdrop(backdrop.file_path)">
                <img :src="`https://image.tmdb.org/t/p/w780${backdrop.file_path}`"
                     :alt="`Backdrop option ${index + 1}`">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-else class="loading-container">
      <div class="spinner-border text-light" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
    </div>
  </div>
</template>

<script>
import { navigationTarget } from '../utils/navigationTarget.js';
import { formatScore } from '../assets/javascript/formatScore.js';
import axios from 'axios';
import ToggleableRating from './ToggleableRating.vue';
import FriendsWhoSaw from './FriendsWhoSaw.vue';
import { getRating, getAllRatings } from "../assets/javascript/GetRating.js";
import ErrorLogService from "../services/ErrorLogService.js";
import LetterboxdUrlService from '../services/LetterboxdUrlService.js';
import { computeFlatKeywords } from '../utils/keywords.js';
import { buildTagSuggestions, canCreateNewTag } from '../utils/tags.js';
import { awardCategoryNameMap } from '../assets/javascript/personalAwardsCategories.js';
import { findOtherAwardsForMovie } from '../assets/javascript/otherAwards.js';
import { sortByAcademyCategoryOrder } from '../assets/javascript/academyAwards.js';
import { awardNameWithThe } from '../assets/javascript/personalAwards.js';
import { warmImageCache, posterUrl, backdropUrl } from '../assets/javascript/offlinePosterCache.js';
import { countDirectors, countCastCrew, countGenres, countKeywords, countStudios, countPlaces } from '../assets/javascript/entityCounts.js';
import { placeNames, PLACE_TYPES } from '../assets/javascript/places.js';
import { genreIdFor } from '../assets/javascript/tmdbGenres.js';
import { WRITER_JOBS } from '../assets/javascript/personRoleGroups.js';

export default {
  name: 'MovieDetail',
  components: {
    ToggleableRating,
    FriendsWhoSaw
  },
  data () {
    return {
      movie: null,
      result: null, // Will be constructed from movie data
      previousEntry: null,
      letterboxdData: null,
      getAllRatings,
      isLoading: false,
      showPosterOptions: false,
      loadingPosters: false,
      posterOptions: [],
      showBackdropOptions: false,
      loadingBackdrops: false,
      backdropOptions: [],
      isEditingKeywords: false,
      keywordInput: '',
      isEditingTags: false,
      tagInputs: {},
      expandedViewingKeys: {}
    };
  },
  created () {
    // Hide main header for this page
    this.$store.commit('setShowHeader', false);

    // Scroll to top when entering movie detail page
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;

    // Get movie data from route parameter - don't await to render immediately
    const tmdbId = this.$route.params.tmdbId;
    this.loadMovieData(tmdbId);
  },

  beforeUnmount () {
    // Show header again when leaving this page
    this.$store.commit('setShowHeader', true);
  },
  watch: {
    '$route.params.tmdbId': {
      handler (newId) {
        if (newId) {
          // Scroll to top
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
          // Reload movie data for new movie
          this.loadMovieData(newId);
        }
      }
    }
  },
  computed: {
    // Names wherever back will actually land, so the link can't lie.
    backLabel () {
      const back = this.$router?.options?.history?.state?.back;
      if (back && !back.startsWith('/movie/') && back !== this.$route?.fullPath) {
        return this.$router?.resolve?.(back)?.meta?.title || 'Back';
      }
      return 'Home';
    },
    overallRank () {
      // Optional-chained: test mounts (and early lifecycle) may lack the
      // getter; the badge simply doesn't render then.
      const ranked = this.$store?.getters?.allMediaSortedByRating || [];
      const rank = ranked.findIndex((media) => media.dbKey === this.result?.dbKey) + 1;
      return rank > 0 ? rank : null;
    },
    ordinalRank () {
      const n = this.overallRank;
      const suffix = (n % 10 === 1 && n % 100 !== 11) ? 'st' : (n % 10 === 2 && n % 100 !== 12) ? 'nd' : (n % 10 === 3 && n % 100 !== 13) ? 'rd' : 'th';
      return `${n}${suffix}`;
    },
    // Reads the locally-cached, already-normalized FULL Academy Awards
    // dataset (state.allAcademyAwards, fetched once at initializeDB — see
    // CLAUDE.md's "Full Academy Awards Dataset, Cached Locally") instead of
    // a live per-movie network call this page used to make on every visit.
    // Compared as strings on both sides — the API's `tmdb` field is a
    // numeric-looking string, and string comparison sidesteps any
    // Number()-coercion edge case (same reasoning as
    // connectionsGenerator.js's buildAcademyWinsByTmdbId, which hits this
    // exact same dataset). Being a plain computed (derived from this.movie
    // + the store) also structurally eliminates the stale-data-across-
    // navigation bug the old manually-managed `data().awardsData` field
    // used to need an explicit reset for — there's nothing to reset now.
    awardsForMovie () {
      if (!this.movie) return [];
      const movieId = String(this.movie.id);
      return (this.$store.state.allAcademyAwards || []).filter((award) => String(award.tmdb) === movieId);
    },
    academyAwardWins () {
      return sortByAcademyCategoryOrder(this.awardsForMovie.filter((award) => award.isWinner));
    },
    academyAwardNominations () {
      return sortByAcademyCategoryOrder(this.awardsForMovie.filter((award) => !award.isWinner));
    },
    // TMDB's /movie/{id} response already includes budget/revenue (both USD,
    // 0 meaning "not available" - TMDB doesn't distinguish that from a
    // genuinely free production), and AddRating.js now stores them alongside
    // everything else it already pulls from that same response - no extra
    // network call. Only movies rated/re-rated after that change have these
    // fields locally; older entries just render nothing here (same
    // graceful-degradation convention every other optional section on this
    // page already follows, e.g. Cast/Keywords/Production Companies).
    movieBudget () {
      return this.movie?.budget || 0;
    },
    movieRevenue () {
      return this.movie?.revenue || 0;
    },
    hasBoxOfficeInfo () {
      return this.movieBudget > 0 || this.movieRevenue > 0;
    },
    productionCountries () {
      return (this.movie?.production_countries || [])
        .map((country) => country?.name)
        .filter(Boolean);
    },
    narrativePlaces () {
      return placeNames(this.movie, PLACE_TYPES.NARRATIVE);
    },
    filmingPlaces () {
      return placeNames(this.movie, PLACE_TYPES.FILMING);
    },
    // (N) badges like the keyword ones: how many films in the library touch
    // the place, either way.
    placeCounts () {
      return countPlaces(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    // My personal awards (PersonalAwardsModal.vue) — settings.personalAwards is
    // keyed by year, each year holding { categories: { <key>: { nominees, winner } } }.
    // Nominees/winner are "minimal" objects (convertNomineeToMinimal) carrying
    // movieId (a TMDB id, matching this.movie.id) plus a person's `name` when the
    // category is person-shaped (director/acting). Scans every year rather than
    // just the movie's release year because a personal award year can honor films
    // from more than one calendar year (see getMoviesForYear's own eligibility logic).
    personalAwardsByResult () {
      const empty = { wins: [], nominations: [] };
      if (!this.movie) return empty;

      const personalAwards = this.$store.state.settings?.personalAwards || {};
      const categoryNames = awardCategoryNameMap(personalAwards);
      const wins = [];
      const nominations = [];

      Object.keys(personalAwards)
        .sort((a, b) => Number(b) - Number(a))
        .forEach((year) => {
          const categories = personalAwards[year]?.categories || {};
          Object.keys(categories).forEach((categoryKey) => {
            const categoryData = categories[categoryKey];
            if (!categoryData) return;

            // Resolves custom awards too — an honorary award invented for
            // one year still has to name itself on the film that won it.
            const categoryName = categoryNames[categoryKey] || categoryKey;
            const matchingNominees = (categoryData.nominees || []).filter((nominee) => nominee && nominee.movieId === this.movie.id);
            const winnerMatches = Boolean(categoryData.winner && categoryData.winner.movieId === this.movie.id);
            const names = matchingNominees.map((nominee) => nominee.name).filter(Boolean);

            const entry = {
              id: `${year}-${categoryKey}`,
              year,
              category: categoryName,
              names: names.length ? names : null
            };

            if (winnerMatches) {
              wins.push(entry);
            } else if (matchingNominees.length) {
              nominations.push(entry);
            }
          });
        });

      return { wins, nominations };
    },
    personalAwardWins () {
      return this.personalAwardsByResult.wins;
    },
    personalAwardNominations () {
      return this.personalAwardsByResult.nominations;
    },
    // "Other" (non-Oscar) major ceremonies — see assets/javascript/otherAwards.js.
    // Statically bundled data (title + release year, no TMDB id available from the
    // source), matched against this movie by normalized title + year.
    otherAwardsForMovie () {
      if (!this.movie) return { wins: [], nominations: [] };
      return findOtherAwardsForMovie(this.movie);
    },
    otherAwardWins () {
      return this.otherAwardsForMovie.wins;
    },
    otherAwardNominations () {
      return this.otherAwardsForMovie.nominations;
    },
    // The user's configured personal award name (settings.personalAwardName,
    // default 'Oscar') — same grammar helper Home.vue/PersonalAwardsModal.vue
    // use, so this section's heading says e.g. "The Groskers" instead of a
    // hardcoded name.
    personalAwardSectionTitle () {
      return awardNameWithThe(this.$store.state.settings?.personalAwardName);
    },
    sortedFlatKeywords () {
      if (!this.topStructure(this.result)?.flatKeywords) return [];
      return [...this.topStructure(this.result).flatKeywords].sort((a, b) => {
        const countA = this.keywordCounts[a] || 0;
        const countB = this.keywordCounts[b] || 0;
        return countB - countA;
      });
    },
    keywordCounts () {
      return countKeywords(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },
    viewingTags () {
      // Unique viewing-tags across all ratings of this movie.
      if (!this.result || !this.result.ratings) return [];

      const allTags = this.result.ratings
        .flatMap(rating => rating.tags || [])
        .map(tag => tag.title)
        .filter(Boolean);

      return [...new Set(allTags)];
    },
    sortedTags () {
      if (!this.viewingTags || !this.viewingTags.length) return [];
      return [...this.viewingTags].sort((a, b) => {
        const countA = this.tagCounts[a] || 0;
        const countB = this.tagCounts[b] || 0;
        return countB - countA;
      });
    },
    tagCounts () {
      const counts = {};

      // Count how many times each tag appears across all movies in the database
      this.allEntriesWithFlatKeywordsAdded.forEach((result) => {
        if (!result.ratings) return;

        const tags = result.ratings
          .flatMap(rating => rating.tags || [])
          .map(tag => tag.title)
          .filter(Boolean);

        tags.forEach((tag) => {
          if (counts[tag]) {
            counts[tag]++;
          } else {
            counts[tag] = 1;
          }
        });
      });

      return counts;
    },

    trimmedKeywordInput () {
      return (this.keywordInput || '').trim();
    },

    orderedRatingsForEditor () {
      if (!this.result || !Array.isArray(this.result.ratings)) return [];
      // Most-recent first; stable index-based key so list reorders don't break v-for state.
      return this.result.ratings
        .map((rating, index) => ({ ...rating, _editorKey: `viewing-${index}`, _originalIndex: index }))
        .sort((a, b) => {
          const dateA = a.date ? new Date(a.date).getTime() : 0;
          const dateB = b.date ? new Date(b.date).getTime() : 0;
          return dateB - dateA;
        });
    },

    viewingTagVocabularyTitles () {
      const tagsByCategory = this.$store.state.settings && this.$store.state.settings.tags;
      const viewingTags = tagsByCategory && tagsByCategory['viewing-tags'];
      if (!viewingTags) return [];
      return Object.values(viewingTags)
        .map((t) => t && t.title)
        .filter(Boolean);
    },

    currentKeywordsLowercase () {
      return new Set(this.sortedFlatKeywords.map((k) => k.toLowerCase()));
    },

    keywordSuggestions () {
      const query = this.trimmedKeywordInput.toLowerCase();
      if (!query) return [];
      const currentSet = this.currentKeywordsLowercase;
      return Object.keys(this.keywordCounts)
        .filter((name) => name.toLowerCase().includes(query) && !currentSet.has(name.toLowerCase()))
        .sort((a, b) => (this.keywordCounts[b] || 0) - (this.keywordCounts[a] || 0))
        .slice(0, 10)
        .map((name) => ({ name, count: this.keywordCounts[name] || 0 }));
    },

    canCreateTypedKeyword () {
      const typed = this.trimmedKeywordInput;
      if (!typed) return false;
      if (this.currentKeywordsLowercase.has(typed.toLowerCase())) return false;
      const existsInLibrary = Object.keys(this.keywordCounts).some(
        (name) => name.toLowerCase() === typed.toLowerCase()
      );
      return !existsInLibrary;
    },

    // Count computed properties for proper tracking
    allEntriesWithFlatKeywordsAdded () {
      return this.$store.getters.allMediaAsArray.map((result) => {
        return {
          ...result,
          movie: {
            ...result.movie,
            flatKeywords: this.computeFlatKeywords(result.movie)
          }
        }
      });
    },

    // Whether short films (<=40min) count toward the badges below — mirrors
    // Home.vue's showShorts computed exactly (same default) so a badge's
    // number matches what clicking through to Home's filtered grid actually
    // shows, regardless of the "Include short films" setting.
    showShorts () {
      const value = this.$store.state.settings?.includeShorts;
      return typeof value === 'boolean' ? value : false;
    },

    /**
     * Every writing credit on this film, in credit order, one entry per person.
     *
     * Matched against WRITER_JOBS rather than the word "Writer", which is the
     * job title more than half the library has never carried. Deduped by name
     * because a novelist who also wrote the screenplay holds two credits and is
     * still one writer.
     */
    writers () {
      const crew = this.topStructure(this.result)?.crew;
      if (!Array.isArray(crew)) return [];
      const names = crew
        .filter((member) => WRITER_JOBS.includes(member?.job))
        .map((member) => member.name);
      return [...new Set(names)];
    },

    countsDirectors () {
      return countDirectors(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },

    countsCastCrew () {
      return countCastCrew(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },

    countsGenres () {
      return countGenres(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },

    countsStudios () {
      return countStudios(this.allEntriesWithFlatKeywordsAdded, this.showShorts);
    },

    lastHigherRatedMovie () {
      // Get the current movie's release date and rating
      const currentReleaseDate = this.movie?.release_date;
      const currentRating = this.ratingForMedia(this.result);

      if (!currentReleaseDate || !currentRating) {
        return null;
      }

      const currentDate = new Date(currentReleaseDate);

      // Get all movies released before this one
      const earlierMovies = this.allEntriesWithFlatKeywordsAdded
        .filter((result) => {
          const releaseDate = result.movie?.release_date;
          if (!releaseDate) return false;

          const movieDate = new Date(releaseDate);
          return movieDate < currentDate;
        })
        .filter((result) => {
          // Only include movies with a rating higher than current movie
          const rating = this.ratingForMedia(result);
          return rating > currentRating;
        })
        .sort((a, b) => {
          // Sort by release date descending (most recent first)
          const dateA = new Date(a.movie.release_date);
          const dateB = new Date(b.movie.release_date);
          return dateB - dateA;
        });

      // Return the most recent movie (first in the sorted array) that has a higher rating
      return earlierMovies.length > 0 ? earlierMovies[0] : null;
    },
  },
  methods: {
    formatScore,
    async loadMovieData (tmdbId) {
      try {
        // Wait for database to be loaded if it isn't already
        if (!this.$store.state.dbLoaded) {
          // Wait for database to load
          await new Promise((resolve) => {
            const unwatch = this.$watch(
              () => this.$store.state.dbLoaded,
              (newVal) => {
                if (newVal) {
                  unwatch();
                  resolve();
                }
              }
            );
          });
        }

        // Check if movie exists in user's database
        const allResults = this.$store.getters.allMediaAsArray || [];
        const existingMovie = allResults.find(r => r.movie?.id?.toString() === tmdbId);

        if (existingMovie) {
          this.movie = existingMovie.movie;
          this.result = existingMovie;
          this.previousEntry = existingMovie;
        } else {
          // Not in the library. In practice the only way here is a friend's
          // activity — a "Seth logged X" push lands on /movie/<id> whether or
          // not you've seen X (push-notify.js can't tell). Bug report
          // 2026-09-21: "When a friend logs a movie that isn't in my
          // library, tapping the notification should take me to my film
          // club." Home was the old fallback, which read as the tap doing
          // nothing at all.
          this.$router.push('/film-club');
          return;
        }

        // Load Letterboxd data if available
        await this.checkLetterboxdData();
      } catch (error) {
        console.error('Error loading movie data:', error);
        this.$router.push('/');
      }
    },

    goBack () {
      // Show loading state immediately
      this.isLoading = true;

      const target = navigationTarget({
        backPath: this.$router?.options?.history?.state?.back,
        currentPath: this.$route?.fullPath,
        parentPath: this.$route?.meta?.parent || '/',
        titleFor: (path) => this.$router?.resolve?.(path)?.meta?.title,
        avoid: ['/login']
      });

      // Tapping through cast members walks you movie → movie → movie, and
      // stepping back out one page at a time is nobody's idea of "back" —
      // that chain is why this always pushed home. It still does, but ONLY
      // for that case: arriving here from the Film Club or the watchlist now
      // returns you there instead of dumping you on the home screen.
      const cameFromAnotherMovie = target.useBack && target.path.startsWith('/movie/');

      if (target.useBack && !cameFromAnotherMovie) {
        this.$router.back();
        return;
      }

      // Home-specific handoffs: restore the scroll position it saved, and
      // feature this movie in its banner.
      this.$store.commit('setHomePageNavigationIntent', 'close');
      this.$store.commit('setBannerRequest', { type: 'movie', movieId: this.result && this.result.movie && this.result.movie.id });
      this.$router.push('/');
    },

    /**
     * Clicking a name, genre, keyword or studio on this page.
     *
     * These hand off as a TYPED chip, the way `searchForTag` always has.
     * They used to hand off as free text and lean on Home's
     * `detectFilterType` cascade to work out what they meant — which
     * happened to work, because a link's text is by definition an exact
     * entity name. That stopped being true on 2026-08-29, when typed text
     * became a plain search on purpose (Matt: "why do we need a name search
     * separate from a title search?"). A click is not typing: you tapped a
     * specific person on a specific film, so the type is known here and is
     * no longer worth re-deriving — and re-deriving it is exactly what would
     * drag in a film merely CALLED "Heist of the Lantern Thriller" when you
     * clicked the keyword "heist" (MovieDetailSearchLinks.test.js).
     */
    searchFor (query, type) {
      // Set navigation intent to scroll to top
      this.$store.commit('setHomePageNavigationIntent', 'search');

      // If the clicked value has a known type, promote its group to the top of
      // the grouped result hierarchy (e.g. clicking a keyword puts Keywords first).
      const groupKey = this.groupKeyForClickType(type);
      this.$store.commit('setHomePagePromoteGroup', groupKey);

      const chip = this.chipForClick(query, type);
      this.$store.commit('setHomePageSearchValue', chip ? '' : query);
      this.$store.commit('setHomePageSearchChips', chip ? [chip] : []);
      this.$store.commit('setHomePageScrollPosition', 0); // Scroll to top for new search
      // Feature a movie from the upcoming search results in the home banner.
      this.$store.commit('setBannerRequest', { type: 'fromResults' });
      this.$router.push('/');
    },
    /**
     * The chip a click means, or null to fall back to a plain search.
     *
     * Every crew role is a `person` chip: Home splits a person's results into
     * Director / Cast / Producer sections itself (personRoleGroups), so the
     * role is a display concern there, not a different question. `genreId`
     * rides along because a genre chip carries its identity from wherever it
     * was created (see Home's createFilterByType).
     */
    chipForClick (query, type) {
      const value = String(query || '').trim();
      if (!value) return null;

      const asPerson = ['director', 'cast', 'writer', 'composer', 'editor', 'photo', 'producer'];
      const stamp = (chipType, extra = {}) => ({
        id: `${chipType}-${Date.now()}`,
        type: chipType,
        value,
        display: value,
        ...extra
      });

      if (asPerson.includes(type)) return stamp('person');
      if (type === 'genre') return stamp('genre', { genreId: genreIdFor(value) });
      if (type === 'keyword') return stamp('keyword');
      if (type === 'company') return stamp('company');
      if (type === 'place') return stamp('place');
      // 'title' and anything unlabelled stay a plain search — a title IS the
      // free-text question, and an unknown click should not invent a filter.
      return null;
    },
    groupKeyForClickType (type) {
      // Maps the type of value clicked on the detail page to a grouped-result
      // group key. Returns null for unknown/typeless clicks (e.g. year).
      const map = {
        keyword: 'keyword-genre',
        genre: 'keyword-genre',
        place: 'place',
        director: 'director',
        cast: 'cast',
        producer: 'producer',
        company: 'company',
        title: 'title',
        writer: 'writer',
        composer: 'music',
        editor: 'editor',
        photo: 'cinematographer'
      };
      return map[type] || null;
    },

    searchForTag (tag) {
      // Set navigation intent to scroll to top
      this.$store.commit('setHomePageNavigationIntent', 'search');

      // Create a tag chip and navigate back to home
      const tagChip = {
        id: `tag-${Date.now()}`,
        type: 'tag',
        value: tag,
        display: `Tag: ${tag}`
      };
      this.$store.commit('setHomePageSearchValue', ''); // Clear search input
      this.$store.commit('setHomePageSearchChips', [tagChip]); // Set tag chip
      this.$store.commit('setHomePageScrollPosition', 0); // Scroll to top for new search
      this.$router.push('/');
    },

    rateMedia (movie) {
      this.$store.commit('setMovieToRate', movie);
      this.$router.push('/rate-movie');
    },

    // Amend an existing viewing instead of logging a new one. Order matters:
    // setMovieToRate CLEARS ratingToEdit (so a plain "Add New Rating" can
    // never inherit a stale target), so the target is set after it.
    editRating (index) {
      this.$store.commit('setMovieToRate', this.topStructure(this.result));
      this.$store.commit('setRatingToEdit', { dbKey: this.result.dbKey, index });
      this.$router.push('/rate-movie');
    },

    // Copy over all the helper methods from DBGridLayoutSearchResult
    getYear (media) {
      const date = media?.movie?.release_date;
      return date ? new Date(date).getFullYear() : 'Unknown';
    },

    prettifyRuntime (result) {
      const runtime = result?.movie?.runtime;
      if (!runtime) return 'Runtime unknown';

      const hours = Math.floor(runtime / 60);
      const minutes = runtime % 60;

      if (hours > 0) {
        return `${hours}h ${minutes}m`;
      } else {
        return `${minutes}m`;
      }
    },

    multipleEntries (array) {
      return Array.isArray(array) && array.length > 1;
    },

    formatCurrency (amount) {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
    },

    turnArrayIntoList (array, key) {
      if (!Array.isArray(array)) return [];
      return key ? array.map(item => item[key]) : array;
    },

    getCrewMember (job, strict = false) {
      if (!this.topStructure(this.result)?.crew) return [];
      const crew = this.topStructure(this.result).crew.filter(member => {
        if (strict === 'strict') {
          return member.job === job;
        }
        return member.job?.includes(job);
      });
      return crew.map(member => member.name);
    },

    ratingForMedia (result) {
      return this.mostRecentRating(result).calculatedTotal;
    },

    normalizedRatingForMedia (result) {
      return this.mostRecentRating(result).normalizedRating;
    },

    mostRecentRating (media) {
      return getRating(media);
    },

    formattedDate (date) {
      if (!date) return '';
      return new Date(date).toLocaleDateString();
    },

    // Same pattern as Insights.resumeAwards — jump straight into that year's
    // PersonalAwardsModal (bypassing the once-a-day gate) so tapping a personal
    // award on a movie's page doubles as a shortcut back into editing it.
    openWeb () {
      const id = this.topStructure(this.result)?.id;
      if (id) this.$router.push({ path: '/web', query: { movie: String(id) } });
    },
    openPersonalAwardsYear (year) {
      // Direct to the awards page — the old settings-flag handoff could
      // race the navigation and open nothing (see Insights.resumeAwards).
      this.$router.push({ path: '/awards', query: { year: Number(year) } });
    },

    parseNamesToList (names) {
      try {
        if (!names) return '';

        // If it's a string, return as-is
        if (typeof names === 'string') {
          return names;
        }

        // If it's an array
        if (Array.isArray(names)) {
          if (names.length === 0) return '';

          // Check if array contains objects with name property
          if (names[0] && typeof names[0] === 'object' && names[0].name) {
            return names.map((name) => name.name).join(', ');
          }

          // Array of strings
          return names.join(', ');
        }

        // Fallback for other types
        return String(names);
      } catch (error) {
        console.error('Failed to parse names:', error);
        return '';
      }
    },

    // Letterboxd integration methods
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

    goToWikipedia (query) {
      const searchTerm = query || this.topStructure(this.result)?.title;
      // Route through Wikipedia's "go to page, else search" endpoint rather
      // than a raw /wiki/<title> URL. Award ceremony titles are often
      // ordinal ("83rd Golden Globe Awards") and a guessed/approximate title
      // can miss — this still jumps straight to an exact match, but falls
      // back to a useful results list instead of a dead "page does not
      // exist" screen (see otherAwards.js's buildWikipediaQuery).
      const url = `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(searchTerm)}&go=Go`;
      window.open(url, '_blank');
    },

    topStructure (result) {
      if (!result?.movie) return null;
      return {
        ...result.movie,
        flatKeywords: this.computeFlatKeywords(result.movie)
      };
    },

    computeFlatKeywords,

    toggleKeywordEditor () {
      this.isEditingKeywords = !this.isEditingKeywords;
      if (!this.isEditingKeywords) {
        this.keywordInput = '';
      }
    },

    closeKeywordEditor () {
      this.isEditingKeywords = false;
      this.keywordInput = '';
    },

    async persistKeywordChange ({ customKeywords, removedKeywords }) {
      if (!this.result?.dbKey) return;
      const updated = {
        ...this.result,
        movie: {
          ...this.result.movie,
          customKeywords,
          removedKeywords
        }
      };

      try {
        // Leaf-path durable writes (StampGame's pattern) — the old
        // whole-entry setDBValue was lossy offline and could clobber
        // concurrent field changes (2026-08-15 offline audit).
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${this.result.dbKey}/movie/customKeywords`,
          value: customKeywords
        });
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${this.result.dbKey}/movie/removedKeywords`,
          value: removedKeywords
        });
        this.result = updated;
        if (this.previousEntry && this.previousEntry.dbKey === updated.dbKey) {
          this.previousEntry = updated;
        }
      } catch (error) {
        console.error('Error saving keyword change:', error);
        ErrorLogService.error('Error saving keyword change:', error);
      }
    },

    async removeKeyword (keyword) {
      if (!keyword || !this.result?.movie) return;
      const existingRemoved = this.result.movie.removedKeywords || [];
      const existingCustom = this.result.movie.customKeywords || [];

      const nextCustom = existingCustom.filter((k) => k !== keyword);
      const nextRemoved = existingRemoved.includes(keyword)
        ? existingRemoved
        : [...existingRemoved, keyword];

      await this.persistKeywordChange({
        customKeywords: nextCustom,
        removedKeywords: nextRemoved
      });
    },

    async addKeyword (keyword) {
      const trimmed = (keyword || '').trim();
      if (!trimmed || !this.result?.movie) return;

      const existingRemoved = this.result.movie.removedKeywords || [];
      const existingCustom = this.result.movie.customKeywords || [];

      const nextRemoved = existingRemoved.filter(
        (k) => k.toLowerCase() !== trimmed.toLowerCase()
      );

      const alreadyVisible = this.currentKeywordsLowercase.has(trimmed.toLowerCase());
      let nextCustom = existingCustom;
      if (!alreadyVisible && !existingCustom.some((k) => k.toLowerCase() === trimmed.toLowerCase())) {
        nextCustom = [...existingCustom, trimmed];
      }

      this.keywordInput = '';

      await this.persistKeywordChange({
        customKeywords: nextCustom,
        removedKeywords: nextRemoved
      });
    },

    addTypedKeyword () {
      const typed = this.trimmedKeywordInput;
      if (!typed) return;
      // Match any existing keyword case-insensitively so we don't create dupes
      const match = Object.keys(this.keywordCounts).find(
        (name) => name.toLowerCase() === typed.toLowerCase()
      );
      this.addKeyword(match || typed);
    },

    // --- Tag editor ---
    toggleTagEditor () {
      this.isEditingTags = !this.isEditingTags;
      if (this.isEditingTags) {
        // Auto-expand the most recent viewing
        const first = this.orderedRatingsForEditor[0];
        if (first) {
          this.expandedViewingKeys = { [first._editorKey]: true };
        }
      } else {
        this.tagInputs = {};
        this.expandedViewingKeys = {};
      }
    },

    closeTagEditor () {
      this.isEditingTags = false;
      this.tagInputs = {};
      this.expandedViewingKeys = {};
    },

    toggleViewingExpansion (editorKey) {
      this.expandedViewingKeys = {
        ...this.expandedViewingKeys,
        [editorKey]: !this.expandedViewingKeys[editorKey]
      };
    },

    tagsForRating (rating) {
      if (!rating || !Array.isArray(rating.tags)) return [];
      return rating.tags.map((t) => t && t.title).filter(Boolean);
    },

    trimmedTagInputFor (editorKey) {
      return ((this.tagInputs && this.tagInputs[editorKey]) || '').trim();
    },

    tagSuggestionsFor (editorKey) {
      const rating = this.orderedRatingsForEditor.find((r) => r._editorKey === editorKey);
      if (!rating) return [];
      return buildTagSuggestions({
        query: this.trimmedTagInputFor(editorKey),
        alreadyOnViewing: this.tagsForRating(rating),
        globalTagCounts: this.tagCounts,
        vocabularyTitles: this.viewingTagVocabularyTitles
      });
    },

    canCreateTypedTagFor (editorKey) {
      const rating = this.orderedRatingsForEditor.find((r) => r._editorKey === editorKey);
      if (!rating) return false;
      return canCreateNewTag({
        query: this.trimmedTagInputFor(editorKey),
        alreadyOnViewing: this.tagsForRating(rating),
        globalTagCounts: this.tagCounts,
        vocabularyTitles: this.viewingTagVocabularyTitles
      });
    },

    async persistRatingsChange (nextRatings) {
      if (!this.result || !this.result.dbKey) return;
      const updated = {
        ...this.result,
        ratings: nextRatings
      };
      try {
        // Leaf-path durable write — survives offline, can't clobber other
        // entry fields (2026-08-15 offline audit).
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${this.result.dbKey}/ratings`,
          value: nextRatings
        });
        this.result = updated;
        if (this.previousEntry && this.previousEntry.dbKey === updated.dbKey) {
          this.previousEntry = updated;
        }
      } catch (error) {
        console.error('Error saving tag change:', error);
        ErrorLogService.error('Error saving tag change:', error);
      }
    },

    async addVocabularyTagIfNew (title) {
      const trimmed = (title || '').trim();
      if (!trimmed) return;
      const exists = this.viewingTagVocabularyTitles.some(
        (n) => n.toLowerCase() === trimmed.toLowerCase()
      );
      if (exists) return;

      const newDbKey = `${new Date().getTime()}-${crypto.randomUUID()}`;
      try {
        await this.$store.dispatch('writeDurably', {
          path: `settings/tags/viewing-tags/${newDbKey}`,
          value: { title: trimmed }
        });
      } catch (error) {
        console.error('Error adding tag to vocabulary:', error);
        ErrorLogService.error('Error adding tag to vocabulary:', error);
      }
    },

    findRatingIndexByEditorKey (editorKey) {
      const found = this.orderedRatingsForEditor.find((r) => r._editorKey === editorKey);
      return found ? found._originalIndex : -1;
    },

    async addTagToViewing (editorKey, tagTitle) {
      const trimmed = (tagTitle || '').trim();
      if (!trimmed) return;
      const idx = this.findRatingIndexByEditorKey(editorKey);
      if (idx < 0 || !this.result || !Array.isArray(this.result.ratings)) return;

      const existing = this.result.ratings[idx].tags || [];
      const already = existing.some((t) => t && t.title && t.title.toLowerCase() === trimmed.toLowerCase());
      if (already) {
        this.tagInputs = { ...this.tagInputs, [editorKey]: '' };
        return;
      }

      const nextRatings = this.result.ratings.map((rating, i) => {
        if (i !== idx) return rating;
        return { ...rating, tags: [...existing, { title: trimmed }] };
      });

      this.tagInputs = { ...this.tagInputs, [editorKey]: '' };

      await this.addVocabularyTagIfNew(trimmed);
      await this.persistRatingsChange(nextRatings);
    },

    addTypedTag (editorKey) {
      const typed = this.trimmedTagInputFor(editorKey);
      if (!typed) return;
      const matchInCounts = Object.keys(this.tagCounts).find(
        (name) => name.toLowerCase() === typed.toLowerCase()
      );
      const matchInVocab = this.viewingTagVocabularyTitles.find(
        (name) => name.toLowerCase() === typed.toLowerCase()
      );
      this.addTagToViewing(editorKey, matchInCounts || matchInVocab || typed);
    },

    async removeTagFromViewing (editorKey, tagTitle) {
      if (!tagTitle) return;
      const idx = this.findRatingIndexByEditorKey(editorKey);
      if (idx < 0 || !this.result || !Array.isArray(this.result.ratings)) return;

      const existing = this.result.ratings[idx].tags || [];
      const nextTags = existing.filter(
        (t) => !(t && t.title && t.title.toLowerCase() === tagTitle.toLowerCase())
      );
      if (nextTags.length === existing.length) return;

      const nextRatings = this.result.ratings.map((rating, i) => {
        if (i !== idx) return rating;
        return { ...rating, tags: nextTags };
      });

      await this.persistRatingsChange(nextRatings);
    },

    getBackdropPath () {
      // Check if user has selected a custom backdrop
      return this.result?.customBackdropPath || this.movie?.backdrop_path;
    },

    // Rating deletion methods
    showConfimDeleteButton (dbKey, index) {
      const deleteButton = document.getElementById(`delete-button-${dbKey}-${index}`);
      const confirmDeleteButton = document.getElementById(`confirm-delete-button-${dbKey}-${index}`);

      deleteButton.classList.add('d-none');
      confirmDeleteButton.classList.remove('d-none');
    },

    showDeleteButton (dbKey, index) {
      const deleteButton = document.getElementById(`delete-button-${dbKey}-${index}`);
      const confirmDeleteButton = document.getElementById(`confirm-delete-button-${dbKey}-${index}`);

      deleteButton.classList.remove('d-none');
      confirmDeleteButton.classList.add('d-none');
    },

    deleteRating (entry, index) {
      let scratch = { ...entry };
      scratch.ratings.splice(index, 1);

      if (!scratch.ratings.length) {
        scratch = null;
      }

      // Durable: the old setDBValue deletion was lost offline, silently
      // RESURRECTING the deleted rating on reconnect (2026-08-15 audit).
      // Partial removals write the ratings leaf; removing the last rating
      // deletes the entry (writeDurably tombstones it for delta sync).
      const dbEntry = scratch === null
        ? { path: `movieLog/${entry.dbKey}`, value: null }
        : { path: `movieLog/${entry.dbKey}/ratings`, value: scratch.ratings };

      this.$store.dispatch('writeDurably', dbEntry);
      this.$store.commit('flashSaved', scratch === null ? 'Movie removed' : 'Viewing removed');
      document.querySelectorAll('.confirm-delete-button').forEach((button) => button.classList.add('d-none'));
      document.querySelectorAll('.delete-button').forEach((button) => button.classList.remove('d-none'));

      // Update local data to reflect the deletion
      if (scratch === null) {
        // Movie was completely removed, navigate back to home
        this.$router.push('/');
      } else {
        // Update local previousEntry data
        this.previousEntry = scratch;
      }
    },

    // Count methods using computed properties
    countDirector (name) {
      return this.countsDirectors[name] || 0;
    },

    countCastCrew (name) {
      return this.countsCastCrew[name] || 0;
    },

    countGenre (genre) {
      return this.countsGenres[genre] || 0;
    },

    countStudios (studio) {
      return this.countsStudios[studio] || 0;
    },

    formatTimeDifference (earlierDate, laterDate) {
      const earlier = new Date(earlierDate);
      const later = new Date(laterDate);
      const diffMs = later - earlier;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      // Less than 7 days: show in days
      if (diffDays < 7) {
        return diffDays === 1 ? '1 day' : `${diffDays} days`;
      }

      // Less than 60 days: show in weeks
      if (diffDays < 60) {
        const weeks = Math.round(diffDays / 7);
        return weeks === 1 ? '1 week' : `${weeks} weeks`;
      }

      // Less than 730 days (2 years): show in months
      if (diffDays < 730) {
        const months = Math.round(diffDays / 30);
        return months === 1 ? '1 month' : `${months} months`;
      }

      // Otherwise: show in years
      const years = Math.round(diffDays / 365);
      return years === 1 ? '1 year' : `${years} years`;
    },

    getPosterPath (result) {
      return result?.customPosterPath || result?.movie?.poster_path;
    },

    navigateToMovie (tmdbId) {
      // Navigate to the new movie detail page
      this.$router.push(`/movie/${tmdbId}`);
    },

    // Poster selection methods
    async togglePosterOptions () {
      this.showPosterOptions = !this.showPosterOptions;

      // If showing posters, hide backdrops
      if (this.showPosterOptions) {
        this.showBackdropOptions = false;

        if (this.posterOptions.length === 0) {
          await this.loadPosterOptions();
        }

        // Scroll to bring the poster options into view
        this.$nextTick(() => {
          const posterSection = document.querySelector('.poster-options-grid');
          if (posterSection) {
            const rect = posterSection.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const targetPosition = rect.top + scrollTop - 100;

            window.scrollTo({
              top: targetPosition,
              behavior: 'smooth'
            });
          }
        });
      }
    },

    async loadPosterOptions () {
      this.loadingPosters = true;

      try {
        const tmdbId = this.movie?.id;
        const apiKey = process.env.VUE_APP_TMDB_API_KEY;
        const imagesUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${apiKey}`;

        const response = await axios.get(imagesUrl);
        const posters = response.data.posters || [];

        // Detect user's language preference
        const userLanguage = this.getUserLanguage();

        // Filter posters by language - prioritize user's language, then null (no text), then others
        const languageFilteredPosters = posters.filter(poster =>
          poster.iso_3166_1 === userLanguage || poster.iso_3166_1 === null || poster.iso_3166_1 === 'null'
        );

        // Use filtered list if we have enough, otherwise fall back to all posters
        const postersToSort = languageFilteredPosters.length >= 6 ? languageFilteredPosters : posters;

        // Sort by vote_count (descending) and take top 6
        this.posterOptions = postersToSort
          .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
          .slice(0, 6);
      } catch (error) {
        console.error('Error fetching poster options:', error);
        ErrorLogService.error('Error fetching poster options:', error);
      } finally {
        this.loadingPosters = false;
      }
    },

    getUserLanguage () {
      // Get user's language from browser
      const browserLang = navigator.language || navigator.userLanguage;
      // Extract country code (e.g., "en-US" -> "US", "en-GB" -> "GB")
      const countryCode = browserLang.includes('-') ? browserLang.split('-')[1].toUpperCase() : 'US';
      return countryCode;
    },

    isSelectedPoster (posterPath) {
      const customPoster = this.result?.customPosterPath;
      return customPoster === posterPath || (!customPoster && posterPath === this.movie?.poster_path);
    },

    async selectPoster (posterPath) {
      try {
        // Local first, so the new poster is on screen the instant it is
        // tapped; the durable write follows. (It used to wait for the write
        // and then change, with nothing to say the tap had registered.)
        this.result.customPosterPath = posterPath;
        if (this.previousEntry) {
          this.previousEntry.customPosterPath = posterPath;
        }
        this.$store.commit('flashSaved', 'Poster saved');

        // Leaf-path durable write for the custom poster choice
        // (2026-08-15 offline audit).
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${this.result.dbKey}/customPosterPath`,
          value: posterPath
        });

        // Fire-and-forget: get the newly-chosen poster into the offline
        // image cache immediately rather than waiting for it to be viewed.
        warmImageCache([posterUrl(posterPath)]);
      } catch (error) {
        console.error('Error saving custom poster:', error);
        ErrorLogService.error('Error saving custom poster:', error);
      }
    },

    // Backdrop selection methods
    async toggleBackdropOptions () {
      this.showBackdropOptions = !this.showBackdropOptions;

      // If showing backdrops, hide posters
      if (this.showBackdropOptions) {
        this.showPosterOptions = false;

        if (this.backdropOptions.length === 0) {
          await this.loadBackdropOptions();
        }

        // Scroll to bring the backdrop options into view
        this.$nextTick(() => {
          const backdropSection = document.querySelector('.backdrop-options-grid');
          if (backdropSection) {
            const rect = backdropSection.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const targetPosition = rect.top + scrollTop - 100;

            window.scrollTo({
              top: targetPosition,
              behavior: 'smooth'
            });
          }
        });
      }
    },

    async loadBackdropOptions () {
      this.loadingBackdrops = true;

      try {
        const tmdbId = this.movie?.id;
        const apiKey = process.env.VUE_APP_TMDB_API_KEY;
        const imagesUrl = `https://api.themoviedb.org/3/movie/${tmdbId}/images?api_key=${apiKey}`;

        const response = await axios.get(imagesUrl);
        const backdrops = response.data.backdrops || [];

        // Detect user's language preference
        const userLanguage = this.getUserLanguage();

        // Filter backdrops by language - prioritize user's language, then null (no text), then others
        const languageFilteredBackdrops = backdrops.filter(backdrop =>
          backdrop.iso_3166_1 === userLanguage || backdrop.iso_3166_1 === null || backdrop.iso_3166_1 === 'null'
        );

        // Use filtered list if we have enough, otherwise fall back to all backdrops
        const backdropsToSort = languageFilteredBackdrops.length >= 6 ? languageFilteredBackdrops : backdrops;

        // Sort by vote_count (descending) and take top 6
        this.backdropOptions = backdropsToSort
          .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
          .slice(0, 6);
      } catch (error) {
        console.error('Error fetching backdrop options:', error);
        ErrorLogService.error('Error fetching backdrop options:', error);
      } finally {
        this.loadingBackdrops = false;
      }
    },

    isSelectedBackdrop (backdropPath) {
      const customBackdrop = this.result?.customBackdropPath;
      return customBackdrop === backdropPath || (!customBackdrop && backdropPath === this.movie?.backdrop_path);
    },

    async selectBackdrop (backdropPath) {
      try {
        // Local first (see selectPoster), then the durable write.
        this.result.customBackdropPath = backdropPath;
        if (this.previousEntry) {
          this.previousEntry.customBackdropPath = backdropPath;
        }
        this.$store.commit('flashSaved', 'Backdrop saved');

        // Update the movie entry in the database with the custom backdrop path
        // Leaf-path durable write for the custom backdrop choice
        // (2026-08-15 offline audit).
        await this.$store.dispatch('writeDurably', {
          path: `movieLog/${this.result.dbKey}/customBackdropPath`,
          value: backdropPath
        });

        // Update the movie data to immediately reflect the change
        if (this.movie) {
          this.movie.backdrop_path = backdropPath;
        }

        // Fire-and-forget: get the newly-chosen backdrop into the offline
        // image cache immediately rather than waiting for it to be viewed.
        warmImageCache([backdropUrl(backdropPath)]);
      } catch (error) {
        console.error('Error saving custom backdrop:', error);
        ErrorLogService.error('Error saving custom backdrop:', error);
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.movie-detail-page {
  background: #000;
  color: #fff;
}

.movie-header {
  position: relative;
  height: 200px;
  overflow: hidden;

  .backdrop-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  // Unified "Home" back affordance, matching Insights/RateMovie (caret + label,
  // top-left). Text-shadow keeps it legible over bright backdrops.
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

    &.loading {
      pointer-events: none;
    }

    .spinner-border-sm {
      width: 20px;
      height: 20px;
    }
  }

  .header-overlay {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;

    h1 {
      position: absolute;
      font-size: 2rem;
      margin: 0;
      bottom: 0;
      color: white;
      background-color: rgba(0, 0, 0, 0.5);
      padding: 6px 12px;
      right: 0;
    }
  }
}

.movie-content {
  margin: 0 auto;
  max-width: 650px;
  padding: 1rem;

  /* ---------------------------------------------------------------------
     Section accents (2026-08-17). The page was entirely flat black with grey
     labels and a Bootstrap-underlined link for every name, which made the
     underline the loudest thing on it. Every rule below is deliberately
     height-neutral: no new surfaces, no new padding, nothing removed. Matt:
     "I want all the information that's on there... I wouldn't want to get
     too much bulk here."

     The colours are NOT chosen for this page. The first attempt invented a
     hue per family and Matt read it exactly right — "the colors feel a
     little bit arbitrary" — not least because it used blue for people while
     blue already means Ratings elsewhere in the app. These are the app's own
     accents, carrying the meanings they already carry:

       purple  #cd7fe8  people   — Insights' People tab, where Favorite
                                   Directors/Actors/Composers/etc. live
       blue    #1D8BF1  ratings  — Insights' Ratings tab
       gold    #ffc107  awards   — wins throughout: Trophy Case, the Deep
                                   Stats crown, personal awards
       green   #6fd39b  labels   — genres, keywords and tags: the vocabulary
                                   you search your own library by. The one
                                   house choice here, kept in the family of
                                   Insights' Activity green.

     Production facts — box office, country, companies — get NO accent on
     purpose. They're TMDB's facts about the film rather than anything in
     your library's vocabulary, and the absence of colour is the signal. The
     links among them keep their default underline, so they still read as
     tappable.
     --------------------------------------------------------------------- */
  .directors, .cast, .writers, .composers,
  .editors, .cinematographers, .producers { --sec: #cd7fe8; }

  .genres, .keywords, .tags { --sec: #6fd39b; }

  .awards { --sec: #ffc107; }

  /* Every award name in gold was a wall of it — "we need to figure out how to
     break up the wall of yellow" (Insights, 2026-08-16). Gold now means won;
     nominated is a muted amber (#b9a06a, ~8:1 on this background). */
  .awards .nominees a.link { color: #b9a06a; }

  /* The ratings block is the Ratings tab's subject, so it takes that accent
     — on the labels only, since the scores themselves are the point. */
  .ratings-and-comparison-wrapper > .ratings-section > h4,
  .ratings-and-comparison-wrapper > .comparison-poster-section > h4 {
    color: #1D8BF1;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  a {
    color: white;
    cursor: pointer;
  }

  h4 {
    font-size: 0.75rem;
    margin-bottom: 2px;
    color: #fff;
  }

  /* Micro-label, matching .standout-facet on Deep Stats and .coverage-month
     on Insights. Smaller than what it replaces, so it costs no height. */
  .directors, .cast, .writers, .composers, .editors, .cinematographers,
  .producers, .genres, .keywords, .tags, .awards {
    > h4,
    > .tags-header > h4,
    > .keywords-header > h4 {
      color: var(--sec);
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    /* The underline was Bootstrap Reboot's, not a decision. Colour carries
       the "this is tappable" signal instead, and it reads far quieter across
       a list of fourteen editors. */
    a.link {
      color: var(--sec);
      text-decoration: none;
    }

    /* Mobile-first: press feedback is :active only — a tapped link on iOS
       keeps a :hover state forever, with no mouse to leave it. */
    a.link:active {
      opacity: 0.6;
    }

    .small-count-bubble {
      color: #9a9a9a;
    }
  }

  p {
    font-size: 1rem;
    margin-bottom: 1rem;
  }

  .pending-reconciliation-notice {
    background-color: #332701;
    border: 1px solid #ffc107;
    color: #ffe69c;
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    margin-bottom: 1rem;
    font-size: 0.9rem;

    a {
      color: #ffc107;
      font-weight: 600;
      margin-left: 0.5rem;
      text-decoration: underline;
    }
  }

  .rating-runtime-and-date {
    margin-bottom: 1rem;

    .rating-with-rank {
      align-items: baseline;
      display: flex;
      gap: 0.3rem;
    }


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
    .awards-body {
      max-height: 150px;
      overflow-y: auto;
      padding: 6px;
      box-shadow: inset 0 0 5px -2px rgb(0 0 0 / 50%);
    }

    .award-group {
      margin-bottom: 0.75rem;

      h5 {
        color: #adb5bd;
        font-size: 0.85rem;
        text-transform: uppercase;
        letter-spacing: 0.03em;
        margin-bottom: 0.25rem;
      }

      h6 {
        color: #6c757d;
        font-size: 0.75rem;
        margin-bottom: 0;
        padding-left: 6px;
      }
    }

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

  .keywords-header {
    margin-bottom: 2px;

    .keyword-edit-toggle {
      color: #fff;
      line-height: 1;
      min-width: 32px;
      min-height: 32px;

      i {
        font-size: 1rem;
      }
    }
  }

  .keyword-editor {
    padding: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);

    .keyword-chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .keyword-chip {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 4px 4px 4px 10px;
      border-radius: 999px;
      font-size: 0.85rem;
      line-height: 1.2;

      .keyword-chip-label {
        margin-right: 4px;
      }

      .keyword-chip-remove {
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        border: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;

        i {
          font-size: 0.9rem;
          line-height: 1;
        }
      }
    }

    .keyword-add-row {
      margin-bottom: 8px;
    }

    .keyword-add-input {
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #444;

      &::placeholder {
        color: #888;
      }
    }

    .keyword-suggestion-list {
      list-style: none;
      padding: 0;
      margin: 0 0 8px 0;
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid #333;
      border-radius: 4px;
    }

    .keyword-suggestion-item {
      padding: 8px 10px;
      color: #fff;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      justify-content: space-between;
      align-items: center;

      &:last-child {
        border-bottom: 0;
      }

      &:active {
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .keyword-create-new {
      width: 100%;
    }
  }

  .tags-header {
    margin-bottom: 2px;

    .web-link {
      color: #fff;
      line-height: 1;
      min-height: 28px;
      min-width: 28px;
      opacity: 0.8;
      &:active { opacity: 1; }
      i { font-size: 1rem; }
    }
    .tag-edit-toggle {
      color: #fff;
      line-height: 1;
      min-width: 32px;
      min-height: 32px;

      i {
        font-size: 1rem;
      }
    }
  }

  .tag-editor {
    padding: 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.06);

    .viewing-block {
      border: 1px solid #2a2a2a;
      border-radius: 4px;
      margin-bottom: 8px;
      background: rgba(0, 0, 0, 0.25);

      &:last-child {
        margin-bottom: 0;
      }
    }

    .viewing-header {
      width: 100%;
      text-align: left;
      background: transparent;
      color: #fff;
      border: 0;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 44px;

      .viewing-header-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.9rem;

        i {
          font-size: 0.85rem;
        }
      }

      .viewing-medium {
        font-weight: 600;
      }

      .viewing-tag-preview {
        font-size: 0.75rem;
        color: #ccc;
        padding-left: 20px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
    }

    .viewing-body {
      padding: 0 10px 10px 10px;
    }

    .tag-chip-list {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .tag-chip {
      display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 4px 4px 4px 10px;
      border-radius: 999px;
      font-size: 0.85rem;
      line-height: 1.2;

      .tag-chip-label {
        margin-right: 4px;
      }

      .tag-chip-remove {
        background: rgba(0, 0, 0, 0.35);
        color: #fff;
        border: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;

        i {
          font-size: 0.9rem;
          line-height: 1;
        }
      }
    }

    .tag-add-row {
      margin-bottom: 8px;
    }

    .tag-add-input {
      background: #1a1a1a;
      color: #fff;
      border: 1px solid #444;

      &::placeholder {
        color: #888;
      }
    }

    .tag-suggestion-list {
      list-style: none;
      padding: 0;
      margin: 0 0 8px 0;
      max-height: 180px;
      overflow-y: auto;
      border: 1px solid #333;
      border-radius: 4px;
    }

    .tag-suggestion-item {
      padding: 8px 10px;
      color: #fff;
      border-bottom: 1px solid #2a2a2a;
      display: flex;
      justify-content: space-between;
      align-items: center;

      &:last-child {
        border-bottom: 0;
      }

      &:active {
        background: rgba(255, 255, 255, 0.1);
      }
    }

    .tag-create-new {
      width: 100%;
    }
  }

  .ratings-and-comparison-wrapper {
    display: flex;
    gap: 1rem;
    align-items: flex-start;

    .ratings-section {
      flex: 1;
      min-width: 0; // Allow flex item to shrink below content size
    }

    .comparison-poster-section {
      flex-shrink: 0;
      width: 65px;

      h4 {
        margin-bottom: 0.35rem;
        font-size: 0.6rem;
      }

      .poster-with-overlay {
        cursor: pointer;
        border-radius: 3px;
        overflow: hidden;
        transition: transform 0.2s;
        margin-bottom: 0.25rem;

        &:hover {
          transform: scale(1.02);
        }

        .comparison-poster {
          width: 100%;
          display: block;
          aspect-ratio: 2/3;
          object-fit: cover;
        }
      }

      .time-below-poster {
        font-size: 0.5rem;
        color: #fff;
        text-align: right;
        line-height: 1.2;
      }
    }
  }

  .previous-ratings,
  .ratings-section {
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

  .small-count-bubble {
    bottom: 3px;
    /* 0.5rem was under the legibility floor; 0.62rem still sits inside the
       1rem line box, so lines don't grow. */
    font-size: 0.62rem;
    position: relative;
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
    }
  }
}

.loading-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 50vh;
}

// Alternate Media Section (Posters & Backdrops)
.alternate-media-section {
  .poster-options-grid,
  .backdrop-options-grid {
    gap: 0.5rem;
    padding: 0 0.5rem;
    min-height: 400px; // Fixed height to prevent jumping
  }

  .poster-options-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
  }

  .backdrop-options-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }
}

.poster-option,
.backdrop-option {
  position: relative;
  cursor: pointer;
  border: 2px solid transparent;
  border-radius: 4px;
  overflow: hidden;
  transition: all 0.2s;

  &:hover {
    border-color: #666;
  }

  &.selected {
    border-color: #6c757d;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
}

.poster-option {
  aspect-ratio: 2/3;
}

.backdrop-option {
  aspect-ratio: 16/9;
}
</style>