<template>
  <div class="film-club-screen">
    <BackLink/>
    <h1 class="cs-title">Film Club</h1>
    <p class="cs-subtitle">Friends on Cinema Roll — what they're watching and where your tastes meet.</p>

    <!-- Painted for one frame before the real content (nextFrame): the
         tap that opened this screen is acknowledged at once instead of
         after the ~0.5-1s the sections below take to build. -->
    <SkeletonBlock v-if="!painted" :rows="7"/>
    <template v-else>

    <div v-if="!socialSettings.enabled" class="cs-section">
      <p class="cs-empty">Sharing is off. Turn on "Share on Cinema Roll" in Settings to join the club — nothing is shared until you do.</p>
    </div>

    <template v-else>
      <!-- Requests inbox -->
      <section v-if="requestRows.length" class="cs-section">
        <h2 class="cs-section-title">Friend requests</h2>
        <div v-for="request in requestRows" :key="request.key" class="cs-row">
          <span class="cs-row-name">{{ request.name }}</span>
          <span class="cs-row-actions">
            <button type="button" class="btn btn-warning btn-sm" @click="accept(request.key)">Accept</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" @click="decline(request.key)">Decline</button>
          </span>
        </div>
      </section>

      <!-- Recently watched — the bit Matt likes most, so it stays at the
           top, now with how long ago each viewing was. -->
      <section v-if="summary && summary.feed.length" class="cs-section">
        <h2 class="cs-section-title">Recently watched</h2>
        <div class="cs-poster-row cs-feed-row">
          <div
            v-for="item in summary.feed"
            :key="`${item.friendKey}-${item.id}-${item.at}`"
            class="cs-poster-card cs-poster-tappable"
            @click="openFeedItem(item)"
          >
            <div class="cs-poster-frame">
              <img v-if="item.p" :src="poster(item.p)" :alt="item.t" class="cs-poster">
              <div v-else class="cs-poster cs-poster-blank">{{ item.t }}</div>
              <!-- Haven't seen it: the hat button is still the quick action,
                   but the poster itself is no longer inert — it opens the
                   summary sheet (bug report, 2026-08-20). -->
              <SendToHat
                v-if="!inMyLibrary(item.id)"
                class="cs-poster-hat"
                variant="icon"
                :movies="hatMovieFor(item)"
                :note="feedNote(item)"
              />
            </div>
            <!-- Stars, not the composite: `r` is on each person's own scale,
                 so one friend's 8.7 isn't another's (2026-08-31, "We're
                 showing their raw scores. I think I'd rather show their star
                 ratings"). The score stays as the fallback for anyone whose
                 profile publishes no stars — same rule as the detail-page
                 pills. -->
            <span class="cs-poster-note">
              <span class="cs-poster-who">{{ item.friendName }}</span>
              <span v-if="item.s !== null && item.s !== undefined" class="cs-poster-stars" :aria-label="`${item.s} out of 5`">
                <i v-for="i in fullStars(item.s)" :key="`f${i}`" class="bi bi-star-fill"/>
                <i v-if="hasHalfStar(item.s)" class="bi bi-star-half"/>
              </span>
              <span v-else class="cs-poster-score">{{ formatScore(item.r) }}</span>
            </span>
            <span v-if="watchedAgo(item.at)" class="cs-poster-when">{{ watchedAgo(item.at) }}</span>
            <span v-if="!inMyLibrary(item.id)" class="cs-poster-unseen">Not in your library</span>
          </div>
        </div>
      </section>

      <!-- "Has anybody seen this?" — report -P1lQnAdARMxUpPScybv. -->
      <section v-if="friendRows.length" class="cs-section">
        <h2 class="cs-section-title">Has anybody seen…</h2>
        <p class="cs-caption">Anything you or a friend has logged.</p>
        <input
          v-model="seenSearch"
          type="search"
          class="form-control form-control-sm cs-input"
          placeholder="Search a title"
          aria-label="Search the club for a movie"
        >

        <!-- Results, until one is picked. -->
        <div v-if="!seenPick && seenMatches.length" class="cs-seen-matches">
          <button
            v-for="match in seenMatches"
            :key="match.id"
            type="button"
            class="cs-seen-match"
            @click="seenPick = match"
          >
            <img v-if="match.poster" :src="poster(match.poster)" :alt="''" class="cs-seen-thumb">
            <span v-else class="cs-seen-thumb cs-seen-thumb--blank" aria-hidden="true"></span>
            <span class="cs-seen-match-title">{{ match.title }}</span>
          </button>
        </div>
        <p v-else-if="!seenPick && seenSearch.trim().length >= 2" class="cs-empty">
          Nobody in the club has logged anything called “{{ seenSearch.trim() }}”.
        </p>

        <div v-if="seenPick" class="cs-seen-answer">
          <div class="cs-seen-head">
            <span class="cs-seen-picked">{{ seenPick.title }}</span>
            <button type="button" class="cs-seen-clear" @click="clearSeenPick">Clear</button>
          </div>

          <p class="cs-seen-you">
            {{ seenBreakdown.youveSeen ? 'It’s in your library.' : 'You haven’t logged it.' }}
          </p>

          <p v-if="seenBreakdown.seen.length" class="cs-subhead">Seen it</p>
          <div v-for="person in seenBreakdown.seen" :key="`seen-${person.key}`" class="cs-row">
            <span class="cs-row-name">{{ person.name }}</span>
            <span class="cs-row-detail">
              <span v-if="person.stars !== null" :aria-label="`${person.stars} out of 5`">
                <i v-for="i in fullStars(person.stars)" :key="`s${i}`" class="bi bi-star-fill"/>
                <i v-if="hasHalfStar(person.stars)" class="bi bi-star-half"/>
              </span>
              <span v-else-if="person.score !== null">{{ formatScore(person.score) }}</span>
              <span v-else>on their shelf</span>
            </span>
          </div>

          <p v-if="seenBreakdown.notSeen.length" class="cs-subhead">Hasn’t seen it</p>
          <div v-for="person in seenBreakdown.notSeen" :key="`unseen-${person.key}`" class="cs-row">
            <span class="cs-row-name">{{ person.name }}</span>
          </div>

          <!-- Said plainly rather than folded into "hasn't seen it": a
               shelf-only sharer may have loved it last week and simply not
               published the fact. See clubTitleSearch.js. -->
          <p v-if="seenBreakdown.unknown.length" class="cs-subhead">No way to tell</p>
          <div v-for="person in seenBreakdown.unknown" :key="`unknown-${person.key}`" class="cs-row">
            <span class="cs-row-name">{{ person.name }}</span>
            <span class="cs-row-detail">{{ person.why }}</span>
          </div>
        </div>
      </section>

      <!-- Friends sit high on the page now: picking one was several screens
           down ("I have to scroll pretty far down before I can, like, select
           a friend and look at what they've got going on"). -->
      <section class="cs-section">
        <h2 class="cs-section-title">Friends</h2>
        <p v-if="!friendRows.length" class="cs-empty">No friends yet — open "Find people" below and send a request.</p>
        <div v-for="friend in friendRows" :key="friend.key" class="cs-friend cs-row-tappable" @click="$router.push(`/film-club/${friend.key}`)">
          <div class="cs-friend-head">
            <span class="cs-friend-name">{{ friend.name }}</span>
            <span class="cs-friend-chevron"><i class="bi bi-chevron-right"></i></span>
          </div>

          <p class="cs-friend-line">
            <span v-if="friend.error" class="cs-row-error">feed unreachable</span>
            <template v-else-if="friend.titles == null">no profile yet</template>
            <template v-else>
              <strong>{{ friend.titles }}</strong> titles
              <template v-if="friend.sharedCount"> · <strong>{{ friend.sharedCount }}</strong> in common</template>
              <template v-if="friend.alignment != null"> · <strong>{{ formatScore(friend.alignment) }}</strong> aligned</template>
              <template v-if="friend.lastWatchedAt"> · last watched {{ watchedAgo(friend.lastWatchedAt) }}</template>
            </template>
          </p>

          <!-- What they've been watching, rather than a bare count. Scrolls
               sideways through everything their profile publishes, a page at
               a time as you reach the end (2026-08-22: "we should increase
               that so it's a scrollable horizontal list... we don't want to
               load thousands of movies every time so these should be lazy
               loaded only when I scroll to see more"). -->
          <div
            v-if="friend.recent.length"
            class="cs-friend-posters"
            @scroll.passive="growFriendPosters(friend, $event)"
          >
            <img
              v-for="item in visibleRecent(friend)"
              :key="`${friend.key}-${item.id}-${item.at}`"
              :src="poster(item.p)"
              :alt="item.t"
              class="cs-friend-poster"
              loading="lazy"
            >
          </div>
        </div>
      </section>

      <!-- The charts are their own screen: they're the interesting half of
           the club once there are a few people in it, and they would double
           the length of this page. -->
      <button type="button" class="cs-charts-link" @click="$router.push('/club-charts')">
        <span>
          <strong>Club Charts</strong>
          <em>The Venn, taste maps, blind spots, who's the contrarian</em>
        </span>
        <i class="bi bi-chevron-right"></i>
      </button>

      <!-- Both of these lists run long and pushed everything else off the
           screen; they scroll in place instead ("it feels like it takes up
           too much space vertically... its own little section in a
           independent scrolling"). -->
      <section v-if="summary && summary.clubFavorites.length" class="cs-section">
        <h2 class="cs-section-title">Club favorites</h2>
        <p class="cs-caption">Rated by two or more of you, best average first.</p>
        <div class="cs-scroll-list">
          <div v-for="movie in summary.clubFavorites" :key="`fav-${movie.id}`" class="cs-consensus-row" @click="goToTitle(movie)">
            <img v-if="movie.p" :src="poster(movie.p)" :alt="movie.t" class="cs-thumb">
            <div class="cs-consensus-info">
              <span class="cs-row-name">{{ movie.t }}</span>
              <span class="cs-scores">
                <span v-for="score in movie.scores" :key="score.who" class="cs-score-chip">{{ score.who }} {{ formatScore(score.r) }}</span>
              </span>
            </div>
            <span class="cs-average">{{ movie.average.toFixed(2) }}</span>
          </div>
        </div>
      </section>

      <section v-if="summary && summary.biggestDivides.length" class="cs-section">
        <h2 class="cs-section-title">Most divisive</h2>
        <p class="cs-caption">The widest spreads between anyone in the club.</p>
        <div class="cs-scroll-list">
          <div v-for="movie in summary.biggestDivides" :key="`div-${movie.id}`" class="cs-consensus-row" @click="goToTitle(movie)">
            <img v-if="movie.p" :src="poster(movie.p)" :alt="movie.t" class="cs-thumb">
            <div class="cs-consensus-info">
              <span class="cs-row-name">{{ movie.t }}</span>
              <span class="cs-scores">
                <span v-for="score in movie.scores" :key="score.who" class="cs-score-chip">{{ score.who }} {{ formatScore(score.r) }}</span>
              </span>
            </div>
            <span class="cs-average cs-spread">±{{ formatScoreGap(movie.spread) }}</span>
          </div>
        </div>
      </section>

      <!-- Everything to do with FINDING people is housekeeping, not the daily
           view, so it collapses ("should the sections about who my friends
           are, finding friends in other apps, and finding people be somehow
           their own, like, maybe collapsible accordion"). Same component the
           settings pane uses. -->
      <SettingsSection
        v-if="pendingRows.length"
        title="Requests sent"
        hint="People you've asked, still waiting"
        collapsible
        :startOpen="false"
      >
        <div v-for="pending in pendingRows" :key="pending.key" class="cs-row">
          <span class="cs-row-name">{{ pending.name }}</span>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="cancel(pending.key)">Cancel</button>
        </div>
      </SettingsSection>

      <SettingsSection title="Friends on other apps" hint="Add someone using Movie Log or another app" collapsible :startOpen="false">
        <p class="cs-caption">
          Someone using a different movie app (like Movie Log) can join your club by sharing a feed link. They'll appear
          alongside everyone else — same comparisons, same picks.
        </p>
        <!-- Requests from people on other apps -->
        <div v-for="request in inboxRequests" :key="request.id" class="cs-row">
          <span class="cs-row-name">{{ request.name }} <span class="cs-row-app">on {{ request.app }}</span></span>
          <span class="cs-row-actions">
            <button type="button" class="btn btn-warning btn-sm" @click="acceptRequest(request)">Accept</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" @click="dismissRequest(request.id)">Dismiss</button>
          </span>
        </div>

        <!-- Browse people on other apps and add them directly. -->
        <div class="cs-discovery">
          <input v-model="directorySearch" type="text" class="form-control cs-input" placeholder="Search people on other apps">
          <p v-if="directoryLoading" class="cs-caption">Looking…</p>
          <p v-else-if="!visibleDirectory.length" class="cs-caption">
            {{ directorySearch ? 'Nobody by that name.' : 'Nobody discoverable right now.' }}
          </p>
          <div v-for="person in visibleDirectory" :key="`${person.app}-${person.handle}`" class="cs-row">
            <span class="cs-row-name">
              {{ person.name }}
              <span class="cs-row-app">@{{ person.handle }} · {{ person.app }}</span>
            </span>
            <button type="button" class="btn btn-warning btn-sm" :disabled="requesting === person.handle" @click="requestFriend(person)">
              {{ requesting === person.handle ? 'Asking…' : 'Add friend' }}
            </button>
          </div>
          <p v-if="externalError" class="cs-external-error">{{ externalError }}</p>
          <p v-if="externalNote" class="cs-caption">{{ externalNote }}</p>
        </div>

        <p v-if="!crossAppDiscovery" class="cs-share-own cs-caption">
          People on other apps can't find you yet — turn on
          <button type="button" class="cs-settings-link" @click="$router.push('/')">cross-app discovery in Settings</button>.
        </p>
      </SettingsSection>

      <SettingsSection title="Find people" hint="Everyone else on Cinema Roll who shares" collapsible :startOpen="false">
        <p v-if="!directoryRows.length" class="cs-empty">Nobody else has turned on sharing yet.</p>
        <div v-for="person in directoryRows" :key="person.key" class="cs-row">
          <span class="cs-row-name">{{ person.name }}</span>
          <button type="button" class="btn btn-warning btn-sm" @click="add(person.key)">Add friend</button>
        </div>
      </SettingsSection>
    </template>

    <!-- One instance for the whole screen: driven by which movie is set, so
         tapping along the feed re-targets it rather than mounting and tearing
         down a sheet per poster. -->
    <MoviePreview :movie="previewing" @close="previewing = null" @rate="rateFromPreview"/>
    </template>
  </div>
</template>
<script>
// The Film Club hub (/film-club): requests inbox, the combined all-friends
// summary, the friends list (each row opens the per-friend comparison),
// and the directory for sending requests. All set math is pure in
// src/assets/javascript/social.js; this screen only renders and dispatches.
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { afterFrame, SKELETON_FIRST } from '../utils/nextFrame.js';
import SettingsSection from './SettingsSection.vue';
import SendToHat from './SendToHat.vue';
import MoviePreview from './MoviePreview.vue';
import { ratedTmdbIds } from '../assets/javascript/discover.js';
import { timeAgo } from '../assets/javascript/timeAgo.js';
import { getRating } from '../assets/javascript/GetRating.js';
import { filmClubSummary, friendSnapshot, myRatingsById } from '../assets/javascript/social.js';
import { memoByIdentity } from '../utils/memoByIdentity.js';

// Both are pure in their (cached getter) inputs and were rebuilt on every
// open of the club - ~200ms at desktop speed (2026-09-23 speed sweep).
const summaryMemo = memoByIdentity((entries, profiles) => filmClubSummary(entries, getRating, profiles));
const clubTitlesMemo = memoByIdentity((entries, friends) => clubTitleIndex(entries, friends));
import { filterDirectory } from '../assets/javascript/interchange.js';
import { clubTitleIndex, searchClubTitles, clubSeenBreakdown } from '../assets/javascript/clubTitleSearch.js';
import { omitQaAccounts, isQaAccountKey } from '../assets/javascript/databaseKey.js';
import { formatScore, formatScoreGap } from '../assets/javascript/formatScore.js';

// A friend row shows this many posters before you scroll, then this many more
// each time you reach the end of the strip. The profile carries 40, and
// mounting every one of them for every friend is exactly the "load thousands
// of movies every time" the request asked us not to do — each poster is a
// TMDB image request.
const FRIEND_POSTERS_INITIAL = 8;
const FRIEND_POSTERS_PAGE = 8;
// How close to the right edge counts as "reached the end", in px.
const FRIEND_POSTERS_TRIGGER = 120;

export default {
  name: 'FilmClubScreen',
  components: { SkeletonBlock, BackLink, SettingsSection, SendToHat, MoviePreview },
  data () {
    return {
      painted: !SKELETON_FIRST,
      // How many recent posters each friend's strip is currently rendering,
      // keyed by friend key. Absent = the initial page.
      friendPosterCounts: {},
      // The unrated film whose summary sheet is open, or null.
      previewing: null,
      // Was never declared, so `v-model` on the "Search people on other apps"
      // box had nothing to write to and the filter never applied. Noticed
      // while adding `previewing`; the component had no data() at all.
      directorySearch: '',
      // "Has anybody seen…": what's typed, and the title picked out of the
      // results (report -P1lQnAdARMxUpPScybv).
      seenSearch: '',
      seenPick: null
    };
  },
  computed: {
    // TMDB ids of everything you've rated, for telling a friend's watch you
    // can open from one you can't.
    myTmdbIds () {
      return ratedTmdbIds(this.$store.getters.allMoviesAsArray);
    },
    socialSettings () {
      return this.$store.getters.socialSettings;
    },
    /**
     * Every title the club knows about — mine plus everything any friend has
     * published. Built once per library/profile change, not per keystroke:
     * ~1,400 of my own films plus a few friends' maps is real work, and the
     * search itself is then a walk over a flat array.
     */
    clubTitles () {
      return clubTitlesMemo(this.$store.getters.allMoviesAsArray, this.$store.getters.filmClubFriends);
    },
    seenMatches () {
      return searchClubTitles(this.clubTitles, this.seenSearch);
    },
    // Ids as STRINGS, which is what the breakdown compares against — a
    // published ratings map is keyed by Firebase, so its keys are strings
    // while a movie's own id is a number.
    myTmdbIdStrings () {
      return new Set([...this.myTmdbIds].map(String));
    },
    seenBreakdown () {
      return clubSeenBreakdown(
        this.$store.getters.filmClubFriends,
        this.seenPick?.id,
        { myRatedIds: this.myTmdbIdStrings }
      );
    },
    crossAppDiscovery () {
      return this.$store.getters.crossAppDiscoveryEnabled;
    },
    directoryLoading () {
      return this.$store.state.federatedDirectoryLoading;
    },
    visibleDirectory () {
      const known = Object.values(this.$store.state.settings?.externalFriends || {}).map((f) => f?.feedUrl);
      const asked = Object.keys(this.$store.state.settings?.clubRequestsSent || {});
      return filterDirectory(this.$store.state.federatedDirectory, {
        search: this.directorySearch,
        excludeHandles: asked,
        excludeInboxUrls: known.filter(Boolean)
      }).slice(0, 25);
    },
    inboxRequests () {
      return this.$store.getters.clubInboxRequests || [];
    },
    clubFeedUrl () {
      const account = this.$store.state.databaseTopKey;
      const secret = this.$store.state.settings?.clubFeedKey;
      if (!account || !secret) return '';
      return `https://movie-log-8c4d5-default-rtdb.firebaseio.com/clubFeed/${account}/${secret}.json`;
    },
    me () {
      return this.$store.getters.socialUserKey;
    },
    directory () {
      // Filter QA accounts on the way out as well as on the way in: a client
      // running older code could republish one, and nobody should ever be
      // offered the test user as a friend (Natalie, 2026-08-16).
      return omitQaAccounts(this.$store.state.socialDirectory);
    },
    friendKeys () {
      return this.$store.getters.socialFriendKeys;
    },
    profiles () {
      return this.$store.state.socialFriendProfiles || {};
    },
    requestRows () {
      return Object.entries(this.$store.state.socialRequests || {})
        // A request from someone I've already befriended is stale noise.
        .filter(([key]) => !this.friendKeys.includes(key))
        // The QA tester is invisible to real people, requests included.
        .filter(([key]) => !isQaAccountKey(key))
        .map(([key, request]) => ({ key, name: request?.name || this.nameFor(key) }));
    },
    // Built once and shared by every friend row, rather than walking the
    // library per friend.
    myRatings () {
      return myRatingsById(this.$store.getters.allMoviesAsArray || [], getRating);
    },
    friendRows () {
      return (this.$store.getters.filmClubFriends || []).map((friend) => {
        const snapshot = friendSnapshot(this.myRatings, friend.profile);
        return {
          key: friend.key,
          name: friend.name,
          external: friend.external,
          source: friend.source,
          error: friend.error,
          ...snapshot,
          // A poster-less recent item would render a broken image.
          recent: snapshot.recent.filter((item) => item.p)
        };
      })
        // "My friends should be sorted based on who watched a movie most
        // recently" (2026-08-17). Anyone with no profile yet sorts last
        // rather than jumping to the top on a null.
        .sort((a, b) => (b.lastWatchedAt || 0) - (a.lastWatchedAt || 0));
    },
    pendingRows () {
      return this.$store.getters.socialPendingSentKeys.map((key) => ({ key, name: this.nameFor(key) }));
    },
    directoryRows () {
      const excluded = new Set([this.me, ...this.friendKeys, ...this.$store.getters.socialPendingSentKeys]);
      return Object.entries(this.directory)
        .filter(([key]) => !excluded.has(key))
        .map(([key, row]) => ({ key, name: row?.name || key }));
    },
    summary () {
      return summaryMemo(
        this.$store.getters.allMoviesAsArray || [],
        this.$store.getters.filmClubProfiles || {}
      );
    }
  },
  watch: {
    // Edges arrive async from the listener; refetch profiles whenever the
    // mutual set changes (a new acceptance, a removal).
    friendKeys: {
      immediate: true,
      handler (keys) {
        if (keys.length) this.$store.dispatch('fetchFriendProfiles');
      }
    }
  },
  created () {
    this.$store.dispatch('attachSocialListeners');
    this.$store.dispatch('fetchSocialDirectory');
    this.$store.dispatch('syncExternalFriends');
    this.$store.dispatch('watchClubInbox');
    this.$store.dispatch('fetchFederatedDirectory');
    // Opening the club clears the rainbow chip's new-updates badge.
    this.$store.commit('markFilmClubSeen');
  },
  mounted () {
    afterFrame(() => { this.painted = true; });
  },
  methods: {
    // Exposed so the template can call them — an Options API template can't
    // reach module scope. Two decimals on every score (bug report); see
    // assets/javascript/formatScore.js.
    formatScore,
    formatScoreGap,
    // Star arithmetic, matching FriendsWhoSaw: whole stars filled, a trailing
    // half when the rating lands on a .5 step (starRating.js snaps to those,
    // so there is no third case).
    fullStars (stars) {
      return Math.floor(stars);
    },
    hasHalfStar (stars) {
      return stars % 1 !== 0;
    },
    watchedAgo (at) {
      return timeAgo(at);
    },
    async requestFriend (person) {
      this.externalError = '';
      this.externalNote = '';
      this.requesting = person.handle;
      try {
        const result = await this.$store.dispatch('requestFriendFromDirectory', person);
        if (!result?.ok) {
          this.externalError = result?.error || 'Could not send that request.';
          return;
        }
        this.externalNote = `Asked ${person.name}. They'll see it in ${person.app}.`;
      } finally {
        this.requesting = null;
      }
    },

    async acceptRequest (request) {
      await this.$store.dispatch('acceptClubRequest', request);
    },
    dismissRequest (id) {
      this.$store.dispatch('dismissClubRequest', id);
    },
    nameFor (key) {
      return this.directory[key]?.name || key;
    },
    accept (key) {
      this.$store.dispatch('acceptFriendRequest', key);
    },
    decline (key) {
      this.$store.dispatch('declineFriendRequest', key);
    },
    cancel (key) {
      this.$store.dispatch('cancelFriendRequest', key);
    },
    add (key) {
      this.$store.dispatch('sendFriendRequest', key);
    },
    poster (path) {
      return `https://image.tmdb.org/t/p/w185${path}`;
    },
    clearSeenPick () {
      this.seenPick = null;
      this.seenSearch = '';
    },
    visibleRecent (friend) {
      return friend.recent.slice(0, this.friendPosterCounts[friend.key] || FRIEND_POSTERS_INITIAL);
    },
    // Scrolled to within a poster's width of the end: render the next page.
    // Nothing here reaches the network directly — the new <img>s do, which is
    // the point of paging them in rather than mounting all forty.
    growFriendPosters (friend, event) {
      const strip = event.target;
      const shown = this.friendPosterCounts[friend.key] || FRIEND_POSTERS_INITIAL;
      if (shown >= friend.recent.length) return;
      if (strip.scrollLeft + strip.clientWidth < strip.scrollWidth - FRIEND_POSTERS_TRIGGER) return;

      this.friendPosterCounts[friend.key] = Math.min(shown + FRIEND_POSTERS_PAGE, friend.recent.length);
    },
    goToMovie (tmdbId) {
      if (tmdbId == null) return;
      this.$router.push(`/movie/${tmdbId}`);
    },
    inMyLibrary (tmdbId) {
      return tmdbId != null && this.myTmdbIds.has(tmdbId);
    },
    // "Clicking a poster on the recent friends feed takes me to that movie in
    // my db. But if I haven't seen that movie, it should instead take me
    // nowhere" (2026-08-17). MovieDetail is a pure lookup in YOUR library, so
    // a friend's film you've never rated rendered an empty page.
    // In your library: straight to your own detail page, which is the richer
    // destination. Not in it: MovieDetail is a pure local lookup and would
    // render an empty page, so this used to do NOTHING at all — a dead poster.
    // Bug report, 2026-08-20: "if it's one that I have not yet rated... just
    // clicking the poster should pull up some kind of a summary of the movie
    // so that I can investigate further."
    openFeedItem (item) {
      if (item?.id == null) return;
      if (this.inMyLibrary(item.id)) {
        this.goToMovie(item.id);
        return;
      }
      this.previewing = { id: item.id, title: item.t || '', poster_path: item.p || null, source: this.hatMovieFor(item) };
    },
    rateFromPreview (media) {
      this.previewing = null;
      this.$store.commit('setMovieToRate', media);
      this.$router.push('/rate-movie');
    },
    // A friend's feed item is a bare {id,t,p,...}, not a library entry —
    // toHatMovie takes either, but it wants TMDB field names.
    hatMovieFor (item) {
      return {
        id: item.id,
        title: item.t,
        poster_path: item.p || null,
        release_date: '',
        overview: ''
      };
    },
    feedNote (item) {
      const score = item.r != null ? ` (${formatScore(item.r)})` : '';
      return `${item.friendName} watched this${score}`;
    },
    goToTitle (movie) {
      this.goToMovie(movie.id);
    }
  }
};
</script>

<style lang="scss" scoped>
.film-club-screen {
  color: #eee;
  min-width: 0;
  padding: 0.75rem 1rem 2rem;
  width: 100%;
}

.cs-charts-link {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  color: #eee;
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  text-align: left;
  width: 100%;
}

.cs-charts-link:active { opacity: 0.75; }
.cs-charts-link strong { display: block; font-size: 0.95rem; }
.cs-charts-link em { color: #b9b9b9; font-size: 0.72rem; font-style: normal; }

/* A friend row was a name, a count and a chevron. It now says how much you
   overlap, how closely you agree and what they've just been watching
   (2026-08-17: "the list of friends in my film club is a bit sparse"). */
.cs-friend {
  border-bottom: 1px solid #242424;
  padding: 0.6rem 0;
}

.cs-friend:last-child { border-bottom: none; }

.cs-friend-head {
  align-items: baseline;
  display: flex;
  justify-content: space-between;
}

.cs-friend-name { color: #fff; font-size: 1rem; font-weight: 700; }
.cs-friend-chevron { color: #9a9a9a; }

.cs-friend-line {
  color: #b9b9b9;
  font-size: 0.72rem;
  margin: 0.15rem 0 0.4rem;
}

.cs-friend-line strong { color: #eee; }

/* Scrolls sideways rather than wrapping or truncating (2026-08-22). Poster
   size is deliberately unchanged — "don't mess with the size of the posters
   just load more". `align-items: flex-start` keeps every top and bottom edge
   in line, the house rule for any poster row. */
.cs-friend-posters {
  align-items: flex-start;
  display: flex;
  gap: 0.35rem;
  overflow-x: auto;
  /* The row's parent scrolls the page; without this an almost-horizontal
     swipe hands the gesture up and the strip feels stuck. */
  overscroll-behavior-x: contain;
  padding-bottom: 0.25rem;
}

.cs-friend-poster {
  border-radius: 4px;
  display: block;
  flex: 0 0 auto;
  height: 66px;
  object-fit: cover;
  width: 44px;
}

/* The feed is the part Matt likes most and it read as a thin strip, so its
   posters run larger than the other rows' (2026-08-17: "the recent feed on
   my film club could be larger"). */
.cs-feed-row .cs-poster-card { flex: 0 0 116px; width: 116px; }
.cs-feed-row .cs-poster { height: 174px; width: 116px; }

/* Feed posters carry an add-to-hat button for anything not in your library,
   so an unopenable card still has something to do. */
.cs-poster-frame { position: relative; }

/* Flush: the hat control is a corner ribbon. */
.cs-poster-hat {
  position: absolute;
  right: 0;
  top: 0;
}

.cs-poster-unseen {
  color: #9a9a9a;
  display: block;
  font-size: 0.62rem;
  line-height: 1.2;
}

/* Only the ones that go somewhere look like they do. */
.cs-poster-tappable { cursor: pointer; }
.cs-poster-tappable:active { transform: scale(0.97); }

.cs-title { margin: 0.25rem 0 0; }
.cs-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 1rem; }

.cs-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
}

.cs-section-title { font-size: 1.05rem; margin: 0 0 0.5rem; }
.cs-subhead { color: #ffc107; font-size: 0.8rem; letter-spacing: 0.4px; margin: 0.75rem 0 0.25rem; text-transform: uppercase; }
.cs-caption { color: #ccc; font-size: 0.75rem; margin: 0 0 0.5rem; }
.cs-empty { color: #ccc; font-size: 0.85rem; margin: 0; }

.cs-add-external,
.cs-share-own {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.cs-share-own { border-top: 1px solid #2e2e2e; margin-top: 0.75rem; padding-top: 0.75rem; }

.cs-input {
  background: #161616;
  border: 1px solid #2e2e2e;
  color: white;
  font-size: 0.8rem;

  &::placeholder { color: #888; }
}

.cs-external-error { color: #e88; font-size: 0.75rem; margin: 0; }
.cs-row-app { color: #ccc; font-size: 0.75rem; font-weight: 400; }
.cs-discovery { display: flex; flex-direction: column; gap: 0.3rem; }

.cs-settings-link {
  background: none;
  border: none;
  color: #9ec5fe;
  padding: 0;
  text-decoration: underline;
}

.cs-row {
  align-items: center;
  border-top: 1px solid #2e2e2e;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  padding: 0.55rem 0;

  &:first-of-type { border-top: none; }
}

.cs-row-tappable:active { background: #222; }

.cs-row-name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.cs-row-detail { color: #ccc; font-size: 0.8rem; white-space: nowrap; }
.cs-row-error { color: #e88; }
.cs-row-actions { display: flex; gap: 0.4rem; }

.cs-seen-matches { display: flex; flex-direction: column; margin-top: 0.5rem; }

.cs-seen-match {
  align-items: center;
  background: none;
  border: none;
  border-top: 1px solid #2e2e2e;
  color: white;
  display: flex;
  gap: 0.5rem;
  padding: 0.4rem 0;
  text-align: left;
  width: 100%;

  &:first-of-type { border-top: none; }
  // Mobile-first: :active, never :hover — a tapped row on an installed PWA
  // keeps a hover state with no mouse to leave it.
  &:active { background: #222; }
}

.cs-seen-thumb {
  border-radius: 3px;
  flex: 0 0 auto;
  height: 42px;
  object-fit: cover;
  width: 28px;
}

.cs-seen-thumb--blank { background: #2e2e2e; display: block; }
.cs-seen-match-title { font-size: 0.85rem; min-width: 0; overflow-wrap: anywhere; }

.cs-seen-answer { margin-top: 0.5rem; }

.cs-seen-head {
  align-items: baseline;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.cs-seen-picked { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }

.cs-seen-clear {
  background: none;
  border: none;
  color: #9ec5fe;
  flex: none;
  font-size: 0.75rem;
  padding: 0;
  text-decoration: underline;
}

// #ccc, not .text-muted — Bootstrap's muted grey fails against these panels.
.cs-seen-you { color: #ccc; font-size: 0.8rem; margin: 0.15rem 0 0; }

.cs-poster-row {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.25rem;
}

.cs-poster-card {
  flex: 0 0 auto;
  width: 74px;
}

.cs-poster {
  border-radius: 6px;
  display: block;
  height: 111px;
  object-fit: cover;
  width: 74px;
}

.cs-poster-blank {
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

.cs-poster-note {
  align-items: center;
  color: #ccc;
  display: flex;
  flex-wrap: wrap;
  font-size: 0.65rem;
  gap: 0.05rem 0.3rem;
  justify-content: center;
  margin-top: 0.2rem;
}

/* The name is the part that gets long, so it's the only part that truncates —
   the stars beside it stay whole. */
.cs-poster-who {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Same gold as the detail-page pills (#f8d62b on #161616, ~11:1). */
.cs-poster-stars {
  color: #f8d62b;
  display: inline-flex;
  font-size: 0.6rem;
  gap: 0.05rem;
  white-space: nowrap;
}

.cs-poster-score {
  font-variant-numeric: tabular-nums;
}

/* How fresh the viewing is. #9a9a9a on #161616 is ~7:1. */
.cs-poster-when {
  color: #9a9a9a;
  display: block;
  font-size: 0.62rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Club favorites and Most divisive both run to dozens of rows and pushed the
   rest of the page away. They scroll in place now. */
.cs-scroll-list {
  max-height: 16rem;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.cs-consensus-row {
  align-items: flex-start;
  border-top: 1px solid #2e2e2e;
  display: flex;
  gap: 0.6rem;
  padding: 0.55rem 0;

  &:active { background: #222; }
}

.cs-thumb {
  border-radius: 4px;
  flex: 0 0 auto;
  height: 69px;
  object-fit: cover;
  width: 46px;
}

.cs-consensus-info { display: flex; flex: 1 1 auto; flex-direction: column; gap: 0.25rem; min-width: 0; }

.cs-scores { display: flex; flex-wrap: wrap; gap: 0.3rem; }

.cs-score-chip {
  background: #222;
  border-radius: 6px;
  color: #ccc;
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
}

.cs-average { color: #ffc107; font-weight: 700; }
.cs-spread { color: #e88; }
</style>
