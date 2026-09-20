<template>
  <div class="newsletter-screen">
    <div v-if="!issue && !loading" class="newsletter-empty">
      <h2>This week in film</h2>

      <!-- "Send me the newsletter" read as email — "where's it going to
           send it?" (Matt, 2026-09-20). Nothing is sent anywhere: an issue
           appears on THIS page, and the phone buzzes only if Cinema Roll
           notifications are already on. So the copy says where it turns up,
           and the notification line tells the truth about this device rather
           than promising a buzz that may never come. -->
      <p v-if="!optedIn">
        A short issue every Friday: what became watchable at home this week
        that's worth your time, and one film from the past having a moment.
        It appears right here — nothing gets emailed.
      </p>
      <template v-else>
        <p>No issue yet. A new one appears on this page every Friday morning.</p>
        <p class="newsletter-quiet">
          {{ pushSubscribed
            ? 'Your phone will buzz when it lands.'
            : 'Notifications are off for Cinema Roll, so it will just be waiting for you here — with a New flag on the Insights page.' }}
        </p>
      </template>

      <div class="newsletter-empty-actions">
        <!-- With no issue there was previously nothing to press: the build
             button lived only in a rendered issue's footer, so opting in led
             to a dead end. This is the way to a first issue without waiting
             for Friday. -->
        <button v-if="optedIn" class="btn btn-primary" :disabled="rebuilding" @click="rebuild">
          {{ rebuilding ? 'Building, about a minute…' : 'Build this week\'s issue now' }}
        </button>
        <button class="btn btn-sm newsletter-optout" @click="toggleOptIn">
          {{ optedIn ? 'Turn the newsletter off' : 'Turn the newsletter on' }}
        </button>
      </div>

      <p v-if="rebuildError" class="newsletter-error">{{ rebuildError }}</p>
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
        <h2 class="newsletter-section-title">{{ featureTitle }}</h2>
        <!-- "How did you pick that movie?" (Matt, 2026-09-20) should be
             answerable on the page, not only in the prose — so the occasion
             is stated as a fact, from the same data that did the choosing. -->
        <p class="newsletter-feature-why">{{ featureWhy }}</p>
        <h3 class="newsletter-feature-headline">{{ issue.feature.headline }}</h3>
        <p v-if="issue.feature.hook" class="newsletter-hook">{{ issue.feature.hook }}</p>
        <p v-for="(para, index) in featureParagraphs" :key="index" class="newsletter-para">
          {{ para }}
        </p>
        <div v-if="issue.feature.tmdb" class="newsletter-feature-actions">
          <SendToHat :movies="issue.feature.tmdb" :note="hatNote" label="Add to a hat"/>
        </div>
      </section>

      <footer class="newsletter-footer">
        <button class="btn btn-sm newsletter-optout" @click="toggleOptIn">
          {{ optedIn ? 'Turn the newsletter off' : 'Turn the newsletter on' }}
        </button>
        <!-- The testing switch Matt asked for: "set it up just for testing so
             that it shows up all the time, so that I can see it and review
             it".

             NOT gated on devMode, though that was the first instinct:
             devMode repoints `databaseTopKey` at `testing-database`, while
             the Lambda derives the account from the caller's ID token — so
             in devMode the app would poll a different node than the one the
             rebuild writes to, and wait forever. The spend is bounded on the
             server instead (a cooldown and a daily cap per account), which is
             the honest place for it. -->
        <button
          v-if="optedIn"
          class="btn btn-sm btn-outline-warning"
          :disabled="rebuilding"
          @click="rebuild"
        >
          {{ rebuilding ? 'Building, about a minute…' : 'Rebuild this issue' }}
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
    // Whether ANY device holds a push subscription — the same flag the
    // Notifications card reads. Without it the empty state would promise a
    // buzz that never comes.
    pushSubscribed () {
      return Boolean(this.$store.state.pushSubscribed);
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
    // "X turns 40" only works for an anniversary; a film that is simply back
    // in circulation has no number.
    featureTitle () {
      const f = this.issue?.feature;
      if (!f) return '';
      return f.turning ? `${f.title} turns ${f.turning}` : f.title;
    },

    // The occasion, in plain words, from the data that made the choice.
    featureWhy () {
      const f = this.issue?.feature;
      if (!f) return '';
      const released = this.longDate(f.releaseDate);
      const parts = [];
      if (f.turning) {
        const when = f.daysAway === 0 ? 'today' : 'this week';
        parts.push(`${f.turning} years old ${when}`);
      }
      if (f.reason === 'trending' || f.alsoTrending) parts.push('back in this week\u2019s most-watched');
      if (released) parts.push(`released ${released}`);
      return parts.join(' \u00b7 ');
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
    // Also the push state, or `pushSubscribed` is false on a cold open
    // straight to this route and the empty state tells the reader
    // notifications are off when they are not.
    this.$store.dispatch('loadPushState')?.catch?.(() => {});
  },
  methods: {
    posterUrl,
    longDate (iso) {
      if (!iso) return '';
      const [y, m, d] = String(iso).split('-').map(Number);
      if (!y || !m || !d) return '';
      // Built from parts, never `new Date(iso)` — that parses as UTC and
      // reports the previous day in a western timezone.
      return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    },
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

.newsletter-empty p {
  margin: 0 auto 0.75rem;
  max-width: 30rem;
}

.newsletter-quiet {
  color: #ccc;   /* not .text-muted — that grey fails on this background */
  font-size: 0.85rem;
}

.newsletter-empty-actions {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-top: 1.25rem;
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
  /* flex-start, not the default stretch: a stretched row pulls the poster to
     the height of the text beside it, which is exactly how these came out
     squished (report, 2026-09-20 — "the posters are squished"). The house
     rule for any row of posters is edge-aligned images and text that flows
     (vue-ui.md). */
  align-items: flex-start;
  display: flex;
  gap: 0.9rem;
  margin-bottom: 1.75rem;
}

.newsletter-poster {
  /* TMDB's own poster ratio, declared rather than inferred, so the box is
     the right shape before the image lands and can never be distorted by
     whatever the row does. */
  aspect-ratio: 2 / 3;
  border-radius: 0.3rem;
  flex: 0 0 auto;
  height: auto;
  object-fit: cover;
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

.newsletter-feature-why {
  color: #ccc;   /* ~11:1 here; Bootstrap's muted grey would not pass */
  font-size: 0.78rem;
  letter-spacing: 0.02em;
  margin: 0.15rem 0 0.6rem;
  text-transform: uppercase;
}

.newsletter-feature-actions {
  display: flex;
  justify-content: center;
  margin-top: 1.25rem;
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
