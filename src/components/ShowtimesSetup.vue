<template>
  <div class="setup">
    <BackLink/>
    <h1 class="su-title">Your theaters</h1>
    <p class="su-subtitle">
      Cinema Roll watches these boards and tells you when a new film is listed. Put your favorite first:
      a film playing at several of them is only news at the best one.
    </p>

    <SkeletonBlock v-if="loading" :rows="4"/>

    <template v-else>
      <section class="su-panel">
        <h2 class="su-heading">
          Ranked
          <span class="su-count">{{ list.length }}/{{ max }}</span>
        </h2>
        <p v-if="!list.length" class="su-empty">None yet. Find theaters near you below.</p>
        <ol v-else class="su-ranked">
          <li v-for="(theater, i) in list" :key="theater.key" class="su-row">
            <span class="su-rank">{{ i + 1 }}</span>
            <span class="su-name">{{ theater.name }}</span>
            <button type="button" class="su-icon" :disabled="i === 0" :aria-label="`Move ${theater.name} up`" @click="move(i, -1)">
              <i class="bi bi-arrow-up"></i>
            </button>
            <button type="button" class="su-icon" :disabled="i === list.length - 1" :aria-label="`Move ${theater.name} down`" @click="move(i, 1)">
              <i class="bi bi-arrow-down"></i>
            </button>
            <button type="button" class="su-icon" :aria-label="`Remove ${theater.name}`" @click="remove(i)">
              <i class="bi bi-x-lg"></i>
            </button>
          </li>
        </ol>
      </section>

      <section class="su-panel">
        <h2 class="su-heading">Find theaters</h2>
        <form class="su-search" @submit.prevent="search()">
          <input
            v-if="!askCity"
            v-model.trim="zip"
            class="su-input"
            inputmode="numeric"
            autocomplete="postal-code"
            maxlength="5"
            placeholder="Zip code"
            aria-label="Zip code"
          >
          <input
            v-else
            v-model.trim="city"
            class="su-input"
            autocomplete="address-level2"
            placeholder="City, ST"
            aria-label="Nearby city and state"
          >
          <button type="submit" class="su-button" :disabled="searching || !canSearch">
            {{ searching ? 'Looking…' : 'Find' }}
          </button>
        </form>
        <p v-if="searchNote" class="su-note">{{ searchNote }}</p>
        <button v-if="askCity" type="button" class="su-link" @click="askCity = false; searchNote = ''">Use a zip code instead</button>

        <p v-if="place && results.length" class="su-near">Near {{ place }}</p>
        <ul v-if="results.length" class="su-results">
          <li v-for="theater in results" :key="theater.key" class="su-result" :class="{ unreadable: !theater.readable }">
            <div class="su-result-text">
              <span class="su-name">{{ theater.name }}</span>
              <span class="su-meta">{{ metaFor(theater) }}</span>
              <span v-if="!theater.readable" class="su-meta warn">No showtimes online for this one</span>
            </div>
            <button
              v-if="added(theater)"
              type="button"
              class="su-icon on"
              :aria-label="`Remove ${theater.name}`"
              @click="remove(list.findIndex((t) => t.key === theater.key))"
            >
              <i class="bi bi-check-lg"></i>
            </button>
            <button
              v-else
              type="button"
              class="su-icon"
              :disabled="!theater.readable || list.length >= max"
              :aria-label="`Add ${theater.name}`"
              @click="add(theater)"
            >
              <i class="bi bi-plus-lg"></i>
            </button>
          </li>
        </ul>
      </section>

      <div class="su-save">
        <p v-if="saveNote" class="su-note">{{ saveNote }}</p>
        <button type="button" class="su-button wide" :disabled="saving || !dirty" @click="save()">
          {{ saving ? 'Reading their boards…' : 'Save' }}
        </button>
      </div>
    </template>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import SkeletonBlock from './SkeletonBlock.vue';
import { findTheatersNear, refreshTheaterBoard } from '../utils/push.js';

