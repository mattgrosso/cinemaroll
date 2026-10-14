<template>
  <div v-if="hats.length && !everythingAlreadyInAHat" class="send-to-hat" :class="`send-to-hat-${variant}`">
    <!-- On a poster the control is an icon in the corner; under a list it is
         a labelled button. Same behaviour either way. -->
    <button
      type="button"
      :class="variant === 'icon' ? 'hat-icon-button' : 'hat-button'"
      :disabled="sending"
      :title="buttonLabel"
      :aria-label="buttonLabel"
      @click.stop="activate"
    >
      <span v-if="sending" class="spinner-border spinner-border-sm" role="status"></span>
      <template v-else>
        <!-- A top hat, rather than Bootstrap's magic wand: "I'd much rather
             be hat related" (2026-08-17). Drawn here because bootstrap-icons
             has no hat at all. -->
        <svg class="hat-glyph" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <!-- No plus any more: "let's get rid of the + and then give another
               really careful try on that hat icon. Let's make it cuter and
               more like a hat" (2026-08-17). Losing the plus is what makes
               this possible — the crown had to be OUTLINED before so a
               same-coloured plus wouldn't be swallowed inside it, and an
               outline is exactly what stopped it reading as a hat at 15px.
               Solid shapes, a flared crown (what makes a top hat a TOP hat),
               a clear band gap, and a slight tilt for a bit of life. -->
          <g transform="rotate(-8 12 12)">
            <path class="hat-crown" d="M6.6 4.1a1.3 1.3 0 0 1 1.3-1.3h8.2a1.3 1.3 0 0 1 1.3 1.3l-.55 9.4H7.15Z"/>
            <ellipse class="hat-brim" cx="12" cy="16.6" rx="9.8" ry="2.5"/>
          </g>
        </svg>
        <span v-if="variant !== 'icon'">{{ buttonLabel }}</span>
      </template>
    </button>

    <!-- One hat: no picker needed. More than one: choose.
         Teleported to <body> as a sheet rather than dropped in place. The
         icon variant sits on a poster inside a horizontal `overflow-x: auto`
         row, so an absolutely-positioned dropdown was clipped by the scroller
         and dragged its layout sideways — "it is stuck inside of that
         scrolling container so it just kind of breaks the scroll layout...
         maybe there must be another way to show all my hats without making it
         feel cramped and inaccessible" (2026-08-17). A sheet escapes every
         overflow and clipping context there will ever be, and gives each hat
         a full-width row instead of a cramped chip. -->
    <Teleport to="body">
      <div v-if="open && !sending" class="hat-sheet-backdrop" @click.stop="open = false">
        <div class="hat-sheet" @click.stop>
          <p class="hat-sheet-title">Add to which hat?</p>
          <button
            v-for="hat in hats"
            :key="hat.title"
            type="button"
            class="hat-sheet-choice"
            @click="send(hat)"
          >
            <span>{{ hat.title }}</span>
            <i class="bi bi-chevron-right"></i>
          </button>
          <button type="button" class="hat-sheet-cancel" @click="open = false">Cancel</button>
        </div>
      </div>
    </Teleport>

    <!-- Same clipping problem, same answer. -->
    <Teleport to="body">
      <p v-if="result" class="hat-toast" :class="{ 'hat-toast-error': result.error }">{{ result.message }}</p>
    </Teleport>
  </div>
</template>

<script>
// "Send to hat" for one movie or a whole list — Matt, 2026-08-16: "fill a
// hat from a list is kind of the same as send to a hat. It just iterates
// through the list."
//
// Cinema Roll originally did NOT track what's in a hat — "we don't really
// need to keep track of that... if you try to add something to a hat, it
// should just notify you back that it's already in there" (2026-08-16).
// That changed on 2026-08-17: "it would be nice if the hat icon button only
// appeared on movies that aren't already in one of my hats", which can only
// be known before the tap. So the store now keeps a cached set of the ids
// waiting in linked hats (ensureMovieHatContents) and this button hides
// itself for them. The send-time check stays exactly as it was — it is
// still the authority, and still reports "already in there" if the cache
// was stale or a hat could not be read.
import ErrorLogService from '../services/ErrorLogService.js';
import { trackEvent } from '../utils/usage.js';

