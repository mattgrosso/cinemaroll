<template>
  <!-- Lines, not pills (2026-10-04: "we're stuck with this like pill with
       name and stars"). On the movie page they continue your own viewing
       lines in one panel: the label is a thin divider, then the name on the
       left and the stars where your score sits. The hidden chevron matches
       the one on your lines, so the stars line up under your score. -->
  <div v-if="friends.length" class="friends-who-saw" :class="{ 'friends-who-saw--compact': compact }">
    <div v-if="label" class="friends-who-saw-label">{{ label }}</div>
    <!-- Compact, the rows wrap inside this column so a second line starts
         under the first name, not under the label (Matt, 2026-10-06). -->
    <div class="friend-rows">
    <div v-for="friend in friends" :key="friend.key" class="friend-row">
      <span class="friend-name">{{ friend.name }}</span>
      <span v-if="friend.stars !== null" class="friend-stars" :aria-label="`${friend.stars} out of 5`">
        <i v-for="i in fullStars(friend)" :key="`f${i}`" class="bi bi-star-fill"/>
        <i v-if="hasHalfStar(friend)" class="bi bi-star-half"/>
      </span>
      <!-- No stars published yet: their app assigns those, and an older
           profile simply doesn't carry them. The composite is worth less as a
           comparison but it's what we have, and it beats a blank line. -->
      <span v-else-if="friend.score !== null" class="friend-score">{{ formatScore(friend.score) }}</span>
      <!-- Their written Letterboxd review(s), when the sweep has any for this
           film (2026-11-17, "is there any way to get their actual written
           reviews"). The pane opens under the rows, one friend at a time. -->
      <button
        v-if="friend.reviews && friend.reviews.length"
        type="button"
        class="friend-review-toggle"
        :class="{ open: openReviewKey === friend.key }"
        :aria-expanded="openReviewKey === friend.key ? 'true' : 'false'"
        @click="toggleReview(friend.key)"
      >Review<template v-if="friend.reviews.length > 1">s</template></button>
      <i class="bi bi-chevron-down friend-row-spacer" aria-hidden="true"></i>
    </div>
    </div>
    <div v-if="openFriend" class="friend-review-pane">
      <div v-for="review in openFriend.reviews" :key="review.id" class="friend-review">
        <div class="friend-review-head">
          <span class="friend-review-name">{{ openFriend.name }}</span>
          <a v-if="review.url" :href="review.url" target="_blank" rel="noopener" class="friend-review-date">{{ dateLabel(review.watchedDate) }}</a>
          <span v-else class="friend-review-date">{{ dateLabel(review.watchedDate) }}</span>
          <span v-if="review.spoilers" class="friend-review-flag">Spoilers</span>
        </div>
        <p class="friend-review-text">{{ review.review }}</p>
      </div>
    </div>
  </div>
</template>

<script>
// "I just need little pills that show the name and rating for any friends who
// have seen and rated the movie" (2026-08-25), then: "let's use the normalized
// ratings... It would be best if we could show star ratings for these."
//
// Stars, not the composite, because the composite isn't comparable between
// people: `r` is each person's own weighted total, while stars present the
// NORMALIZED rating — library-relative and curve-adjusted — which is what
// makes one friend's 4 stars mean the same as another's. Only the source can
// assign them (see starRating.js), so they travel in the profile rather than
// being worked out here.
import { formatScore } from '../assets/javascript/formatScore.js';
import { clubLinesFor } from '../assets/javascript/friendReviews.js';
import { watchedDateLabel } from '../assets/javascript/letterboxdFormat.js';

// How old a copy of a friend's profile these pills will show. Profiles are
// one-shot reads, so an app left open holds whatever it fetched at launch;
// a friend-log push arriving hours later steers that same running app to the
// film, and the pills have to be able to say what the push just said. Five
// minutes keeps a movie-to-movie browse from re-downloading ~100KB per
// friend at every step while still beating any notification tap.
export const FRIEND_PROFILE_MAX_AGE_MS = 5 * 60 * 1000;

export default {
  name: 'FriendsWhoSaw',
  props: {
    tmdbId: {
      type: [Number, String],
      default: null
    },
    // A small field-name label before the pills ("Club" on the movie page),
    // shown only when there are pills to name.
    label: {
      type: String,
      default: ''
    },
    // One wrapping line — "Club  Seth ★★★★  Brian ★★★½" — instead of a row
    // per friend (Matt, 2026-10-06: the club "taking up a lot of space on
    // the screen on the initial above-the-fold screen", and outweighing
    // his own ratings).
    compact: {
      type: Boolean,
      default: false
    }
  },
  data () {
    return { openReviewKey: null };
  },
  computed: {
    friends () {
      return clubLinesFor(this.$store.getters.filmClubFriends, this.$store.state.friendLetterboxd, this.tmdbId);
    },
    openFriend () {
      return this.friends.find((friend) => friend.key === this.openReviewKey && friend.reviews.length) || null;
    },
    // Everything this component needs fetched, as one string cheap to watch.
    //
    // The screens that load club data all do it on MOUNT, and a friend-log
    // push notification navigates straight to `/#/movie/<id>` — so the app
    // can cold-start on this page with Home never mounting at all, and
    // NOBODY'S rating shows for the whole session (report
    // -P0EQt6w7iKdJziMXHTi: "I clicked on their notification... their rating
    // and none of the other ratings, none of them were there"). The pills
    // therefore ensure their own data.
    //
    // And the pills ask for a FRESH copy (maxAgeMs), not just a present one:
    // report -P0sDPxbC4120byAaK5W (2026-09-06), Seth logged a film, the push
    // steered Matt's already-open app here, and Seth's profile in memory was
    // the one fetched that morning.
    //
    // The user KEY is watched alongside membership, and it is the load-
    // bearing part on that path: at mount, auth hasn't resolved, so
    // attachSocialListeners has no account to listen for and returns having
    // done nothing — and without the key here, nothing would ever ask it
    // again, because the native roster it would otherwise wait on is exactly
    // what that listener produces. An account with external friends happens
    // to recover when settings land; one without would stay blank.
    clubRoster () {
      const me = this.$store.getters.socialUserKey || '';
      const native = this.$store.getters.socialFriendKeys || [];
      const external = Object.keys(this.$store.state?.settings?.externalFriends || {});
      return [me, ...native, ...external].join('|');
    }
  },
  watch: {
    clubRoster: {
      // Immediate doubles as the mounted hook; ensureClubData only fetches
      // what's missing, so re-fires are cheap no-ops once profiles are in.
      immediate: true,
      handler () {
        this.$store.dispatch('ensureClubData', { maxAgeMs: FRIEND_PROFILE_MAX_AGE_MS });
        this.$store.dispatch('ensureFriendLetterboxd');
      }
    },
    tmdbId () {
      this.openReviewKey = null;
    }
  },
  methods: {
    formatScore,
    toggleReview (key) {
      this.openReviewKey = this.openReviewKey === key ? null : key;
    },
    dateLabel (date) {
      return date ? watchedDateLabel(date) : 'On Letterboxd';
    },
    fullStars (friend) {
      return Math.floor(friend.stars);
    },
    hasHalfStar (friend) {
      return friend.stars % 1 !== 0;
    }
  }
};
</script>

<style lang="scss">
@import '@/assets/scss/detail-scale';
  .friends-who-saw {
    .friends-who-saw-label {
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      color: #6fb8ff;
      font-size: ds(0.62rem);
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 0.4rem 0.6rem 0.1rem;
      text-transform: uppercase;
    }

    /* Same measure as a viewing line on the movie page. */
    .friend-row {
      align-items: center;
      display: flex;
      font-size: ds(0.8rem);
      gap: 8px;
      padding: 0.35rem 0.6rem;
    }

    .friend-name {
      color: #fff;
      flex: 1 1 auto;
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .friend-stars {
      color: #f8d62b;
      display: inline-flex;
      flex: 0 0 auto;
      font-size: ds(0.75rem);
      gap: 0.1rem;
      white-space: nowrap;
    }

    .friend-score {
      /* Tabular so the column doesn't jitter, and #ccc rather than
         Bootstrap's .text-muted, which fails contrast on this app's dark
         panels (see .claude/rules/vue-ui.md). */
      color: #ccc;
      flex: 0 0 auto;
      font-variant-numeric: tabular-nums;
    }

    .friend-row-spacer {
      flex: 0 0 auto;
      font-size: ds(0.7rem);
      visibility: hidden;
    }

    .friend-review-toggle {
      background: rgba(255, 128, 0, 0.1);
      border: 1px solid #ff8000; /* Letterboxd's orange */
      border-radius: 4px;
      color: #fff;
      flex: 0 0 auto;
      font-size: ds(0.62rem);
      letter-spacing: 0.04em;
      line-height: 1.2;
      padding: 2px 6px;
      text-transform: uppercase;

      &.open,
      &:active { background: rgba(255, 128, 0, 0.3); }
    }

    /* Styled like the Letterboxd tile's "your review" pane on the movie page. */
    .friend-review-pane {
      grid-column: 1 / -1;
      padding: 0 0.6rem 0.35rem;
    }

    .friend-review {
      background: rgba(255, 255, 255, 0.05);
      border-left: 2px solid #ff8000;
      margin-top: 6px;
      padding: 6px 8px;
      text-align: left;
    }

    .friend-review-head {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
    }

    .friend-review-name {
      color: #fff;
      font-size: ds(0.75rem);
      font-weight: 600;
    }

    .friend-review-date {
      color: #ccc;
      font-size: ds(0.75rem);
      text-decoration: none;

      &:active { color: #fff; }
    }

    .friend-review-flag {
      color: #ffb366;
      font-size: ds(0.62rem);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    .friend-review-text {
      color: #fff;
      font-size: ds(0.85rem);
      line-height: 1.4;
      margin: 4px 0 0;
      white-space: pre-line;
    }

    &--compact {
      align-items: baseline;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      column-gap: 12px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      padding: 0.35rem 0.6rem 0.45rem;

      .friends-who-saw-label { border-top: 0; padding: 0; }
      .friend-rows { display: flex; flex-wrap: wrap; gap: 2px 12px; min-width: 0; }
      .friend-row { display: inline-flex; font-size: ds(0.75rem); gap: 5px; padding: 0; }
      .friend-name { color: #ddd; flex: 0 0 auto; }
      .friend-stars { font-size: ds(0.6rem); }
      .friend-score { font-size: ds(0.7rem); }
      .friend-review-toggle { font-size: ds(0.55rem); padding: 1px 5px; }
      .friend-review-pane { padding: 0; }
      .friend-row-spacer { display: none; }
    }
  }
</style>
