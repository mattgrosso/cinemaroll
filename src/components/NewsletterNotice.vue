<template>
  <!-- A prompt-card in Home's unified notification space, wearing the neutral
       "app" accent — the app talking about itself, per _prompt-card.scss.
       This is the newsletter's only entry point in the app, and deliberately
       so: a weekly issue is NEWS, not a permanent destination, and the
       rainbow button row is documented as fragile (see vue-ui.md, "the extra
       watchlist button broke the rainbow"). Unread, it's here; read, it's
       gone until Friday. -->
  <div v-if="unread" class="prompt-card" @click="open">
    <span class="prompt-badge prompt-badge-app"><i class="bi bi-envelope-paper-fill"></i></span>
    <span class="prompt-body">
      <span class="prompt-label">This week in film</span>
      <p class="prompt-text">{{ summary }}</p>
      <a class="prompt-action prompt-action-app" @click.stop="open">Read this week's issue</a>
    </span>
  </div>
</template>

<script>
// Whether there is an issue the reader hasn't opened yet.
//
// "Read" is remembered in localStorage rather than in the database on
// purpose: it is a per-DEVICE convenience, the same class of state as a
// remembered tab, and syncing it would mean a write on every open of a screen
// whose whole job is to be read once. Reading it on the phone and finding the
// card still up on the laptop is the correct, unsurprising behaviour for a
// newsletter.
const READ_KEY = 'cinemaRoll.newsletter.lastRead';

export default {
  name: 'NewsletterNotice',
  data () {
    return { lastRead: null };
  },
  computed: {
    issue () {
      return this.$store.state.newsletterIssue || null;
    },
    optedIn () {
      return Boolean(this.$store.state.newsletterPrefs?.newsletter);
    },
    unread () {
      if (!this.optedIn || !this.issue?.weekKey) return false;
      return this.issue.weekKey !== this.lastRead;
    },
    summary () {
      const picks = this.issue?.picks?.length || 0;
      const feature = this.issue?.feature;
      const parts = [];
      if (picks) parts.push(`${picks} new ${picks === 1 ? 'film' : 'films'} worth your time`);
      if (feature?.title) parts.push(`${feature.title} at ${feature.turning}`);
      return parts.length ? `${parts.join(', plus ')}.` : 'This week’s issue is ready.';
    }
  },
  created () {
    // Wrapped: localStorage throws outright in a locked-down private window,
    // and a notice card must never be what takes Home down.
    try {
      this.lastRead = localStorage.getItem(READ_KEY);
    } catch {
      this.lastRead = null;
    }
    // Home does not otherwise read the newsletter, so the card has to ask for
    // it. The action is a no-op without a signed-in account key.
    this.$store.dispatch('loadNewsletter')?.catch?.(() => {});
  },
  methods: {
    open () {
      const week = this.issue?.weekKey;
      if (week) {
        try {
          localStorage.setItem(READ_KEY, week);
        } catch {
          // A device that can't remember it shows the card again. Harmless.
        }
        this.lastRead = week;
      }
      this.$router.push('/newsletter');
    }
  }
};
</script>