export default {
  name: 'SendToHat',
  props: {
    // A Cinema Roll library entry, a TMDB movie, or a list of either.
    movies: { type: [Array, Object], required: true },
    label: { type: String, default: null },
    variant: { type: String, default: 'button' },
    // Plain-language provenance written onto the hat movie, so a draw can
    // say where it came from ("Worth a rewatch", "Natalie watched this").
    // Movie Hat renders it on the drawn-movie screen.
    note: { type: String, default: null }
  },
  emits: ['added'],
  data () {
    return {
      open: false,
      sending: false,
      result: null,
      resultTimer: null
    };
  },
  computed: {
    hats () {
      // Guarded: a screen mounted without this getter (older tests, a
      // partial store) must not take the whole section down with it.
      return this.$store.getters.linkedMovieHats || [];
    },
    list () {
      return Array.isArray(this.movies) ? this.movies : [this.movies];
    },
    // A Cinema Roll entry wraps its TMDB movie; a raw TMDB result is the
    // movie. Both shapes arrive here.
    tmdbIds () {
      return this.list
        .map((item) => item?.movie?.id ?? item?.id)
        .filter((id) => id != null);
    },
    // Hidden once every movie it offers is already waiting in a hat. For a
    // whole-list button that means the list is fully accounted for; if even
    // one is missing there is still something to send.
    everythingAlreadyInAHat () {
      // Same guard as `hats` above: a screen mounted with a partial store
      // must not take the button down with it.
      const inHats = this.$store?.state?.movieHatMovieIds || {};
      if (!this.tmdbIds.length) return false;
      return this.tmdbIds.every((id) => inHats[id]);
    },
    buttonLabel () {
      if (this.label) return this.label;
      return this.list.length > 1 ? `Add ${this.list.length} to a hat` : 'Add to hat';
    }
  },
  mounted () {
    // Fills the "already in a hat" set the first time any of these buttons
    // renders. Cached in the store, so a screen full of them costs one
    // round trip per hat, not one per button.
    // Deliberately not awaited — but a promise nobody awaits still needs a
    // rejection handler, or a failed lookup surfaces as an unhandled
    // rejection (in the browser, and loudly enough in Vitest to fail the
    // whole run with an "Unhandled Rejection" while every test passes).
    // Nothing to do on failure: the set stays empty and the buttons simply
    // don't know what's already hatted.
    if (this.hats.length) this.$store?.dispatch?.('ensureMovieHatContents')?.catch?.(() => {});
  },
  beforeUnmount () {
    if (this.resultTimer) clearTimeout(this.resultTimer);
  },
  methods: {
    // One linked hat means there is nothing to choose — go straight in.
    activate () {
      if (this.hats.length === 1) {
        this.send(this.hats[0]);
        return;
      }
      this.open = !this.open;
    },
    async send (hat) {
      this.open = false;
      this.sending = true;
      this.result = null;

      try {
        const { added, skipped } = await this.$store.dispatch('addToMovieHat', {
          title: hat.title,
          dbKey: hat.dbKey,
          entries: this.list,
          note: this.note
        });
        this.report({ message: this.summarize(added, skipped, hat.title) });
        if (added?.length) trackEvent('hat-send');
        // Everything the hat now holds — freshly added, or skipped because
        // it was already there — so the button disappears straight away
        // rather than waiting for the cache to age out.
        this.$store?.commit?.('noteMoviesInHat', [...(added || []), ...(skipped || [])]
          .map((item) => item?.movie?.id ?? item?.id));
        // Lists use this to take a movie off themselves: "when I add a movie
        // to a hat from my watchlist, it should be removed from the watchlist
        // because I have essentially decided OK, I will watch that"
        // (2026-08-17). Only what was genuinely added — a skip means it was
        // already in the hat and the list already knew about it.
        if (added.length) this.$emit('added', added, this.list);
      } catch (error) {
        ErrorLogService.error('Adding to a movie hat failed', error);
        this.report({ message: `Couldn't reach ${hat.title}.`, error: true });
      } finally {
        this.sending = false;
      }
    },
    // Says what actually happened, including the already-in-there case.
    summarize (added, skipped, hatTitle) {
      const movies = (count) => `${count} ${count === 1 ? 'movie' : 'movies'}`;

      if (!added.length && skipped.length) {
        return skipped.length === 1
          ? `${skipped[0].title} is already in ${hatTitle}.`
          : `All ${movies(skipped.length)} were already in ${hatTitle}.`;
      }
      if (added.length && skipped.length) {
        return `Added ${movies(added.length)} to ${hatTitle}; ${skipped.length} already there.`;
      }
      if (added.length === 1) {
        // "is in X" read as a status rather than as something that just
        // happened, and sat too close to "is already in X" (2026-08-17).
        return `${added[0].title} was added to ${hatTitle}.`;
      }
      return added.length
        ? `Added ${movies(added.length)} to ${hatTitle}.`
        : `Nothing to add to ${hatTitle}.`;
    },
    report (result) {
      this.result = result;
      if (this.resultTimer) clearTimeout(this.resultTimer);
      this.resultTimer = setTimeout(() => { this.result = null; }, 6000);
    }
  }
};
</script>

<style lang="scss" scoped>
/* No `position` here, deliberately.
 *
 * This root is placed by whoever renders it, and two callers pin it to a
 * poster's corner (`.cs-poster-hat`, `.cc-poster-hat`, both `position:
 * absolute`). Those are parent-scoped rules on this component's root, so they
 * carry exactly the same specificity as a rule here — and this component's CSS
 * is emitted once per chunk that imports it, which put two later copies of a
 * `position: relative` here after both of them. Last one wins, so the hat
 * dropped into normal flow and rendered below the poster instead of on it
 * (bug report, 2026-08-21).
 *
 * Nothing inside needs a containing block from this element: the wedge is
 * `.hat-icon-button::before`, contained by `.hat-icon-button`'s own
 * `position: relative`, and both sheets are teleported to <body> and fixed.
 * Don't set layout properties on this root — set them on the button. */

