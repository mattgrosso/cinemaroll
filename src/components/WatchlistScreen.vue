<template>
  <div class="watchlist-screen">
    <BackLink/>
    <h1 class="watchlist-title">Watchlist</h1>
    <p class="watchlist-subtitle">Built from your own ratings — what to revisit, and what to see next.</p>

    <!-- Bug report (2026-08-27): "It'll be cool if I could have a prompt
         somewhere on the watchlist page where I could give it a prompt and it
         would give me back a watchlist tailored to that prompt."
         Everything below this is derived from ratings; this is the one place
         you can just say what you're in the mood for. -->
    <section class="watchlist-section prompt-section">
      <h2 class="section-title">Ask for something</h2>
      <p class="section-caption">Describe what you're in the mood for.</p>

      <form class="prompt-form" @submit.prevent="askForWatchlist">
        <input
          v-model="promptText"
          class="prompt-input"
          type="text"
          maxlength="300"
          autocomplete="off"
          :disabled="promptLoading"
          placeholder="something funny for a rainy Sunday"
          aria-label="Describe what you're in the mood for"
        >
        <button
          class="prompt-button"
          type="submit"
          :disabled="promptLoading || !promptText.trim()"
        >{{ promptLoading ? 'Thinking…' : 'Ask' }}</button>
      </form>

      <!-- Quota and failure both land here. The endpoint's own wording is
           used for a quota refusal, because it's the one that says when it
           comes back. -->
      <p v-if="promptError" class="section-caption prompt-error">{{ promptError }}</p>

      <p v-if="promptLoading" class="section-loading">Looking for something that fits&hellip;</p>
      <template v-else-if="promptResults.length">
        <p class="section-caption">For &ldquo;{{ promptAsked }}&rdquo;.</p>
        <WatchlistRow
          :items="mediaItems(promptResults)"
          :hat-note="`Asked for: ${promptAsked}`"
          @select="previewMedia"
          @hatted="puntAll"
        />
      </template>
      <p v-else-if="promptAsked && !promptError" class="section-loading">
        Nothing came back that you haven't already rated. Try asking differently.
      </p>
    </section>

    <!-- Bug report (2026-09-01): "It'll be nice if on watchlist I could type
         into the input a person like a director or an actor and get the full
         list their entire filmography... then I could go through and add them
         all to hat easily."

         Its own box rather than a second job for the prompt above: that one
         is an AI call that takes seconds and answers a mood, this is a name
         lookup that should come straight back. Deliberately NOT the treatment
         every other section here gets — no unseen-only filter, no quality
         ranking. The whole filmography, newest first, with the ones you've
         already rated marked (see personFilmography.js). -->
    <section class="watchlist-section person-section">
      <h2 class="section-title">Someone's filmography</h2>
      <p class="section-caption">A director or an actor — everything they've made.</p>

      <!-- The typeahead is the search bar's (Home.vue), narrowed to people:
           the directors and cast already in your library, ranked the same
           way and described the same way ("director · 4 films"). Bug report
           (Matt, 2026-09-01): "It would be nice if the filmography search
           could auto complete for me sort of like we do in the other search
           fields." A tap fills the name AND runs the lookup - there is no
           chip to build here, the name is the whole query. Anyone not in the
           library is still one Find away, exactly as before.

           Below the field rather than above it: this box sits mid-page with
           nothing re-filtering underneath, so the panel can take the natural
           reading direction. mousedown.prevent keeps a tap from blurring the
           input (and closing the panel) before the click lands. -->
      <form class="prompt-form person-form" @submit.prevent="searchPerson">
        <input
          ref="personInput"
          v-model="personQuery"
          class="prompt-input"
          type="text"
          maxlength="100"
          autocomplete="off"
          :disabled="personLoading"
          placeholder="Greta Gerwig"
          aria-label="A director or actor's name"
          @focus="personFocused = true"
          @blur="personFocused = false"
          @input="personTypeaheadDismissed = false"
          @keydown.esc="personTypeaheadDismissed = true"
        >
        <button
          class="prompt-button"
          type="submit"
          :disabled="personLoading || !personQuery.trim()"
        >{{ personLoading ? 'Looking…' : 'Find' }}</button>
        <div v-if="personTypeaheadOpen" class="typeahead-panel person-typeahead">
          <button
            v-for="suggestion in personSuggestions"
            :key="`${suggestion.kind}-${suggestion.value}`"
            type="button"
            class="typeahead-row"
            @mousedown.prevent
            @click="pickPersonSuggestion(suggestion)"
          >
            <span class="typeahead-term">{{ suggestion.value }}</span>
            <span class="typeahead-meta">{{ describeSuggestion(suggestion) }}</span>
          </button>
        </div>
      </form>

      <p v-if="personError" class="section-caption prompt-error">{{ personError }}</p>
      <p v-if="personLoading" class="section-loading">Looking up the filmography&hellip;</p>

      <!-- Names collide, and the app can't guess which one you meant. Shown
           only when there's a real choice to make; one match goes straight
           through to the films. -->
      <template v-else-if="personChoices.length">
        <p class="section-caption">Which one?</p>
        <div class="person-choices">
          <button
            v-for="person in personChoices"
            :key="person.id"
            type="button"
            class="person-choice"
            @click="choosePerson(person)"
          >
            <img v-if="person.profilePath" :src="`https://image.tmdb.org/t/p/w185${person.profilePath}`" :alt="person.name" class="person-choice-photo" loading="lazy">
            <span v-else class="person-choice-photo person-choice-photo-blank"><i class="bi bi-person-fill"></i></span>
            <span class="person-choice-name">{{ person.name }}</span>
            <span v-if="person.knownFor.length" class="person-choice-known">{{ person.knownFor.join(', ') }}</span>
            <span v-else-if="person.department" class="person-choice-known">{{ person.department }}</span>
          </button>
        </div>
      </template>

      <template v-else-if="personFilms.length">
        <p class="section-caption">
          {{ personName }} — {{ personProgress.total }} films,
          {{ personProgress.seen }} of them already rated.
        </p>
        <!-- personItems, not mediaItems: that one hides punted films, and a
             filmography that quietly drops entries isn't the entire one.
             No @hatted either — punting as you add would make the list you're
             working through shift under you. -->
        <WatchlistRow
          :items="personItems"
          :hat-note="`From ${personName}'s filmography`"
          @select="previewMedia"
        />
      </template>

      <p v-else-if="personSearched && !personError" class="section-loading">
        No films found for &ldquo;{{ personSearched }}&rdquo;.
      </p>
    </section>

    <!-- Local, always available: movies you loved but haven't logged in a
         long time. -->
    <section v-if="rewatchList.length" class="watchlist-section">
      <h2 class="section-title">Worth a rewatch</h2>
      <WatchlistRow :items="rewatchItems" puntable hat-note="Worth a rewatch" @select="goToMovie" @punt="punt" @hatted="puntAll"/>
    </section>

    <!-- Local, always available: movies the world loves more than you did
         (feedback: "if I rated something and didn't really love it, and
         the community loves it... should I give this another chance?"). -->
    <section v-if="anotherShotList.length" class="watchlist-section">
      <h2 class="section-title">Give these another shot</h2>
      <!-- "You were cool on them; the wider world wasn't" read backwards to
           Natalie (2026-08-16) — she took it as "I liked these and everyone
           else didn't". Say which way round it is in plain words. -->
      <p class="section-caption">You rated these low. Almost everyone else loves them.</p>
      <WatchlistRow :items="anotherShotItems" puntable hat-note="Worth a second look — rated low here, loved elsewhere" @select="goToMovie" @punt="punt" @hatted="puntAll"/>
    </section>

    <!-- TMDB-fed: well-regarded movies from years you've started but not
         finished (feedback: "I'm often trying to get my years up to 10 so I
         can fill in my awards").

         One section with a year selector, not one section per year (bug
         report, 2026-08-19: "it seems like an arbitrary number of lists...
         maybe there's a way to combine those into a single list with like a
         year selector above it... and then, if you could see on each one of
         those selectors, how close we actually are"). Every unfinished year
         is offered; each tab carries its own distance, so how the order was
         chosen is visible rather than guessed at. -->
    <section v-if="nearYears.length" class="watchlist-section">
      <h2 class="section-title">Get a year to {{ awardsThreshold }}</h2>
      <p class="section-caption">
        {{ selectedYearSummary.count }} rated in {{ selectedYear }} —
        {{ selectedYearSummary.missing }} to go for awards.
      </p>

      <!-- Closest to done on the left, so the most winnable year is the one
           you land on. Scrolls sideways like every other long row here. -->
      <div class="year-picker" role="tablist" aria-label="Choose a year to fill out">
        <button
          v-for="year in nearYears"
          :key="`year-tab-${year.year}`"
          type="button"
          role="tab"
          class="year-tab"
          :class="{ active: year.year === selectedYear }"
          :aria-selected="year.year === selectedYear"
          @click="selectYear(year.year)"
        >
          <span class="year-tab-year">{{ year.year }}</span>
          <span class="year-tab-gap">{{ year.missing }} to go</span>
        </button>
      </div>

      <p v-if="yearsLoading" class="section-loading">Looking up {{ selectedYear }}&hellip;</p>
      <WatchlistRow
        v-else-if="selectedYearMovies.length"
        :items="mediaItems(selectedYearMovies)"
        :hat-note="sectionHatNote({ year: selectedYear })"
        @select="previewMedia"
        @hatted="puntAll"
      />
      <p v-else class="section-loading">Nothing well-regarded found that you haven't already rated.</p>
    </section>

    <!-- TMDB-fed: unseen movies from the people your ratings favor. Tapping
         one opens its summary (2026-08-20); rating is the button inside that
         sheet, which then makes the same setMovieToRate + /rate-movie handoff
         PickMedia uses. -->
    <!-- Film Club picks: the strongest signal in the app, and until now it
         only existed on the per-friend comparison page. -->
    <section v-if="friendPickMedia.length" class="watchlist-section">
      <h2 class="section-title">Your Film Club loves these</h2>
      <p class="section-caption">Rated 8 or better by friends, never rated by you. Agreement sorts first.</p>
      <WatchlistRow :items="mediaItems(friendPickMedia)" hat-note="Loved by the film club" @select="previewMedia" @hatted="puntAll"/>
    </section>

    <section v-for="section in rankedSections" :key="section.key" class="watchlist-section">
      <h2 class="section-title">{{ section.title }}</h2>
      <p class="section-caption">
        Based on {{ section.names.join(', ') }}.
        <span v-if="section.record" class="section-record">{{ section.record.hits }} of {{ section.record.suggested }} watched</span>
      </p>
      <p v-if="section.loading" class="section-loading">Looking up filmographies&hellip;</p>
      <WatchlistRow v-else-if="section.movies.length" :items="mediaItems(section.movies)" :hat-note="sectionHatNote(section)" @select="previewMedia" @hatted="puntAll"/>
      <p v-else class="section-loading">Nothing new found — you've seen the good ones.</p>
    </section>

    <DrawFromHat/>

    <!-- One instance for every poster in every row: driven by which movie is
         set, so tapping along a row re-targets it rather than mounting and
         tearing down a sheet per poster. -->
    <MoviePreview :movie="previewing" @close="previewing = null" @rate="rateFromPreview"/>

    <p v-if="!$store.state.isOnline" class="watchlist-offline-note">
      You're offline — the "what to see next" lists need a connection, so only the rewatch list is shown.
    </p>
  </div>
</template>

<script>
// Bug-report request: "I should figure out how to generate watchlists based
// on my ratings and also maybe a way to make a list of movies that I should
// consider rewatching." All the judgment lives in discover.js (pure,
// tested); this screen fetches the TMDB filmographies for the top people
// and renders. Library crew/cast entries store names only (no TMDB person
// ids), so each person costs a /search/person + /movie_credits pair — six
// people means ~12 requests once per visit.
import axios from 'axios';
import BackLink from './games/BackLink.vue';
import WatchlistRow from './WatchlistRow.vue';
import DrawFromHat from './DrawFromHat.vue';
import MoviePreview from './MoviePreview.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { friendsLoveUnseen } from '../assets/javascript/social.js';
import { memoByIdentity } from '../utils/memoByIdentity.js';

// Pure in (my library, friend profiles), both cached getters; rebuilt on
// every open of the Watchlist before (~100ms desktop, 2026-09-23 sweep).
const friendPicksMemo = memoByIdentity((library, profiles) => friendsLoveUnseen(library, getRating, profiles));
import { rankSections, sourceSummary } from '../assets/javascript/recommendationStats.js';
import { rewatchCandidates, anotherShotCandidates, nearThresholdYears, favoritePeople, peopleYouRateHigher, rankWatchlistCandidates, dailyPick, ratedTmdbIds, topRatedSeeds, tasteProfile, puntKeyFor, nextPunt, isPunted, PEOPLE_PER_SECTION, MIN_PEOPLE_PER_SECTION } from '../assets/javascript/discover.js';
import { awardsYearThreshold } from '../assets/javascript/personalAwards.js';
import { formatScore } from '../assets/javascript/formatScore.js';
import { tasteSummary, pickTmdbMatch, buildPromptedList } from '../assets/javascript/promptedWatchlist.js';
import { personCandidates, filmographyFrom, filmographyProgress } from '../assets/javascript/personFilmography.js';
import { buildCatalog, typeaheadEntries } from '../assets/javascript/catalog.js';
import { rankTypeahead, describeSuggestion } from '../assets/javascript/searchSuggestions.js';
import { postToAi } from '../utils/aiRequest.js';

// Long enough to read the "added to <hat>" confirmation before the card that
// owns it leaves the list.
const PUNT_AFTER_HAT_MS = 4000;

// Each TMDB-fed row is ranked to this depth and kept, and the row on screen
// is dailyPick's slice of it (discover.js): punted and hatted films drop
// out first, and which of the best remaining ones show turns over daily.
// Bug report 2026-09-20 — the directors row was empty because its twelve
// were all already in a hat, and the rows never changed between visits.
const RANK_POOL = 36;

// The performer pool is resolved against TMDB (for gender and id) in rank
// order, this many names at a time, until both the actors and the
// actresses row have PEOPLE_PER_SECTION names or the pool runs out. A
// library that leans one way — a top twelve with one woman in it is what
// produced the one-name actresses row — keeps walking down its list
// instead of settling for whoever happened to be near the top.
const PERFORMER_LOOKUP_BATCH = 8;
// How deep that walk is allowed to go. Fifty names is ~7 batches at worst,
// and well past where a person still has enough loved films to matter.
const PERFORMER_POOL_CAP = 50;
// The rows built on people rather than films or genres — the ones that need
// MIN_PEOPLE_PER_SECTION names before they're worth showing.
const PEOPLE_SECTION_KEYS = new Set(['directors', 'actresses', 'actors', 'underrated']);

export default {
  name: 'WatchlistScreen',
  components: {
    BackLink,
    DrawFromHat,
    MoviePreview,
    WatchlistRow
  },
  data () {
    return {
      // Pending hat-punts, cleared on unmount — see puntAll.
      puntTimers: [],
      // The "ask for something" box. `promptAsked` is the request the results
      // on screen belong to, kept separate from what's currently typed so the
      // caption doesn't change under you while you edit.
      promptText: '',
      promptAsked: '',
      promptResults: [],
      promptLoading: false,
      promptError: '',
      // The "someone's filmography" box. `personSearched` is the name the
      // results belong to, kept apart from what's typed for the same reason
      // promptAsked is.
      personQuery: '',
      personSearched: '',
      personChoices: [],
      personName: '',
      personFilms: [],
      personLoading: false,
      personError: '',
      // The person typeahead is only open while its input has focus, and
      // Escape closes it until the next keystroke - the search bar's rules.
      personFocused: false,
      personTypeaheadDismissed: false,
      // The unrated movie whose summary sheet is open, or null.
      previewing: null,
      // Suggestions per year, keyed by year — { 1997: [...movies] }. Filled
      // one year at a time, as each is selected, and kept so switching back
      // to a year already looked at is instant and costs no second request.
      yearMovies: {},
      // Which year the picker is on. Null until the library has arrived and
      // defaultYear can pick the closest-to-done one.
      selectedYear: null,
      gemMovies: [],
      gemsLoading: true,
      yearsLoading: true,
      directorMovies: [],
      actorMovies: [],
      actressMovies: [],
      underratedMovies: [],
      actorNames: [],
      actressNames: [],
      underratedNames: [],
      similarMovies: [],
      directorsLoading: true,
      actorsLoading: true,
      similarLoading: true,
      // One-shot guard for the library watcher below.
      loaded: false
    };
  },
  computed: {
    rewatchItems () {
      return this.rewatchList.map((candidate) => ({
        key: candidate.entry.dbKey,
        title: candidate.entry.movie.title,
        poster: this.posterUrl(candidate.entry),
        // The poster already says which film it is; these say why it's here.
        // Two deliberate lines rather than one string left to wrap around the
        // X (bug report) — see WatchlistRow.
        metaLines: [formatScore(candidate.rating), this.yearsAgoLabel(candidate.yearsSince)],
        source: candidate.entry
      }));
    },
    anotherShotItems () {
      return this.anotherShotList.map((candidate) => ({
        key: candidate.entry.dbKey,
        title: candidate.entry.movie.title,
        poster: this.posterUrl(candidate.entry),
        metaLines: [`You ${formatScore(candidate.yours)}`, `World ${formatScore(candidate.community)}`],
        source: candidate.entry
      }));
    },
    library () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    // The people in your library, in the shape the search bar's typeahead
    // ranks (catalog.js). Shorts included: a filmography lookup is about the
    // person, and someone you only know from a short is still someone you
    // might want the rest of. Directors first, then cast, deduped - a
    // director who also acts is offered once, as a director.
    personTypeaheadIndex () {
      return typeaheadEntries(buildCatalog(this.library, true))
        .filter((entry) => entry.expectedType === 'director' || entry.expectedType === 'cast/crew');
    },
    personSuggestions () {
      return rankTypeahead(this.personTypeaheadIndex, this.personQuery);
    },
    personTypeaheadOpen () {
      return this.personFocused &&
        !this.personTypeaheadDismissed &&
        !this.personLoading &&
        this.personSuggestions.length > 0;
    },
    // How much of the person's filmography is already in the library — the
    // useful number when you're deciding what's left to hat.
    personProgress () {
      return filmographyProgress(this.personFilms);
    },
    // Same shape mediaItems produces, minus the punt filter. See the note in
    // the template: an "entire filmography" that silently drops films punted
    // from some other list on this page isn't the entire filmography.
    personItems () {
      return this.personFilms.map((film) => ({
        key: film.id,
        title: film.title,
        poster: film.poster_path ? `https://image.tmdb.org/t/p/w342${film.poster_path}` : null,
        metaLines: [film.note].filter(Boolean),
        // Greys the card and flags it (2026-09-01: "gray them out or put a
        // message that says already rated"). This is the only list on the
        // screen that can carry a seen film at all.
        seen: film.rated,
        source: film
      }));
    },
    punts () {
      return this.$store.state.settings?.watchlistPunts || {};
    },
    taste () {
      return tasteProfile(this.library, getRating);
    },
    // TMDB ids already sitting in one of your hats.
    hattedIds () {
      return this.$store.state.movieHatMovieIds || {};
    },
    /**
     * Everything a suggestion row should skip.
     *
     * Punted films are excluded INSIDE the candidate builders, before their
     * cap is applied — filtering the capped list afterwards is what left
     * these rows permanently short after a few punts (bug report).
     *
     * Hatted films join them, 2026-08-19: "In any watchlist, if a movie is
     * already present in one of my hats, it should not appear as a
     * suggestion so that includes the rewatch watchlist... anything where we
     * have a watchlist if I've already put it in a hat I don't need to be
     * suggested that movie anymore." Putting a film in a hat is a decision
     * made — the same reasoning that already punts a film when you hat it
     * from one of these rows, applied to hats filled anywhere else too.
     */
    skipFromSuggestions () {
      return (entry) => isPunted(entry, this.punts) || this.isHatted(entry);
    },
    /**
     * A ranked pool's showing for today. Reads punts and hat contents, so
     * hatting a film from a row promotes the next candidate at once rather
     * than leaving a gap until the next visit — and hat contents that land
     * after the pool was built are honoured the moment they do.
     */
    showing () {
      const exclude = this.skipFromSuggestions;
      return (pool) => dailyPick(pool || [], Date.now(), { exclude });
    },
    rewatchList () {
      return rewatchCandidates(this.library, getRating, Date.now(), { exclude: this.skipFromSuggestions });
    },
    anotherShotList () {
      return anotherShotCandidates(this.library, getRating, Date.now(), { exclude: this.skipFromSuggestions });
    },
    // Your three strongest genre affinities, named (for Hidden Gems). Two
    // until 2026-09-13 — the same "broader base" ask as the people rows.
    topTasteGenres () {
      const nameById = new Map();
      this.library.forEach((entry) => (entry.movie?.genres || []).forEach((g) => {
        if (g?.id != null && g?.name) nameById.set(g.id, g.name);
      }));
      return Object.entries(this.taste)
        .filter(([id]) => nameById.has(Number(id)))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([id]) => ({ id: Number(id), name: nameById.get(Number(id)) }));
    },
    // Every started-but-unfinished year, closest to done first. No longer
    // trimmed to a handful — the picker shows them all (see the template).
    nearYears () {
      return nearThresholdYears(this.library, awardsYearThreshold(this.$store.state.settings));
    },
    // The year the picker opens on: the one needing the fewest films, which
    // is simply the head of the list nearYears already sorted.
    defaultYear () {
      return this.nearYears[0]?.year ?? null;
    },
    // The selected year's own row from nearYears. Falls back to a zeroed
    // stand-in so the caption can render during the tick between the library
    // arriving and selectedYear being set.
    selectedYearSummary () {
      return this.nearYears.find((year) => year.year === this.selectedYear) || { count: 0, missing: 0 };
    },
    selectedYearMovies () {
      return this.showing(this.yearMovies[this.selectedYear]);
    },
    awardsThreshold () {
      return awardsYearThreshold(this.$store.state.settings);
    },
    favoriteDirectors () {
      return favoritePeople(this.library, getRating, { role: 'director' });
    },
    favoriteActors () {
      return favoritePeople(this.library, getRating, { role: 'actor' });
    },
    // Wide, because the top of the list could be all actors and leave the
    // actresses row with one name (or none). Walked in rank order by
    // resolvePerformersUntil, which stops once each row is full.
    favoritePerformerPool () {
      return favoritePeople(this.library, getRating, { role: 'actor', cap: PERFORMER_POOL_CAP });
    },
    underratedPerformers () {
      return peopleYouRateHigher(this.library, getRating, { role: 'actor' });
    },
    recommendationSeeds () {
      return topRatedSeeds(this.library, getRating);
    },
    // Film Club's strongest signal, previously stranded on the per-friend
    // comparison page: what your friends love that you've never rated.
    socialFriendKeys () {
      return this.$store.getters.socialFriendKeys || [];
    },
    friendPicks () {
      // Includes friends on other apps — a Movie Log friend's raves count
      // exactly like a Cinema Roll friend's.
      return friendPicksMemo(this.library, this.$store.getters.filmClubProfiles || {});
    },
    friendPickMedia () {
      return this.friendPicks.map((pick) => ({
        id: pick.id,
        title: pick.title,
        poster_path: pick.poster_path,
        note: pick.fanCount > 1
          ? `${pick.fanCount} friends · ${formatScore(pick.average)} avg`
          : `${pick.fans[0].name} · ${formatScore(pick.fans[0].rating)}`
      }));
    },
    peopleSections () {
      if (!this.$store.state.isOnline) return [];
      return [
        {
          key: 'directors',
          title: 'From directors you love',
          names: this.favoriteDirectors.map((p) => p.name),
          movies: this.showing(this.directorMovies),
          loading: this.directorsLoading
        },
        {
          key: 'actresses',
          title: 'From actresses you love',
          names: this.actressNames.map((p) => p.name),
          movies: this.showing(this.actressMovies),
          loading: this.actorsLoading
        },
        {
          key: 'actors',
          title: 'From actors you love',
          names: this.actorNames.map((p) => p.name),
          movies: this.showing(this.actorMovies),
          loading: this.actorsLoading
        },
        {
          // Not "who you rate highly" — who you rate higher than everyone
          // else does, which fills with different people entirely.
          key: 'underrated',
          title: 'From people you rate higher than most',
          names: this.underratedNames.map((p) => p.name),
          movies: this.showing(this.underratedMovies),
          loading: this.actorsLoading
        },
        {
          key: 'similar',
          title: 'More like your favorites',
          names: this.recommendationSeeds.map((entry) => entry.movie.title),
          movies: this.showing(this.similarMovies),
          loading: this.similarLoading
        },
        {
          key: 'gems',
          title: 'Hidden gems',
          names: this.topTasteGenres.map((g) => g.name),
          movies: this.showing(this.gemMovies),
          loading: this.gemsLoading
        }
      ].filter((section) => section.names.length >= (PEOPLE_SECTION_KEYS.has(section.key) ? MIN_PEOPLE_PER_SECTION : 1));
    },
    // Order by what has actually earned watches (recommendationStats.js).
    // Sources with no history sit at the neutral prior, so a new section
    // still gets a fair showing rather than being buried.
    sectionHatNoteMap () {
      // Plain language, readable by whoever draws it out of a shared hat —
      // so it says what Cinema Roll thought, not which code path ran.
      return {
        directors: 'From a director you love',
        actors: 'Starring an actor you love',
        actresses: 'Starring an actress you love',
        underrated: 'Starring someone you rate higher than most people do',
        similar: 'Like one of your favorites',
        gems: 'A hidden gem'
      };
    },
    rankedSections () {
      const sources = this.$store.state.settings?.watchlistLearning?.sources || {};
      return rankSections(this.peopleSections, sources).map((section) => ({
        ...section,
        record: sourceSummary(sources[section.key])
      }));
    }
  },
  beforeUnmount () {
    // A pending punt must not fire into a torn-down component.
    this.puntTimers.forEach((timer) => clearTimeout(timer));
    this.puntTimers = [];
  },
  created () {
    // Film Club picks need friends' published profiles; the watchlist is
    // reachable without ever visiting the club, so bootstrap them here too.
    this.$store.dispatch('attachSocialListeners');
    this.$store.dispatch('fetchFriendProfiles');
    this.$store.dispatch('syncExternalFriends');
    // Every row on this screen now hides films already in a hat, so the
    // contents have to be loaded for the screen itself — not left to whenever
    // the first SendToHat button happens to mount. Cached for ten minutes by
    // the action, so arriving here repeatedly costs nothing.
    this.$store.dispatch('ensureMovieHatContents')?.catch?.(() => {});
  },
  watch: {
    // Friend edges arrive asynchronously from the listener, so refetch when
    // the mutual set changes.
    socialFriendKeys: {
      handler (keys) {
        if (keys?.length) this.$store.dispatch('fetchFriendProfiles');
      }
    },
    // Same wait-for-the-library pattern as the games: a deep link mounts
    // before Firebase data arrives.
    library: {
      immediate: true,
      handler (entries) {
        if (this.loaded || !entries.length) return;
        this.loaded = true;
        this.buildWatchlists();
      }
    },
    // Rating a film from the picker can finish the very year you're looking
    // at, which drops it out of nearYears and would leave the tab strip with
    // nothing selected. Fall back to whatever is closest to done now.
    nearYears (years) {
      if (!years.length) return;
      if (years.some((year) => year.year === this.selectedYear)) return;
      this.selectYear(this.defaultYear);
    }
  },
  methods: {
    // TMDB-shaped lists (year fillers, Film Club picks, ranked sections).
    /**
     * Ask for a watchlist in words.
     *
     * The library is NOT sent - see promptedWatchlist.js for why. What goes
     * up is the request plus a one-line taste sketch; what comes back is
     * titles, which are resolved against TMDB here and filtered against what
     * has already been rated. That filtering is done locally on purpose: an
     * id against a Set is exact and free, where asking the model to avoid
     * 1,386 titles would mean sending it 1,386 titles and it would still slip.
     */
    /**
     * Look a person up by name. One clear match goes straight to their films;
     * anything ambiguous puts the chooser on screen instead of guessing.
     */
    describeSuggestion,
    /**
     * A tapped suggestion is the whole answer: put the name in the box and
     * go and get the filmography, no second tap on Find.
     */
    pickPersonSuggestion (suggestion) {
      this.personQuery = suggestion.value;
      this.personTypeaheadDismissed = true;
      this.$refs.personInput?.blur();
      return this.searchPerson();
    },
    async searchPerson () {
      const query = this.personQuery.trim();
      if (!query || this.personLoading) return;
      this.personTypeaheadDismissed = true;

      this.personLoading = true;
      this.personError = '';
      this.personChoices = [];
      this.personFilms = [];
      this.personName = '';

      try {
        const apiKey = process.env.VUE_APP_TMDB_API_KEY;
        const { data } = await axios.get(
          `https://api.themoviedb.org/3/search/person?api_key=${apiKey}&query=${encodeURIComponent(query)}`
        );
        const candidates = personCandidates(data?.results || []);
        this.personSearched = query;

        if (!candidates.length) return;
        if (candidates.length === 1) {
          await this.loadFilmography(candidates[0]);
          return;
        }
        this.personChoices = candidates;
      } catch (error) {
        console.error('Person search failed for', query, error);
        this.personError = "Couldn't look that name up just now. Try again in a moment.";
        this.personSearched = '';
      } finally {
        this.personLoading = false;
      }
    },
    async choosePerson (person) {
      this.personChoices = [];
      this.personLoading = true;
      try {
        await this.loadFilmography(person);
      } finally {
        this.personLoading = false;
      }
    },
    /**
     * Their whole filmography. `scoreFor` is passed rather than resolved
     * inside personFilmography.js so that module stays store-free and
     * unit-testable, the way the rest of assets/javascript is.
     */
    async loadFilmography (person) {
      try {
        const apiKey = process.env.VUE_APP_TMDB_API_KEY;
        const { data } = await axios.get(
          `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${apiKey}`
        );

        const byTmdbId = new Map();
        this.library.forEach((entry) => {
          if (entry?.movie?.id != null) byTmdbId.set(entry.movie.id, entry);
        });

        this.personFilms = filmographyFrom(data, {
          ratedIds: new Set(byTmdbId.keys()),
          scoreFor: (id) => {
            const rating = getRating(byTmdbId.get(id))?.calculatedTotal;
            return Number.isFinite(rating) ? formatScore(rating) : null;
          }
        });
        this.personName = person.name;
        this.personSearched = person.name;
      } catch (error) {
        console.error('Filmography lookup failed for', person.name, error);
        this.personError = "Couldn't load that filmography just now. Try again in a moment.";
      }
    },
    async askForWatchlist () {
      const ask = this.promptText.trim();
      if (!ask || this.promptLoading) return;

      this.promptLoading = true;
      this.promptError = '';
      this.promptResults = [];

      try {
        const entries = Object.values(this.$store.state.movieLog || {});
        const { data } = await postToAi('/watchlist', {
          prompt: ask,
          taste: tasteSummary(entries, getRating)
        });

        const suggestions = data?.movies || [];
        if (!suggestions.length) {
          this.promptAsked = ask;
          return;
        }

        const apiKey = process.env.VUE_APP_TMDB_API_KEY;
        const matches = await Promise.all(suggestions.map(async (suggestion) => {
          try {
            const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}`
              + `&query=${encodeURIComponent(suggestion.title)}`
              + (suggestion.year ? `&year=${suggestion.year}` : '');
            const res = await axios.get(url);
            return pickTmdbMatch(suggestion, res.data?.results || []);
          } catch {
            // One title failing to resolve should cost that one title, never
            // the whole list.
            return null;
          }
        }));

        this.promptResults = buildPromptedList(suggestions, matches, ratedTmdbIds(entries));
        this.promptAsked = ask;
      } catch (error) {
        // The endpoint says when a quota resets, so its own wording is better
        // than anything generic invented here.
        this.promptError = error?.response?.data?.error
          || "Couldn't get suggestions just now. Try again in a moment.";
        this.promptAsked = '';
      } finally {
        this.promptLoading = false;
      }
    },
    mediaItems (movies) {
      return this.notPunted(movies).map((media) => ({
        key: media.id,
        title: media.title || media.name || '',
        poster: media.poster_path ? `https://image.tmdb.org/t/p/w342${media.poster_path}` : null,
        // Only ever a reason to be here — never the title, which the poster
        // is already carrying.
        metaLines: [media.note || (media.matchPct ? `${media.matchPct}% match` : null)].filter(Boolean),
        source: media
      }));
    },
    posterUrl (entry) {
      const path = entry?.movie?.poster_path;
      return path ? `https://image.tmdb.org/t/p/w342${path}` : null;
    },
    // Not-yet punt: snoozes the item (60d, doubling per repeat punt) and
    // records it — the punt history is future threshold-tuning signal.
    // A movie you've put in a hat is a decision made; it shouldn't keep
    // showing up as a suggestion. Reuses the punt machinery rather than
    // inventing a second kind of hidden: it snoozes for 60 days and comes
    // back if you never got round to watching it.
    //
    // Deliberately delayed. The confirmation toast lives inside SendToHat,
    // which lives inside the card — so punting immediately unmounted the card,
    // took the toast with it, and you got no confirmation at all that
    // anything had happened. Waiting lets you read "X was added to Y" and
    // then watch it leave, which reads as cause and effect.
    puntAll (items) {
      const timer = setTimeout(() => {
        (items || []).forEach((item) => this.punt(item));
        this.puntTimers = this.puntTimers.filter((pending) => pending !== timer);
      }, PUNT_AFTER_HAT_MS);
      this.puntTimers.push(timer);
    },
    punt (item) {
      const key = puntKeyFor(item);
      if (!key) return;
      this.$store.dispatch('writeDurably', {
        path: `settings/watchlistPunts/${key}`,
        value: nextPunt(this.punts[key])
      });
    },
    // A TMDB id, from either shape this screen handles: a library entry
    // ({ movie: { id } }) or a raw TMDB result ({ id }).
    tmdbIdOf (media) {
      return media?.movie?.id ?? media?.id ?? null;
    },
    isHatted (media) {
      const id = this.tmdbIdOf(media);
      return id != null && Boolean(this.hattedIds[id]);
    },
    // Named for what it does now: drops punted AND already-hatted films, so
    // every discover row obeys the same rule as the two derived ones.
    notPunted (movies) {
      return (movies || []).filter((movie) => !isPunted(movie, this.punts) && !this.isHatted(movie));
    },
    dueLabel (candidate) {
      // Cycle-based (discover.js): 1.0 = exactly due.
      if (candidate.overdue >= 1.5) return 'long overdue';
      if (candidate.overdue >= 1) return 'due for a rewatch';
      return 'coming due';
    },
    yearsAgoLabel (years) {
      const rounded = Math.round(years);
      if (rounded < 1) return 'a while ago';
      return rounded === 1 ? 'a year ago' : `${rounded} years ago`;
    },
    // Year sections carry the year; the people sections carry their key.
    sectionHatNote (section) {
      if (section?.year) return `Filling out ${section.year}`;
      return this.sectionHatNoteMap[section?.key] || 'From your Cinema Roll watchlist';
    },
    goToMovie (entry) {
      if (entry?.movie?.id == null) return;
      this.$router.push(`/movie/${entry.movie.id}`);
    },
    // Bug report, 2026-08-20: "just clicking the poster should pull up some
    // kind of a summary of the movie so that I can investigate further."
    // These rows suggest films you HAVEN'T seen, so dropping straight into
    // the rating flow only ever made sense if you had.
    previewMedia (media) {
      if (media?.id == null) return;
      this.previewing = { id: media.id, title: media.title || media.name || '', poster_path: media.poster_path, source: media };
    },
    rateFromPreview (media) {
      this.previewing = null;
      this.rateMedia(media);
    },
    rateMedia (media) {
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
    async buildWatchlists () {
      if (!this.$store.state.isOnline) {
        this.gemsLoading = false;
        this.yearsLoading = false;
        this.directorsLoading = false;
        this.actorsLoading = false;
        this.similarLoading = false;
        return;
      }
      const rated = ratedTmdbIds(this.library);

      // The year picker opens on the closest-to-done year; only that one is
      // fetched now, the rest as they're tapped. Kicked off (not awaited)
      // alongside everything else below.
      if (this.selectedYear == null) this.selectedYear = this.defaultYear;
      const yearLoaded = this.loadSelectedYear();

      // Resolve gender first so the performer list can be split. The pool
      // is walked in rank order until each row has its full complement, so
      // a library whose top names skew one way still fills both rows.
      const performers = await this.resolvePerformersUntil(this.favoritePerformerPool, PEOPLE_PER_SECTION);
      this.actressNames = performers.filter((p) => p.gender === 1).slice(0, PEOPLE_PER_SECTION);
      this.actorNames = performers.filter((p) => p.gender === 2).slice(0, PEOPLE_PER_SECTION);
      this.underratedNames = await this.resolvePerformers(this.underratedPerformers);

      const [directorMovies, actressMovies, actorMovies, underratedMovies, similarMovies, gemMovies] = await Promise.all([
        this.moviesFromPeople(this.favoriteDirectors, 'crew', rated),
        this.moviesFromPeople(this.actressNames, 'cast', rated),
        this.moviesFromPeople(this.actorNames, 'cast', rated),
        this.moviesFromPeople(this.underratedNames, 'cast', rated),
        this.moviesLikeFavorites(this.recommendationSeeds, rated),
        this.hiddenGems(this.topTasteGenres, rated)
      ]);
      await yearLoaded;
      this.gemMovies = gemMovies;
      this.gemsLoading = false;
      this.directorMovies = directorMovies;
      this.directorsLoading = false;
      this.actressMovies = actressMovies;
      this.actorMovies = actorMovies;
      this.underratedMovies = underratedMovies;
      this.actorsLoading = false;
      this.similarMovies = similarMovies;
      this.similarLoading = false;

      // Learning loop: credit sources whose earlier suggestions have since
      // been rated, then record whatever is on screen now. Recording after
      // reconciling means a movie can't be credited in the same pass it was
      // first offered.
      //
      // Each step is guarded separately, and neither is allowed to take the
      // other down. Reconciling used to throw on every visit after the first
      // (it was handed a Set where it expected an array), and because the
      // dispatch is awaited, recording never ran again either — one type
      // error froze the entire learning loop. This is best-effort
      // bookkeeping; the lists are already on screen by this point, so
      // nothing here is worth failing the page for.
      try {
        await this.$store.dispatch('reconcileWatchlistLearning', rated);
      } catch (error) {
        console.error('Watchlist learning: reconcile failed', error);
      }

      try {
        // What's on screen — today's slice of each pool, not the pool.
        await this.$store.dispatch('recordWatchlistSuggestions', {
          directors: this.showing(directorMovies).map((movie) => movie.id),
          actors: this.showing(actorMovies).map((movie) => movie.id),
          similar: this.showing(similarMovies).map((movie) => movie.id),
          gems: this.showing(gemMovies).map((movie) => movie.id),
          friends: this.friendPickMedia.map((movie) => movie.id)
        });
      } catch (error) {
        console.error('Watchlist learning: recording failed', error);
      }
    },
    // Hidden Gems (Brian-survey D2): well-loved but little-seen — high
    // TMDB score, LOW vote count (the inverse of every popularity filter),
    // pulled from your two strongest taste genres.
    async hiddenGems (genres, rated) {
      const apiKey = process.env.VUE_APP_TMDB_API_KEY;
      const pools = await Promise.all((genres.length ? genres : [{ id: null }]).map(async ({ id }) => {
        try {
          const genreParam = id != null ? `&with_genres=${id}` : '';
          const response = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}${genreParam}&vote_average.gte=7.2&vote_count.gte=60&vote_count.lte=1200&sort_by=vote_average.desc&page=1`);
          return response.data?.results || [];
        } catch {
          return [];
        }
      }));
      const candidates = pools.flat().map((movie) => ({
        id: movie.id,
        title: movie.title,
        poster_path: movie.poster_path,
        release_date: movie.release_date,
        vote_average: movie.vote_average,
        vote_count: movie.vote_count,
        genre_ids: movie.genre_ids
      }));
      return rankWatchlistCandidates(candidates, rated, Date.now(), { cap: RANK_POOL, profile: this.taste, exclude: this.skipFromSuggestions });
    },
    // Per near-threshold year: TMDB discover, well-voted first, then the
    // shared unseen-only quality ranking.
    // One year's suggestions. Previously every year on screen was fetched
    // up front, which was affordable only because the list was capped at
    // three; now that the picker offers every unfinished year, this is
    // called for the selected one and its result cached in yearMovies.
    async moviesForYear (year, rated) {
      const apiKey = process.env.VUE_APP_TMDB_API_KEY;
      try {
        const response = await axios.get(`https://api.themoviedb.org/3/discover/movie?api_key=${apiKey}&primary_release_year=${year}&sort_by=vote_count.desc&vote_count.gte=200&page=1`);
        const candidates = (response.data?.results || []).map((movie) => ({
          id: movie.id,
          title: movie.title,
          poster_path: movie.poster_path,
          release_date: movie.release_date,
          vote_average: movie.vote_average,
          vote_count: movie.vote_count,
          popularity: movie.popularity
        }));
        return rankWatchlistCandidates(candidates, rated, Date.now(), { cap: RANK_POOL, profile: this.taste, exclude: this.skipFromSuggestions });
      } catch {
        return [];
      }
    },
    // Tapping a tab. Already-fetched years come back instantly from the
    // cache; a new one shows the section's loading line while it lands.
    async selectYear (year) {
      if (year == null || year === this.selectedYear) return;
      this.selectedYear = year;
      await this.loadSelectedYear();
    },
    async loadSelectedYear () {
      const year = this.selectedYear;
      if (year == null) return;
      if (this.yearMovies[year]) {
        this.yearsLoading = false;
        return;
      }
      if (!this.$store.state.isOnline) {
        this.yearsLoading = false;
        return;
      }
      this.yearsLoading = true;
      const movies = await this.moviesForYear(year, ratedTmdbIds(this.library));
      // Guard against a slow response for a year the user has already
      // tabbed away from — cache it, but don't lift the spinner on the year
      // now on screen, which has its own request in flight.
      this.yearMovies = { ...this.yearMovies, [year]: movies };
      if (this.selectedYear === year) this.yearsLoading = false;
    },
    // credits kind: 'crew' keeps only their Director credits; 'cast' keeps
    // reasonably-billed roles (order < 10) so cameos don't flood the list.
    async moviesFromPeople (people, kind, rated) {
      const apiKey = process.env.VUE_APP_TMDB_API_KEY;
      const allCredits = [];

      await Promise.all(people.map(async (person) => {
        try {
          // The gender pass has usually already resolved this id — reuse it
          // rather than searching for the same name twice.
          let personId = person.id;
          if (personId == null) {
            const search = await axios.get(`https://api.themoviedb.org/3/search/person?api_key=${apiKey}&query=${encodeURIComponent(person.name)}`);
            personId = search.data?.results?.[0]?.id;
          }
          if (personId == null) return;
          const credits = await axios.get(`https://api.themoviedb.org/3/person/${personId}/movie_credits?api_key=${apiKey}`);
          const list = kind === 'crew'
            ? (credits.data?.crew || []).filter((credit) => credit.job === 'Director')
            : (credits.data?.cast || []).filter((credit) => (credit.order ?? 99) < 10);
          allCredits.push(...list);
        } catch (error) {
          // Best-effort per person — one failed lookup shouldn't empty the list.
          console.error('Watchlist lookup failed for', person.name, error);
        }
      }));

      return rankWatchlistCandidates(allCredits, rated, Date.now(), { cap: RANK_POOL, profile: this.taste, exclude: this.skipFromSuggestions });
    },
    /**
     * Resolve gender (and id) for the top cast names, so the performer list
     * can be split. "There should be a separate one for actors and actresses"
     * (2026-08-17).
     *
     * The library doesn't carry gender — storedEntry.js trims it — so it has
     * to come from TMDB, the same way FavoriteActors/FavoriteActresses get
     * it. The id that comes back is kept and handed to moviesFromPeople, so
     * this costs no extra requests overall.
     */
    /**
     * resolvePerformers, a batch at a time down the ranked pool, stopping
     * as soon as both the actors and the actresses row have `quota` names.
     * Usually that's one or two batches; a lopsided library walks further
     * rather than shipping a one-name row.
     */
    async resolvePerformersUntil (pool, quota) {
      const resolved = [];
      const enough = () => resolved.filter((p) => p.gender === 1).length >= quota &&
        resolved.filter((p) => p.gender === 2).length >= quota;
      for (let start = 0; start < pool.length && !enough(); start += PERFORMER_LOOKUP_BATCH) {
        const batch = pool.slice(start, start + PERFORMER_LOOKUP_BATCH);
        resolved.push(...await this.resolvePerformers(batch));
      }
      return resolved;
    },
    async resolvePerformers (people) {
      const apiKey = process.env.VUE_APP_TMDB_API_KEY;

      return (await Promise.all(people.map(async (person) => {
        try {
          const search = await axios.get(`https://api.themoviedb.org/3/search/person?api_key=${apiKey}&query=${encodeURIComponent(person.name)}`);
          const match = search.data?.results?.[0];
          if (!match) return null;
          return { ...person, id: match.id, gender: match.gender };
        } catch (error) {
          console.error('Performer lookup failed for', person.name, error);
          return null;
        }
      }))).filter(Boolean);
    },
    // Recommendations v1 (bug report: 'some kind of a recommendation
    // system you and I will work out together') — TMDB's own
    // /recommendations for each of your top-rated movies, pooled and run
    // through the same unseen-only quality ranking. A deliberately simple
    // first pass to react to; the 'work out together' design conversation
    // can replace the seeding/scoring without touching the screen.
    async moviesLikeFavorites (seeds, rated) {
      const apiKey = process.env.VUE_APP_TMDB_API_KEY;
      const pooled = [];

      await Promise.all(seeds.map(async (seed) => {
        try {
          const response = await axios.get(`https://api.themoviedb.org/3/movie/${seed.movie.id}/recommendations?api_key=${apiKey}`);
          pooled.push(...(response.data?.results || []));
        } catch (error) {
          console.error('Recommendations lookup failed for', seed.movie.title, error);
        }
      }));

      return rankWatchlistCandidates(pooled, rated, Date.now(), { cap: RANK_POOL, profile: this.taste, exclude: this.skipFromSuggestions });
    }
  }
};
</script>

<style lang="scss" scoped>
.watchlist-screen {
  color: #eee;
  /* BackLink safety margin, same as every screen using it. */
  padding: 2.5rem 1rem 2rem;
}

.watchlist-title {
  margin: 0.5rem 0 0;
}

.watchlist-subtitle {
  color: #adb5bd;
  font-size: 0.85rem;
  margin: 0.25rem 0 1.25rem;
}

/* 1.75rem when every row still ended in a bulk "add all to a hat" button,
   which put its own ~40px between the posters and the next heading. With that
   gone (2026-08-20: "it takes up more room than it actually has value... then
   we can tighten up those layouts a little bit") the gap is doing the whole
   job of separating two sections on its own, and doesn't need to be as big. */
.watchlist-section {
  margin-bottom: 1.25rem;
}

.section-title {
  border-bottom: 1px solid #333;
  font-size: 1.1rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.35rem;
}

/* Sideways like the poster rows below it, and for the same reason: however
   many years are unfinished, this stays one row tall. */
.year-picker {
  display: flex;
  gap: 0.35rem;
  margin-bottom: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  -webkit-overflow-scrolling: touch;
}

/* Two stacked lines — the year, and how far it has to go — so the ordering
   explains itself at a glance (bug report: "if you could see on each one of
   those selectors, how close we actually are"). Neutral surfaces, no left
   accent bar; the selected tab is the light one. 40px minimum tap target. */
.year-tab {
  background: #1c1c1c;
  border: 1px solid #333;
  border-radius: 6px;
  color: #b9b9b9;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.1rem;
  line-height: 1.15;
  min-height: 40px;
  padding: 0.3rem 0.55rem;
  white-space: nowrap;
}

.year-tab-year {
  font-size: 0.85rem;
  font-weight: 600;
}

/* #9a9a9a on #1c1c1c is ~5.5:1; on the active tab's #e8e8e8 the darker
   value below is used instead. */
.year-tab-gap {
  color: #9a9a9a;
  font-size: 0.62rem;
}

.year-tab.active {
  background: #e8e8e8;
  border-color: #e8e8e8;
  color: #111;
}

.year-tab.active .year-tab-gap {
  color: #444;
}

/* Mobile-first: press feedback only, never a hover state that sticks. */
.year-tab:active:not(.active) {
  background: #2b2b2b;
  color: #fff;
}

.section-record {
  color: #9ec5fe;
  white-space: nowrap;
}

.section-caption {
  color: #adb5bd;
  font-size: 0.78rem;
  margin: 0 0 0.5rem;
}

/* "Ask for something" — the one place on this page you type rather than
   scroll. Matched to .year-tab's surfaces so it belongs to the page rather
   than announcing itself; :active not :hover, since this is an installed iOS
   PWA where a tapped element keeps its hover state with no mouse to leave
   it. */
.prompt-form {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

/* The person box anchors its typeahead panel. */
.person-form {
  position: relative;
}

/* The search bar's panel (Home.vue), opening downward under this field. */
.typeahead-panel {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  left: 0;
  margin-top: 4px;
  max-height: 220px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 20;
}
.typeahead-row {
  align-items: baseline;
  background: none;
  border: none;
  color: #eee;
  display: flex;
  font-size: 0.9rem;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 40px;
  padding: 0.45rem 0.7rem;
  text-align: left;
  width: 100%;
}
.typeahead-row:active { background: #1f1f1f; }
.typeahead-term {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.typeahead-meta {
  color: #8b8b8b;
  flex-shrink: 0;
  font-size: 0.7rem;
}

.prompt-input {
  background: #1c1c1c;
  border: 1px solid #333;
  border-radius: 6px;
  color: #f1f1f1;
  flex: 1;
  /* 16px exactly, not 0.95rem: below 16px iOS Safari zooms the whole page in
     when the field takes focus, and never zooms back out. */
  font-size: 1rem;
  min-height: 44px;
  min-width: 0;
  padding: 0.5rem 0.7rem;

  &::placeholder { color: #6c757d; }

  &:focus {
    border-color: #5a5a5a;
    outline: none;
  }

  &:disabled { opacity: 0.6; }
}

.prompt-button {
  background: #2b2b2b;
  border: 1px solid #444;
  border-radius: 6px;
  color: #f1f1f1;
  flex: 0 0 auto;
  font-size: 0.9rem;
  font-weight: 600;
  min-height: 44px;
  padding: 0.5rem 1.1rem;

  &:active { background: #3a3a3a; }

  &:disabled {
    color: #7a7a7a;
    opacity: 0.7;
  }
}

/* Amber rather than red: running out of suggestions for the day is a limit,
   not a failure, and it reads better as information than as an error. */
.prompt-error {
  color: #e0a458;
}

/* Disambiguating a name. A sideways row like every other list on this page,
   so it takes one row's height however many people share the name. */
.person-choices {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
  -webkit-overflow-scrolling: touch;
}

.person-choice {
  background: #1c1c1c;
  border: 1px solid #333;
  border-radius: 6px;
  /* #e6e6e6 on #1c1c1c is ~12:1. */
  color: #e6e6e6;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.4rem;
  text-align: left;
  width: 116px;

  &:active { background: #2b2b2b; }
}

/* Fixed height so every photo in the row lines up top and bottom, whatever
   TMDB returns — the house poster-row rule. The text below may run to any
   number of lines; the card just gets taller. */
.person-choice-photo {
  border-radius: 4px;
  display: block;
  height: 156px;
  object-fit: cover;
  width: 104px;
}

.person-choice-photo-blank {
  align-items: center;
  background: #2b2b2b;
  color: #8a8a8a;
  display: flex;
  font-size: 1.6rem;
  justify-content: center;
}

.person-choice-name {
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.2;
}

/* #b9b9b9 on #1c1c1c is ~9:1 — .text-muted would fail here. */
.person-choice-known {
  color: #b9b9b9;
  font-size: 0.66rem;
  line-height: 1.2;
}

.section-loading {
  color: #adb5bd;
  font-size: 0.85rem;
}

.rewatch-row {
  /* Poster-row rule: fixed image heights + top alignment; titles below
     flow to any length without disturbing the posters. */
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
}

.rewatch-card {
  cursor: pointer;
  position: relative;
  background: none;
  border: none;
  color: #eee;
  flex: 0 0 auto;
  padding: 0;
  text-align: center;
  width: 100px;
}

/* Mobile-first press feedback, no :hover. */
.rewatch-card:active {
  opacity: 0.7;
}

.rewatch-poster {
  border-radius: 0.35rem;
  height: 150px;
  object-fit: cover;
  width: 100px;
}

.rewatch-poster-placeholder {
  align-items: center;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #666;
  display: flex;
  font-size: 2rem;
  justify-content: center;
}

.rewatch-name {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 0.3rem;
}

.punt-btn {
  align-items: center;
  background: rgba(0, 0, 0, 0.75);
  border: 1px solid #3a3a3a;
  border-radius: 50%;
  color: #ccc;
  display: flex;
  height: 28px;
  justify-content: center;
  position: absolute;
  right: 2px;
  top: 2px;
  width: 28px;
  z-index: 2;
}

.punt-btn:active {
  background: rgba(0, 0, 0, 0.95);
}

.rewatch-due {
  color: #ffd700;
  display: block;
  font-size: 0.68rem;
  margin-top: 0.1rem;
}

.rewatch-meta {
  color: #ffc107;
  display: block;
  font-size: 0.7rem;
}

.watchlist-offline-note {
  color: #adb5bd;
  font-size: 0.8rem;
  text-align: center;
}
</style>
