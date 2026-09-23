<template>
  <div class="deep-stats">
    <BackLink/>
    <h1 class="ds-title">Deep Stats</h1>
    <p class="ds-subtitle">Your library, interrogated.</p>

    <!-- Painted for one frame before the real content (nextFrame): the
         tap that opened this screen is acknowledged at once instead of
         after the ~0.5-1s the sections below take to build. -->
    <SkeletonBlock v-if="!painted" :rows="7"/>
    <template v-else>

    <!-- The Crown -->
    <section v-if="crown.length" class="ds-section">
      <h2 class="ds-section-title">The Crown</h2>
      <p class="ds-section-caption">Starting from the oldest release you've rated, each new high score starts a reign.</p>
      <!-- Sideways: as a vertical list this was the tallest thing on the
           page by a distance, and it reads better as a succession anyway. -->
      <div class="ds-poster-row">
        <div
          v-for="reign in crown"
          :key="reign.entry.dbKey"
          class="ds-poster-card crown-card"
          :class="{ current: reign.current }"
          role="button"
          :aria-label="reign.entry.movie.title"
          @click="goToMovie(reign.entry)"
        >
          <img v-if="reign.entry.movie.poster_path" :src="poster(reign.entry)" :alt="reign.entry.movie.title" class="ds-poster">
          <span class="crown-card-year">
            {{ reign.year }}
            <span v-if="reign.current" class="crown-current-tag">now</span>
          </span>
          <span class="ds-poster-note">{{ reign.rating.toFixed(2) }} · {{ reign.reignYears }}y</span>
        </div>
      </div>
    </section>

    <!-- The Pantheon -->
    <section v-if="pantheonData.constellations.length" class="ds-section">
      <h2 class="ds-section-title">The Pantheon</h2>
      <p class="ds-section-caption">
        Perfection, category by category — {{ pantheonData.perfectFilms }} film{{ pantheonData.perfectFilms === 1 ? '' : 's' }},
        {{ pantheonData.totalMarks }} perfect marks.
      </p>
      <!-- The per-category lists are gone: with this many perfect marks in
           each one they were long without being interesting ("I have too many
           movies in each of these categories for it to be really
           fascinating"). Constellations survive because scoring perfectly in
           more than one category at once still means something. -->
      <div v-if="pantheonData.constellations.length" class="pantheon-category">
        <h3 class="pantheon-label">Constellations <span class="pantheon-count">{{ pantheonData.constellations.length }}</span></h3>
        <p class="ds-section-caption">Perfect in more than one category at once.</p>
        <div class="ds-poster-row">
          <div v-for="star in pantheonData.constellations" :key="star.entry.dbKey" class="ds-poster-card" @click="goToMovie(star.entry)">
            <img v-if="star.entry.movie.poster_path" :src="poster(star.entry)" :alt="star.entry.movie.title" class="ds-poster">
            <span class="ds-poster-note gold">{{ star.count }} perfect marks</span>
          </div>
        </div>
      </div>
    </section>

    <!-- Rewatches -->
    <section v-if="rewatches" class="ds-section">
      <h2 class="ds-section-title">Rewatches</h2>
      <p class="ds-section-caption">The films you keep returning to — and how long they make you wait.</p>
      <div class="ds-strip">
        <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.repeatViewings }}</span><span class="ds-strip-label">repeat viewings</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.filmsRevisited }}</span><span class="ds-strip-label">films revisited</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ Math.round(rewatches.rewatchRate * 100) }}%</span><span class="ds-strip-label">rewatch rate</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ rewatches.medianReturnYears.toFixed(1) }}y</span><span class="ds-strip-label">median return</span></div>
      </div>
      <h3 class="pantheon-label">Most rewatched</h3>
      <div class="ds-poster-row">
        <div v-for="film in rewatches.mostRewatched" :key="film.entry.dbKey" class="ds-poster-card" @click="goToMovie(film.entry)">
          <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
          <span class="ds-poster-note gold">{{ film.viewings }} viewings</span>
        </div>
      </div>
      <h3 class="pantheon-label">Quickest returns</h3>
      <div class="ds-poster-row">
        <div v-for="film in rewatches.quickestReturns" :key="`q-${film.entry.dbKey}`" class="ds-poster-card" @click="goToMovie(film.entry)">
          <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
          <span class="ds-poster-note gold">{{ gapLabel(film.gapDays) }}</span>
        </div>
      </div>

      <!-- The other end of the same list (2026-08-17). -->
      <h3 v-if="rewatches.longestReturns.length" class="pantheon-label">Longest waits</h3>
      <div v-if="rewatches.longestReturns.length" class="ds-poster-row">
        <div v-for="film in rewatches.longestReturns" :key="`l-${film.entry.dbKey}`" class="ds-poster-card" @click="goToMovie(film.entry)">
          <img v-if="film.entry.movie.poster_path" :src="poster(film.entry)" :alt="film.entry.movie.title" class="ds-poster">
          <span class="ds-poster-note gold">{{ gapLabel(film.gapDays) }}</span>
        </div>
      </div>
    </section>

    <!-- Marathon Club -->
    <section v-if="marathon" class="ds-section">
      <h2 class="ds-section-title">Marathon Club</h2>
      <p class="ds-section-caption">
        How much you've packed into a single stretch — the most films you've watched in one
        day, one week and one month, and how many days you've watched anything at all.
        Not consecutive days; the biggest ones.
      </p>
      <div class="ds-strip">
        <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.dayRecord.count }}</span><span class="ds-strip-label">day record · {{ duration(marathon.dayRecord.minutes) }}</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.weekRecord.count }}</span><span class="ds-strip-label">week record · {{ duration(marathon.weekRecord.minutes) }}</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.monthRecord.count }}</span><span class="ds-strip-label">month record · {{ duration(marathon.monthRecord.minutes) }}</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ marathon.movieDays }}</span><span class="ds-strip-label">movie days</span></div>
      </div>
      <h3 class="pantheon-label">Biggest days</h3>
      <ol class="top-days">
        <li v-for="(dayEntry, index) in marathon.topDays" :key="dayEntry.day" class="top-day">
          <span class="top-day-rank">{{ index + 1 }}</span>
          <div class="top-day-info">
            <span class="top-day-date">{{ dayEntry.day }}</span>
            <span class="top-day-detail">{{ dayEntry.count }} movies · {{ duration(dayEntry.minutes) }}</span>
            <!-- "Should show the posters of the movies I watched on the
                 longest days. Make sure [they] be pretty small though."
                 (2026-08-17) -->
            <div class="day-posters">
              <img
                v-for="(watched, position) in dayEntry.entries"
                :key="`${dayEntry.day}-${watched.dbKey}-${position}`"
                v-show="watched.movie.poster_path"
                :src="poster(watched)"
                :alt="watched.movie.title"
                :title="watched.movie.title"
                class="day-poster"
                loading="lazy"
                @click="goToMovie(watched)"
              >
            </div>
          </div>
        </li>
      </ol>
    </section>

    <!-- Ties. "Would be cool if I could see how many ties there are in the
         whole database" (2026-09-06). Exact equality at the fourth decimal,
         the tournament's own definition (deepStats.tieStats). -->
    <section v-if="ties" class="ds-section ties">
      <h2 class="ds-section-title">Ties</h2>
      <p class="ds-section-caption">
        Films whose scores match exactly, to the fourth decimal — the ties the tiebreak tournament
        settles, one group at a time, starting from the top.
      </p>
      <div class="ds-strip">
        <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.tiedFilms }}</span><span class="ds-strip-label">films tied</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.groups }}</span><span class="ds-strip-label">tied groups</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ ties.largest }}</span><span class="ds-strip-label">biggest tie</span></div>
        <div class="ds-strip-item"><span class="ds-strip-value">{{ Math.round(ties.share * 100) }}%</span><span class="ds-strip-label">of the library</span></div>
      </div>
      <h3 class="pantheon-label">
        Next up for the tournament
        <span class="pantheon-count">{{ ties.next.films.length }} at {{ formatScore(ties.next.score) }}</span>
      </h3>
      <div class="ds-poster-row">
        <div v-for="film in ties.next.films" :key="`tie-next-${film.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.movie.title" @click="goToMovie(film)">
          <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
          <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
        </div>
      </div>
      <template v-if="biggestTies.length">
        <h3 class="pantheon-label">Biggest ties</h3>
        <div v-for="group in biggestTies" :key="`tie-${group.score}`" class="pantheon-category tie-group">
          <h3 class="pantheon-label">
            {{ group.films.length }} films at {{ formatScore(group.score) }}
          </h3>
          <div class="ds-poster-row">
            <div v-for="film in group.films" :key="`tie-${group.score}-${film.dbKey}`" class="ds-poster-card" role="button" :aria-label="film.movie.title" @click="goToMovie(film)">
              <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
              <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
            </div>
          </div>
        </div>
      </template>
    </section>

    <!-- Years -->
    <section v-if="years.length" class="ds-section">
      <h2 class="ds-section-title">Years</h2>
      <p class="ds-section-caption">
        How good each year of watching was, by Log Score — quality and depth together, so a
        year of many good films beats a year of two great ones. The poster is that year's best.
      </p>
      <!-- "I should be able to sort it chronologically, which you already
           have, or I should be able to sort it by rank." (2026-08-17) -->
      <div class="ds-sort">
        <button
          type="button"
          class="ds-sort-btn"
          :class="{ active: yearSort === 'chronological' }"
          @click="yearSort = 'chronological'"
        >Chronological</button>
        <button
          type="button"
          class="ds-sort-btn"
          :class="{ active: yearSort === 'rank' }"
          @click="yearSort = 'rank'"
        >By rank</button>
      </div>
      <div class="ds-poster-row">
        <div
          v-for="year in years"
          :key="year.year"
          class="ds-poster-card"
          role="button"
          :aria-label="`${year.year}: ${year.watched} watched`"
          @click="year.top && goToMovie(year.top)"
        >
          <img v-if="year.top && year.top.movie.poster_path" :src="poster(year.top)" :alt="year.top.movie.title" class="ds-poster">
          <div v-else class="ds-poster ds-poster-blank">{{ year.year }}</div>
          <span class="crown-card-year">{{ year.year }}</span>
          <span class="ds-poster-note gold">{{ year.score ?? '—' }}</span>
          <span class="ds-poster-note">{{ year.watched }} watched</span>
        </div>
      </div>
    </section>

    <!-- Decade Championship -->
    <section v-if="championship" ref="championshipSection" class="ds-section decade-championship">
      <h2 class="ds-section-title">Decade Championship</h2>
      <p class="ds-section-caption">
        Who dominated each decade of your library, by release year. Log Score throughout, so depth
        counts alongside quality and a decade you've barely explored can't crown anyone on one lucky
        film — nobody qualifies on fewer than two.
      </p>
      <!-- The same strip the year screens use: every decade visible, not
           hidden behind a select. Newest first, like the year strips. -->
      <div class="ds-decade-scroller">
        <button
          v-for="candidate in decades"
          :key="candidate.decade"
          type="button"
          class="btn btn-sm ds-decade-pill"
          :class="candidate.decade === activeDecade ? 'btn-primary selected' : 'btn-outline-secondary'"
          @click="selectedDecade = candidate.decade"
        >{{ candidate.label }}</button>
      </div>
      <p class="ds-section-caption decade-count">
        {{ championship.filmCount }} film{{ championship.filmCount === 1 ? '' : 's' }} rated from the {{ championship.label }}.
      </p>

      <!-- One winner per category in a sideways row, like every other row on
           this page: a portrait for a person, a poster for the film. Tap a
           winner to unfold the runners-up beneath the row. Fourth layout of
           the day (2026-09-02): "just a horizontally scrolling list... with
           one poster or photograph per winner", and "I can click on any of
           the results and see... further down the line, other competitors." -->
      <div class="ds-poster-row champions" :class="{ 'has-open': openCategoryKey }">
        <div
          v-for="category in championshipCategories"
          :key="`${championship.decade}-${category.key}`"
          class="ds-poster-card champion"
          :class="{ open: category.key === openCategoryKey }"
          :data-category="category.key"
          role="button"
          :aria-expanded="category.key === openCategoryKey ? 'true' : 'false'"
          :aria-label="category.winner ? `${category.label}: ${category.winner.name}` : category.label"
          @click="toggleCategory(category)"
        >
          <img
            v-if="imageFor(category, category.winner)"
            :src="imageFor(category, category.winner)"
            :alt="category.winner.name"
            class="ds-poster"
            loading="lazy"
          >
          <img
            v-else-if="category.winner && category.kind === 'person'"
            src="../assets/images/Image_not_available.png"
            :alt="category.winner.name"
            class="ds-poster"
          >
          <div v-else class="ds-poster ds-poster-blank">{{ category.winner ? category.winner.name : '…' }}</div>
          <span class="champion-category">{{ category.label }}</span>
          <span v-if="category.winner" class="champion-name">{{ category.winner.name }}</span>
          <span v-else class="champion-name decade-looking">Looking…</span>
          <span v-if="category.winner" class="ds-poster-note gold">{{ category.winner.scoreLabel }}</span>
        </div>
      </div>

      <!-- The runners-up for the open category: the field, in order. -->
      <div v-if="openCategory" class="competitors" :data-competitors="openCategory.key">
        <p class="champion-category competitors-title">
          {{ openCategory.label }} of the {{ championship.label }}
          <template v-if="openCategory.note"> · {{ openCategory.note }}</template>
        </p>
        <ol class="competitor-list">
          <li
            v-for="(competitor, index) in openCategory.field"
            :key="`${openCategory.key}-${competitor.name}`"
            class="competitor"
            role="button"
            :aria-label="`#${index + 1} ${competitor.name}`"
            @click="tapCompetitor(openCategory, competitor, index)"
          >
            <span class="competitor-rank">{{ index + 1 }}</span>
            <img v-if="imageFor(openCategory, competitor)" :src="imageFor(openCategory, competitor)" :alt="competitor.name" class="competitor-image" loading="lazy">
            <img v-else-if="openCategory.kind === 'person'" src="../assets/images/Image_not_available.png" :alt="competitor.name" class="competitor-image">
            <div v-else class="competitor-image competitor-image-blank"></div>
            <span class="competitor-name">{{ competitor.name }}</span>
            <span class="competitor-detail">
              <span class="champion-score">{{ competitor.scoreLabel }}</span>
              <template v-if="competitor.count"> · {{ competitor.count }} film{{ competitor.count === 1 ? '' : 's' }}</template>
            </span>
          </li>
        </ol>
        <p v-if="openCategory.loading" class="champion-detail decade-looking">Looking further down the line…</p>
        <p v-else-if="openCategory.field.length < 2" class="champion-detail">Nobody else qualifies with two films from the {{ championship.label }}.</p>
      </div>
      <p v-if="!championshipCategories.length" class="ds-section-caption">
        Not enough from the {{ championship.label }} yet to crown anyone.
      </p>

      <PersonModal
        v-if="selectedChampion"
        :person="selectedChampion.person"
        :role-label="selectedChampion.roleLabel"
        :rank="selectedChampion.rank"
        :rank-of="selectedChampion.rankOf"
        :library-average="championship.globalAvg"
        @close="selectedChampion = null"
        @search="searchForChampion"
        @select-film="selectChampionFilm"
      />
    </section>

    <!-- Standouts -->
    <section v-if="standoutList.length" class="ds-section">
      <h2 class="ds-section-title">Standouts</h2>
      <p class="ds-section-caption">
        The corners of your library you rate unusually well, ranked against each other — genres,
        keywords, directors, actors, studios, decades. The number is how far above your own average
        each one sits, pulled back toward that average when there's little evidence, so eight films
        can beat four hundred but one lucky film can't beat anything.
      </p>
      <div class="standouts">
        <div v-for="standout in standoutList" :key="`${standout.facet}-${standout.value}`" class="standout">
          <div class="standout-head">
            <span class="standout-facet">{{ standout.facet }}</span>
            <span class="standout-value">{{ standout.value }}</span>
            <span class="standout-score" :class="{ gold: standout.lift > 0 }">
              {{ standout.lift > 0 ? '+' : '' }}{{ standout.lift.toFixed(2) }}
            </span>
          </div>
          <p class="standout-detail">
            {{ standout.count }} rated · {{ standout.mean.toFixed(2) }} average · {{ standout.score }} log score
          </p>
          <div class="ds-poster-row">
            <div
              v-for="film in standout.top"
              :key="`${standout.value}-${film.dbKey}`"
              class="ds-poster-card"
              role="button"
              :aria-label="film.movie.title"
              @click="goToMovie(film)"
            >
              <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
              <div v-else class="ds-poster ds-poster-blank">{{ film.movie.title }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Genres -->
    <section v-if="genres.length" class="ds-section">
      <h2 class="ds-section-title">Genres</h2>
      <p class="ds-section-caption">Ranked by log score — favorites rewarded, small samples humbled.</p>
      <div v-for="(genre, index) in genres" :key="genre.name" class="pantheon-category">
        <h3 class="pantheon-label">
          <span class="genre-rank">#{{ index + 1 }}</span> {{ genre.name }}
          <span class="pantheon-count">{{ genre.count }} rated</span>
          <span class="genre-score">{{ genre.score }}</span>
        </h3>
        <div class="ds-poster-row">
          <div v-for="film in genre.top" :key="`${genre.name}-${film.dbKey}`" class="ds-poster-card" @click="goToMovie(film)">
            <img v-if="film.movie.poster_path" :src="poster(film)" :alt="film.movie.title" class="ds-poster">
          </div>
        </div>
      </div>
    </section>
    </template>
  </div>
</template>
<script>
// Deep Stats (/stats): the best of Brian's Movie Log stats suite, adapted
// (surveyed live 2026-08-15 — Crown, Pantheon, Rewatches, Marathon, plus
// log-scored Years and Genres). All computation is pure in deepStats.js /
// logScore.js; this screen only renders. Fully offline.
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { afterFrame, SKELETON_FIRST } from '../utils/nextFrame.js';
import PersonModal from './PersonModal.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { crownTimeline, pantheon, rewatchStats, marathonStats, yearStats, genreStats, standouts, tieStats } from '../assets/javascript/deepStats.js';
import { logScoreSettings } from '../assets/javascript/logScore.js';
import { decadesAvailable, defaultDecade, decadeChampionship, DECADE_DEFAULTS } from '../assets/javascript/decadeChampionship.js';
import { isEligibleForActingCategory } from '../assets/javascript/genderEligibility.js';
import { formatScore } from '../assets/javascript/formatScore.js';
import { lookupPerson } from '../utils/personLookup.js';

// Decade Championship's Actor/Actress split walks the decade's ranked cast
// with one TMDB lookup per name until both lists are as deep as asked. A
// thin decade may never fill one of them; this stops the walk from turning
// into a lookup per credited actor in the decade.
const CAST_LOOKUP_CAP = 40;

export default {
  name: 'DeepStats',
  components: { SkeletonBlock, BackLink, PersonModal },
  data () {
    return {
      painted: !SKELETON_FIRST,
      // Years section ordering — see the Years block.
      yearSort: 'chronological',
      // Decade Championship. `selectedDecade` is the tapped pill; null means
      // "the best-evidenced decade" (see activeDecade).
      selectedDecade: null,
      // The Actor/Actress lists for the active decade, resolved by walking
      // the ranked cast with one TMDB lookup per name (the stored cast
      // carries no gender). Resumable: the row needs one of each, and the
      // unfolded runners-up need `depth` of each, so the walk goes only as
      // far as has been asked for. See continueCastWalk.
      castWalk: { target: 0, index: 0, lookups: 0, loading: false, done: false, actors: [], actresses: [] },
      castSeq: 0,
      // Which category's runners-up are unfolded beneath the row.
      openCategoryKey: null,
      // name -> TMDB profile_path (null once looked up and missing), for the
      // portraits of crew winners, who are never looked up for gender.
      portraits: {},
      // A tapped champion: { person, roleLabel, rank, rankOf } for PersonModal.
      selectedChampion: null
    };
  },
  computed: {
    library () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    weights () {
      return logScoreSettings(this.$store.state.settings);
    },
    decades () {
      return decadesAvailable(this.library, getRating);
    },
    // Falls back to the decade with the most rated films — both before any
    // tap and if the library changes under a selection.
    activeDecade () {
      if (this.decades.some((candidate) => candidate.decade === this.selectedDecade)) return this.selectedDecade;
      return defaultDecade(this.decades);
    },
    championship () {
      if (this.activeDecade === null) return null;
      return decadeChampionship(this.library, getRating, this.weights, this.activeDecade);
    },
    // The section's categories in display order. Each carries its full
    // ranked list, its `winner` (null while still being looked up) and its
    // `field` — the runners-up the row unfolds on tap. Actor and Actress
    // come from the cast walk; offline they collapse into one Performer.
    championshipCategories () {
      const championship = this.championship;
      if (!championship) return [];
      const depth = DECADE_DEFAULTS.depth;
      const person = (champion) => ({ ...champion, scoreLabel: formatScore(champion.score) });
      const category = (key, label, kind, ranked, extra = {}) => ({
        key, label, kind, ranked, winner: ranked[0] || null, field: ranked.slice(0, depth), ...extra
      });
      const people = (key, label, ranked, extra) => category(key, label, 'person', ranked.map(person), extra);

      const categories = [category('film', 'Film', 'film', championship.films.map(({ entry, rating }) => ({
        name: entry.movie.title, best: entry, entries: [entry], score: rating, scoreLabel: formatScore(rating), count: 0
      })))];
      const crew = new Map(championship.crew.map((c) => [c.key, c]));
      categories.push(people('director', 'Director', crew.get('director').ranked));

      if (this.$store.state.isOnline === false) {
        categories.push(people('performer', 'Performer', championship.performers, { note: 'offline, actors and actresses together' }));
      } else {
        const loading = this.castWalk.loading;
        categories.push(people('actor', 'Actor', this.castWalk.actors, { loading }));
        categories.push(people('actress', 'Actress', this.castWalk.actresses, { loading }));
      }

      championship.crew
        .filter((c) => c.key !== 'director')
        .forEach((c) => categories.push(people(c.key, c.label, c.ranked)));

      return categories.filter((c) => c.winner || c.loading);
    },
    openCategory () {
      return this.championshipCategories.find((c) => c.key === this.openCategoryKey) || null;
    },
    crown () {
      return crownTimeline(this.library, getRating);
    },
    pantheonData () {
      return pantheon(this.library, getRating);
    },
    ties () {
      return tieStats(this.library, getRating);
    },
    // The next-up group already has its own row; don't show it twice.
    biggestTies () {
      return (this.ties?.biggest || []).filter((group) => group.score !== this.ties.next.score);
    },
    rewatches () {
      return rewatchStats(this.library);
    },
    marathon () {
      return marathonStats(this.library, { includeShorts: Boolean(this.$store.state.settings?.includeShorts) });
    },
    years () {
      const stats = yearStats(this.library, getRating, this.weights);
      if (this.yearSort !== 'rank') return stats;
      // A year with no score sorts last rather than to the top on a null.
      return [...stats].sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
    },
    standoutList () {
      return standouts(this.library, getRating, this.weights);
    },
    genres () {
      return genreStats(this.library, getRating, this.weights);
    }
  },
  watch: {
    // A new championship object means the decade or the library changed:
    // fold the runners-up away and restart the cast walk. Person lookups are
    // cached by name at module scope, so flipping back to a decade is free.
    championship: {
      immediate: true,
      handler () {
        this.openCategoryKey = null;
        this.startCastWalk();
        // A different decade is a different row: start it from its left
        // edge. Bug report (2026-09-02): "when I click a year here... it's
        // just leaving me scrolled horizontally wherever I happen to have
        // been." The pill strip keeps its scroll — the tapped pill is there.
        this.$nextTick(this.resetChampionshipScroll);
      }
    },
    // Portraits for whoever is on screen: the winners, plus the unfolded
    // field. Cast members already carry `details` from the walk; this is for
    // crew, who were never looked up.
    championshipCategories: {
      immediate: true,
      handler (categories) {
        categories.forEach((c) => {
          if (c.kind !== 'person') return;
          const shown = c.key === this.openCategoryKey ? c.field : c.field.slice(0, 1);
          shown.forEach((p) => this.ensurePortrait(p));
        });
      }
    }
  },
  mounted () {
    afterFrame(() => { this.painted = true; });
  },
  methods: {
    formatScore,
    resetChampionshipScroll () {
      const section = this.$refs.championshipSection;
      if (!section) return;
      section.querySelectorAll('.ds-poster-row').forEach((row) => {
        row.scrollLeft = 0;
      });
    },
    startCastWalk () {
      this.castSeq += 1;
      this.castWalk = { target: 0, index: 0, lookups: 0, loading: false, done: false, actors: [], actresses: [] };
      this.continueCastWalk(1);
    },
    // Walk the decade's ranked cast until Actor and Actress each hold
    // `target` people, or the list / lookup cap runs out. Someone TMDB can't
    // identify is skipped, as the Favorite sections do — a wrong crown is
    // worse than a missing one. A FOUND person with no definite reading
    // (not specified, non-binary) goes on both lists, per genderEligibility.
    async continueCastWalk (target) {
      const championship = this.championship;
      if (!championship || this.$store.state.isOnline === false) return;
      const walk = this.castWalk;
      const seq = this.castSeq;
      walk.target = Math.max(walk.target, target);
      if (walk.loading || walk.done) return;

      walk.loading = true;
      const performers = championship.performers;
      const wants = () => walk.actors.length < walk.target || walk.actresses.length < walk.target;
      while (walk.index < performers.length && walk.lookups < CAST_LOOKUP_CAP && wants()) {
        const performer = performers[walk.index];
        walk.index += 1;
        walk.lookups += 1;
        const details = await lookupPerson(performer.name);
        if (seq !== this.castSeq) return; // superseded by a newer decade
        if (!details) continue;
        const champion = { ...performer, details };
        if (isEligibleForActingCategory(details.gender, { isActress: false })) walk.actors.push(champion);
        if (isEligibleForActingCategory(details.gender, { isActress: true })) walk.actresses.push(champion);
      }
      walk.done = walk.index >= performers.length || walk.lookups >= CAST_LOOKUP_CAP;
      walk.loading = false;
    },
    ensurePortrait (person) {
      const name = person?.name;
      if (!name || person.details || Object.prototype.hasOwnProperty.call(this.portraits, name)) return;
      if (this.$store.state.isOnline === false) return;
      this.portraits[name] = null;
      this.loadPortrait(name);
    },
    async loadPortrait (name) {
      const details = await lookupPerson(name); // never throws: misses resolve to null
      this.portraits[name] = details?.profile_path || null;
    },
    // A poster for a film, a portrait for a person; '' when there's nothing
    // to show yet (the template falls back to the not-available image).
    imageFor (category, item) {
      if (!item) return '';
      if (category.kind === 'film') {
        return item.best?.movie?.poster_path ? this.poster(item.best) : '';
      }
      const path = item.details?.profile_path || this.portraits[item.name];
      return path ? `https://image.tmdb.org/t/p/w185${path}` : '';
    },
    toggleCategory (category) {
      if (this.openCategoryKey === category.key) {
        this.openCategoryKey = null;
        return;
      }
      this.openCategoryKey = category.key;
      if (category.key === 'actor' || category.key === 'actress') this.continueCastWalk(DECADE_DEFAULTS.depth);
    },
    async tapCompetitor (category, competitor, index) {
      if (category.kind === 'film') {
        this.goToMovie(competitor.best);
        return;
      }
      const details = competitor.details ?? await lookupPerson(competitor.name);
      this.selectedChampion = {
        person: { name: competitor.name, entries: competitor.entries, count: competitor.count, finalScore: competitor.score, details },
        roleLabel: `${category.label} of the ${this.championship.label}`,
        rank: index + 1,
        rankOf: category.field.length
      };
    },
    searchForChampion () {
      const name = this.selectedChampion?.person?.name;
      this.selectedChampion = null;
      if (name) this.$router.push({ name: 'Home', query: { search: encodeURIComponent(name) } });
    },
    selectChampionFilm (film) {
      this.selectedChampion = null;
      this.goToMovie(film);
    },
    poster (entry) {
      return `https://image.tmdb.org/t/p/w185${entry.movie.poster_path}`;
    },
    goToMovie (entry) {
      if (entry?.movie?.id == null) return;
      this.$router.push(`/movie/${entry.movie.id}`);
    },
    duration (minutes) {
      if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      const mins = Math.round(minutes % 60);
      return [days ? `${days}d` : null, hours ? `${hours}h` : null, `${mins}m`].filter(Boolean).join(' ');
    },
    gapLabel (days) {
      if (days < 1) return 'same day';
      if (days < 60) {
        const whole = Math.round(days);
        return `${whole} ${whole === 1 ? 'day' : 'days'}`;
      }
      if (days < 700) {
        const months = Math.round(days / 30.4);
        return `${months} ${months === 1 ? 'month' : 'months'}`;
      }
      return `${(days / 365.25).toFixed(1)} years`;
    }
  }
};
</script>

<style lang="scss" scoped>
.deep-stats {
  color: #eee;
  padding: 0.75rem 1rem 2rem;
}

.ds-title { margin: 0.25rem 0 0; }
.ds-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 1rem; }

