<template>
  <div class="friend-comparison">
    <BackLink/>

    <div v-if="!profile" class="fc-section">
      <p class="fc-empty">No published profile from this friend yet — they may not have opened the app since accepting.</p>
    </div>

    <template v-else>
      <h1 class="fc-title">You &amp; {{ profile.name }}</h1>
      <p class="fc-subtitle">{{ profile.counts?.titles || 0 }} titles in their library<span v-if="comparison && comparison.sharedCount"> · {{ comparison.sharedCount }} you've both rated</span></p>

      <!-- Headline numbers. Each one now says what it means underneath: the
           labels alone didn't ("I don't really know what alignment means...
           it's telling me two different numbers"). -->
      <div v-if="comparison && comparison.sharedCount" class="fc-strip">
        <div class="fc-strip-item">
          <span class="fc-strip-value">{{ formatScore(comparison.alignment) }}</span>
          <span class="fc-strip-label">alignment</span>
        </div>
        <div class="fc-strip-item">
          <span class="fc-strip-value">{{ comparison.myAverage.toFixed(2) }}</span>
          <span class="fc-strip-label">your average</span>
        </div>
        <div class="fc-strip-item">
          <span class="fc-strip-value">{{ comparison.theirAverage.toFixed(2) }}</span>
          <span class="fc-strip-label">their average</span>
        </div>
      </div>
      <p v-if="comparison && comparison.sharedCount" class="fc-strip-note">
        <strong>Alignment</strong> is 10 minus how far apart your scores usually are — you two
        typically land {{ formatScoreGap(comparison.averageGap) }} apart on the {{ comparison.sharedCount }}
        {{ comparison.sharedCount === 1 ? 'movie' : 'movies' }} you've both rated, so 10 would mean identical scores every time.
      </p>
      <p v-if="comparison && comparison.myLogScore != null" class="fc-strip-note">
        <strong>Log Score</strong> weights a library by depth as well as quality, so a big
        well-liked one outscores a handful of favourites: yours across those shared movies is
        {{ comparison.myLogScore.toFixed(2) }}, {{ profile.name }}'s is {{ comparison.theirLogScore.toFixed(2) }}.
      </p>

      <!-- What they've been watching, high on the page: it wasn't here at
           all ("somewhere on the individual person's page, I should see their
           most recent views... And it should be higher up on their page"). -->
      <section v-if="recentViews.length" class="fc-section">
        <h2 class="fc-section-title">{{ profile.name }} recently watched</h2>
        <div class="fc-poster-row">
          <div v-for="item in recentViews" :key="`recent-${item.id}-${item.at}`" class="fc-poster-card" @click="openFilm(item.id, item.t, item.p)">
            <img v-if="item.p" :src="poster(item.p)" :alt="item.t" class="fc-poster">
            <div v-else class="fc-poster fc-poster-blank">{{ item.t }}</div>
            <span class="fc-poster-note">{{ formatScore(item.r) }}</span>
            <span v-if="watchedAgo(item)" class="fc-poster-when">{{ watchedAgo(item) }}</span>
          </div>
        </div>
      </section>

      <!-- Shared loves -->
      <section v-if="comparison && comparison.sharedLoves && comparison.sharedLoves.length" class="fc-section">
        <h2 class="fc-section-title">You both love</h2>
        <div class="fc-poster-row">
          <div v-for="item in comparison.sharedLoves" :key="item.entry.dbKey" class="fc-poster-card" @click="goToMovie(item.entry.movie.id)">
            <img v-if="item.entry.movie.poster_path" :src="poster(item.entry.movie.poster_path)" :alt="item.entry.movie.title" class="fc-poster">
            <span class="fc-poster-note">{{ formatScore(item.mine) }} · {{ formatScore(item.theirs) }}</span>
          </div>
        </div>
      </section>

      <!-- Their loves I haven't seen -->
      <section v-if="comparison && comparison.theyLoveUnseen && comparison.theyLoveUnseen.length" class="fc-section">
        <h2 class="fc-section-title">{{ profile.name }} loves these — you haven't rated them</h2>
        <div class="fc-poster-row">
          <div v-for="item in comparison.theyLoveUnseen" :key="item.id" class="fc-poster-card" @click="openFilm(item.id, item.t, item.p)">
            <img v-if="item.p" :src="poster(item.p)" :alt="item.t" class="fc-poster">
            <div v-else class="fc-poster fc-poster-blank">{{ item.t }}</div>
            <span class="fc-poster-note">{{ formatScore(item.r) }}</span>
          </div>
        </div>
      </section>

      <!-- Their whole library, searchable and cut by year, genre, director
           (Matt, 2026-11-13: "look through one of my friends … whole library
           and … search by year or by genre or by whatever category I want").
           Rows and filtering live in friendLibrary.js. -->
      <section v-if="libraryRows.length" class="fc-section fc-library">
        <h2 class="fc-section-title">{{ profile.name }}'s library</h2>
        <p class="fc-caption">{{ libraryResults.length }} of {{ visibleLibraryCount }} {{ visibleLibraryCount === 1 ? 'film' : 'films' }}</p>
        <input
          v-model="libraryQuery"
          type="search"
          class="form-control fc-library-search"
          placeholder="Search titles, years, genres, directors"
          aria-label="Search their library"
        >
        <div class="fc-facet-row">
          <button
            v-for="facet in facets"
            :key="facet.key"
            type="button"
            class="fc-facet"
            :class="{ open: openFacet === facet.key }"
            @click="toggleFacet(facet.key)"
          >{{ facet.label }}</button>
        </div>
        <div v-if="openFacet" class="fc-option-row">
          <span v-if="!openFacetOptions.length" class="fc-caption">Nothing to pick from yet.</span>
          <button
            v-for="option in openFacetOptions"
            :key="`${openFacet}-${option.value}`"
            type="button"
            class="fc-option"
            :class="{ picked: isChipPicked(openFacet, option.value) }"
            @click="toggleChip(openFacet, option.value)"
          >{{ option.label }} <span class="fc-option-count">{{ option.count }}</span></button>
        </div>
        <div v-if="libraryChips.length" class="fc-chip-row">
          <button
            v-for="chip in libraryChips"
            :key="`chip-${chip.facet}-${chip.value}`"
            type="button"
            class="fc-chip"
            :aria-label="`Remove ${chipLabel(chip)}`"
            @click="toggleChip(chip.facet, chip.value)"
          >{{ chipLabel(chip) }} <i class="bi bi-x-lg" aria-hidden="true"></i></button>
        </div>
        <label class="fc-sort">
          <span>Sort by</span>
          <select v-model="librarySort" class="form-select form-select-sm">
            <option v-for="option in sorts" :key="option.key" :value="option.key">{{ option.label }}</option>
          </select>
        </label>
        <!-- Films a chip couldn't place because their year, genre or director
             hasn't reached this phone yet (report, 2026-11-13: only films
             the reader had also seen were showing). Said, not hidden. -->
        <p v-if="libraryUnknownCount" class="fc-caption fc-library-unknown">
          {{ libraryUnknownCount }} more {{ libraryUnknownCount === 1 ? 'film' : 'films' }} might fit, but {{ profile.name }}'s
          app hasn't sent {{ libraryUnknownCount === 1 ? 'its' : 'their' }} {{ unknownFactsLabel }} yet. They'll appear once {{ profile.name }} next opens Cinema Roll.
        </p>
        <p v-if="!libraryResults.length" class="fc-empty">Nothing in {{ profile.name }}'s library matches that.</p>
        <!-- The list scrolls inside a fixed-height box, controls stay above it
             (Matt, 2026-11-13: "fit it into the same size vertical space and
             internally scroll"). Forty rows at a time; the next forty load as
             the box nears its bottom. -->
        <div
          v-else
          ref="libraryList"
          class="fc-scroll-list fc-library-list"
          @scroll.passive="onLibraryScroll"
        >
          <div
            v-for="row in libraryResults.slice(0, libraryShown)"
            :key="`lib-${row.id}`"
            class="fc-versus-row fc-library-row"
            @click="openFilm(row.id, row.title, row.poster)"
          >
            <img v-if="row.poster" :src="poster(row.poster)" :alt="row.title" class="fc-thumb" loading="lazy">
            <div v-else class="fc-thumb fc-poster-blank"></div>
            <div class="fc-versus-info">
              <span class="fc-row-name">{{ row.title }}<span v-if="row.year" class="fc-row-year"> ({{ row.year }})</span></span>
              <span v-if="libraryRowDetail(row)" class="fc-versus-scores">{{ libraryRowDetail(row) }}</span>
              <span v-if="row.at" class="fc-versus-scores">Watched {{ watchedOn(row.at) }}</span>
              <span v-if="myScores.has(row.id)" class="fc-versus-scores fc-library-mine">You: {{ formatScore(myScores.get(row.id)) }}</span>
            </div>
            <span class="fc-gap-badge">{{ formatScore(row.score) }}</span>
          </div>
        </div>
      </section>

      <!-- Criterion tendencies -->
      <section v-if="comparison && comparison.criterionGaps" class="fc-section">
        <h2 class="fc-section-title">Where your tastes differ</h2>
        <p class="fc-caption">Average difference per criterion across everything you've both rated. Right of center means you score it higher than {{ profile.name }} does.</p>
        <div v-for="gap in comparison.criterionGaps" :key="gap.criterion" class="fc-gap-row">
          <span class="fc-gap-name">{{ criterionLabel(gap.criterion) }}</span>
          <span class="fc-gap-bar">
            <span class="fc-gap-track">
              <span class="fc-gap-fill" :class="{ negative: gap.gap < 0 }" :style="gapBarStyle(gap.gap)"></span>
            </span>
          </span>
          <span class="fc-gap-value" :class="{ negative: gap.gap < 0 }">{{ gap.gap > 0 ? '+' : '' }}{{ gap.gap.toFixed(2) }}</span>
        </div>
      </section>

      <!-- Disagreements -->
      <section v-if="comparison && comparison.biggestDisagreements && comparison.biggestDisagreements.length" class="fc-section">
        <h2 class="fc-section-title">Biggest disagreements</h2>
        <p v-if="anyCriteriaDetail" class="fc-caption">Tap a movie to see the criterion-by-criterion breakdown.</p>
        <div class="fc-scroll-list">
        <div v-for="item in comparison.biggestDisagreements" :key="item.entry.dbKey">
          <div class="fc-versus-row" @click="toggleDetail(item)">
            <img v-if="item.entry.movie.poster_path" :src="poster(item.entry.movie.poster_path)" :alt="item.entry.movie.title" class="fc-thumb">
            <div class="fc-versus-info">
              <span class="fc-row-name">{{ item.entry.movie.title }}</span>
              <span class="fc-versus-scores">You {{ formatScore(item.mine) }} · {{ profile.name }} {{ formatScore(item.theirs) }}</span>
            </div>
            <span class="fc-gap-badge">{{ formatScoreGap(item.gap) }}</span>
          </div>
          <div v-if="expandedKey === item.entry.dbKey" class="fc-detail">
            <div v-if="item.myViewings?.length || item.theirViewings?.length" class="fc-viewings">
              <p v-if="item.myViewings?.length" class="fc-viewing-line">You: {{ viewingLabel(item.myViewings) }}</p>
              <p v-if="item.theirViewings?.length" class="fc-viewing-line">{{ profile.name }}: {{ viewingLabel(item.theirViewings) }}</p>
            </div>
          </div>
          <div v-if="expandedKey === item.entry.dbKey && detailFor(item)" class="fc-detail">
            <div class="fc-detail-head"><span></span><span>You</span><span>{{ profile.name }}</span></div>
            <div v-for="row in detailFor(item)" :key="row.criterion" class="fc-detail-row">
              <span class="fc-detail-name">{{ criterionLabel(row.criterion) }}</span>
              <span :class="{ 'fc-detail-win': row.mine > row.theirs }">{{ formatScore(row.mine) }}</span>
              <span :class="{ 'fc-detail-win': row.theirs > row.mine }">{{ formatScore(row.theirs) }}</span>
            </div>
          </div>
        </div>
        </div>
      </section>

      <!-- Their public shelf — always available, and the whole story when
           they share composites but not the full ratings map. -->
      <section v-if="profile.topShelf && profile.topShelf.length" class="fc-section">
        <h2 class="fc-section-title">Their top shelf</h2>
        <div class="fc-poster-row">
          <div v-for="item in profile.topShelf" :key="item.id" class="fc-poster-card" @click="openFilm(item.id, item.t, item.p)">
            <img v-if="item.p" :src="poster(item.p)" :alt="item.t" class="fc-poster">
            <div v-else class="fc-poster fc-poster-blank">{{ item.t }}</div>
            <span class="fc-poster-note">{{ formatScore(item.r) }}</span>
          </div>
        </div>
      </section>

      <section v-if="comparison && !comparison.sharedCount" class="fc-section">
        <p class="fc-empty">{{ profile.ratings ? "No overlap yet — you haven't rated any of the same movies." : `${profile.name} isn't sharing movie-by-movie scores, so there's nothing to compare directly — their shelf above is what they've made public.` }}</p>
      </section>

      <div class="fc-remove">
        <button type="button" class="btn btn-outline-danger btn-sm" @click="unfriend">Remove friend</button>
      </div>

      <!-- A film I have not rated opens this sheet, as the Film Club feed does:
           MovieDetail only knows my own library and bounces anything else to
           /film-club (report, 2026-11-14: tapping a film in Matt's 2026 list
           "just took me back to the friends list"). -->
      <MoviePreview :movie="previewing" @close="previewing = null" @rate="rateFromPreview"/>
    </template>
  </div>
</template>

<script>
// Per-friend comparison (/film-club/:friendKey). Overlap math is pure in
// social.js (compareWithFriend); the criterion drill-down renders only when
// both sides have a breakdown — theirs exists only behind their own
// shareCriteria opt-in.
import BackLink from './games/BackLink.vue';
import MoviePreview from './MoviePreview.vue';
import { timeAgo } from '../assets/javascript/timeAgo.js';
import { getRating } from '../assets/javascript/GetRating.js';
import { compareWithFriend, CRITERIA } from '../assets/javascript/social.js';
import { logScoreSettings } from '../assets/javascript/logScore.js';
import { formatScore, formatScoreGap } from '../assets/javascript/formatScore.js';
import { includeShortsSetting } from '../assets/javascript/shorts.js';
import { friendLibraryRows, filterFriendLibrary, filmsWithUnknownFacts, facetOptions, facetValueLabel, FACETS, SORTS } from '../assets/javascript/friendLibrary.js';

const LIBRARY_PAGE = 40;
// How close to the bottom of the library box (px) the next page loads.
const LIBRARY_LOAD_MARGIN = 300;

export default {
  name: 'FriendComparison',
  components: { BackLink, MoviePreview },
  data () {
    return {
      expandedKey: null,
      // The film being previewed (not in my library), or null.
      previewing: null,
      libraryQuery: '',
      libraryChips: [],
      librarySort: 'score',
      libraryShown: LIBRARY_PAGE,
      openFacet: null,
      facets: FACETS,
      sorts: SORTS
    };
  },
  computed: {
    // The friend's own recent feed, straight off their published profile —
    // the same `recent` list the club-wide feed is built from.
    recentViews () {
      return (this.profile?.recent || []).filter((item) => item && item.at).slice(0, 12);
    },
    friendKey () {
      return this.$route.params.friendKey;
    },
    profile () {
      // Native friend or a friend on another app — same shape either way.
      return this.$store.getters.filmClubProfiles?.[this.friendKey] || null;
    },
    library () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    globalAvg () {
      const scores = this.library.map((entry) => getRating(entry)?.calculatedTotal).filter(Number.isFinite);
      if (!scores.length) return null;
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    },
    comparison () {
      if (!this.profile) return null;
      return compareWithFriend(this.library, getRating, this.profile, {
        globalAvg: this.globalAvg,
        weights: logScoreSettings(this.$store.state.settings)
      });
    },
    // Every film the friend has published, joined to my library for the
    // year/genre/director a not-yet-updated friend doesn't send.
    libraryRows () {
      return friendLibraryRows(this.profile, this.library);
    },
    includeShorts () {
      return includeShortsSetting(this.$store.state);
    },
    // My score per TMDB id, so each of their rows can say whether I've seen
    // it — the list is all of theirs, and this makes that plain.
    // Every TMDB id in my library (films and TV), the same set MovieDetail
    // looks a film up in.
    myIds () {
      const all = this.$store.getters.allMediaAsArray || this.library;
      return new Set(all.map((entry) => entry?.movie?.id).filter((id) => id != null).map(Number));
    },
    myScores () {
      const scores = new Map();
      this.library.forEach((entry) => {
        const id = entry?.movie?.id;
        const score = id == null ? null : getRating(entry)?.calculatedTotal;
        if (Number.isFinite(score)) scores.set(Number(id), score);
      });
      return scores;
    },
    libraryUnknownCount () {
      return filmsWithUnknownFacts(this.libraryRows, {
        query: this.libraryQuery,
        chips: this.libraryChips,
        includeShorts: this.includeShorts
      });
    },
    unknownFactsLabel () {
      const names = { decade: 'release year', year: 'release year', genre: 'genre', director: 'director', watched: 'viewing date' };
      const picked = [...new Set(this.libraryChips.map((chip) => names[chip.facet]).filter(Boolean))];
      return picked.length > 1 ? `${picked.slice(0, -1).join(', ')} or ${picked[picked.length - 1]}` : (picked[0] || 'details');
    },
    visibleLibraryCount () {
      return this.includeShorts ? this.libraryRows.length : this.libraryRows.filter((row) => !row.short).length;
    },
    libraryResults () {
      return filterFriendLibrary(this.libraryRows, {
        query: this.libraryQuery,
        chips: this.libraryChips,
        includeShorts: this.includeShorts,
        sort: this.librarySort
      });
    },
    // Options counted within what the other chips already leave, so a pick
    // never offers a dead end.
    openFacetOptions () {
      if (!this.openFacet) return [];
      const others = this.libraryChips.filter((chip) => chip.facet !== this.openFacet);
      const pool = filterFriendLibrary(this.libraryRows, { query: this.libraryQuery, chips: others, includeShorts: this.includeShorts });
      return facetOptions(pool, this.openFacet);
    },
    anyCriteriaDetail () {
      return (this.comparison?.biggestDisagreements || []).some((item) =>
        this.detailFor(item) || item.myViewings?.length || item.theirViewings?.length);
    }
  },
  created () {
    this.$store.dispatch('attachSocialListeners');
    if (!this.profile) {
      this.$store.dispatch('fetchFriendProfiles');
      this.$store.dispatch('syncExternalFriends');
    }
  },
  watch: {
    libraryQuery () { this.restartLibraryList(); },
    libraryChips () { this.restartLibraryList(); },
    librarySort () { this.restartLibraryList(); }
  },
  methods: {
    // Template-exposed; two decimals on every score (bug report).
    formatScore,
    formatScoreGap,
    // `d`: from a friend's end-of-day copy — a day, never "3 hours ago".
    watchedAgo (item) {
      return timeAgo(item.at, Date.now(), { dayOnly: Boolean(item.d) });
    },
    toggleFacet (key) {
      this.openFacet = this.openFacet === key ? null : key;
    },
    isChipPicked (facet, value) {
      return this.libraryChips.some((chip) => chip.facet === facet && chip.value === value);
    },
    toggleChip (facet, value) {
      this.libraryChips = this.isChipPicked(facet, value)
        ? this.libraryChips.filter((chip) => !(chip.facet === facet && chip.value === value))
        : [...this.libraryChips, { facet, value }];
    },
    // Near the bottom of the box: draw the next page.
    onLibraryScroll (event) {
      const box = event?.target;
      if (!box || this.libraryShown >= this.libraryResults.length) return;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - LIBRARY_LOAD_MARGIN) {
        this.libraryShown += LIBRARY_PAGE;
      }
    },
    // A new search, filter or sort starts the box over at the top.
    restartLibraryList () {
      this.libraryShown = LIBRARY_PAGE;
      const box = this.$refs.libraryList;
      if (box) box.scrollTop = 0;
    },
    chipLabel (chip) {
      const label = facetValueLabel(chip.facet, chip.value);
      return chip.facet === 'watched' ? `Watched in ${label}` : label;
    },
    libraryRowDetail (row) {
      const parts = [];
      if (row.genres.length) parts.push(row.genres.slice(0, 2).join(', '));
      if (row.directors.length) parts.push(row.directors.join(' & '));
      return parts.join(' · ');
    },
    watchedOn (at) {
      return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    },
    criterionLabel (key) {
      return key.charAt(0).toUpperCase() + key.slice(1);
    },
    // Bar from center: half the track is one full point of gap, capped.
    gapBarStyle (gap) {
      const width = Math.min(50, Math.abs(gap) * 25);
      return gap >= 0
        ? { left: '50%', width: `${width}%` }
        : { right: '50%', width: `${width}%` };
    },
    detailFor (item) {
      if (!item.myCriteria || !item.theirCriteria) return null;
      const rows = CRITERIA.map((criterion, i) => ({
        criterion,
        mine: item.myCriteria[i],
        theirs: item.theirCriteria[i]
      })).filter((row) => row.mine >= 0 && row.theirs >= 0);
      return rows.length ? rows : null;
    },
    // "Theater · Mar 2019, then Bluray · Aug 2024"
    viewingLabel (viewings) {
      return (viewings || []).slice(0, 3).map((viewing) => {
        const when = new Date(viewing.at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        return viewing.m ? `${viewing.m} · ${when}` : when;
      }).join(', ');
    },
    toggleDetail (item) {
      if (!this.detailFor(item) && !item.myViewings?.length && !item.theirViewings?.length) {
        this.goToMovie(item.entry.movie.id);
        return;
      }
      this.expandedKey = this.expandedKey === item.entry.dbKey ? null : item.entry.dbKey;
    },
    poster (path) {
      return `https://image.tmdb.org/t/p/w185${path}`;
    },
    goToMovie (tmdbId) {
      if (tmdbId == null) return;
      this.$router.push(`/movie/${tmdbId}`);
    },
    // A film of theirs: my own page if I have rated it, otherwise the preview
    // sheet (summary, where to watch, the club's scores, "rate it").
    openFilm (tmdbId, title, posterPath) {
      if (tmdbId == null) return;
      if (this.myIds.has(Number(tmdbId))) {
        this.goToMovie(tmdbId);
        return;
      }
      const source = { id: Number(tmdbId), title: title || '', poster_path: posterPath || null, release_date: '', overview: '' };
      this.previewing = { id: source.id, title: source.title, poster_path: source.poster_path, source };
    },
    rateFromPreview (media) {
      this.previewing = null;
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
    unfriend () {
      this.$store.dispatch('removeFriend', this.friendKey);
      this.$router.push('/film-club');
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/screen-top';
.friend-comparison {
  color: #eee;
  min-width: 0;
  padding: $screen-top-gap 1rem 2rem;
  width: 100%;
}

.fc-title { margin: 0; }
.fc-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 1rem; }
.fc-empty { color: #ccc; font-size: 0.85rem; margin: 0; }
.fc-caption { color: #ccc; font-size: 0.75rem; margin: 0 0 0.5rem; }

.fc-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.fc-strip-item {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  display: flex;
  flex: 1 1 100px;
  flex-direction: column;
  padding: 0.5rem 0.75rem;
}

.fc-strip-value { color: #ffc107; font-size: 1.15rem; font-weight: 700; }
.fc-strip-label { color: #ccc; font-size: 0.7rem; letter-spacing: 0.4px; text-transform: uppercase; }

.fc-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
}

.fc-section-title { font-size: 1.05rem; margin: 0 0 0.5rem; }

/* Explains the headline numbers directly under them. #b9b9b9 on the panel is
   ~8:1; .text-muted would fail. */
.fc-strip-note {
  color: #b9b9b9;
  font-size: 0.75rem;
  line-height: 1.35;
  margin: 0 0 0.5rem;
}

.fc-strip-note strong { color: #eee; }

/* How fresh the viewing is. */
.fc-poster-when {
  color: #9a9a9a;
  display: block;
  font-size: 0.62rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Twelve rows that each expand — far too tall to sit in the flow. */
.fc-scroll-list {
  max-height: 18rem;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.fc-gap-row {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.fc-gap-name { flex: 0 0 7em; font-size: 0.85rem; }

.fc-gap-bar { flex: 1 1 auto; min-width: 0; }

.fc-gap-track {
  background: #222;
  border-radius: 4px;
  display: block;
  height: 8px;
  position: relative;

  &::after {
    background: #555;
    bottom: -2px;
    content: '';
    left: 50%;
    position: absolute;
    top: -2px;
    width: 1px;
  }
}

.fc-gap-fill {
  background: #ffc107;
  border-radius: 4px;
  bottom: 0;
  position: absolute;
  top: 0;

  &.negative { background: #6ea8fe; }
}

.fc-gap-value {
  color: #ffc107;
  flex: 0 0 3.2em;
  font-size: 0.8rem;
  font-weight: 700;
  text-align: right;

  &.negative { color: #6ea8fe; }
}

.fc-versus-row {
  align-items: flex-start;
  border-top: 1px solid #2e2e2e;
  display: flex;
  gap: 0.6rem;
  padding: 0.55rem 0;

  &:active { background: #222; }
}

.fc-thumb {
  border-radius: 4px;
  flex: 0 0 auto;
  height: 69px;
  object-fit: cover;
  width: 46px;
}

.fc-versus-info { display: flex; flex: 1 1 auto; flex-direction: column; gap: 0.25rem; min-width: 0; }
.fc-row-name { font-weight: 600; overflow-wrap: anywhere; }
.fc-versus-scores { color: #ccc; font-size: 0.8rem; }

.fc-gap-badge {
  background: #222;
  border-radius: 8px;
  color: #ffc107;
  flex: 0 0 auto;
  font-weight: 700;
  padding: 0.2rem 0.5rem;
}

.fc-detail {
  background: #1c1c1c;
  border-radius: 8px;
  margin: 0 0 0.5rem;
  padding: 0.5rem 0.75rem;
}

.fc-viewings { padding-bottom: 0.25rem; }

.fc-viewing-line {
  color: #ccc;
  font-size: 0.75rem;
  margin: 0;
}

.fc-detail-head,
.fc-detail-row {
  display: grid;
  font-size: 0.8rem;
  gap: 0.4rem;
  grid-template-columns: 1fr 3em 3em;
  padding: 0.15rem 0;
  text-align: right;
}

.fc-detail-head { color: #ccc; font-size: 0.7rem; letter-spacing: 0.4px; text-transform: uppercase; }
.fc-detail-name { color: #ccc; text-align: left; }
.fc-detail-win { color: #ffc107; font-weight: 700; }

.fc-poster-row {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.fc-poster-card { flex: 0 0 auto; width: 74px; }

.fc-poster {
  border-radius: 6px;
  display: block;
  height: 111px;
  object-fit: cover;
  width: 74px;
}

.fc-poster-blank {
  align-items: center;
  background: #222;
  color: #ccc;
  display: flex;
  font-size: 0.6rem;
  justify-content: center;
  overflow: hidden;
  padding: 0.25rem;
  text-align: center;
}

.fc-poster-note {
  color: #ccc;
  display: block;
  font-size: 0.65rem;
  margin-top: 0.2rem;
  text-align: center;
}

.fc-library-search {
  background: #222;
  border-color: #3a3a3a;
  color: #eee;
  margin-bottom: 0.5rem;

  &:focus { background: #222; color: #eee; }
  /* ~6:1 on #222; Bootstrap's default placeholder grey fails here. */
  &::placeholder { color: #9a9a9a; }
}

.fc-facet-row,
.fc-option-row,
.fc-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

/* Option lists can run to dozens of years or directors: cap and scroll. */
.fc-option-row { max-height: 9.5rem; overflow-y: auto; -webkit-overflow-scrolling: touch; }

.fc-facet,
.fc-option,
.fc-chip {
  background: #222;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  color: #eee;
  font-size: 0.8rem;
  min-height: 40px;
  padding: 0.3rem 0.8rem;

  &:active { background: #333; }
}

.fc-facet.open { border-color: #ffc107; color: #ffc107; }
.fc-option.picked { background: #ffc107; border-color: #ffc107; color: #161616; }
.fc-option.picked .fc-option-count { color: #333; }
.fc-option-count { color: #b9b9b9; font-size: 0.7rem; margin-left: 0.2rem; }
.fc-chip { background: #ffc107; border-color: #ffc107; color: #161616; font-weight: 600; }

.fc-sort {
  align-items: center;
  color: #ccc;
  display: flex;
  font-size: 0.8rem;
  gap: 0.5rem;
  margin-bottom: 0.25rem;

  .form-select { background-color: #222; border-color: #3a3a3a; color: #eee; min-width: 0; width: auto; }
}

.fc-library-row { cursor: pointer; }
.fc-row-year { color: #ccc; font-weight: 400; }

/* Same height as the other scroll list; the box itself is the scroller. */
.fc-library-list { margin-top: 0.25rem; overscroll-behavior: contain; }

.fc-remove {
  display: flex;
  justify-content: center;
  padding: 0.5rem 0 0;
}
</style>