// Matt, 2026-09-30: "We really built it just with me in mind … we should
// figure out how to get this configured so that other people could set it up
// for their own local theaters … give a zip code or something, and then it
// would have to present them with a bunch of theaters, and then they would
// have to rank them." The push Lambda finds theaters (CinemaClock's city
// page, nearest first) and, once the list is saved, builds the board at once.
// The list's order is the pecking order the sweep uses for pushes.

export const MAX_THEATERS = 12;

export default {
  name: 'ShowtimesSetup',
  components: { BackLink, SkeletonBlock },
  data () {
    return {
      loading: true,
      max: MAX_THEATERS,
      list: [],
      saved: '[]',
      zip: '',
      city: '',
      askCity: false,
      place: null,
      results: [],
      searching: false,
      searchNote: '',
      saving: false,
      saveNote: ''
    };
  },
  computed: {
    canSearch () {
      return this.askCity ? /,\s*[a-z]{2}\s*$/i.test(this.city) : /^\d{5}$/.test(this.zip);
    },
    dirty () { return JSON.stringify(this.list) !== this.saved; }
  },
  async mounted () {
    try {
      const [follow] = await Promise.all([
        this.$store.dispatch('loadTheaterFollow'),
        this.$store.state.theaterBoard ? null : this.$store.dispatch('loadTheaterBoard')
      ]);
      if (follow && Array.isArray(follow.theaters)) {
        this.list = follow.theaters.map(({ key, name }) => ({ key, name }));
        this.zip = follow.zip || '';
        this.place = follow.place || null;
      } else if (this.$store.state.databaseTopKey === 'mattgrosso-gmail-com') {
        // Matt has no saved list: the sweep follows its own, which is what
        // his board shows. Start from that so editing it changes nothing
        // until he moves something.
        const board = this.$store.state.theaterBoard;
        this.list = (board?.theaters || []).map(({ key, name }) => ({ key, name }));
      }
      this.saved = JSON.stringify(follow ? this.list : []);
    } catch (error) {
      console.warn('Showtimes setup: could not load', error);
    }
    this.loading = false;
  },
  methods: {
    metaFor (theater) {
      const miles = theater.distance === null || theater.distance === undefined ? '' : `${theater.distance} mi`;
      return [miles, theater.address].filter(Boolean).join(' · ');
    },
    added (theater) { return this.list.some((t) => t.key === theater.key); },
    add (theater) {
      if (this.added(theater) || this.list.length >= this.max || !theater.readable) return;
      this.list.push({ key: theater.key, name: theater.name });
    },
    remove (i) {
      if (i >= 0) this.list.splice(i, 1);
    },
    move (i, by) {
      const j = i + by;
      if (j < 0 || j >= this.list.length) return;
      const next = this.list.slice();
      [next[i], next[j]] = [next[j], next[i]];
      this.list = next;
    },
    async search () {
      if (!this.canSearch || this.searching) return;
      this.searching = true;
      this.searchNote = '';
      try {
        const found = await findTheatersNear(this.askCity ? { city: this.city } : { zip: this.zip });
        if (found.found) {
          this.place = found.place;
          this.results = found.theaters || [];
          if (!this.results.length) this.searchNote = `No theaters listed near ${found.place}.`;
        } else if (found.reason === 'town') {
          // CinemaClock has no page for small towns; a bigger one nearby works.
          this.askCity = true;
          this.results = [];
          this.searchNote = `No theater listings for ${found.place}. Try the nearest bigger city, like "Austin, TX".`;
        } else {
          this.results = [];
          this.searchNote = this.askCity ? 'Couldn\'t find that city. Type it as "City, ST".' : 'Couldn\'t find that zip code.';
        }
      } catch (error) {
        console.warn('Showtimes setup: search failed', error);
        this.searchNote = 'Couldn\'t reach the theater finder. Try again in a moment.';
      }
      this.searching = false;
    },
    async save () {
      if (this.saving) return;
      this.saving = true;
      this.saveNote = '';
      try {
        await this.$store.dispatch('saveTheaterFollow', { zip: this.askCity ? null : this.zip || null, place: this.place, theaters: this.list });
        this.saved = JSON.stringify(this.list);
        try {
          await refreshTheaterBoard();
        } catch (error) {
          // Saved either way; the sweep builds the board within 15 minutes.
          console.warn('Showtimes setup: refresh failed', error);
        }
        await this.$store.dispatch('loadTheaterBoard');
        this.$router.push('/showtimes');
      } catch (error) {
        console.warn('Showtimes setup: save failed', error);
        this.saveNote = 'Couldn\'t save. Try again.';
      }
      this.saving = false;
    }
  }
};
</script>

