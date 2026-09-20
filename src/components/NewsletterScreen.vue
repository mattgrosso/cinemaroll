<template>
  <div class="newsletter-screen">
    <div v-if="!issue && !loading" class="newsletter-empty">
      <h2>This week in film</h2>
      <p v-if="!optedIn">
        A short issue every Friday: what became watchable at home this week
        that's worth your time, and one film from the past having a moment.
      </p>
      <p v-else>
        No issue yet. The next one lands on Friday.
      </p>
      <button class="btn btn-primary" @click="toggleOptIn">
        {{ optedIn ? 'Turn the newsletter off' : 'Send me the newsletter' }}
      </button>
    </div>

    <div v-else-if="loading" class="newsletter-loading">
      <div class="spinner-border" role="status"><span class="visually-hidden">Loading…</span></div>
    </div>

    <article v-else class="newsletter-issue">
      <header class="newsletter-header">
        <p class="newsletter-kicker">This week in film</p>
        <p class="newsletter-dateline">{{ formattedWeek }}</p>
        <!-- A testing issue is stamped, or a rebuilt one is indistinguishable
             from Friday's and every screenshot becomes ambiguous. -->
        <p v-if="issue.testing" class="newsletter-testing">rebuilt for testing</p>
      </header>

      <p v-if="issue.intro" class="newsletter-intro">{{ issue.intro }}</p>

      <section v-if="picks.length" class="newsletter-section">
        <h2 class="newsletter-section-title">New this week</h2>
        <div v-for="pick in picks" :key="pick.id" class="newsletter-pick">
          <img
            v-if="pick.posterPath"
            class="newsletter-poster"
            :src="posterUrl(pick.posterPath)"
            :alt="`${pick.title} poster`"
            loading="lazy"
          />
          <div class="newsletter-pick-body">
            <h3 class="newsletter-pick-title">
              <router-link :to="`/movie/${pick.id}`">{{ pick.title }}</router-link>
              <span v-if="pick.year" class="newsletter-year">{{ pick.year }}</span>
            </h3>
            <p v-if="pick.director" class="newsletter-credit">{{ pick.director }}</p>

            <!-- Scores are rendered only where they exist. "No critic score
                 yet" is an honest line; a zero would be a lie. -->
            <p class="newsletter-scores">
              <span v-if="pick.rottenTomatoes != null" class="newsletter-score">
                {{ pick.rottenTomatoes }}% RT
              </span>
              <span v-if="pick.metacritic != null" class="newsletter-score">
                {{ pick.metacritic }} Metacritic
              </span>
              <span v-if="pick.rottenTomatoes == null && pick.metacritic == null" class="newsletter-score newsletter-score--none">
                No critic score yet
              </span>
            </p>

            <p class="newsletter-why">{{ pick.why }}</p>

            <div class="newsletter-pick-footer">
              <span class="newsletter-where">{{ pick.availability }}</span>
              <SendToHat :movies="pick.tmdb" :note="hatNote" label="Add to a hat"/>
            </div>
          </div>
        </div>
      </section>

      <section v-if="issue.feature" class="newsletter-section newsletter-feature">
        <h2 class="newsletter-section-title">{{ issue.feature.title }} turns {{ issue.feature.turning }}</h2>
        <h3 class="newsletter-feature-headline">{{ issue.feature.headline }}</h3>
        <p v-if="issue.feature.hook" class="newsletter-hook">{{ issue.feature.hook }}</p>
        <p v-for="(para, index) in featureParagraphs" :key="index" class="newsletter-para">
          {{ para }}
        </p>
      </section>

      <footer class="newsletter-footer">
        <button class="btn btn-sm newsletter-optout" @click="toggleOptIn">
          {{ optedIn ? 'Turn the newsletter off' : 'Send me the newsletter' }}
        </button>
        <!-- The testing switch Matt asked for: "set it up just for testing so
             that it shows up all the time, so that I can see it and review
             it". Behind devMode so it never shows up for anybody else. -->
        <button
          v-if="devMode"
          class="btn btn-sm btn-outline-warning"
          :disabled="rebuilding"
          @click="rebuild"
        >
          {{ rebuilding ? 'Building…' : 'Rebuild this issue' }}
        </button>
      </footer>

      <p v-if="rebuildError" class="newsletter-error">{{ rebuildError }}</p>
    </article>
  </div>
</template>

<script>
// The weekly issue, as read.
//
// This screen RENDERS; it never composes. Everything on it was written by
// aws-lambda/newsletter.js into `{topKey}/newsletter/issues/<weekKey>`, which
// means an issue reads identically on every device, offline, and a year from
// now — and that a fact shown here is a fact that was checked when the issue
// was built rather than re-derived on each open.
//
// The one thing it may do is ask for a REBUILD, and only in devMode.
import SendToHat from './SendToHat.vue';
import { posterUrl } from '../assets/javascript/offlinePosterCache.js';

