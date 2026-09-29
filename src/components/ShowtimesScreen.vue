<template>
  <div class="showtimes">
    <BackLink/>
    <h1 class="st-title">Showtimes</h1>
    <p class="st-subtitle">What's on the boards at the theaters you follow.</p>

    <SkeletonBlock v-if="loading" :rows="6"/>

    <template v-else-if="board">
      <div class="st-controls">
        <button type="button" class="st-toggle" :class="{ on: onlyUnique }" @click="onlyUnique = !onlyUnique" :aria-pressed="onlyUnique">
          <i class="bi" :class="onlyUnique ? 'bi-check-square-fill' : 'bi-square'"></i>
          <span>Only films no better theater has</span>
        </button>
        <button v-if="dismissedCount" type="button" class="st-toggle" :class="{ on: showDismissed }" @click="showDismissed = !showDismissed" :aria-pressed="showDismissed">
          <i class="bi" :class="showDismissed ? 'bi-eye-fill' : 'bi-eye-slash'"></i>
          <span>{{ dismissedCount }} dismissed</span>
        </button>
        <span class="st-updated">Checked {{ ago(board.updatedAt) }}</span>
      </div>

      <section v-for="theater in theaters" :key="theater.key" class="st-theater">
        <h2 class="st-theater-name">
          <a v-if="theater.url" :href="theater.url" target="_blank" rel="noopener">{{ theater.name }}</a>
          <span v-else>{{ theater.name }}</span>
          <span class="st-count">{{ theater.shown.length }}</span>
        </h2>
        <p v-if="!theater.ok" class="st-empty">Couldn't read this board last time.</p>
        <p v-else-if="!theater.shown.length" class="st-empty">
          {{ theater.listings.length ? 'Nothing here you haven\'t seen or a better theater lacks.' : 'Nothing listed.' }}
        </p>
        <!-- Posters, not names (Matt: "I like posters more than text"). A
             card is the film's poster with a thin caption; the X and a
             swipe to the left both dismiss it. -->
        <div v-else class="st-grid">
          <div
            v-for="item in theater.shown"
            :key="item.slug"
            class="st-card"
            :class="{ covered: item.coveredBy, dismissed: item.dismissed, leaving: leaving === cardId(theater, item) }"
            :style="cardStyle(theater, item)"
            @touchstart.passive="touchStart($event, theater, item)"
            @touchmove.passive="touchMove($event, theater, item)"
            @touchend="touchEnd(theater, item)"
            @touchcancel="touchEnd(theater, item, true)"
          >
            <a class="st-card-link" :href="item.url || theater.url" target="_blank" rel="noopener" @click="blockIfSwiping($event)">
              <img
                v-if="posterFor(item)"
                :src="posterFor(item)"
                :alt="item.title"
                class="st-poster"
                loading="lazy"
                @error="posterFailed(item)"
              >
              <div v-else class="st-poster st-poster-blank"><span>{{ item.title }}</span></div>
              <div class="st-tags">
                <span v-if="item.imax" class="st-tag">IMAX</span>
                <span v-if="isNew(item)" class="st-tag new">new</span>
              </div>
              <div class="st-caption">
                <span class="st-caption-title">{{ item.title }}</span>
                <span class="st-caption-when">{{ when(item) }}</span>
                <span v-if="item.coveredBy" class="st-caption-also">Also at {{ nameOf(item.coveredBy) }}</span>
              </div>
            </a>
            <button
              type="button"
              class="st-dismiss"
              :aria-label="item.dismissed ? `Bring back ${item.title}` : `Dismiss ${item.title}`"
              @click.stop="toggleDismiss(theater, item)"
            >
              <i class="bi" :class="item.dismissed ? 'bi-arrow-counterclockwise' : 'bi-x-lg'"></i>
            </button>
          </div>
        </div>
      </section>
    </template>

    <p v-else class="st-empty">No board yet. The sweep publishes one every 15 minutes once it has run.</p>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { lookupPoster } from '../utils/posterLookup.js';

// Matt, 2026-09-28: "it would also be great if I could see this somewhere on
// Cinemaroll, besides just the push notification … a page … that would show
// me the list of showtimes coming up." Then: "I'd rather see movie posters
// than names … a way for me to dismiss things off of this screen … swipe it
// off or maybe hit an X." The push sweep publishes the board
// (aws-lambda/push-notify.js, boardForApp); this screen reads it, fills in
// posters the feeds didn't carry (TMDB, cached on the device), and records
// dismissals under theaters/dismissed. Theaters are in pecking order and, by
// default, a film a better theater also has is hidden - the rule the pushes
// follow.