<style lang="scss" scoped>
.setup {
  color: #eee;
  padding: 0.75rem 1rem 6rem;
}

.su-title { margin: 0.25rem 0 0; }
.su-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 0.9rem; }

.su-panel {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.9rem;
  padding: 0.8rem 0.9rem;
}

.su-heading {
  align-items: center;
  display: flex;
  font-size: 1.02rem;
  font-weight: 700;
  gap: 0.5rem;
  margin: 0 0 0.6rem;
}

.su-count {
  background: #2b2b2b;
  border-radius: 999px;
  color: #bbb;
  font-size: 0.68rem;
  font-weight: 700;
  padding: 0.05rem 0.45rem;
}

.su-empty, .su-near { color: #aaa; font-size: 0.82rem; margin: 0.2rem 0 0.4rem; }
.su-note { color: #ffcd57; font-size: 0.8rem; margin: 0.5rem 0 0; }

.su-ranked, .su-results {
  list-style: none;
  margin: 0;
  padding: 0;
}

.su-row, .su-result {
  align-items: center;
  border-top: 1px solid #262626;
  display: flex;
  gap: 0.4rem;
  min-height: 48px;
  padding: 0.3rem 0;

  &:first-child { border-top: 0; }
}

.su-rank {
  color: #ffc107;
  flex: 0 0 1.4rem;
  font-weight: 700;
  text-align: center;
}

.su-name {
  color: #eee;
  flex: 1 1 auto;
  font-size: 0.92rem;
  min-width: 0;
}

.su-result-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}

.su-meta {
  color: #aaa;
  font-size: 0.74rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  &.warn { color: #d9a441; }
}

.su-result.unreadable .su-name { color: #999; }

.su-icon {
  align-items: center;
  background: #1f1f1f;
  border: 1px solid #333;
  border-radius: 8px;
  color: #ddd;
  display: inline-flex;
  flex: 0 0 40px;
  height: 40px;
  justify-content: center;
  width: 40px;

  &:active { background: #2a2a2a; }
  &:disabled { color: #555; border-color: #262626; }
  &.on { border-color: #ffc107; color: #ffc107; }
}

.su-search {
  display: flex;
  gap: 0.5rem;
}

.su-input {
  background: #0f0f0f;
  border: 1px solid #3a3a3a;
  border-radius: 8px;
  color: #fff;
  flex: 1 1 auto;
  // 16px keeps iOS from zooming the page on focus.
  font-size: 16px;
  min-height: 44px;
  min-width: 0;
  padding: 0.4rem 0.7rem;

  &::placeholder { color: #888; }
  &:focus { border-color: #ffc107; outline: none; }
}

.su-button {
  background: #ffc107;
  border: 0;
  border-radius: 8px;
  color: #111;
  font-weight: 700;
  min-height: 44px;
  padding: 0.4rem 1.1rem;

  &:active { background: #e0a800; }
  &:disabled { background: #3a3a3a; color: #999; }
  &.wide { width: 100%; }
}

.su-link {
  background: none;
  border: 0;
  color: #ffcd57;
  font-size: 0.8rem;
  margin-top: 0.4rem;
  padding: 0.3rem 0;
  text-decoration: underline;
}

.su-near { margin-top: 0.8rem; }

.su-save {
  background: linear-gradient(to top, #212529 70%, rgba(33, 37, 41, 0));
  bottom: 0;
  left: 0;
  padding: 1.2rem 1rem calc(0.8rem + env(safe-area-inset-bottom));
  position: fixed;
  right: 0;
  z-index: 5;
}
</style>
