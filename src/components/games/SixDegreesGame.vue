<template>
  <div class="six-degrees-game">
    <BackLink/>
    <GameHowTo/>

    <!-- Bug report: needs a well-connected cast graph, more than the bare
         GamesHub gate guarantees. Same "help me get started" quick-pick
         suggestions as GamesHub/Connections/Home.vue's new-user onboarding. -->
    <div v-if="!pair" class="not-enough-movies">
      <p>Couldn't find a well-connected pair of movies in your library yet — rate a few more (especially ones sharing cast members) and try again.</p>
      <!-- Same difficulty picker as the main view below - tapping a segment
           picks AND immediately starts a pair at that difficulty (also
           useful even at the default "Any" tier - pickConnectedPair's
           search is randomized, so a retry can occasionally succeed where
           a prior attempt didn't). -->
      <div class="new-game-panel">
        <span class="difficulty-picker-label">New game:</span>
        <div class="difficulty-segments">
          <button
            v-for="level in difficultyOptions"
            :key="level.key"
            type="button"
            class="difficulty-segment"
            :class="[level.key, { active: selectedDifficulty === level.key }]"
            @click="selectDifficulty(level.key)"
          >{{ level.label }}</button>
        </div>
      </div>
      <NewRatingSearch value="" :suggestionsMode="true"/>
    </div>

    <template v-else>
      <!-- The description is replaced by the win/reveal message once the
           round ends, in the SAME spot at the top (bug report: "'Connected
           in X hops...' it looks bad. Let's instead put that message at
           the top in place of the input and the game description"). -->
      <p v-if="status === 'playing'" class="game-subtitle">Connect these two through shared cast members or directors.</p>
      <p v-else class="result-message" :class="status">
        <template v-if="status === 'won'">
          Connected in {{ hopsSoFar }} hop{{ hopsSoFar === 1 ? '' : 's' }}
          <span v-if="pair.optimalHops != null"> (shortest possible: {{ pair.optimalHops }})</span>.
        </template>
        <template v-else>Here's the shortest path:</template>
      </p>

      <!-- Input moved above the images (bug report: "moving the input above
           the images and leave the give up buttons below") - just the
           input + suggestions now; the hint/give-up actions live in their
           own row below the chain instead. -->
      <div v-if="status === 'playing'" class="guess-form">
        <input
          v-model="guessInput"
          type="text"
          class="game-input"
          :placeholder="guessPlaceholder"
          @input="onInput"
        >
        <ul v-if="suggestions.length" class="suggestions">
          <li v-for="suggestion in suggestions" :key="suggestion.key || suggestion.name">
            <button type="button" class="suggestion-item" @click="pick(suggestion)">
              {{ suggestion.label }}
            </button>
          </li>
        </ul>
      </div>

      <!-- The connection, built visually between the two posters as you go -
           source through however much of the chain you've found, then
           placeholder "?" slots filling the gap to the target (see
           chainDisplayItems), or - once given up - the real revealed path
           in this exact same row instead (see displayChain; no more
           showing both at once). Movie steps show the real poster; person
           steps show a TMDB profile photo (fetched + cached per name, see
           ensurePersonPhoto) or initials if none is found, WITH a name
           label underneath - posters and "?" placeholders don't get a
           label (bug report: "we don't need the labels under the posters
           and question marks... we do need the names under the
           portraits"). Every REAL step is tappable (goes to the movie's
           detail page, or a library search for the person) and, for
           entries the player actually added (not the source, not a
           placeholder, not the goal marker), carries a small delete badge
           that trims the chain back to that point. -->
      <!-- One row per chain: always the player's own, plus (only after a WIN,
           and only if they ask for it) a second, read-only row showing the
           shortest path that existed - bug report: "at the end when I win...
           I could click something to reveal that path. Ideally it would
           reveal that path without losing my own path. It would just show me
           what could've been." Giving up still REPLACES the row rather than
           adding one (that was its own earlier bug report); the two cases
           are deliberately different. -->
      <template v-for="row in chainRows" :key="row.key">
        <p v-if="row.label" class="chain-row-label">{{ row.label }}</p>
        <div class="chain-row" :ref="(el) => { if (row.key === 'main') chainRowEl = el; }">
          <template v-for="(item, index) in row.items" :key="item.itemKey">
            <button
              type="button"
              class="chain-step"
              :class="[item.type, { goal: item.isGoal, placeholder: item.isPlaceholder }]"
              :data-chain-index="row.interactive && !item.isGoal && !item.isPlaceholder ? index : null"
              @click="handleChainItemClick(item)"
            >
              <span
                v-if="row.interactive && status === 'playing' && index > 0 && !item.isGoal && !item.isPlaceholder"
                class="chain-delete-badge"
                title="Remove this and everything after it"
                @click.stop="deleteFromChain(index)"
              ><i class="bi bi-x"></i></span>
              <template v-if="item.isPlaceholder">
                <div v-if="item.type === 'movie'" class="chain-poster chain-placeholder">?</div>
                <div v-else class="chain-photo chain-placeholder">?</div>
              </template>
              <template v-else>
                <img v-if="item.type === 'movie'" :src="gamePosterUrl(item.entry, 'w185')" :alt="item.entry.movie.title" class="chain-poster">
                <template v-else>
                  <img v-if="personPhotoUrl(item.name)" :src="personPhotoUrl(item.name)" :alt="item.name" class="chain-photo">
                  <div v-else class="chain-photo chain-photo-fallback">{{ personInitials(item.name) }}</div>
                </template>
              </template>
              <span v-if="item.type === 'person' && !item.isPlaceholder" class="chain-step-label" :title="item.name">{{ item.name }}</span>
            </button>
            <i v-if="index < row.items.length - 1" class="bi bi-arrow-right chain-arrow"></i>
          </template>
        </div>
      </template>

      <div v-if="canShowComparison" class="comparison-actions">
        <button type="button" class="hint-segment" @click="showComparisonPath">Show the shortest path</button>
      </div>

      <!-- Replaces the single "Reveal shortest path" button (bug report:
           "turn the reveal shortest path button into a two segment button.
           'Give me one' and 'Give up'"). "Give me one" reveals just the
           next step toward the target (see giveHint) and the game keeps
           going; "Give up" is the old behavior - shows the whole remaining
           path and ends the round. Only shown while playing - swaps for
           the difficulty picker below once the round ends (bug report:
           "too many buttons... hide the new game buttons until someone
           clicks give up... swap the help/give up buttons with the
           difficulty and new game buttons"). -->
      <div v-if="status === 'playing'" class="hint-actions">
        <button type="button" class="hint-segment" @click="giveHint">Give me one</button>
        <button type="button" class="hint-segment give-up" @click="revealPath">Give up</button>
      </div>

      <!-- End of round: the same two-button row every other game ends on
           (bug report, 2026-08-20: "When I complete a six degrees, let's
           lose the difficulty buttons and just have a new game button and a
           back to games button. Just like we do in other games").
           A tier-picking row used to live here; "New Game" now just replays
           whatever tier was last chosen (`selectedDifficulty`, still set
           from the not-enough-movies panel or a previous round). -->
      <div v-else class="end-actions">
        <button type="button" class="btn-game btn-game-primary" @click="start">New Game</button>
        <button type="button" class="btn-game btn-game-secondary" @click="$router.push('/games')">Back to Games</button>
      </div>
    </template>
  </div>
</template>

<script>
import BackLink from './BackLink.vue';
import GameHowTo from './GameHowTo.vue';
import NewRatingSearch from '../NewRatingSearch.vue';
import gameDataMixin from '../../mixins/gameData.js';
import { buildPeopleGraph, pickConnectedPair, shortestPath, scorePathDifficulty, difficultyForScore, DIFFICULTY_LEVELS, nextHintStep } from '../../assets/javascript/games/sixDegrees.js';
import { entryKey, matchesAllTokens } from '../../assets/javascript/games/gameUtils.js';
import sixDegreesBanner from '../../assets/images/games/six-degrees-banner.jpg';

const STORAGE_KEY = 'cinemaRoll.sixDegrees.current';

// How much breathing room to leave to the right of the newest chain entry
// when auto-scrolling to it (see scrollChainToEnd).
const SCROLL_MARGIN_PX = 12;

export default {
  name: 'SixDegreesGame',
  components: { BackLink, GameHowTo, NewRatingSearch },
  mixins: [gameDataMixin],
  // The shared Header stays visible on every game screen (see BackLink's own
  // comment) and just renders store.state.bannerUrl - swap it for a custom
  // banner graphic (designed for this game specifically, with its own
  // "Six Degrees / Cinema Roll Games" branding baked in) rather than
  // leaving whatever movie backdrop Home last set. hideHeaderLogo turns off
  // the usual "Cinema Roll" title overlay too, since the custom graphic
  // already has its own branding in roughly the same corner - the two
  // would otherwise overlap/compete. Both are restored on the way out so
  // leaving doesn't strand either change on Home or another screen. (Two
  // earlier attempts at a banner here - a hand-drawn SVG graphic, then a
  // real-movie-title pun - were each tried and replaced per feedback; see
  // CLAUDE.md.)
  created () {
    this.previousBannerUrl = this.$store.state?.bannerUrl;
    this.$store.commit?.('setBannerUrl', sixDegreesBanner);
    this.$store.commit?.('setHideHeaderLogo', true);
  },
  beforeUnmount () {
    this.$store.commit?.('setBannerUrl', this.previousBannerUrl || null);
    this.$store.commit?.('setHideHeaderLogo', false);
  },
  data () {
    return {
      // Two separate graphs on purpose. `graph` is capped at the 10 most-
      // billed cast per movie — that sparsity is what keeps puzzle
      // generation/optimal-path interesting (see sixDegrees.js's own
      // comment: uncapped, nearly every movie is "1 hop" from nearly every
      // other one). `playGraph` is uncapped (full cast) and is what actually
      // powers the in-play suggestions — per bug report, a real connection
      // through a supporting actor outside the top 10 was silently absent
      // from the capped graph, so typing a movie you genuinely knew the
      // actor was in surfaced nothing. Restricting to the top 10 only makes
      // sense when CHOOSING the puzzle, not when the player is doing the
      // work of recalling/typing a real connection themselves.
      graph: null,
      playGraph: null,
      pair: null,
      chain: [],
      guessInput: '',
      suggestions: [],
      revealedChain: null,
      // The optimal path shown ALONGSIDE a winning chain (opt-in, after a
      // win). Deliberately separate from revealedChain, which is the
      // give-up path that REPLACES the player's own row - see chainRows.
      comparisonChain: null,
      // Set by the template's function ref so pick() can scroll the row to
      // follow each new entry.
      chainRowEl: null,
      // null = "Any" (the original unconstrained 2-4 hop range) - not
      // persisted across sessions, same as other purely-in-session game
      // preferences elsewhere (e.g. Reel Wordle's local-only round state).
      selectedDifficulty: null,
      // name -> TMDB profile_path (or null on a miss/in-flight fetch).
      // Cached so re-rendering the chain never re-fetches a name already
      // seen this session. Bug report follow-up ("actual photos of the
      // people... between the first two posters").
      personPhotoCache: {}
    };
  },
  computed: {
    // One segment per difficulty tier - "Any" was dropped per feedback in
    // favor of always picking a specific tier.
    difficultyOptions () {
      return Object.entries(DIFFICULTY_LEVELS).map(([key, level]) => ({ key, label: level.label }));
    },
    pairDifficulty () {
      return this.pair?.difficulty || null;
    },
    // The chain built so far, plus (only while still unsolved) placeholder
    // "?" slots filling the gap to the target, then the target itself as a
    // trailing "goal" marker. Bug report: "fill in the gap between the
    // last entry and the end appropriately" - always ends on a PERSON
    // placeholder immediately before the goal (the goal is itself the
    // final movie), so needing a movie next means two placeholders (movie,
    // then person) and needing a person next means just one. Once won, the
    // real chain already ends at the target, so nothing synthetic is added.
    chainDisplayItems () {
      const items = this.chain.map((link, index) => ({ ...link, itemKey: `chain-${index}` }));
      if (this.status !== 'won' && this.pair?.target) {
        if (this.needType === 'movie') {
          items.push({ type: 'movie', itemKey: 'placeholder-movie', isPlaceholder: true });
        }
        items.push({ type: 'person', itemKey: 'placeholder-person', isPlaceholder: true });
        items.push({ type: 'movie', entry: this.pair.target, itemKey: 'target-goal', isGoal: true });
      }
      return items;
    },
    // What the chain row actually renders: the player's own progress
    // (chainDisplayItems, above) while playing or after winning, or the
    // real revealed path once given up - bug report: "when I give up, the
    // shortest path should replace my built path, not show both of them."
    // Previously the built chain (with its dangling placeholders) stayed
    // visible above a SEPARATE revealed-path row inside the result banner;
    // now there's only ever one row.
    displayChain () {
      if (this.status === 'revealed' && this.revealedChain) {
        return this.revealedChain.map((link, index) => ({ ...link, itemKey: `revealed-${index}` }));
      }
      return this.chainDisplayItems;
    },
    // The player's own row, plus the optional "what could've been" row after
    // a win. Driven off one list rather than duplicating the (heavily
    // iterated-on) chain-step markup in the template.
    chainRows () {
      const rows = [{ key: 'main', label: null, items: this.displayChain, interactive: true }];
      if (this.comparisonChain) {
        rows.push({
          key: 'comparison',
          label: this.comparisonLabel,
          items: this.comparisonChain.map((link, index) => ({ ...link, itemKey: `comparison-${index}` })),
          interactive: false
        });
      }
      return rows;
    },
    // Only worth offering when they actually WON and took a longer route
    // than the optimum - if they already found the shortest path there's
    // nothing "could've been" to show them.
    canShowComparison () {
      // Follow-up bug report: "I still don't see a way to reveal the
      // shortest path after I find my own path." The first cut also
      // required optimalHops < hopsSoFar - i.e. it hid the button whenever
      // the player MATCHED the optimum, on the reasoning that there'd be
      // nothing "could've been" to show. That was too clever: matching the
      // shortest path is precisely when you want it confirmed, and from the
      // player's side an absent button is indistinguishable from a broken
      // one. Now it's offered after every win (the label below says which
      // case it is).
      return this.status === 'won' && !this.comparisonChain && this.pair?.optimalPath?.length > 0;
    },
    // Distinguishes "here's the shorter route you missed" from "you already
    // found it" - the button shows in both cases now (see canShowComparison).
    comparisonLabel () {
      const hops = this.pair?.optimalHops;
      const hopText = `${hops} hop${hops === 1 ? '' : 's'}`;
      return hops >= this.hopsSoFar
        ? `You found it — the shortest path was also ${hopText}:`
        : `The shortest path was ${hopText}:`;
    },
    needType () {
      const last = this.chain[this.chain.length - 1];
      return last?.type === 'movie' ? 'person' : 'movie';
    },
    // Names the actual movie/person in the prompt instead of a generic
    // "that movie"/"they" (bug report: "Who was in Rebel Without A Cause?"
    // / "what else was Rock Hudson in?"). Falls back to the generic phrasing
    // if for some reason the chain's last entry isn't resolved yet.
    guessPlaceholder () {
      const last = this.chain[this.chain.length - 1];
      if (this.needType === 'person') {
        const title = last?.entry?.movie?.title;
        return title ? `Who was in ${title}?` : 'Who was in that movie?';
      }
      const name = last?.name;
      return name ? `What else was ${name} in?` : 'What else were they in?';
    },
    hopsSoFar () {
      return Math.floor((this.chain.length - 1) / 2);
    },
    usedPersonNames () {
      return new Set(this.chain.filter((link) => link.type === 'person').map((link) => link.name));
    },
    usedMovieKeys () {
      return new Set(this.chain.filter((link) => link.type === 'movie').map((link) => entryKey(link.entry)));
    },
    status () {
      if (this.revealedChain) return 'revealed';
      const last = this.chain[this.chain.length - 1];
      if (last?.type === 'movie' && this.pair && entryKey(last.entry) === entryKey(this.pair.target)) return 'won';
      return 'playing';
    }
  },
  watch: {
    // status is a computed (derived from the chain reaching the target), so
    // watch it rather than hooking an imperative win moment — see
    // ReelWordleGame.
    status (newStatus) {
      if (newStatus === 'won') {
        this.recordGameWin();
        this.recordGameRound({ steps: this.hopsSoFar, optimal: this.pair?.optimalHops ?? null });
      }
    },
    // eligibleGameEntries can be empty for a tick while the library is still
    // loading from Firebase (most visible on a direct/deep-link navigation
    // straight to this route, before dbLoaded settles) — calling loadOrStart
    // unconditionally from created() could build an empty cast graph and
    // never retry once real data arrived, silently stranding the page on
    // "not enough movies" forever. Same fix Reel Wordle already has for the
    // identical race (see its eligibleGameEntries watcher).
    eligibleGameEntries: {
      immediate: true,
      handler (entries) {
        if (this.pair || !entries.length) return;
        this.loadOrStart();
      }
    }
  },
  methods: {
    // Resumes an in-progress pair+chain from localStorage if one exists and
    // both its endpoints are still in the library; otherwise starts fresh.
    // Same pattern as Reel Wordle's persistence (see cinemaRoll.reelWordle.
    // current) — per bug report, leaving the page (e.g. to poke around Home
    // for inspiration) and coming back was silently discarding progress.
    loadOrStart () {
      this.graph = buildPeopleGraph(this.eligibleGameEntries);
      this.playGraph = buildPeopleGraph(this.eligibleGameEntries, Infinity);
      if (this.tryRestore()) return;
      this.start();
    },
    tryRestore () {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const saved = JSON.parse(raw);

        // Bug report: "you don't need to save my result... the next time I
        // return to the game it should just be a new game." A finished
        // round (won, or given up) isn't progress to resume - fall through
        // to a fresh start() instead of restoring it.
        const lastSavedLink = saved?.chain?.[saved.chain.length - 1];
        const wasWon = lastSavedLink?.type === 'movie' && lastSavedLink.key === saved?.targetKey;
        if (saved?.revealed || wasWon) return false;

        const source = this.eligibleGameEntries.find((entry) => entryKey(entry) === saved?.sourceKey);
        const target = this.eligibleGameEntries.find((entry) => entryKey(entry) === saved?.targetKey);
        if (!source || !target) return false;

        const path = shortestPath(this.graph, entryKey(source), entryKey(target));
        if (!path) return false;

        const chain = (saved.chain || [])
          .map((link) => {
            if (link.type === 'person') return { type: 'person', name: link.name };
            const entry = this.eligibleGameEntries.find((e) => entryKey(e) === link.key);
            return entry ? { type: 'movie', entry } : null;
          })
          .filter(Boolean);
        if (!chain.length) return false;

        // difficulty/difficultyScore aren't persisted (deterministically
        // re-derivable from the path + library, same reasoning as not
        // persisting optimalPath/optimalHops themselves).
        const entriesByKey = new Map(this.eligibleGameEntries.map((entry) => [entryKey(entry), entry]));
        const difficultyScore = scorePathDifficulty(path, entriesByKey);
        this.pair = {
          source,
          target,
          optimalPath: path,
          optimalHops: (path.length - 1) / 2,
          difficultyScore,
          difficulty: difficultyForScore(difficultyScore)
        };
        this.chain = chain;
        this.guessInput = '';
        this.suggestions = [];
        this.revealedChain = null;
        this.comparisonChain = null;
        this.ensurePersonPhotosFor(this.chain);
        if (saved.revealed) this.revealPath();
        return true;
      } catch (error) {
        console.error('Failed to load persisted Six Degrees progress:', error);
        return false;
      }
    },
    persistState () {
      if (!this.pair) return;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          sourceKey: entryKey(this.pair.source),
          targetKey: entryKey(this.pair.target),
          chain: this.chain.map((link) => (
            link.type === 'movie' ? { type: 'movie', key: entryKey(link.entry) } : { type: 'person', name: link.name }
          )),
          revealed: Boolean(this.revealedChain)
        }));
      } catch (error) {
        // localStorage can throw in private-browsing/quota-exceeded situations;
        // the game still works for this session, it just won't persist.
        console.error('Failed to persist Six Degrees progress:', error);
      }
    },
    start () {
      // Bug report: starting a new game should land you back at the top of
      // the page, not wherever you'd scrolled to (e.g. down past a long
      // chain). Same 'instant' convention GamesHub's own "new screen, jump
      // to top" navigation already uses.
      window.scrollTo({ top: 0, behavior: 'instant' });
      this.graph = buildPeopleGraph(this.eligibleGameEntries);
      this.playGraph = buildPeopleGraph(this.eligibleGameEntries, Infinity);
      const options = this.selectedDifficulty ? { difficulty: this.selectedDifficulty } : {};
      this.pair = pickConnectedPair(this.eligibleGameEntries, this.graph, Math.random, options);
      this.chain = this.pair ? [{ type: 'movie', entry: this.pair.source }] : [];
      this.guessInput = '';
      this.suggestions = [];
      this.revealedChain = null;
      this.comparisonChain = null;
      this.persistState();
    },
    // Picks the tier AND immediately starts a fresh pair (bug report:
    // "let's go back to having 'new game' as a label and then three
    // buttons for difficulty") - a brief detour through a decoupled
    // picker + separate "New Game" button was tried and reverted; now
    // that this whole panel only shows once a round has already ended
    // (see the template), a single tap to both choose and start is
    // simpler than a two-step picker.
    selectDifficulty (level) {
      this.selectedDifficulty = level;
      this.start();
    },
    onInput () {
      const term = this.guessInput.trim().toLowerCase();
      if (term.length < 2) {
        this.suggestions = [];
        return;
      }

      if (this.needType === 'person') {
        const lastMovie = this.chain[this.chain.length - 1].entry;
        const cast = (this.playGraph.peopleByMovie.get(entryKey(lastMovie)) || new Set());
        this.suggestions = [...cast]
          .filter((name) => !this.usedPersonNames.has(name) && matchesAllTokens(name, term))
          .slice(0, 8)
          .map((name) => ({ name, label: name }));
      } else {
        const lastPerson = this.chain[this.chain.length - 1].name;
        const movieKeys = [...(this.playGraph.moviesByPerson.get(lastPerson) || new Set())];
        this.suggestions = movieKeys
          .filter((key) => !this.usedMovieKeys.has(key))
          .map((key) => this.eligibleGameEntries.find((entry) => entryKey(entry) === key))
          .filter(Boolean)
          .filter((entry) => matchesAllTokens(entry.movie.title, term))
          .slice(0, 8)
          .map((entry) => ({ key: entryKey(entry), entry, label: entry.movie.title }));
      }
    },
    pick (suggestion) {
      if (this.needType === 'person') {
        this.chain = [...this.chain, { type: 'person', name: suggestion.name }];
        this.ensurePersonPhoto(suggestion.name);
        // Bug report: "when I get a person who is in the final movie it
        // should just make that final connection for me. I shouldn't have
        // to type the target movie." If this person was also in the
        // target, there's only one possible next movie - add it
        // automatically instead of making the player look it up and type
        // it themselves. Uses the UNCAPPED playGraph (same reasoning as
        // the rest of the in-play suggestions/hints - a real connection
        // outside the puzzle-generation billing cap should still count).
        const targetKey = entryKey(this.pair.target);
        if ((this.playGraph.moviesByPerson.get(suggestion.name) || new Set()).has(targetKey)) {
          this.chain = [...this.chain, { type: 'movie', entry: this.pair.target }];
        }
      } else {
        this.chain = [...this.chain, { type: 'movie', entry: suggestion.entry }];
      }
      this.guessInput = '';
      this.suggestions = [];
      this.persistState();
      this.scrollChainToEnd();
    },
    // Bug report: "I should be able to delete an entry in the chain and it
    // removes everything after it." index refers to chainDisplayItems, which
    // shares indices with this.chain for every real (non-goal) entry - the
    // template already excludes index 0 (the source) and the synthetic goal
    // marker from showing a delete badge at all.
    deleteFromChain (index) {
      if (index <= 0 || index >= this.chain.length) return;
      this.chain = this.chain.slice(0, index);
      this.guessInput = '';
      this.suggestions = [];
      this.persistState();
    },
    // Placeholder "?" slots aren't real entries - nothing to navigate to.
    handleChainItemClick (item) {
      if (item.isPlaceholder) return;
      this.goToChainItem(item);
    },
    // Bug report: "click on any of the items in the list to go to either
    // that movie's detail page or else a search for that person." Progress
    // is already persisted (see persistState calls above), so navigating
    // away and back via the Games button resumes exactly here.
    goToChainItem (item) {
      if (item.type === 'movie') {
        this.$router.push(`/movie/${item.entry.movie.id}`);
      } else {
        this.searchForPerson(item.name);
      }
    },
    // Same store-commit sequence as MovieDetail.vue's searchFor(name, 'cast')
    // - replicated here (rather than shared) since it's a small, component-
    // local navigation action and the two components don't share a base.
    searchForPerson (name) {
      this.$store.commit('setHomePageNavigationIntent', 'search');
      this.$store.commit('setHomePagePromoteGroup', 'cast');
      this.$store.commit('setHomePageSearchValue', name);
      this.$store.commit('setHomePageSearchChips', []);
      this.$store.commit('setHomePageScrollPosition', 0);
      this.$store.commit('setBannerRequest', { type: 'fromResults' });
      this.$router.push('/');
    },
    // "Give me one" - reveals just the next step (see nextHintStep's own
    // comment for why it recomputes from the current position rather than
    // replaying the original optimalPath). Reuses pick() so the hinted
    // entry goes through the exact same chain-update/photo-fetch/persist
    // path a real guess would.
    giveHint () {
      if (!this.pair) return;
      const last = this.chain[this.chain.length - 1];
      const lastLink = last.type === 'movie' ? { type: 'movie', key: entryKey(last.entry) } : { type: 'person', name: last.name };
      const targetKey = entryKey(this.pair.target);
      const hint = nextHintStep(lastLink, this.usedMovieKeys, this.graph, this.playGraph, targetKey, this.usedPersonNames);
      if (!hint) return;
      if (hint.type === 'person') {
        this.pick({ name: hint.name });
      } else {
        const entry = this.eligibleGameEntries.find((e) => entryKey(e) === hint.key);
        if (entry) this.pick({ key: hint.key, entry });
      }
    },
    // A shortestPath-shaped array ([movieKey, person, movieKey, ...]) into
    // the {type, entry|name} link shape the chain row renders.
    linksFromPath (path) {
      return path.map((step, i) => (
        i % 2 === 0
          ? { type: 'movie', entry: this.eligibleGameEntries.find((e) => entryKey(e) === step) }
          : { type: 'person', name: step }
      ));
    },
    revealPath () {
      if (!this.pair?.optimalPath) return;
      const links = this.linksFromPath(this.pair.optimalPath);
      this.revealedChain = links;
      this.ensurePersonPhotosFor(links);
      this.persistState();
    },
    // "Show the shortest path" after a WIN - additive, unlike revealPath.
    // Not persisted: it's a purely presentational "what could've been" peek
    // at an already-finished round, and a finished round isn't resumed
    // anyway (see tryRestore).
    showComparisonPath () {
      if (!this.pair?.optimalPath) return;
      const links = this.linksFromPath(this.pair.optimalPath);
      this.comparisonChain = links;
      this.ensurePersonPhotosFor(links);
    },
    // Bug report: "after each correct guess it would be nice if it would
    // scroll to the right for me." The chain row scrolls horizontally and
    // only grows, so a new entry lands off-screen without this.
    //
    // Follow-up bug report: "the scrolling is better but it should scroll so
    // that I can still see my most recent addition to the chain." The first
    // cut scrolled to scrollWidth (the far right) - but the row doesn't END
    // at the newest entry: the "?" placeholders and the goal poster all sit
    // AFTER it, so scrolling fully right pushed the thing the player just
    // added back off the left. Now it scrolls only far enough to bring the
    // newest REAL entry's right edge into view (with a small margin), and
    // not at all if it's already visible.
    scrollChainToEnd () {
      this.$nextTick(() => {
        const el = this.chainRowEl;
        if (!el) return;

        const newest = el.querySelector(`[data-chain-index="${this.chain.length - 1}"]`);
        let left = el.scrollWidth; // fallback: the old behaviour
        if (newest && typeof newest.getBoundingClientRect === 'function') {
          const rowRight = el.getBoundingClientRect().right;
          const newestRight = newest.getBoundingClientRect().right;
          const delta = newestRight - rowRight + SCROLL_MARGIN_PX;
          if (delta <= 0) return; // already fully visible - don't yank it around
          left = el.scrollLeft + delta;
        }

        if (typeof el.scrollTo === 'function') {
          el.scrollTo({ left, behavior: 'smooth' });
        } else {
          // jsdom (and very old browsers) have no scrollTo on elements.
          el.scrollLeft = left;
        }
      });
    },
    // Circular avatar image for a chain "person" step. Not stored locally
    // (AddRating.js only keeps {name, character} for cast, no profile_path -
    // see CLAUDE.md), so this looks it up live from TMDB by name, same
    // pattern favoriteTuning.js's getDetailsForCastMember already uses for
    // the Favorites sections' person photos.
    personPhotoUrl (name) {
      const path = this.personPhotoCache[name];
      return path ? `https://image.tmdb.org/t/p/w185${path}` : null;
    },
    personInitials (name) {
      if (!name) return '?';
      return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('');
    },
    async ensurePersonPhoto (name) {
      // Undefined = never looked up; null = looked up, no photo (or an
      // in-flight lookup, marked immediately below so concurrent calls for
      // the same name don't double-fetch). Both fall back to initials.
      if (!name || Object.prototype.hasOwnProperty.call(this.personPhotoCache, name)) return;
      this.personPhotoCache = { ...this.personPhotoCache, [name]: null };
      try {
        const query = encodeURIComponent(name);
        const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${query}`;
        const response = await fetch(url);
        const data = await response.json();
        const profilePath = data?.results?.[0]?.profile_path || null;
        this.personPhotoCache = { ...this.personPhotoCache, [name]: profilePath };
      } catch {
        // Best-effort - stays null, falls back to initials.
      }
    },
    ensurePersonPhotosFor (links) {
      links.filter((link) => link.type === 'person').forEach((link) => this.ensurePersonPhoto(link.name));
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';
@import '@/assets/scss/game-inputs';

.six-degrees-game {
  color: #eee;
  // Back up to 1rem (bug report: the description "doesn't have enough
  // horizontal padding from the edges of the screen") - .chain-row claws
  // back the difference with a matching negative margin below, so the
  // 3-across chain-step fit from the earlier 0.5rem pass is unaffected;
  // everything else (subtitle, buttons, etc.) gets the full 1rem inset.
  // Top padding is still the BackLink-overlap safety margin (see the
  // identical comment in ConnectionsGame.vue/GamesHub.vue).
  padding: 1.75rem 1rem 2rem;
}

.game-subtitle {
  color: #adb5bd;
  // Equal above/below (bug report: "make the space above and below the
  // game description match") - was 0.5rem/1rem.
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

// Replaces .game-subtitle once the round ends (bug report: "'Connected in
// X hops...' it looks bad. Let's instead put that message at the top in
// place of the input and the game description") - same spacing as the
// subtitle it stands in for, just a plain text line rather than a colored
// box, since it's now sitting where plain description text used to be.
.result-message {
  margin-top: 0.75rem;
  margin-bottom: 0.75rem;
}

.result-message.won {
  color: #81c784;
}

.result-message.revealed {
  color: #adb5bd;
}

// One connected segmented control, full width (bug report: "no good... one
// connected button set with a label" then "I want the label plus the
// buttons to go full width... it would be nice if the buttons were
// colored"). Each tier gets its own color - a light outline by default, a
// solid fill once selected.
$difficulty-tier-colors: (
  easy: (outline: #66bb6a, fill: #2e7d32),
  medium: (outline: #ffa726, fill: #ef6c00),
  hard: (outline: #ef5350, fill: #c62828)
);

// New game controls - a single "New game:" label + segmented picker row,
// each segment both picking AND immediately starting a fresh pair (see
// selectDifficulty). Only rendered once a round has ended (bug report:
// "too many buttons... hide the new game buttons until someone clicks
// give up... swap the help/give up buttons with the difficulty and new
// game buttons"), swapping places with .hint-actions above.
.new-game-panel {
  align-items: center;
  display: flex;
  gap: 0.6rem;
  margin-top: 1rem;
}

.difficulty-picker-label {
  color: #adb5bd;
  flex-shrink: 0;
  font-size: 0.85rem;
  font-weight: 600;
}

.difficulty-segments {
  border-radius: 8px;
  display: flex;
  flex: 1;
  overflow: hidden;
}

.difficulty-segment {
  background: transparent;
  border: 2px solid #555;
  color: #ccc;
  flex: 1;
  font-size: 0.75rem;
  font-weight: 700;
  // Compact per feedback ("too poofy") - down from 0.45rem/0.4rem.
  padding: 0.25rem 0.3rem;
}

// Each segment's own square corners need to already match the container's
// rounded-rect shape - relying on the container's overflow:hidden alone
// clips a square border against a rounded boundary, leaving a stray
// crescent of border visible outside it at both ends (bug report,
// screenshot). Kept deliberately subtle (8px, not a full pill) per
// feedback ("much less oval and much more rectangular").
.difficulty-segment:first-child {
  border-bottom-left-radius: 8px;
  border-top-left-radius: 8px;
}

.difficulty-segment:last-child {
  border-bottom-right-radius: 8px;
  border-top-right-radius: 8px;
}

@each $key, $colors in $difficulty-tier-colors {
  .difficulty-segment.#{$key} {
    border-color: map-get($colors, outline);
    color: map-get($colors, outline);
  }

  .difficulty-segment.#{$key}.active {
    background: map-get($colors, fill);
    border-color: map-get($colors, fill);
    color: #fff;
  }
}

.difficulty-segment:active:not(.active) {
  background: rgba(255, 255, 255, 0.08);
}

.not-enough-movies {
  color: #adb5bd;
  text-align: center;
  margin-top: 2rem;
}

// The connection itself: source poster -> however much of the chain has
// been found -> (while unsolved) a goal marker for the target. Replaces the
// old separate endpoints row + text-pill chain (bug report: "the series of
// pills... a bit ugly... show actual photos of the people and posters of
// the movies for the steps in between"). Sized 3-across on a phone screen
// (bug report: "fit three items across... use more of the width").
// One horizontally-scrolling row instead of wrapping to multiple lines
// (bug report: "have them all appear in one horizontally scrolling list...
// scroll back and forth with your finger to see the whole chain") - the
// chain only grows longer as a round goes on, so wrapping meant the page
// kept getting taller; this keeps a constant height regardless of length.
// justify-content is flex-start (not center) deliberately - centered
// content that later overflows a scroll container can leave its own start
// unreachable in some browsers.
// Heads the read-only "what could've been" row after a win — see chainRows.
.chain-row-label {
  color: #adb5bd;
  font-size: 0.85rem;
  margin: 0.5rem 0 0;
}

.comparison-actions {
  display: flex;
  margin-bottom: 1rem;
}

.comparison-actions .hint-segment {
  border-radius: 8px;
  flex: 1;
}

.chain-row {
  align-items: center;
  display: flex;
  flex-wrap: nowrap;
  gap: 0.4rem;
  justify-content: flex-start;
  margin-bottom: 1.25rem;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
  // Space below the input, above the posters (bug report: "we need some
  // space below the input above the posters").
  margin-top: 1rem;
  // Claws back the extra horizontal padding .six-degrees-game gained above,
  // so scrolled content can reach all the way to the screen edges.
  margin-left: -0.5rem;
  margin-right: -0.5rem;
  padding-left: 0.5rem;
  padding-right: 0.5rem;
}

.chain-step {
  background: transparent;
  border: none;
  color: inherit;
  flex-shrink: 0;
  font: inherit;
  padding: 0;
  position: relative;
  text-align: center;
  // A single shared width (movie and person alike). Still larger than the
  // original 100px endpoint width.
  width: 104px;
}

.chain-poster {
  border-radius: 0.35rem;
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
}

.chain-photo {
  border-radius: 50%;
  display: block;
  width: 88px;
  height: 88px;
  margin: 0 auto;
  object-fit: cover;
}

.chain-photo-fallback {
  align-items: center;
  background: #333;
  color: #adb5bd;
  display: flex;
  font-size: 1.1rem;
  font-weight: 700;
  justify-content: center;
}

// "?" placeholder slots filling the gap between the built chain and the
// target (bug report: "treatments for both question mark people and
// question mark posters"). Layered on top of .chain-poster/.chain-photo
// (which already provide the right shape/size), just swapping in a
// dashed border + muted fill + a big "?" instead of real art.
.chain-placeholder {
  align-items: center;
  background: #232323;
  border: 2px dashed #555;
  color: #666;
  display: flex;
  font-size: 1.8rem;
  font-weight: 700;
  justify-content: center;
}

.chain-step-label {
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  margin-top: 0.3rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Small "remove this and everything after it" affordance, shown only on
// entries the player actually added (not the source, not the goal marker -
// see the template's v-if). Positioned like ConnectionsGame's
// .tile-hint-badge, just top-left instead of top-right so it doesn't
// collide with the delete badge of an adjacent step's much smaller person
// photo.
.chain-delete-badge {
  align-items: center;
  background: rgba(20, 20, 20, 0.85);
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  color: #eee;
  display: flex;
  height: 1.3rem;
  justify-content: center;
  left: 2px;
  position: absolute;
  top: 2px;
  width: 1.3rem;
}

.chain-delete-badge:active {
  background: rgba(60, 60, 60, 0.95);
}

.chain-arrow {
  color: #666;
  flex-shrink: 0;
  font-size: 0.9rem;
}

.guess-form {
  position: relative;
}

.suggestions {
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 0.35rem;
  list-style: none;
  margin: 0.25rem 0 0;
  max-height: 220px;
  overflow-y: auto;
  padding: 0;
  position: absolute;
  width: 100%;
  z-index: 5;
}

.suggestion-item {
  background: transparent;
  border: none;
  color: #eee;
  display: block;
  padding: 0.5rem 0.75rem;
  text-align: left;
  width: 100%;
}

.suggestion-item:active {
  background: #333;
}

// One connected two-segment control, matching the difficulty switch's own
// visual language (bug report: "turn the reveal shortest path button into
// a two segment button"). Neither segment has a persistent "active" state
// - both are one-tap actions, not a picker.
.hint-actions {
  border-radius: 8px;
  display: flex;
  margin-top: 0.75rem;
  overflow: hidden;
}

.hint-segment {
  background: transparent;
  border: 2px solid #555;
  color: #ccc;
  flex: 1;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 0.4rem 0.4rem;
}

.hint-segment:first-child {
  border-bottom-left-radius: 8px;
  border-top-left-radius: 8px;
}

.hint-segment:last-child {
  border-bottom-right-radius: 8px;
  border-top-right-radius: 8px;
}

// "Give up" tinted red (matching the Hard difficulty color) since it's the
// more final of the two actions - "Give me one" stays neutral.
.hint-segment.give-up {
  border-color: #ef5350;
  color: #ef5350;
}

.hint-segment:active {
  background: rgba(255, 255, 255, 0.08);
}

</style>