export default {
  name: 'NewsletterScreen',
  components: { SendToHat },
  data () {
    return {
      rebuilding: false,
      rebuildError: null
    };
  },
  computed: {
    loading () {
      return !this.$store.state.newsletterLoaded;
    },
    issue () {
      return this.$store.state.newsletterIssue || null;
    },
    optedIn () {
      return Boolean(this.$store.state.newsletterPrefs?.newsletter);
    },
    devMode () {
      return Boolean(this.$store.state.devMode);
    },
    picks () {
      return this.issue?.picks || [];
    },
    // Paragraphs come across as one string with blank lines between them —
    // rendered as separate <p>s rather than with v-html, which would hand a
    // model's output the ability to inject markup.
    featureParagraphs () {
      return String(this.issue?.feature?.article || '')
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    },
    formattedWeek () {
      const key = this.issue?.weekKey;
      if (!key) return '';
      // The key is a UTC date; render it as a plain date without letting a
      // timezone walk it back a day.
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric'
      });
    },
    hatNote () {
      return 'From the newsletter';
    }
  },
  mounted () {
    // Caught here as well as inside the action: a dispatch that throws before
    // reaching the action's own try block would otherwise surface as an
    // unhandled rejection. Optional-chained because a partial store in a test
    // can hand back something that isn't a promise, and a screen must not go
    // down over that — the same guard SendToHat puts on its getter.
    this.$store.dispatch('loadNewsletter')?.catch?.(() => {});
  },
  methods: {
    posterUrl,
    toggleOptIn () {
      this.$store.dispatch('saveNewsletterPrefs', { newsletter: !this.optedIn });
    },
    async rebuild () {
      this.rebuilding = true;
      this.rebuildError = null;
      try {
        await this.$store.dispatch('rebuildNewsletter');
      } catch (error) {
        this.rebuildError = error?.message || 'Could not rebuild the issue.';
      } finally {
        this.rebuilding = false;
      }
    }
  }
};
</script>

<style lang="scss">
.newsletter-screen {
  color: white;
  margin: 0 auto;
  max-width: 44rem;
  padding: 1rem 1rem 4rem;
}

.newsletter-empty,
.newsletter-loading {
  padding-top: 3rem;
  text-align: center;
}

.newsletter-header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.18);
  margin-bottom: 1.5rem;
  padding-bottom: 0.75rem;
  text-align: center;
}

.newsletter-kicker {
  font-size: 1.6rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  margin: 0;
}

.newsletter-dateline {
  color: rgba(255, 255, 255, 0.65);
  font-size: 0.85rem;
  margin: 0.15rem 0 0;
}

.newsletter-testing {
  color: #ffc107;
  font-size: 0.7rem;
  letter-spacing: 0.08em;
  margin: 0.35rem 0 0;
  text-transform: uppercase;
}

.newsletter-intro {
  font-size: 1.05rem;
  line-height: 1.55;
  margin-bottom: 2rem;
}

.newsletter-section-title {
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-size: 1.15rem;
  font-weight: 800;
  margin-bottom: 1rem;
  padding-bottom: 0.35rem;
}

.newsletter-pick {
  display: flex;
  gap: 0.9rem;
  margin-bottom: 1.75rem;
}

.newsletter-poster {
  border-radius: 0.3rem;
  flex: 0 0 auto;
  width: 84px;
}

.newsletter-pick-body {
  flex: 1;
  min-width: 0;
}

.newsletter-pick-title {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;

  a {
    color: white;
    text-decoration: none;
  }

  a:active {
    color: #9ec5fe;
  }
}

.newsletter-year {
  color: rgba(255, 255, 255, 0.55);
  font-size: 0.85rem;
  font-weight: 400;
  margin-left: 0.4rem;
}

.newsletter-credit {
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.82rem;
  margin: 0.1rem 0 0.3rem;
}

.newsletter-scores {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 0.45rem;
}

// White on these would fail against the panel; both of these clear 4.5:1.
.newsletter-score {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 0.2rem;
  color: #d6e4ff;
  font-size: 0.72rem;
  padding: 0.1rem 0.4rem;
}

.newsletter-score--none {
  color: rgba(255, 255, 255, 0.6);
}

.newsletter-why {
  font-size: 0.93rem;
  line-height: 1.5;
  margin: 0 0 0.5rem;
}

.newsletter-pick-footer {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  justify-content: space-between;
}

.newsletter-where {
  color: #8fd19e;
  font-size: 0.8rem;
  font-weight: 600;
}

.newsletter-feature {
  margin-top: 2.5rem;
}

.newsletter-feature-headline {
  font-size: 1.35rem;
  font-weight: 800;
  line-height: 1.25;
  margin: 0.4rem 0 0.5rem;
}

.newsletter-hook {
  color: rgba(255, 255, 255, 0.75);
  font-size: 0.95rem;
  font-style: italic;
  margin-bottom: 1.1rem;
}

.newsletter-para {
  font-size: 1rem;
  line-height: 1.65;
  margin-bottom: 1rem;
}

.newsletter-footer {
  border-top: 1px solid rgba(255, 255, 255, 0.12);
  display: flex;
  gap: 0.6rem;
  justify-content: center;
  margin-top: 2.5rem;
  padding-top: 1.25rem;
}

// NOT btn-outline-secondary: that is Bootstrap's #6c757d, the same grey
// vue-ui.md calls out as failing against this app's dark surfaces. #ccc on
// near-black is ~11:1. Press feedback only — a phone keeps :hover stuck.
.newsletter-optout {
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #ccc;
}

.newsletter-optout:active {
  background: rgba(255, 255, 255, 0.12);
  color: white;
}

.newsletter-error {
  color: #ffc107;
  font-size: 0.85rem;
  margin-top: 0.75rem;
  text-align: center;
}

@media (max-width: 420px) {
  .newsletter-poster { width: 68px; }
  .newsletter-kicker { font-size: 1.35rem; }
}
</style>
