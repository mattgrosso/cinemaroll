<template>
  <section v-if="hats.length" class="draw-from-hat">
    <h2 class="section-title">Your hats</h2>
    <p class="section-caption">
      A real draw — the movie leaves the hat and lands in its history, exactly as it would in Movie Hat.
    </p>

    <!-- Movie Hat is a separate Firebase project with its own sign-in, and
         its rules refuse anonymous reads. When that session lapses (or is a
         different Google account) every hat here answers 401 and the cards
         all read "couldn't load" — which says nothing about what to do about
         it. Say which of the three it is, and put the fix next to it. -->
    <div v-if="accessError" class="hat-access">
      <p class="hat-access-text">{{ accessMessage }}</p>
      <button type="button" class="hat-access-btn" :disabled="reconnecting" @click="reconnect">
        <span v-if="reconnecting" class="spinner-border spinner-border-sm" role="status"></span>
        <span v-else>{{ accessError.reason === 'not-connected' ? 'Connect Movie Hat' : 'Reconnect' }}</span>
      </button>
      <p v-if="reconnectError" class="hat-access-failed">{{ reconnectError }}</p>
    </div>

    <div class="hat-cards">
      <div v-for="hat in cards" :key="hat.title" class="hat-card">
        <!-- Rebuilt as a vertical block (2026-08-17). It used to be a flex ROW
             of poster + body, and the history strip was appended as a third
             flex child, so it was squeezed into a narrow column beside the
             text — "the layout on the hat displays where you're showing the
             history is all busted". A row can't hold a full-width strip; this
             stacks instead. -->
        <!-- ONE row: name, count, Draw (bug report 2026-08-21: "that whole
             header section is way too much... combine the title the button
             and the number of movies in the hat all into one row for sure
             and you can make the button smaller"). It used to be a head row
             plus a separate button row — the leftover of the "Last drew"
             block that once lived between them. The button keeps the 40px
             touch height; smaller means narrower and quieter, not harder
             to hit. -->
        <div class="hat-head">
          <span class="hat-name">{{ hat.title }}</span>
          <span class="hat-waiting">
            <template v-if="hat.error">couldn't load</template>
            <template v-else-if="hat.waiting == null">&hellip;</template>
            <template v-else>{{ hat.waiting }} waiting</template>
          </span>
          <button type="button" class="hat-draw" :disabled="drawing" @click="draw(hat)">
            <span v-if="drawing === hat.title" class="spinner-border spinner-border-sm" role="status"></span>
            <span v-else>Draw</span>
          </button>
        </div>

        <span v-if="!hat.error && !hatHasHistory(hat)" class="hat-empty-label">Nothing drawn yet.</span>

        <!-- Full width, which is the whole reason the card had to stop being
             a row. Everything this hat has ever given up, newest first.
             Shown from the FIRST draw now: it used to need more than one
             entry, because a lone entry would just have restated the "Last
             drew" block that stood above it. That block is gone, so a
             single-draw hat would otherwise show nothing at all. -->
        <div v-if="hatHasHistory(hat)" class="hat-history">
          <p class="hat-history-title">Everything it's drawn · {{ hat.history.length }}</p>
          <div class="hat-history-row">
            <!-- A button, not a div (bug report): "I could click on a poster
                 in one of those lists and it would pop up a list of where I
                 can watch that movie". Being a real button also makes it
                 reachable by keyboard and announced as an action. -->
            <button
              v-for="(drawnMovie, index) in hat.history"
              :key="`${hat.title}-${drawnMovie.id}-${index}`"
              type="button"
              class="hat-history-card"
              :aria-label="`Where to watch ${drawnMovie.title}`"
              @click="showWhereToWatch(drawnMovie)"
            >
              <img
                v-if="drawnMovie.poster_path"
                :src="historyPoster(drawnMovie)"
                :alt="drawnMovie.title"
                :title="drawnMovie.title"
                class="hat-history-poster"
                loading="lazy"
              >
              <div v-else class="hat-history-poster hat-history-blank">{{ drawnMovie.title }}</div>
              <span class="hat-history-when">{{ drawnAt(drawnMovie) }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="drawn" class="drawn">
      <img
        v-if="drawn.movie.poster_path"
        :src="`https://image.tmdb.org/t/p/w342${drawn.movie.poster_path}`"
        :alt="drawn.movie.title"
        class="drawn-poster"
        @click="openMovie"
      >
      <div class="drawn-info">
        <p class="drawn-title">{{ drawn.movie.title }}</p>
        <p v-if="drawn.movie.addedBy" class="drawn-meta">Added by {{ drawn.movie.addedBy }}</p>
        <p v-if="drawn.movie.note" class="drawn-note">{{ drawn.movie.note }}</p>
        <p class="drawn-meta">{{ drawn.remaining }} left in {{ drawn.hat }}</p>
        <button type="button" class="drawn-link" @click="openMovie">Look it up</button>
      </div>
    </div>

    <p v-if="message" class="draw-message" :class="{ 'draw-message-error': messageIsError }">{{ message }}</p>

    <!-- One instance for every poster in every hat: it is driven by which
         movie is set, so tapping along a strip re-targets it rather than
         mounting and tearing down a sheet per poster. -->
    <WhereToWatch :movie="whereToWatch" @close="whereToWatch = null"/>
  </section>
</template>

<script>
// Your hats, on the watchlist — Matt, 2026-08-16: "The draw from hat buttons
// do not need to be all the way at the top. Let's add a section lower down
// that shows each hat with the most recently drawn movie, the total number
// of movies in the hat, and a button to draw."
//
// A draw is destructive on purpose: the movie moves from the hat into its
// history. That is what makes it a hat rather than a shuffle button, so this
// does exactly what Movie Hat's own draw does, through the shared module.
//
// It deliberately does NOT lead into rating: "that's dumb. I'll have to watch
// the movie first." The only follow-on offered is looking the film up.
import ErrorLogService from '../services/ErrorLogService.js';
import { timeAgo } from '../assets/javascript/timeAgo.js';
import WhereToWatch from './WhereToWatch.vue';

// When a hat was last drawn from, or 0 for never (and for a hat whose
// summary hasn't loaded or couldn't). History arrives newest-first from the
// store, but this reads every entry rather than trusting the order.
function lastDrawAt (card) {
  const history = Array.isArray(card?.history) ? card.history : [];
  return history.reduce((latest, drawn) => Math.max(latest, Number(drawn?.dateDrawn) || 0), 0);
}

export default {
  name: 'DrawFromHat',
  components: { WhereToWatch },
  data () {
    return {
      drawing: null,
      drawn: null,
      message: null,
      messageIsError: false,
      reconnecting: false,
      reconnectError: null,
      // The history poster whose availability sheet is open, or null.
      whereToWatch: null
    };
  },
  computed: {
    hats () {
      return this.$store.getters.linkedMovieHats || [];
    },
    // The linked hats always render; their counts and last draw fill in when
    // the lookups land, so the section doesn't pop into existence late.
    // Most recently drawn from at the top (bug report, 2026-09-13: "sorted
    // by most recently drawn from so whichever one has a movie that was most
    // recently drawn it should be at the top"). The hat you're actually
    // using is the one you came here for. Hats that have never been drawn
    // from sit below, in their linked order — and until the summaries land
    // nothing has a draw date yet, so the linked order holds and the cards
    // don't shuffle after they appear.
    cards () {
      const summaries = this.$store.state.movieHatSummaries || [];
      const cards = this.hats.map((hat) => summaries.find((summary) => summary.title === hat.title) || { ...hat, waiting: null });
      return cards
        .map((card, index) => ({ card, index, drawnAt: lastDrawAt(card) }))
        .sort((a, b) => (b.drawnAt - a.drawnAt) || (a.index - b.index))
        .map(({ card }) => card);
    },
    accessError () {
      return this.$store.state.movieHatAccessError;
    },
    // Each reason needs a different action, so each gets its own sentence.
    // 'denied' is the one worth naming the account for: a good token that the
    // rules still refuse almost always means the wrong Google account is
    // connected, and hat membership is per address.
    accessMessage () {
      const { reason, email } = this.accessError || {};
      if (reason === 'not-connected') {
        return 'Cinema Roll isn\'t signed in to Movie Hat, so it can\'t read your hats. Movie Hat is a separate app with its own sign-in.';
      }
      if (reason === 'token-failed') {
        return `Your Movie Hat session${email ? ` (${email})` : ''} has expired and needs renewing.`;
      }
      return email
        ? `Movie Hat is connected as ${email}, which isn't a member of these hats. Reconnect with the account that owns them.`
        : 'Movie Hat refused these hats. Reconnect with the account that owns them.';
    }
  },
  watch: {
    // Settings arrive after mount, so loading these in mounted() fetched an
    // empty list once and never tried again — the cards sat on "…" forever.
    hats: {
      immediate: true,
      handler (hats) {
        if (hats.length) this.$store.dispatch('loadMovieHatSummaries');
      }
    }
  },
  methods: {
    // The whole point of the banner: the fix is one tap from the thing that
    // failed, rather than somewhere in Settings that nobody was told to open.
    async reconnect () {
      this.reconnecting = true;
      this.reconnectError = null;
      try {
        await this.$store.dispatch('connectMovieHat');
        // Both caches are keyed off a session that just changed; force the
        // contents refresh past its ten-minute window so the cards refill now.
        await Promise.all([
          this.$store.dispatch('loadMovieHatSummaries'),
          this.$store.dispatch('ensureMovieHatContents', { force: true })
        ]);
      } catch (error) {
        // Dismissing the Google chooser is a choice, not a failure.
        if (error?.code !== 'auth/popup-closed-by-user') {
          this.reconnectError = "Couldn't sign in to Movie Hat.";
          ErrorLogService.error('Movie Hat reconnect failed', error);
        }
      } finally {
        this.reconnecting = false;
      }
    },
    hatHasHistory (hat) {
      return Boolean(hat.history && hat.history.length);
    },
    showWhereToWatch (drawnMovie) {
      this.whereToWatch = { id: drawnMovie.id, title: drawnMovie.title };
    },
    historyPoster (drawnMovie) {
      return `https://image.tmdb.org/t/p/w185${drawnMovie.poster_path}`;
    },
    drawnAt (drawnMovie) {
      return timeAgo(drawnMovie?.dateDrawn) || '—';
    },
    async draw (hat) {
      this.drawing = hat.title;
      this.message = null;
      this.messageIsError = false;

      try {
        const result = await this.$store.dispatch('drawFromMovieHat', { title: hat.title, dbKey: hat.dbKey });

        if (!result.movie) {
          this.drawn = null;
          this.message = `${hat.title} is empty. Which is sad.`;
          return;
        }
        this.drawn = result;
        // The card's count and last-drawn are now stale by definition.
        this.$store.dispatch('loadMovieHatSummaries');
      } catch (error) {
        ErrorLogService.error('Drawing from a movie hat failed', error);
        this.message = `Couldn't reach ${hat.title}.`;
        this.messageIsError = true;
      } finally {
        this.drawing = null;
      }
    },
    openMovie () {
      if (this.drawn?.movie?.id != null) {
        this.$router.push(`/movie/${this.drawn.movie.id}`);
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.draw-from-hat {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  padding: 0.75rem 1rem;
}

.section-title { font-size: 1.05rem; margin: 0 0 0.35rem; }

.section-caption {
  /* #b9b9b9 on #161616, ~8:1. */
  color: #b9b9b9;
  font-size: 0.75rem;
  line-height: 1.35;
  margin: 0 0 0.7rem;
}

/* Same neutral surface as .hat-card rather than a coloured alert — this is
   an explanation with an action, not an error to recoil from. No left accent
   bar (see .claude/rules/vue-ui.md). */
.hat-access {
  background: #1f1f1f;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  margin-bottom: 0.7rem;
  padding: 0.7rem;
}

.hat-access-text {
  /* #ccc on #1f1f1f, ~6:1. */
  color: #ccc;
  font-size: 0.8rem;
  line-height: 1.4;
  margin: 0 0 0.6rem;
}

.hat-access-btn {
  background: #ffc107;
  border: none;
  border-radius: 6px;
  color: #1a1a1a;
  font-size: 0.8rem;
  font-weight: 600;
  /* House minimum tap target. */
  min-height: 40px;
  padding: 0 1rem;
  width: 100%;
}

/* Mobile-first: press feedback only, never a hover state that sticks. */
.hat-access-btn:active {
  background: #e0a800;
}

.hat-access-btn:disabled {
  opacity: 0.6;
}

.hat-access-failed {
  color: #ff8a80;
  font-size: 0.75rem;
  margin: 0.5rem 0 0;
}

.hat-cards {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* A vertical block. It was a flex row, which had no place to put a full-width
   history strip — appended there it became a squeezed third column. */
.hat-card {
  background: #1f1f1f;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  padding: 0.6rem 0.7rem;
}

.hat-head {
  align-items: center;
  display: flex;
  gap: 0.6rem;
}

/* The name owns the slack; a long hat name wraps and the row grows. */
.hat-name { color: #fff; flex: 1 1 auto; font-size: 0.95rem; font-weight: 700; min-width: 0; }
.hat-waiting { color: #b9b9b9; flex: 0 0 auto; font-size: 0.72rem; white-space: nowrap; }

.hat-empty-label {
  color: #9a9a9a;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  margin-top: 0.4rem;
  text-transform: uppercase;
}

.hat-draw {
  background: #33383d;
  border: 1px solid #555c63;
  border-radius: 8px;
  color: #eee;
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 600;
  /* 40px minimum touch target — "smaller" shrinks the padding, not the hit area. */
  min-height: 40px;
  padding: 0.25rem 0.75rem;
}

/* Mobile-first: press feedback is :active only, never :hover. */
.hat-draw:active { background: #23272b; }
.hat-draw:disabled { opacity: 0.6; }

.drawn {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
}

.drawn-poster {
  border-radius: 4px;
  flex: 0 0 auto;
  width: 96px;
}

.drawn-info {
  min-width: 0;
}

.drawn-title {
  color: #fff;
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0 0 0.2rem;
}

.drawn-meta {
  color: #b9b9b9;
  font-size: 0.75rem;
  margin: 0 0 0.2rem;
}

.drawn-note {
  color: #eee;
  font-size: 0.8rem;
  font-style: italic;
  margin: 0 0 0.3rem;
}

.drawn-link {
  background: none;
  border: 1px solid #6f6f6f;
  border-radius: 999px;
  color: #ccc;
  font-size: 0.75rem;
  min-height: 40px;
  padding: 0.3rem 0.7rem;
}

.drawn-link:active {
  opacity: 0.7;
}

.draw-message {
  color: #b9b9b9;
  font-size: 0.78rem;
  margin: 0.5rem 0 0;
}

.draw-message-error {
  color: #ff9f9f;
}
/* Full width inside the stacked card. */
.hat-history {
  border-top: 1px solid #2e2e2e;
  margin-top: 0.6rem;
  padding-top: 0.5rem;
}

.hat-history-title {
  color: #9a9a9a;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}

.hat-history-row {
  align-items: flex-start;
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
  -webkit-overflow-scrolling: touch;
}

/* A <button> now, so it needs the chrome stripped back to what the div had.
   :active only — a tapped element on iOS keeps :hover with no mouse to leave
   it, which has shipped as a visible bug here before (.claude/rules/vue-ui.md).
   The poster is 48x72 and the timestamp sits under it, so the tap target
   clears 40px without any extra padding. */
.hat-history-card {
  background: none;
  border: none;
  flex: 0 0 48px;
  padding: 0;
  text-align: center;
  width: 48px;
}

.hat-history-card:active { opacity: 0.6; }

.hat-history-poster {
  border-radius: 4px;
  display: block;
  height: 72px;
  object-fit: cover;
  width: 48px;
}

.hat-history-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.5rem;
  justify-content: center;
  padding: 0.2rem;
  text-align: center;
}

.hat-history-when { color: #9a9a9a; display: block; font-size: 0.56rem; line-height: 1.2; }
</style>