.hat-button {
  align-items: center;
  background: #33383d;
  border: 1px solid #555c63;
  border-radius: 8px;
  color: #eee;
  display: flex;
  font-size: 0.78rem;
  gap: 0.4rem;
  /* House minimum for a tap target. */
  min-height: 40px;
  padding: 0.3rem 0.7rem;
}

/* Mobile-first: press feedback is :active only. */
.hat-button:active {
  background: #23272b;
}

/* Sitting on a poster: dark enough to read against any artwork, small
   enough not to be the point, and still a 40px target. */
/* A corner ribbon rather than a floating disc.
 *
 * Bug report, 2026-08-19: "it feels like it's too low and too close to the
 * center like on some of these small posters it's position covers a lot of
 * the poster, including the title sometimes I wonder if there isn't a better
 * way to position that so that it's always hard in the top right corner maybe
 * it's not a circle maybe it's like a diagonal ribbon that takes up that top
 * right corner and has a little hat in it."
 *
 * A 26px disc inset 4px from the corner had its centre ~17px into the poster,
 * which on a small one is most of the way to the middle. A right triangle
 * hugging the corner keeps the same 44px tap area while its mass sits in the
 * corner the artwork can most afford to lose, and the diagonal edge falls
 * AWAY from the centre — so the deeper into the poster you go, the less of it
 * the control covers. Titles, which sit centred or low, stay clear.
 */
.hat-icon-button {
  align-items: flex-start;
  background: none;
  border: none;
  color: #fff;
  display: flex;
  /* Still comfortably past the 40px house minimum. */
  height: 44px;
  justify-content: flex-end;
  padding: 0;
  position: relative;
  width: 44px;
}

/* The wedge itself, behind the glyph. */
.hat-icon-button::before {
  background: rgba(0, 0, 0, 0.62);
  clip-path: polygon(100% 0, 0 0, 100% 100%);
  content: '';
  inset: 0;
  position: absolute;
}

.hat-icon-button:active::before {
  background: rgba(0, 0, 0, 0.88);
}

/* Sits in the thick of the wedge, near the corner — not centred in the
   button's box, which would put it out on the thin diagonal edge. */
.hat-icon-button .hat-glyph {
  height: 15px;
  margin: 4px 4px 0 0;
  position: relative;
  width: 15px;
}


/* The sheet is teleported to <body>, so it is styled unscoped. */
.hat-glyph { height: 15px; width: 15px; }
/* Both solid: with no plus to keep visible, a filled silhouette is what
   actually reads as a hat at this size. */
.hat-glyph .hat-brim,
.hat-glyph .hat-crown { fill: currentColor; }

.hat-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.4rem;
}

.hat-choice {
  background: none;
  border: 1px solid #6f6f6f;
  border-radius: 999px;
  /* #ccc on this background is ~9:1; Bootstrap's muted grey would not be. */
  color: #ccc;
  font-size: 0.75rem;
  min-height: 40px;
  padding: 0.3rem 0.7rem;
}

.hat-choice:active {
  opacity: 0.7;
}

.hat-result {
  color: #b9b9b9;
  font-size: 0.75rem;
  line-height: 1.3;
  margin: 0.4rem 0 0;
}

.hat-result-error {
  color: #ff9f9f;
}
</style>

<!-- Unscoped: the sheet is teleported to <body>, outside this component's
     scope attribute. -->
<style lang="scss">
.hat-sheet-backdrop {
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.6);
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 2000;
}

.hat-sheet {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 14px 14px 0 0;
  max-height: 70vh;
  max-width: 520px;
  overflow-y: auto;
  padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom));
  width: 100%;
}

.hat-sheet-title {
  color: #b9b9b9;
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  margin: 0 0 0.6rem;
  text-transform: uppercase;
}

.hat-sheet-choice {
  align-items: center;
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  color: #eee;
  display: flex;
  justify-content: space-between;
  /* 40px minimum touch target. */
  min-height: 48px;
  margin-bottom: 0.4rem;
  padding: 0.6rem 0.85rem;
  text-align: left;
  width: 100%;
}

.hat-sheet-choice:active { background: #1d1d1d; }

.hat-sheet-cancel {
  background: none;
  border: none;
  color: #b9b9b9;
  min-height: 44px;
  width: 100%;
}

.hat-toast {
  background: #1b1b1b;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  bottom: calc(1rem + env(safe-area-inset-bottom));
  color: #eee;
  font-size: 0.8rem;
  left: 50%;
  margin: 0;
  max-width: 90vw;
  padding: 0.55rem 0.9rem;
  position: fixed;
  transform: translateX(-50%);
  z-index: 2001;
}

.hat-toast-error { border-color: #a5474a; color: #ffb3b3; }
</style>
