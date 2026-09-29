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
          {{ theater.listings.length ? 'Everything here is also at a better theater.' : 'Nothing listed.' }}
        </p>
        <ul v-else class="st-list">
          <li v-for="item in theater.shown" :key="item.slug" class="st-item" :class="{ covered: item.coveredBy }">
            <a class="st-item-main" :href="item.url || theater.url" target="_blank" rel="noopener">
              <span class="st-item-title">
                {{ item.title }}
                <span v-if="item.imax" class="st-tag">IMAX</span>
                <span v-if="isNew(item)" class="st-tag new">new</span>
              </span>
              <span class="st-item-when">{{ when(item) }}</span>
              <span v-if="item.coveredBy" class="st-item-also">Also at {{ nameOf(item.coveredBy) }}</span>
            </a>
          </li>
        </ul>
      </section>
    </template>

    <p v-else class="st-empty">No board yet. The sweep publishes one every 15 minutes once it has run.</p>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';

// Matt, 2026-09-28: "it would also be great if I could see this somewhere on
// Cinemaroll, besides just the push notification … a page … that would show
// me the list of showtimes coming up." The push sweep publishes the board
// (aws-lambda/push-notify.js, boardForApp); this screen only reads it.
// Theaters are in pecking order and, by default, a film a better theater
// also has is hidden - the same rule the pushes follow.

export const SHOWTIMES_SEEN_KEY = 'showtimesSeenAt';
const NEW_FOR_MS = 7 * 24 * 60 * 60 * 1000;
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
    return { loading: true, onlyUnique, now: Date.now() };
  },
  computed: {
    board () { return this.$store.state.theaterBoard; },
    theaters () {
      const list = Array.isArray(this.board?.theaters) ? this.board.theaters : [];
      return list.map((t) => {
        const listings = Array.isArray(t.listings) ? t.listings.slice() : [];
        listings.sort((a, b) => (a.firstShowTime || '9999').localeCompare(b.firstShowTime || '9999'));
        const shown = this.onlyUnique ? listings.filter((l) => !l.coveredBy) : listings;
        return { ...t, listings, shown };
      });
    }
  },
  watch: {
    onlyUnique (value) {
      try { localStorage.setItem('showtimesOnlyUnique', value ? 'yes' : 'no'); } catch { /* private mode */ }
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
  },
  methods: {
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
  justify-content: space-between;
  margin-bottom: 0.9rem;
}

.st-toggle {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 999px;
  color: #ccc;
  display: inline-flex;
  font-size: 0.8rem;
  gap: 0.4rem;
  padding: 0.35rem 0.7rem;

  i { color: #777; }
  &.on { color: #fff; border-color: #ffc107; }
  &.on i { color: #ffc107; }
}

.st-updated { color: #888; font-size: 0.72rem; }

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
  margin: 0 0 0.35rem;

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

.st-list { list-style: none; margin: 0; padding: 0; }

.st-item {
  border-top: 1px solid #262626;
  &:first-child { border-top: 0; }
  &.covered { opacity: 0.6; }
}

.st-item-main {
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding: 0.5rem 0;
  text-decoration: none;
}

.st-item-title { font-size: 0.95rem; font-weight: 600; }
.st-item-when { color: #ccc; font-size: 0.78rem; }
.st-item-also { color: #ffc107; font-size: 0.72rem; }

.st-tag {
  background: #2b2b2b;
  border-radius: 3px;
  color: #ddd;
  font-size: 0.6rem;
  font-weight: 700;
  margin-left: 0.3rem;
  padding: 0.05rem 0.3rem;
  text-transform: uppercase;
  vertical-align: middle;

  &.new { background: rgba(255, 193, 7, 0.16); color: #ffc107; }
}
</style>