export const SHOWTIMES_SEEN_KEY = 'showtimesSeenAt';
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const SWIPE_DISMISS_PX = 90;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-10-02T15:20:00" (the cinema's own clock) or "2026-10-02" -> a
// label; string arithmetic on purpose so no timezone gets a say.
export function showtimeLabel (stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(stamp || '');
  if (!m) return '';
  const [y, mo, d] = m.slice(1, 4).map(Number);
  const day = `${WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${MONTHS[mo - 1]} ${d}`;
  if (m[4] === undefined) return day;
  const h = Number(m[4]);
  return `${day}, ${h % 12 || 12}:${m[5]} ${h < 12 ? 'AM' : 'PM'}`;
}

export default {
  name: 'ShowtimesScreen',
  components: { BackLink, SkeletonBlock },
  data () {
    let onlyUnique = true;
    try { onlyUnique = localStorage.getItem('showtimesOnlyUnique') !== 'no'; } catch { /* private mode */ }
    return {
      loading: true,
      onlyUnique,
      showDismissed: false,
      now: Date.now(),
      // Posters the feeds didn't carry, looked up by title: { [key]: url|null }.
      lookedUp: {},
      failed: {},
      // Swipe state for the one card under a finger.
      swipe: null,
      leaving: null
    };
  },
  computed: {
    board () { return this.$store.state.theaterBoard; },
    dismissedMap () { return this.$store.state.theaterDismissed || {}; },
    dismissedCount () {
      return Object.values(this.dismissedMap).reduce((n, slugs) => n + Object.keys(slugs || {}).length, 0);
    },
    theaters () {
      const list = Array.isArray(this.board?.theaters) ? this.board.theaters : [];
      return list.map((t) => {
        const listings = (Array.isArray(t.listings) ? t.listings : [])
          .map((l) => ({ ...l, dismissed: Boolean(this.dismissedMap[t.key]?.[l.slug]) }));
        listings.sort((a, b) => (a.firstShowTime || '9999').localeCompare(b.firstShowTime || '9999'));
        const shown = listings.filter((l) => (this.showDismissed || !l.dismissed) && (!this.onlyUnique || !l.coveredBy));
        return { ...t, listings, shown };
      });
    }
  },
  watch: {
    onlyUnique (value) {
      try { localStorage.setItem('showtimesOnlyUnique', value ? 'yes' : 'no'); } catch { /* private mode */ }
    },
    theaters: {
      handler () { this.fillPosters(); },
      immediate: false
    }
  },
  async mounted () {
    try {
      await this.$store.dispatch('loadTheaterBoard');
    } catch (error) {
      console.warn('Showtimes: board unavailable', error);
    }
    this.loading = false;
    // The Insights card's "new" pill is relative to the last visit here.
    try { localStorage.setItem(SHOWTIMES_SEEN_KEY, String(Date.now())); } catch { /* private mode */ }
    this.fillPosters();
  },
  methods: {
    cardId (theater, item) { return `${theater.key}/${item.slug}`; },
    posterKey (item) { return `${item.title}|${item.year || ''}`; },
    posterFor (item) {
      if (item.poster && !this.failed[this.cardKeyFor(item)]) return item.poster;
      return this.lookedUp[this.posterKey(item)] || null;
    },
    cardKeyFor (item) { return `${item.slug}:${item.poster || ''}`; },
    posterFailed (item) {
      // A feed's poster URL that 404s (Veezi's placeholder, an expired CDN
      // link) falls through to the TMDB lookup.
      this.failed = { ...this.failed, [this.cardKeyFor(item)]: true };
      this.fillPosters();
    },
    fillPosters () {
      this.theaters.forEach((theater) => theater.shown.forEach((item) => {
        if (this.posterFor(item)) return;
        const key = this.posterKey(item);
        if (key in this.lookedUp) return;
        this.lookedUp = { ...this.lookedUp, [key]: null };
        lookupPoster(item.title, item.year)
          .then((url) => {
            if (url) this.lookedUp = { ...this.lookedUp, [key]: url };
            return url;
          })
          .catch(() => null);
      }));
    },
    when (item) {
      const label = showtimeLabel(item.firstShowTime);
      if (!label) return 'On the board';
      return `${label.includes(',') ? 'First showing' : 'From'} ${label}`;
    },
    isNew (item) {
      return Number(item.firstSeenAt) > this.now - NEW_FOR_MS;
    },
    nameOf (key) {
      const t = (this.board?.theaters || []).find((x) => x.key === key);
      return t ? t.name.replace(/^the /, '') : 'a better theater';
    },
    ago (at) {
      const mins = Math.round((this.now - Number(at)) / 60000);
      if (!Number.isFinite(mins) || mins < 1) return 'just now';
      if (mins < 60) return `${mins} min ago`;
      const hours = Math.round(mins / 60);
      return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
    },
    toggleDismiss (theater, item) {
      const id = this.cardId(theater, item);
      if (item.dismissed) {
        this.$store.dispatch('dismissListing', { theaterKey: theater.key, slug: item.slug, restore: true }).catch(() => {});
        return;
      }
      // Let the card slide away before it leaves the grid.
      this.leaving = id;
      setTimeout(() => {
        this.leaving = null;
        this.$store.dispatch('dismissListing', { theaterKey: theater.key, slug: item.slug }).catch(() => {});
      }, 180);
    },
    // Swipe left to dismiss. Horizontal intent is decided once (a mostly
    // vertical move is a scroll and the card stays put); a release past the
    // threshold dismisses, short of it snaps back.
    touchStart (event, theater, item) {
      if (item.dismissed || event.touches.length !== 1) return;
      const t = event.touches[0];
      this.swipe = { id: this.cardId(theater, item), x: t.clientX, y: t.clientY, dx: 0, horizontal: null, fired: false };
    },
    touchMove (event, theater, item) {
      const s = this.swipe;
      if (!s || s.id !== this.cardId(theater, item)) return;
      const t = event.touches[0];
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (s.horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) s.horizontal = Math.abs(dx) > Math.abs(dy);
      if (!s.horizontal) return;
      this.swipe = { ...s, dx: Math.min(0, dx) };
    },
    touchEnd (theater, item, cancelled = false) {
      const s = this.swipe;
      if (!s || s.id !== this.cardId(theater, item)) return;
      this.swipe = null;
      if (cancelled || !s.horizontal) return;
      if (-s.dx >= SWIPE_DISMISS_PX) {
        this.justSwiped = Date.now();
        this.toggleDismiss(theater, item);
      }
    },
    blockIfSwiping (event) {
      // The tap that ends a swipe must not also open the ticket page.
      if (Date.now() - (this.justSwiped || 0) < 400) event.preventDefault();
    },
    cardStyle (theater, item) {
      const s = this.swipe;
      if (s && s.id === this.cardId(theater, item) && s.horizontal) {
        return { transform: `translateX(${s.dx}px)`, opacity: String(Math.max(0.25, 1 + s.dx / 220)), transition: 'none' };
      }
      return null;
    }
  }
};
</script>

