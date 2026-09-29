<template>
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

    <!-- One winner per category in a sideways row: a portrait for a person,
         a poster for the film. Tap a winner to unfold the runners-up beneath
         the row. Fourth layout of the day (2026-09-02): "just a horizontally
         scrolling list... with one poster or photograph per winner", and "I
         can click on any of the results and see... further down the line,
         other competitors." -->
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
          src="../../assets/images/Image_not_available.png"
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
          <img v-else-if="openCategory.kind === 'person'" src="../../assets/images/Image_not_available.png" :alt="competitor.name" class="competitor-image">
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
</template>

<script>
// Eras tab: who dominated each RELEASE decade (2026-09-02). Pure engine in
// decadeChampionship.js; this component renders it and resolves what the
// stored library can't say on its own (cast gender, crew portraits).
import PersonModal from '../PersonModal.vue';
import { memoByIdentity } from '../../utils/memoByIdentity.js';
import { getRating } from '../../assets/javascript/GetRating.js';
import { decadesAvailable, defaultDecade, decadeChampionship, DECADE_DEFAULTS } from '../../assets/javascript/decadeChampionship.js';
import { isEligibleForActingCategory } from '../../assets/javascript/genderEligibility.js';
import { formatScore } from '../../assets/javascript/formatScore.js';
import { lookupPerson } from '../../utils/personLookup.js';
import statsSection, { libraryMemo } from './statsSection.js';

// The Actor/Actress split walks the decade's ranked cast with one TMDB
// lookup per name until both lists are as deep as asked. A thin decade may
// never fill one of them; this stops the walk from turning into a lookup
// per credited actor in the decade.
const CAST_LOOKUP_CAP = 40;

const decadesMemo = memoByIdentity((library) => decadesAvailable(library, getRating));
const championshipMemo = libraryMemo(decadeChampionship);

export default {
  name: 'DecadeChampionship',
  components: { PersonModal },
  mixins: [statsSection],
  data () {
    return {
      // The tapped pill; null means "the best-evidenced decade" (see
      // activeDecade).
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
    decades () {
      return decadesMemo(this.library);
    },
    // Falls back to the decade with the most rated films — both before any
    // tap and if the library changes under a selection.
    activeDecade () {
      if (this.decades.some((candidate) => candidate.decade === this.selectedDecade)) return this.selectedDecade;
      return defaultDecade(this.decades);
    },
    championship () {
      if (this.activeDecade === null) return null;
      return championshipMemo(this.library, this.weights, this.activeDecade);
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
  methods: {
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
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/stats-section';

/* The pill strip is YearInReview's, so the screens read as one control. */
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

/* The selected pill wears the tab's accent, with black on it as the tab bar
   does. Press feedback is :active only — a tapped pill on iOS keeps :hover. */
.ds-decade-pill.btn-primary { background: var(--accent, #0d6efd); border-color: var(--accent, #0d6efd); color: #000; font-weight: 700; }
.ds-decade-pill:active { transform: scale(0.96); }

.decade-count { margin-bottom: 0.5rem; }
.decade-looking { color: #ccc; }

/* Selection is shown by dimming siblings + a subtle scale, never a coloured
   outline. */
.champions { padding-bottom: 0.6rem; }

.champion { transition: opacity 0.15s ease, transform 0.15s ease; }
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
.champion-score { color: var(--accent, #ffc107); font-weight: 700; }

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
.competitor-rank { color: var(--accent, #ffc107); font-size: 0.8rem; font-weight: 700; grid-row: 1 / 3; }
.competitor-image { border-radius: 4px; display: block; grid-row: 1 / 3; height: 51px; object-fit: cover; width: 34px; }
.competitor-image-blank { background: #2b2b2b; }
.competitor-name { color: #eee; font-size: 0.85rem; font-weight: 600; line-height: 1.2; }
.competitor-detail { color: #ccc; font-size: 0.72rem; }
</style>
