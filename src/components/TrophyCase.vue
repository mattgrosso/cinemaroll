<template>
  <div class="trophy-case">
    <BackLink/>

    <h1 class="trophy-case-title">Trophy Case</h1>

    <div v-if="totalWins === 0" class="empty-state">
      <p>No personal awards completed yet — wins will show up here once you've picked a winner in at least one category.</p>
    </div>

    <template v-else>
      <p class="trophy-case-subtitle">{{ totalWins }} award{{ totalWins === 1 ? '' : 's' }} across {{ yearsRepresented }} year{{ yearsRepresented === 1 ? '' : 's' }}</p>

      <div v-for="shelf in personShelvesTop" :key="shelf.key" class="most-decorated">
        <h2 class="section-title">{{ shelf.title }}</h2>
        <div class="decorated-list">
          <!-- Tap reveals the films panel below the row (feedback: "if you
               tap on a nominee that has a bunch of them, you see a
               horizontal scrolling list of posters") — person search moved
               to the panel's "See in library" button. -->
          <div
            v-for="person in shelf.people"
            :key="person.cardKey"
            class="decorated-person"
            :class="{ expanded: isExpanded(shelf.key, person.cardKey) }"
            @click="toggleFilms(shelf.key, person)"
          >
            <img v-if="winnerImage(person.photo)" :src="winnerImage(person.photo)" :alt="person.name" class="decorated-photo">
            <div v-else class="decorated-photo decorated-photo-placeholder">{{ person.name.charAt(0) }}</div>
            <div class="decorated-name">{{ person.name }}</div>
            <div class="decorated-count">{{ person.label }}</div>
          </div>
        </div>
        <!-- Keyed by the open card so switching people re-mounts the row —
             otherwise the previous person's scroll position carries over. -->
        <div v-if="expandedCard && expandedCard.shelfKey === shelf.key" :key="expandedCard.cardKey" class="person-films">
          <div class="person-films-header">
            <button type="button" class="person-films-search" @click="searchForPerson(expandedCard.name)">
              See in library <i class="bi bi-arrow-right"></i>
            </button>
          </div>
          <div class="person-films-row">
            <button v-for="film in expandedFilms" :key="film.key" type="button" class="person-film" :title="film.title" @click="goToMovieId(film.movieId)">
              <img v-if="film.src" :src="film.src" :alt="film.title" class="person-film-poster">
              <div v-else class="person-film-poster decorated-photo-placeholder">{{ film.title.charAt(0) }}</div>
              <span class="person-film-year">{{ film.year }}</span>
              <span v-if="film.categoryLabel" class="person-film-category">{{ film.categoryLabel }}</span>
            </button>
          </div>
        </div>
      </div>

      <div v-if="mostAwardedMovies.length" class="most-decorated">
        <h2 class="section-title">Most Awarded Movies</h2>
        <div class="decorated-list">
          <div v-for="film in mostAwardedMovies" :key="film.movieId" class="decorated-person" @click="goToMovieId(film.movieId)">
            <img v-if="film.movie.poster_path" :src="`https://image.tmdb.org/t/p/w185${film.movie.poster_path}`" :alt="film.movie.title" class="decorated-poster">
            <div v-else class="decorated-poster decorated-photo-placeholder">{{ film.movie.title.charAt(0) }}</div>
            <div class="decorated-name">{{ film.movie.title }}</div>
            <div class="decorated-count">{{ film.count }} win{{ film.count === 1 ? '' : 's' }}</div>
          </div>
        </div>
      </div>

      <div v-if="mostNominatedMovies.length" class="most-decorated">
        <h2 class="section-title">Most Nominated Movies</h2>
        <div class="decorated-list">
          <div v-for="film in mostNominatedMovies" :key="film.movieId" class="decorated-person" @click="goToMovieId(film.movieId)">
            <img v-if="film.movie.poster_path" :src="`https://image.tmdb.org/t/p/w185${film.movie.poster_path}`" :alt="film.movie.title" class="decorated-poster">
            <div v-else class="decorated-poster decorated-photo-placeholder">{{ film.movie.title.charAt(0) }}</div>
            <div class="decorated-name">{{ film.movie.title }}</div>
            <div class="decorated-count">{{ film.count }} nomination{{ film.count === 1 ? '' : 's' }}</div>
          </div>
        </div>
      </div>

      <!-- User feedback: the per-category winner lists ("just every winner
           from each of the years going back") carried no insight and are
           gone. Everything below is a DERIVED shape — see awardStats.js. -->
      <div v-if="biggestSweeps.length" class="most-decorated">
        <h2 class="section-title">Biggest Sweeps</h2>
        <div class="decorated-list">
          <div v-for="sweep in biggestSweeps" :key="`${sweep.movieId}-${sweep.year}`" class="decorated-person" @click="goToMovieId(sweep.movieId)">
            <img v-if="sweep.movie.poster_path" :src="`https://image.tmdb.org/t/p/w185${sweep.movie.poster_path}`" :alt="sweep.movie.title" class="decorated-poster">
            <div v-else class="decorated-poster decorated-photo-placeholder">{{ sweep.movie.title.charAt(0) }}</div>
            <div class="decorated-name">{{ sweep.movie.title }}</div>
            <div class="decorated-count">{{ sweep.count }} wins · {{ sweep.year }}</div>
          </div>
        </div>
      </div>

      <div v-for="shelf in personShelvesBottom" :key="shelf.key" class="most-decorated">
        <h2 class="section-title">{{ shelf.title }}</h2>
        <div class="decorated-list">
          <!-- Tap reveals the films panel below the row (feedback: "if you
               tap on a nominee that has a bunch of them, you see a
               horizontal scrolling list of posters") — person search moved
               to the panel's "See in library" button. -->
          <div
            v-for="person in shelf.people"
            :key="person.cardKey"
            class="decorated-person"
            :class="{ expanded: isExpanded(shelf.key, person.cardKey) }"
            @click="toggleFilms(shelf.key, person)"
          >
            <img v-if="winnerImage(person.photo)" :src="winnerImage(person.photo)" :alt="person.name" class="decorated-photo">
            <div v-else class="decorated-photo decorated-photo-placeholder">{{ person.name.charAt(0) }}</div>
            <div class="decorated-name">{{ person.name }}</div>
            <div class="decorated-count">{{ person.label }}</div>
          </div>
        </div>
        <!-- Keyed by the open card so switching people re-mounts the row —
             otherwise the previous person's scroll position carries over. -->
        <div v-if="expandedCard && expandedCard.shelfKey === shelf.key" :key="expandedCard.cardKey" class="person-films">
          <div class="person-films-header">
            <button type="button" class="person-films-search" @click="searchForPerson(expandedCard.name)">
              See in library <i class="bi bi-arrow-right"></i>
            </button>
          </div>
          <div class="person-films-row">
            <button v-for="film in expandedFilms" :key="film.key" type="button" class="person-film" :title="film.title" @click="goToMovieId(film.movieId)">
              <img v-if="film.src" :src="film.src" :alt="film.title" class="person-film-poster">
              <div v-else class="person-film-poster decorated-photo-placeholder">{{ film.title.charAt(0) }}</div>
              <span class="person-film-year">{{ film.year }}</span>
              <span v-if="film.categoryLabel" class="person-film-category">{{ film.categoryLabel }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Your own ratings vs your own ceremony picks. -->
      <div v-if="upsets.length" class="most-decorated">
        <h2 class="section-title">Robbed, By Your Own Ratings</h2>
        <div class="versus-row">
          <div v-for="upset in upsets" :key="`${upset.year}-${upset.categoryKey}`" class="versus-card" @click="goToMovieId(upset.robbed.movie.id)">
            <span class="versus-context">{{ upset.year }} · {{ categoryName(upset.categoryKey) }}</span>
            <div class="versus-posters">
              <div class="versus-side">
                <img v-if="upset.robbed.movie.poster_path" :src="`https://image.tmdb.org/t/p/w185${upset.robbed.movie.poster_path}`" :alt="upset.robbed.movie.title" class="versus-poster">
                <div v-else class="versus-poster versus-poster-placeholder">?</div>
                <span class="versus-tag robbed">robbed · {{ formatScore(upset.robbedRating) }}</span>
                <span class="versus-title">{{ upset.robbed.name || upset.robbed.movie.title }}</span>
              </div>
              <span class="versus-vs">vs</span>
              <div class="versus-side">
                <img v-if="upset.winner.movie.poster_path" :src="`https://image.tmdb.org/t/p/w185${upset.winner.movie.poster_path}`" :alt="upset.winner.movie.title" class="versus-poster">
                <div v-else class="versus-poster versus-poster-placeholder">?</div>
                <span class="versus-tag you">your pick · {{ formatScore(upset.winnerRating) }}</span>
                <span class="versus-title">{{ upset.winner.name || upset.winner.movie.title }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { awardCategoryNameMap } from '../assets/javascript/personalAwardsCategories.js';
import { expandNomineeFromMinimal } from '../assets/javascript/personalAwards.js';
import { collectAwardEntries, rankPeople, rankMovies, rankPeopleWithoutWins, rankSweeps, winStreaks, categoryOwners, longestWaits, rankUpsets } from '../assets/javascript/awardStats.js';
import { getRating } from '../assets/javascript/GetRating.js';
import BackLink from './games/BackLink.vue';
import { formatScore } from '../assets/javascript/formatScore.js';

export default {
  components: { BackLink },
  name: 'TrophyCase',
  // Deliberately does NOT hide the app header (it used to): every other
  // screen keeps the header space — games swap in their own art, the rest
  // carry whatever banner was up when you arrived — and this page going
  // headerless made it the odd one out (user feedback). No bespoke Trophy
  // Case artwork exists yet, so the standard header/banner rides along.
  data () {
    return {
      // The tapped person card whose films panel is open:
      // { shelfKey, cardKey, name, entries } | null. One panel at a time.
      expandedCard: null,
      // { [personName]: profilePath | null } - see ensurePersonPhoto.
      personPhotoCache: {}
    };
  },
  watch: {
    // Looks up a photo for every person winner that doesn't already carry
    // one. Deduped by name via the cache, so a repeat winner across
    // categories/years costs a single request.
    personWinnersNeedingPhotos: {
      immediate: true,
      handler (names) {
        names.forEach((name) => this.ensurePersonPhoto(name));
      }
    }
  },
  computed: {
    // Standard category names plus every custom award the user has ever
    // invented, across all years — see categoryName().
    awardCategoryNames () {
      return awardCategoryNameMap(this.$store.state.settings?.personalAwards);
    },
    // Every personal-award WIN, expanded to a displayable object and grouped
    // by category key, sorted newest-year-first within each category.
    categorizedWins () {
      const personalAwards = this.$store.state.settings?.personalAwards || {};
      const library = this.$store.getters.allMediaAsArray;
      const byCategory = {};

      Object.keys(personalAwards).forEach((year) => {
        const categories = personalAwards[year]?.categories || {};
        Object.keys(categories).forEach((categoryKey) => {
          const winner = categories[categoryKey]?.winner;
          if (!winner) return;

          const expanded = expandNomineeFromMinimal(winner, library);
          if (!expanded) return;

          if (!byCategory[categoryKey]) byCategory[categoryKey] = [];
          byCategory[categoryKey].push({ year: Number(year), categoryKey, expanded });
        });
      });

      Object.values(byCategory).forEach((wins) => wins.sort((a, b) => b.year - a.year));

      return byCategory;
    },
    totalWins () {
      return Object.values(this.categorizedWins).reduce((sum, wins) => sum + wins.length, 0);
    },
    yearsRepresented () {
      const years = new Set();
      Object.values(this.categorizedWins).forEach((wins) => wins.forEach((win) => years.add(win.year)));
      return years.size;
    },
    // Person-type winners who've won more than once, ranked by win count —
    // the "show off people" angle: recurring favorites across categories/years.
    // Every win AND nomination, expanded once and shared by the three
    // leaderboards below (see awardStats.js - a winner is also a nominee,
    // and a person's award counts for their film, both deliberate).
    awardEntries () {
      return collectAwardEntries(
        this.$store.state.settings?.personalAwards || {},
        this.$store.getters.allMediaAsArray
      );
    },
    mostNominatedPeople () {
      return rankPeople(this.awardEntries.nominations);
    },
    mostNominatedNeverWon () {
      return rankPeopleWithoutWins(this.awardEntries.nominations, this.awardEntries.wins);
    },
    // The six person shelves, data-driven so one template block renders all
    // of them (and the tap-to-reveal films panel works identically on each).
    personShelvesTop () {
      const plural = (count) => `${count} nomination${count === 1 ? '' : 's'}`;
      return [
        {
          key: 'mostDecorated',
          title: 'Most Decorated',
          people: this.mostDecoratedPeople.map((person) => ({
            name: person.name,
            cardKey: person.name,
            label: `${person.count}× winner`,
            photo: person.wins[0].expanded,
            entries: person.wins
          }))
        },
        {
          key: 'mostNominated',
          title: 'Most Nominated People',
          people: this.mostNominatedPeople.map((person) => ({
            name: person.name,
            cardKey: person.name,
            label: plural(person.count),
            photo: person.entries[0].expanded,
            entries: person.entries
          }))
        },
        {
          key: 'bridesmaid',
          title: 'Always the Bridesmaid',
          people: this.mostNominatedNeverWon.map((person) => ({
            name: person.name,
            cardKey: person.name,
            label: `${plural(person.count)}, no wins`,
            photo: person.entries[0].expanded,
            entries: person.entries
          }))
        }
      ].filter((shelf) => shelf.people.length);
    },
    personShelvesBottom () {
      return [
        {
          key: 'backToBack',
          title: 'Back-to-Back',
          people: this.backToBackWinners.map((streak) => ({
            name: streak.name,
            cardKey: streak.name,
            label: `${streak.length} years running · ${streak.startYear}–${String(streak.endYear).slice(2)}`,
            photo: streak.sample.expanded,
            entries: streak.entries
          }))
        },
        {
          key: 'owners',
          title: 'Owns the Category',
          people: this.categoryOwnersList.map((owner) => ({
            name: owner.name,
            // The same person can own two categories - the card key keeps
            // the two cards' expansion states distinct.
            cardKey: `${owner.name}|${owner.categoryKey}`,
            label: `${owner.count}× ${this.categoryName(owner.categoryKey)}`,
            photo: owner.sample.expanded,
            entries: owner.entries
          }))
        },
        {
          key: 'waits',
          title: 'Worth the Wait',
          people: this.overdueWinners.map((wait) => ({
            name: wait.name,
            cardKey: wait.name,
            label: `won after ${wait.wait} years · first nod ${wait.firstNomination}`,
            photo: wait.sample.expanded,
            entries: wait.entries
          }))
        }
      ].filter((shelf) => shelf.people.length);
    },
    // The open panel's films: full-size posters, oldest first, each
    // captioned with the year and category it represents.
    expandedFilms () {
      if (!this.expandedCard) return [];
      return [...this.expandedCard.entries]
        .filter((entry) => entry?.expanded?.movie)
        .sort((a, b) => a.year - b.year)
        .map((entry, index) => ({
          key: `${entry.expanded.movie.id}-${entry.year}-${entry.categoryKey || index}`,
          movieId: entry.expanded.movie.id,
          src: entry.expanded.movie.poster_path ? `https://image.tmdb.org/t/p/w185${entry.expanded.movie.poster_path}` : null,
          title: entry.expanded.movie.title,
          year: entry.year,
          categoryLabel: entry.categoryKey ? this.categoryName(entry.categoryKey) : null
        }));
    },
    biggestSweeps () {
      return rankSweeps(this.awardEntries.wins);
    },
    backToBackWinners () {
      return winStreaks(this.awardEntries.wins);
    },
    categoryOwnersList () {
      return categoryOwners(this.awardEntries.wins, { minCount: 3 });
    },
    overdueWinners () {
      return longestWaits(this.awardEntries.nominations, this.awardEntries.wins);
    },
    // One getRating pass over the library, shared by every upset lookup —
    // never inside the ranking itself (GetRating is uncached).
    ratingByMovieId () {
      const map = new Map();
      (this.$store.getters.allMediaAsArray || []).forEach((entry) => {
        if (entry?.movie?.id == null) return;
        const rating = getRating(entry)?.calculatedTotal;
        if (Number.isFinite(rating)) map.set(entry.movie.id, rating);
      });
      return map;
    },
    upsets () {
      const ratings = this.ratingByMovieId;
      return rankUpsets(this.awardEntries.wins, this.awardEntries.nominations, (movieId) => ratings.get(movieId) ?? null, { limit: 8 });
    },
    mostAwardedMovies () {
      return rankMovies(this.awardEntries.wins);
    },
    mostNominatedMovies () {
      return rankMovies(this.awardEntries.nominations);
    },
    // Distinct names of person winners with no profile path already stored
    // (older awards, picked before that was captured). Drives the lookup
    // watcher above.
    // Covers nominees as well as winners now that Most Nominated People
    // shows faces too - a person can be nominated without ever winning.
    personWinnersNeedingPhotos () {
      const names = new Set();
      [...this.awardEntries.wins, ...this.awardEntries.nominations].forEach(({ expanded }) => {
        if (expanded?.name && !expanded.details?.profile_path) names.add(expanded.name);
      });
      return [...names];
    },
    mostDecoratedPeople () {
      const counts = {};

      Object.values(this.categorizedWins).forEach((wins) => {
        wins.forEach((win) => {
          const { expanded } = win;
          if (!expanded.name || !expanded.movieId) return; // movie-type win, not a person

          if (!counts[expanded.name]) {
            counts[expanded.name] = { name: expanded.name, count: 0, wins: [] };
          }
          counts[expanded.name].count += 1;
          counts[expanded.name].wins.push(win);
        });
      });

      return Object.values(counts)
        .filter((person) => person.count > 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    }
  },
  methods: {
    // Template-exposed; two decimals on every score (bug report).
    formatScore,
    toggleFilms (shelfKey, person) {
      const already = this.isExpanded(shelfKey, person.cardKey);
      this.expandedCard = already
        ? null
        : { shelfKey, cardKey: person.cardKey, name: person.name, entries: person.entries };
    },
    isExpanded (shelfKey, cardKey) {
      return Boolean(this.expandedCard && this.expandedCard.shelfKey === shelfKey && this.expandedCard.cardKey === cardKey);
    },
    // Resolves custom awards too. Built from EVERY year rather than the one
    // on screen: this shelf aggregates a category across years ("3× Best
    // Needle Drop"), so an award invented in 2019 still has to render by name
    // on a card built in 2026.
    categoryName (categoryKey) {
      return this.awardCategoryNames[categoryKey] || categoryKey;
    },
    // A PERSON gets a picture of the person - never a poster of one of
    // their films (bug report: "I don't wanna show Steven Spielberg but
    // then show the poster for one of his movies, that's not right"). The
    // preferred source is the profile path captured when the award was
    // picked; failing that we look the person up on TMDB by name (see
    // ensurePersonPhoto), and failing THAT we show their initial rather
    // than falling back to a poster, which would be actively misleading.
    // Only movie-type winners resolve to a poster.
    winnerImage (expanded) {
      if (expanded?.name) {
        const storedPath = expanded.details?.profile_path;
        const lookedUpPath = this.personPhotoCache[expanded.name];
        const profilePath = storedPath || lookedUpPath;
        return profilePath ? `https://image.tmdb.org/t/p/w185${profilePath}` : null;
      }
      if (expanded?.movie?.poster_path) {
        return `https://image.tmdb.org/t/p/w185${expanded.movie.poster_path}`;
      }
      return null;
    },
    // Same shape as SixDegreesGame's own person-photo lookup: undefined =
    // never looked up, null = looked up and there's nothing (or a lookup is
    // in flight, marked immediately so concurrent calls for the same name
    // don't double-fetch). Person photos aren't stored locally at rating
    // time (AddRating.js keeps only {name, character} for cast), so this is
    // the only way to get one for a winner whose award predates the
    // profilePath capture.
    async ensurePersonPhoto (name) {
      if (!name || Object.prototype.hasOwnProperty.call(this.personPhotoCache, name)) return;
      this.personPhotoCache = { ...this.personPhotoCache, [name]: null };
      try {
        const query = encodeURIComponent(name);
        const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${query}`;
        const response = await fetch(url);
        const data = await response.json();
        this.personPhotoCache = { ...this.personPhotoCache, [name]: data?.results?.[0]?.profile_path || null };
      } catch {
        // Best-effort - stays null, falls back to the initial.
      }
    },
    goToMovieId (movieId) {
      if (movieId) this.$router.push(`/movie/${movieId}`);
    },
    // Bug report: "When I click on an actor in the trophy case, it seems to
    // take me to one random film of theirs" — the old handler pushed to
    // whichever win/nomination happened to be first in the person's list. A
    // person card now opens that person's whole filmography in the Home
    // grid instead: same store-commit sequence as MovieDetail's
    // searchFor(name, 'cast') and SixDegreesGame.searchForPerson,
    // replicated for the same reason (small, component-local navigation
    // with no shared base). Category trophy cards are unchanged — their
    // film is the specific movie the award was won for, not a random one.
    searchForPerson (name) {
      if (!name) return;
      this.$store.commit('setHomePageNavigationIntent', 'search');
      this.$store.commit('setHomePagePromoteGroup', 'cast');
      this.$store.commit('setHomePageSearchValue', name);
      this.$store.commit('setHomePageSearchChips', []);
      this.$store.commit('setHomePageScrollPosition', 0);
      this.$store.commit('setBannerRequest', { type: 'fromResults' });
      this.$router.push('/');
    },
    goToMovie (win) {
      const movieId = win.expanded.movie?.id || win.expanded.movieId;
      if (movieId) {
        this.$router.push(`/movie/${movieId}`);
      }
    }
    // returnHome removed: BackLink goes wherever you came from, and falls
    // back to Insights (this screen's declared parent) rather than Home.
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/screen-top';
.trophy-case {
  color: #eee;
  padding: $screen-top-gap 1rem 2rem;
}

.home-link {
  align-items: center;
  color: white;
  column-gap: 4px;
  cursor: pointer;
  display: flex;
  padding: 12px 0;
}

.home-link:active {
  opacity: 0.7;
}

.trophy-case-title {
  margin: 0;
}

.trophy-case-subtitle {
  color: #adb5bd;
  margin-bottom: 1.5rem;
}

.empty-state {
  color: #adb5bd;
  margin-top: 2rem;
  text-align: center;
}

.section-title {
  border-bottom: 1px solid #333;
  font-size: 1.1rem;
  margin-bottom: 0.75rem;
  padding-bottom: 0.35rem;
}

.decorated-list {
  align-items: flex-start;
  display: flex;
  gap: 0.9rem;
  overflow-x: auto;
  /* Roomy enough that the expanded card's caret (absolutely positioned
     just below the card) stays INSIDE this box — poking past it made the
     row vertically scrollable and it felt like it "broke loose". */
  padding-bottom: 0.75rem;
}

.decorated-person {
  cursor: pointer;
  flex: 0 0 auto;
  text-align: center;
  width: 100px;
}

/* Selection without chrome: the open card stays full-strength and lifts
   slightly while its shelf-mates recede; a small neutral caret points into
   the panel. (No colored outlines / edge bars — a standing style call.) */
.decorated-person {
  transition: opacity 0.15s ease;
}

.decorated-list:has(.expanded) .decorated-person:not(.expanded) {
  opacity: 0.4;
}

.decorated-person.expanded {
  position: relative;
}

.decorated-person.expanded::after {
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 7px solid #3a3a3a;
  bottom: -0.55rem;
  content: '';
  left: 50%;
  position: absolute;
  transform: translateX(-50%);
}

.decorated-photo {
  border-radius: 0.35rem;
  height: 140px;
  object-fit: cover;
  width: 100px;
}

/* Same footprint as .decorated-photo so the movie leaderboards line up with
   the people ones - posters just aren't cropped, since a cropped poster
   loses the title. */
.decorated-poster {
  border-radius: 0.35rem;
  height: 140px;
  object-fit: contain;
  width: 100px;
}

.decorated-photo-placeholder {
  align-items: center;
  background: #1a1a1a;
  border: 1px solid #333;
  color: #666;
  display: flex;
  font-size: 2rem;
  justify-content: center;
}

.decorated-name {
  font-size: 0.8rem;
  font-weight: 600;
  line-height: 1.2;
  margin-top: 0.1rem;
  /* Never clamp or truncate names. Alignment comes from the row's
     align-items: flex-start + fixed image heights: every photo's top and
     bottom edge lines up, and text below flows as long as it needs. */
  overflow-wrap: break-word;
}

.decorated-count {
  color: #ffc107;
  font-size: 0.7rem;
}


/* Tap-to-reveal films panel — full-size posters in their own scroll row,
   because the in-card mini strips were too small to enjoy (feedback). */
.person-films {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 0.5rem;
  margin-top: 0.5rem;
  padding: 0.6rem 0.75rem;
}

.person-films-header {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 0.25rem;
}

.person-films-search {
  background: none;
  border: none;
  color: #6ec1e4;
  font-size: 0.78rem;
  padding: 0.2rem 0.3rem;
  text-decoration: underline;
}

.person-films-search:active {
  opacity: 0.6;
}

.person-films-row {
  /* Same poster-row rule as .decorated-list: images stay edge-aligned,
     captions below grow freely. */
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
}

.person-film {
  background: none;
  border: none;
  color: #eee;
  flex: 0 0 auto;
  padding: 0;
  text-align: center;
  width: 92px;
}

.person-film:active {
  opacity: 0.7;
}

.person-film-poster {
  border-radius: 0.35rem;
  height: 138px;
  object-fit: cover;
  width: 92px;
}

.person-film-year {
  color: #ffc107;
  display: block;
  font-size: 0.68rem;
  font-weight: 600;
  margin-top: 0.25rem;
}

.person-film-category {
  color: #adb5bd;
  display: block;
  font-size: 0.65rem;
  line-height: 1.2;
}


.most-decorated {
  margin-bottom: 2rem;
}


/* Side-by-side poster matchups (Robbed + You vs. the Academy) — a
   horizontal-scroll row of cards, same rhythm as the people shelves. */
.versus-row {
  display: flex;
  gap: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
}

.versus-card {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 0.5rem;
  cursor: pointer;
  flex: 0 0 auto;
  padding: 0.5rem 0.6rem;
  text-align: center;
  width: 190px;
}

/* Mobile-first: press feedback only. */
.versus-card:active {
  background: #242424;
}

.versus-context {
  color: #adb5bd;
  display: block;
  font-size: 0.68rem;
  margin-bottom: 0.35rem;
}

.versus-posters {
  align-items: flex-start;
  display: flex;
  gap: 0.35rem;
  justify-content: center;
}

.versus-side {
  display: flex;
  flex-direction: column;
  width: 72px;
}

.versus-poster {
  border-radius: 0.25rem;
  height: 108px;
  object-fit: cover;
  width: 72px;
}

.versus-poster-placeholder {
  align-items: center;
  background: #2a2a2a;
  color: #666;
  display: flex;
  font-size: 1.5rem;
  justify-content: center;
}

.versus-vs {
  align-self: center;
  color: #666;
  font-size: 0.65rem;
  text-transform: uppercase;
}

.versus-tag {
  font-size: 0.62rem;
  font-weight: 700;
  margin-top: 0.25rem;
  text-transform: uppercase;
}

.versus-tag.you {
  color: #6ec1e4;
}

.versus-tag.robbed {
  color: #ff6a6a;
}

.versus-title {
  color: #ccc;
  font-size: 0.68rem;
  line-height: 1.2;
  margin-top: 0.1rem;
}

</style>