<style lang="scss" scoped>
.showtimes {
  color: #eee;
  padding: 0.75rem 1rem 2rem;
}

.st-title { margin: 0.25rem 0 0; }
.st-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 0.9rem; }

.st-controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  margin-bottom: 0.9rem;
}

.st-toggle {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  color: #ccc;
  display: inline-flex;
  font-size: 0.78rem;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;

  i { color: #777; }
  &.on { color: #fff; border-color: #ffc107; }
  &.on i { color: #ffc107; }
}

.st-updated { color: #888; font-size: 0.72rem; margin-left: auto; }

.st-theater {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.9rem;
  padding: 0.8rem 0.9rem;
}

.st-theater-name {
  align-items: center;
  display: flex;
  font-size: 1.02rem;
  font-weight: 700;
  gap: 0.5rem;
  margin: 0 0 0.5rem;

  a { color: inherit; text-decoration: none; }
}

.st-count {
  background: #2b2b2b;
  border-radius: 999px;
  color: #bbb;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.05rem 0.45rem;
}

.st-empty { color: #999; font-size: 0.82rem; margin: 0.2rem 0 0; }

/* Three posters across on a phone, more as the screen allows. */
.st-grid {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
}

.st-card {
  background: #0f0f0f;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  transition: transform 0.18s ease, opacity 0.18s ease;
  touch-action: pan-y;

  &.covered { opacity: 0.55; }
  &.dismissed { opacity: 0.4; }
  &.leaving { transform: translateX(-120%); opacity: 0; }
}

.st-card-link {
  color: inherit;
  display: block;
  text-decoration: none;
}

.st-poster {
  aspect-ratio: 2 / 3;
  background: #1c1c1c;
  display: block;
  object-fit: cover;
  width: 100%;
}

.st-poster-blank {
  align-items: center;
  color: #ddd;
  display: flex;
  font-size: 0.78rem;
  font-weight: 600;
  justify-content: center;
  padding: 0.5rem;
  text-align: center;
}

.st-tags {
  display: flex;
  gap: 0.25rem;
  left: 0.3rem;
  position: absolute;
  top: 0.3rem;
}

.st-tag {
  background: rgba(0, 0, 0, 0.75);
  border-radius: 3px;
  color: #eee;
  font-size: 0.58rem;
  font-weight: 700;
  padding: 0.1rem 0.3rem;
  text-transform: uppercase;

  &.new { background: #ffc107; color: #000; }
}

.st-caption {
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.9) 45%);
  bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  left: 0;
  padding: 1.1rem 0.4rem 0.35rem;
  position: absolute;
  right: 0;
}

.st-caption-title {
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.st-caption-when { color: #ccc; font-size: 0.62rem; }
.st-caption-also { color: #ffc107; font-size: 0.6rem; }

.st-dismiss {
  align-items: center;
  background: rgba(0, 0, 0, 0.7);
  border: 0;
  border-radius: 999px;
  color: #fff;
  display: flex;
  font-size: 0.75rem;
  height: 28px;
  justify-content: center;
  position: absolute;
  right: 0.25rem;
  top: 0.25rem;
  width: 28px;
}
</style>