.ds-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.ds-strip-item {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  display: flex;
  flex: 1 1 100px;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
}

.ds-strip-value { color: #ffc107; font-size: 1.15rem; font-weight: 700; }
.ds-strip-label { color: #ccc; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.4px; }

.ds-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 1rem;
  padding: 0.9rem 1rem;
}

.ds-section-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.25rem; }

/* Sideways rows carry most of this page now: a section is one row tall
   however much is in it. */
.crown-card-year {
  color: #fff;
  display: block;
  font-size: 0.72rem;
  font-weight: 700;
  margin-top: 0.2rem;
}

.crown-card.current .crown-card-year { color: #ffd700; }

.crown-current-tag {
  background: #ffd700;
  border-radius: 3px;
  color: #000;
  font-size: 0.58rem;
  margin-left: 0.25rem;
  padding: 0 3px;
  text-transform: uppercase;
}

.ds-poster-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.68rem;
  justify-content: center;
  padding: 0.3rem;
  text-align: center;
}

.standouts {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.standout-head {
  align-items: baseline;
  display: flex;
  gap: 0.4rem;
}

.standout-facet {
  /* #9a9a9a on this background is ~7:1. */
  color: #9a9a9a;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.standout-value {
  color: #fff;
  flex: 1 1 auto;
  font-size: 0.95rem;
  font-weight: 700;
  min-width: 0;
}

.standout-score {
  color: #b9b9b9;
  font-size: 0.95rem;
  font-weight: 700;
}

.standout-score.gold { color: #ffc107; }

.standout-detail {
  color: #b9b9b9;
  font-size: 0.72rem;
  margin: 0.1rem 0 0.3rem;
}
.ds-section-caption { color: #ccc; font-size: 0.78rem; margin: 0 0 0.75rem; }

.crown-timeline { display: flex; flex-direction: column; row-gap: 0.75rem; }

.crown-reign {
  align-items: center;
  border-left: none;
  display: flex;
  gap: 0.75rem;

  &.current .crown-name { color: #ffc107; }
}

.crown-poster { border-radius: 6px; height: 108px; width: 72px; object-fit: cover; flex: 0 0 72px; }
.crown-info { display: flex; flex-direction: column; min-width: 0; row-gap: 2px; }
.crown-year { color: #ccc; font-size: 0.75rem; font-weight: 700; }
.crown-current-tag {
  background: rgba(255, 193, 7, 0.15);
  border-radius: 999px;
  color: #ffc107;
  font-size: 0.65rem;
  margin-left: 0.4rem;
  padding: 0.1rem 0.45rem;
  text-transform: uppercase;
}
.crown-name { font-size: 0.95rem; font-weight: 600; }
.crown-detail { color: #ccc; font-size: 0.75rem; }
.crown-score { color: #ffc107; font-size: 1.05rem; font-weight: 700; margin-left: auto; }

.pantheon-category { margin-top: 0.75rem; }
.pantheon-label { color: #eee; font-size: 0.85rem; font-weight: 700; margin: 0 0 0.4rem; }
.pantheon-count { color: #999; font-size: 0.72rem; font-weight: 400; margin-left: 0.35rem; }
.genre-rank { color: #ffc107; }
.genre-score { color: #ffc107; float: right; }

.ds-poster-row {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
}

.ds-poster-card { cursor: pointer; flex: 0 0 92px; width: 92px; }
.ds-poster { border-radius: 6px; display: block; height: 138px; object-fit: cover; width: 92px; }
/* Left, not centred: these sit under a fixed-width poster, and centring made
   the label and the note under it disagree about where the card starts. */
.ds-poster-note { color: #ccc; display: block; font-size: 0.7rem; line-height: 1.25; margin-top: 0.25rem; }
.ds-poster-note.gold { color: #ffc107; }

/* Decade Championship. The pill strip is YearInReview's, so the two screens
   read as the same control. */
.ds-decade-scroller {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.2rem;
  -webkit-overflow-scrolling: touch;
}

.ds-decade-pill { flex-shrink: 0; min-height: 40px; white-space: nowrap; }

/* Bootstrap paints btn-outline-secondary's label #6c757d — ~2.6:1 on this
   surface, the same failure as .text-muted. */
.ds-decade-pill.btn-outline-secondary { border-color: #4a4a4a; color: #ccc; }

/* Press feedback is :active only — a tapped pill on iOS keeps :hover. */
.ds-decade-pill:active { transform: scale(0.96); }

.decade-count { margin-bottom: 0.5rem; }
.decade-looking { color: #ccc; }

/* Winners row: the page's standard sideways poster row, one card per
   category. Selection is shown by dimming siblings + a subtle scale, never
   a coloured outline. */
.champions { padding-bottom: 0.6rem; }

.champion { transition: opacity 0.15s ease, transform 0.15s ease; }
.champion:active { opacity: 0.7; }
.champions.has-open .champion:not(.open) { opacity: 0.45; }
.champion.open { transform: scale(1.03); }

.champion-category {
  /* #9a9a9a on #161616 is ~7:1. */
  color: #9a9a9a;
  display: block;
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  margin-top: 0.3rem;
  text-transform: uppercase;
}

/* Names flow to any number of lines; the card just gets taller. */
.champion-name { color: #fff; display: block; font-size: 0.74rem; font-weight: 700; line-height: 1.2; }
.champion-detail { color: #ccc; font-size: 0.72rem; margin: 0.3rem 0 0; }
.champion-score { color: #ffc107; font-weight: 700; }

/* The unfolded field for one category. */
.competitors {
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-top: 0.4rem;
  padding: 0.6rem 0.75rem;
}

.competitors-title { margin: 0 0 0.4rem; }
.competitor-list { list-style: none; margin: 0; padding: 0; }

.competitor {
  align-items: center;
  border-top: 1px solid #222;
  cursor: pointer;
  display: grid;
  column-gap: 0.6rem;
  grid-template-columns: 1.4rem 34px 1fr;
  grid-template-rows: auto auto;
  min-height: 44px;
  padding: 0.35rem 0;
}

.competitor:first-child { border-top: none; }
.competitor:active { opacity: 0.7; }
.competitor-rank { color: #ffc107; font-size: 0.8rem; font-weight: 700; grid-row: 1 / 3; }
.competitor-image { border-radius: 4px; display: block; grid-row: 1 / 3; height: 51px; object-fit: cover; width: 34px; }
.competitor-image-blank { background: #2b2b2b; }
.competitor-name { color: #eee; font-size: 0.85rem; font-weight: 600; line-height: 1.2; }
.competitor-detail { color: #ccc; font-size: 0.72rem; }

.ds-sort { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }

.ds-sort-btn {
  background: #101010;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  color: #ccc;
  font-size: 0.7rem;
  /* 40px minimum tap target. */
  min-height: 40px;
  padding: 0 0.85rem;
}

.ds-sort-btn.active { background: #ffc107; border-color: #ffc107; color: #101010; font-weight: 700; }
.ds-sort-btn:active { opacity: 0.75; }

.day-posters { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 0.3rem; }

/* Small on purpose — they're a reminder of the day, not the subject. */
.day-poster {
  border-radius: 3px;
  cursor: pointer;
  display: block;
  height: 45px;
  object-fit: cover;
  width: 30px;
}

.day-poster:active { opacity: 0.7; }

.top-days { list-style: none; margin: 0; padding: 0; }
.top-day { align-items: center; display: flex; gap: 0.75rem; padding: 0.35rem 0; }
.top-day-rank {
  align-items: center;
  background: #101010;
  border: 1px solid #3a3a3a;
  border-radius: 50%;
  color: #ffc107;
  display: flex;
  flex: 0 0 28px;
  font-size: 0.8rem;
  font-weight: 700;
  height: 28px;
  justify-content: center;
}
.top-day-info { display: flex; flex-direction: column; }
.top-day-date { font-size: 0.85rem; font-weight: 600; }
.top-day-detail { color: #ccc; font-size: 0.72rem; }

.year-cards { display: flex; flex-direction: column; row-gap: 0.6rem; }
.year-card {
  align-items: center;
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  display: flex;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
}
.year-label { color: #ffc107; font-size: 1.05rem; font-weight: 700; flex: 0 0 3.2rem; }
.year-numbers { display: flex; flex-direction: column; row-gap: 2px; }
.year-stat { color: #ccc; font-size: 0.78rem; }
.year-stat strong { color: #eee; }
.year-stat.gold strong { color: #ffc107; }
.year-top-poster { border-radius: 6px; cursor: pointer; height: 84px; margin-left: auto; width: 56px; object-fit: cover; }
</style>
