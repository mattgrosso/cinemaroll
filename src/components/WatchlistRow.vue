<template>
  <div class="watchlist-row-wrapper" :class="{ 'watchlist-row-large': large }">
    <div class="watchlist-row">
      <div
        v-for="item in items"
        :key="item.key"
        class="watchlist-card"
        :class="{ 'watchlist-card-seen': item.seen }"
        role="button"
        :aria-label="item.seen ? `${item.title} — already rated` : item.title"
        @click="$emit('select', item.source)"
      >
        <!-- The frame is what the RATED flag anchors to. Without it the flag
             positions against the CARD, whose bottom is below the caption, and
             it lands on the meta text instead of on the artwork.

             NOTE the v-if/v-else pair below must stay ADJACENT. Putting
             anything between them re-binds the v-else to that element, which
             is exactly how the blank-artwork branch started rendering under
             every poster — title and all, against the posters-not-text rule
             (2026-09-01: "The layout is broken. You also seem to have the
             title there"). -->
        <div class="watchlist-poster-frame">
          <img
            v-if="item.poster"
            :src="item.poster"
            :alt="item.title"
            class="watchlist-poster"
            loading="lazy"
          >
          <!-- No artwork is the ONE case where the title has to carry it. -->
          <div v-else class="watchlist-poster watchlist-poster-blank">{{ item.title }}</div>

          <!-- Bug report (2026-09-01), against the filmography row that had
               just shipped: "should filter out movies that I've already seen
               or at least should mark them... maybe gray them out or put a
               message that says already rated." Greying, not filtering — his
               own call, and the right one for a filmography, where the ones
               you've seen are half of what the list is telling you. The score
               in the meta line was already there and wasn't loud enough. -->
          <span v-if="item.seen" class="watchlist-seen-flag">Rated</span>
        </div>

        <!-- Hat button alone, pinned top-right, matching every other poster
             in the app (bug report: "It should always be in the top right
             corner no matter where that is in the app"). It used to share
             this strip with the punt X under justify-content: space-between,
             which meant the hat sat LEFT when the X was present and RIGHT
             when it wasn't — "it's awkward that the X button is sometimes on
             the right and sometimes on the left and sometimes it's a hat
             button sometimes it's an X button". -->
        <div class="watchlist-card-actions">
          <SendToHat variant="icon" :movies="item.source" :note="hatNote" @added="onAdded"/>
        </div>

        <!-- Kept because a poster can't tell you your own score or how long
             it's been. The TITLE is what the poster already says.

             The punt X now lives here rather than over the artwork: "let's
             move that down lower make it very small, but make it part of the
             text below the poster where we have like a rating and a year".
             Visibly tiny, but the tap target keeps the house 40px minimum —
             the same split the buttons over the poster already used. -->
        <span v-if="metaLines(item).length || puntable" class="watchlist-meta">
          <!-- Deliberate lines, not a wrap. Bug report: "since now it always
               stacks the two lines no matter how wide the content might be
               let's have the X on the right and then have two lines of text
               separated by a hard return". -->
          <span v-if="metaLines(item).length" class="watchlist-meta-text">
            <span v-for="(line, index) in metaLines(item)" :key="index" class="watchlist-meta-line">{{ line }}</span>
          </span>
          <button
            v-if="puntable"
            type="button"
            class="punt-btn"
            :title="puntLabel"
            :aria-label="puntLabel"
            @click.stop="$emit('punt', item.source)"
          >
            <i class="bi bi-x"></i>
          </button>
        </span>
      </div>
    </div>
    <!-- There was a bulk "add the whole list to a hat" button under every row
         here. Removed 2026-08-20: "The button we have for adding a whole
         watchlist to a hat it takes up more room than it actually has value.
         Let's just get rid of it then we can tighten up those layouts a
         little bit." The per-poster hat button is the everyday action and is
         the only one now. -->
  </div>
</template>

<script>
// One presentation for every list on the watchlist (Matt, 2026-08-16):
//
//   "All over this page you've ignored my rule that posters are better than
//    text. You've got a bunch of movie posters with the titles written out
//    right below them."
//
//   "I like the idea of the 'get X year to 10' sections but they are too
//    large. They should be sideways scrolling lists."
//
//   "Every poster on a watchlist should have a button to easily add it to a
//    hat. But don't make the buttons ugly."
//
//   "The 'add all' buttons should be less prominent (maybe at the bottom of
//    the list)."
//
// So: one sideways-scrolling row of posters, no titles under them, a small
// hat button on each poster, and the bulk action demoted to below the row.
// Note this is NOT MediaResultGrid — that one is still right where it is
// used, choosing between similar search results, where the title is the
// only thing telling two candidates apart.
import SendToHat from './SendToHat.vue';

export default {
  name: 'WatchlistRow',
  components: { SendToHat },
  props: {
    // [{ key, title, poster, metaLines, source, seen? }] — `source` is handed
    // back on select and passed to the hat; metaLines is an array of caption
    // lines, each rendered on its own row beside the punt X. `seen` dims the
    // card and flags it as already rated; only the filmography row sets it,
    // every other list here being unseen-only by construction.
    items: { type: Array, required: true },
    puntable: { type: Boolean, default: false },
    // What the X means on this row: a snooze on the rewatch rows, "not
    // interested" on the suggestion rows (2026-10-08).
    puntLabel: { type: String, default: 'Not yet — back in a couple of months' },
    // Plain-language provenance for the hat: "use plain language to label why
    // that movie went into the hat" (2026-08-17). Every list on this screen
    // supplies its own, so a draw can say it came from the rewatch pile or
    // from a director you love.
    hatNote: { type: String, default: null },
    // Bigger posters, for a row that has a tab to itself (the Watchlist's
    // Club tab, 2026-10-08 — the same 156px as Film Club's Activity strip).
    large: { type: Boolean, default: false }
  },
  emits: ['select', 'punt', 'hatted'],
  methods: {
    metaLines (item) {
      return (item?.metaLines || []).filter(Boolean);
    },
    // Hand back the ORIGINAL sources, not the hat payloads: the screen punts
    // by dbKey where it has one, and toHatMovie has already thrown that away.
    onAdded (added, sources) {
      const addedIds = new Set(added.map((movie) => movie.id));
      this.$emit('hatted', (sources || []).filter((source) => {
        const id = source?.movie?.id ?? source?.id;
        return addedIds.has(id);
      }));
    }
  }
};
</script>

<style lang="scss" scoped>
.watchlist-row {
  display: flex;
  gap: 0.5rem;
  /* Sideways rather than a wall: a section is one row tall however many
     movies are in it. */
  overflow-x: auto;
  padding-bottom: 0.25rem;
  -webkit-overflow-scrolling: touch;
}

.watchlist-card {
  flex: 0 0 auto;
  position: relative;
  width: 104px;
}

.watchlist-poster {
  border-radius: 4px;
  display: block;
  /* Fixed height with the poster's own aspect ratio, so every image in the
     row lines up top AND bottom regardless of what TMDB returns. */
  height: 156px;
  object-fit: cover;
  width: 104px;
}

/* Wraps the artwork so the RATED flag has something poster-shaped to sit in.
   Fixed height, matching the poster: the card is taller than this (the caption
   runs below it), and a flag anchored to the card would land on the text. */
.watchlist-poster-frame {
  height: 156px;
  position: relative;
  width: 104px;
}

/* Already rated. Dimmed and desaturated so a scan down the row separates
   "seen it" from "haven't" without reading a word — but still tappable, still
   hattable (a rewatch is a real reason to hat something), and NOT removed:
   in a filmography the ones you've seen are half of what the list is saying.

   The dimming is on the poster alone. Dimming the whole card would take the
   caption and the hat button with it, and the caption is where the score is. */
.watchlist-card-seen .watchlist-poster {
  filter: grayscale(0.85);
  opacity: 0.45;
}

/* A word, for the case where dimming alone isn't obvious — a dark poster is
   already dim. Bottom-left, clear of the hat button's top-right corner. */
.watchlist-seen-flag {
  background: rgba(0, 0, 0, 0.78);
  border-radius: 3px;
  bottom: 4px;
  color: #e8e8e8;
  font-size: 0.6rem;
  font-weight: 600;
  left: 4px;
  letter-spacing: 0.03em;
  line-height: 1;
  padding: 2px 5px;
  position: absolute;
  text-transform: uppercase;
}

.watchlist-poster-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.7rem;
  justify-content: center;
  line-height: 1.2;
  padding: 0.3rem;
  text-align: center;
}

/* Flush into the top-right corner, the same as every other hat button in
   the app. No inset: the control is a corner ribbon now, so it has to meet
   both edges to read as one. */
.watchlist-card-actions {
  display: flex;
  position: absolute;
  right: 0;
  top: 0;
}

/* In the meta line now, not over the artwork. Same "small to look at, big to
   tap" split the poster buttons use: a 40px target (the house minimum — see
   .claude/rules/vue-ui.md) around a glyph small enough to read as part of the
   caption.

   The horizontal margin pulls the target into the card's own gutter, but
   there is deliberately NO vertical one. A first attempt centred the 40px box
   on the caption with -12px top and bottom, which measured live on the
   deployed page as the target overlapping the poster's bottom 8px — an
   invisible control sitting on the artwork, which is the BackLink edge-strip
   bug (an unseen overlay eating real taps) rebuilt by hand. The card simply
   gets taller instead, which is the house rule for text under a poster. */
.punt-btn {
  align-items: center;
  background: none;
  border: none;
  color: #8a8a8a;
  display: flex;
  flex: 0 0 auto;
  height: 40px;
  justify-content: center;
  margin-right: -10px;
  padding: 0;
  width: 40px;
}

.punt-btn i {
  font-size: 0.8rem;
  line-height: 1;
}

/* Mobile-first: press feedback only, never a hover state that sticks. */
.punt-btn:active {
  color: #fff;
}

.watchlist-meta {
  /* Centred against the caption block rather than pinned to its first line,
     so the X sits level with two lines of text instead of riding high. */
  align-items: center;
  /* #b9b9b9 on the page background is ~8:1. */
  color: #b9b9b9;
  display: flex;
  font-size: 0.68rem;
  gap: 0.2rem;
  justify-content: space-between;
  line-height: 1.25;
  margin-top: 0.25rem;
}

/* Never clamped — a long line still wraps and the card gets taller (Matt's
   poster-row rule). min-width: 0 so it can actually wrap instead of forcing
   the flex row wider than the card. */
.watchlist-meta-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.watchlist-meta-line {
  display: block;
}

/* Same shape, 1.5x: every image in the row still lines up top and bottom. */
.watchlist-row-large {
  .watchlist-card,
  .watchlist-poster-frame,
  .watchlist-poster { width: 156px; }

  .watchlist-poster-frame,
  .watchlist-poster { height: 234px; }

  .watchlist-meta { font-size: 0.78rem; }
}
</style>
