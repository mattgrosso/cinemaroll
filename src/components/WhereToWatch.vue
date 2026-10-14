<template>
  <!-- Teleported for the same reason SendToHat's picker is: these open from a
       poster inside a horizontal scroller, and a sheet parented there is
       clipped by it and drags its layout sideways. -->
  <Teleport to="body">
    <div v-if="movie" class="wtw-backdrop" @click.self="$emit('close')">
      <div class="wtw-sheet">
        <div class="wtw-head">
          <p class="wtw-title">{{ movie.title }}</p>
          <button type="button" class="wtw-close" aria-label="Close" @click="$emit('close')">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <p v-if="loading" class="wtw-status">
          <span class="spinner-border spinner-border-sm" role="status"></span>
          Looking&hellip;
        </p>

        <p v-else-if="error" class="wtw-status">Couldn't check where this is streaming.</p>

        <p v-else-if="!groups.length" class="wtw-status">
          Not streaming, renting or selling anywhere right now.
        </p>

        <template v-else>
          <div v-for="group in groups" :key="group.key" class="wtw-group">
            <p class="wtw-group-label">{{ group.label }}</p>
            <!-- Icons only (bug report: "way too big and spread out. Just the
                 icons would be fine in the various categories"). The name
                 still reaches anyone who needs it via alt/title — a logo is
                 recognisable, a screen reader's user is not looking at it. -->
            <div class="wtw-providers">
              <template v-for="provider in group.providers" :key="provider.id">
                <img
                  v-if="provider.logo"
                  :src="provider.logo"
                  :alt="provider.name"
                  :title="provider.name"
                  class="wtw-logo"
                  loading="lazy"
                >
                <!-- A provider with no artwork still has to be visible, so it
                     falls back to its initial rather than disappearing. -->
                <span v-else class="wtw-logo wtw-logo-blank" :title="provider.name">
                  {{ provider.name ? provider.name.slice(0, 1) : '?' }}
                </span>
              </template>
            </div>
          </div>

          <a v-if="link" :href="link" target="_blank" rel="noopener" class="wtw-link">
            Open on TMDB <i class="bi bi-box-arrow-up-right"></i>
          </a>
        </template>

        <!-- TMDB sources this from JustWatch and requires the credit wherever
             it is displayed. -->
        <p class="wtw-credit">Availability from JustWatch, via TMDB</p>
      </div>
    </div>
  </Teleport>
</template>

<script>
// Bug report (2026-08-18): "it'd be nice if I could click on a poster in one of
// those lists and it would pop up a list of where I can watch that movie."
//
// Controlled by its parent: `movie` non-null means open. Fetching is keyed off
// that prop rather than a mounted() hook so one instance can serve a whole
// scroller of posters without being torn down and rebuilt per tap.
import axios from 'axios';
import { normalizeWatchProviders, PROVIDER_REGION } from '../assets/javascript/watchProviders';
import backgroundScrollLock from '../mixins/backgroundScrollLock.js';
import { trackEvent } from '../utils/usage.js';

// Availability changes on the order of days, and a hat's history strip invites
// tapping several posters in a row (and often the same one twice). Cached for
// the life of the page, per movie — module scope, so it survives this
// component being unmounted with the watchlist screen.
const cache = new Map();

export default {
  name: 'WhereToWatch',
  mixins: [backgroundScrollLock],
  props: {
    // { id, title } — TMDB movie id. Null closes the sheet.
    movie: { type: Object, default: null }
  },
  emits: ['close'],
  data () {
    return {
      loading: false,
      error: false,
      groups: [],
      link: null
    };
  },
  watch: {
    movie: {
      immediate: true,
      handler (movie) {
        this.lockBackgroundScroll(Boolean(movie));
        if (!movie) return;
        trackEvent('where-to-watch');
        this.load(movie);
      }
    }
  },
  methods: {
    async load (movie) {
      if (movie.id == null) {
        this.error = true;
        return;
      }

      if (cache.has(movie.id)) {
        this.apply(cache.get(movie.id));
        return;
      }

      this.loading = true;
      this.error = false;
      this.groups = [];
      this.link = null;

      try {
        const url = `https://api.themoviedb.org/3/movie/${movie.id}/watch/providers?api_key=${process.env.VUE_APP_TMDB_API_KEY}`;
        const response = await axios.get(url);
        const normalized = normalizeWatchProviders(response.data, PROVIDER_REGION);
        cache.set(movie.id, normalized);

        // The sheet may have been closed, or moved to another poster, while
        // this was in flight — only paint if it's still this movie's turn.
        if (this.movie?.id === movie.id) this.apply(normalized);
      } catch {
        // A failed lookup is NOT cached: the next tap should try again.
        if (this.movie?.id === movie.id) {
          this.error = true;
          this.loading = false;
        }
      }
    },
    apply (normalized) {
      this.groups = normalized.groups;
      this.link = normalized.link;
      this.loading = false;
      this.error = false;
    }
  }
};
</script>

<!-- Unscoped: the sheet is teleported to <body>, outside this component's
     scoped-style tree, exactly as SendToHat's is. -->
<style lang="scss">
.wtw-backdrop {
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.6);
  bottom: 0;
  display: flex;
  justify-content: center;
  left: 0;
  position: fixed;
  right: 0;
  top: 0;
  z-index: 1060;
}

.wtw-sheet {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 14px 14px 0 0;
  max-height: 70vh;
  max-width: 520px;
  overflow-y: auto;
  padding: 0.9rem 1rem calc(1rem + env(safe-area-inset-bottom));
  width: 100%;
}

.wtw-head {
  align-items: flex-start;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.wtw-title {
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.25;
  margin: 0;
  min-width: 0;
}

.wtw-close {
  background: none;
  border: none;
  color: #ccc;
  flex: 0 0 auto;
  /* 40px minimum touch target. */
  height: 40px;
  width: 40px;
}

.wtw-close:active { color: #fff; }

/* #ccc, not Bootstrap's .text-muted — that fails contrast on these panels. */
.wtw-status {
  align-items: center;
  color: #ccc;
  display: flex;
  font-size: 0.85rem;
  gap: 0.5rem;
  margin: 0.9rem 0;
}

.wtw-group { margin-top: 0.7rem; }

.wtw-group-label {
  color: #9a9a9a;
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  margin: 0 0 0.3rem;
  text-transform: uppercase;
}

/* Just the logos, packed (bug report: "way too big and spread out"). Dropping
   the name captions took each provider from a 62px column with a wrapping
   label to a 40px tile, so a group of five fits one row instead of two. */
.wtw-providers {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.wtw-logo {
  border-radius: 8px;
  flex: 0 0 auto;
  height: 40px;
  object-fit: cover;
  width: 40px;
}

.wtw-logo-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.9rem;
  justify-content: center;
  text-transform: uppercase;
}

.wtw-link {
  color: #6ea8fe;
  display: inline-block;
  font-size: 0.78rem;
  margin-top: 0.9rem;
  text-decoration: none;
}

.wtw-link:active { color: #9ec5fe; }

.wtw-credit {
  color: #7a7a7a;
  font-size: 0.58rem;
  margin: 0.9rem 0 0;
}
</style>
