<template>
  <!-- Movie Hat is a separate Firebase project with its own sign-in, and its
       rules refuse anonymous reads. When that session is missing, lapsed or a
       different Google account, every hat request is refused — and "couldn't
       load" or "couldn't reach" says nothing about what to do about it. Say
       which of the three it is, and put the fix next to it.

       Shared (Sentry, 2026-10-22): it lived only in the "Your hats" section,
       so a phone that had never signed in to Movie Hat (the hats in settings
       follow the account; the Movie Hat sign-in is per device) got a bare
       "Couldn't reach <hat>." from the hat button. Now the button, the
       Watchlist's hat note and the hats section all say the same thing. -->
  <div v-if="error" class="hat-access">
    <p class="hat-access-text">{{ message }}</p>
    <button type="button" class="hat-access-btn" :disabled="reconnecting" @click.stop="reconnect">
      <span v-if="reconnecting" class="spinner-border spinner-border-sm" role="status"></span>
      <span v-else>{{ error.reason === 'not-connected' ? 'Connect Movie Hat' : 'Reconnect' }}</span>
    </button>
    <p v-if="reconnectError" class="hat-access-failed">{{ reconnectError }}</p>
  </div>
</template>

<script>
import ErrorLogService from '../services/ErrorLogService.js';
import { isSignInDismissal, movieHatSignInMessage } from '../assets/javascript/movieHatSignIn.js';

export default {
  name: 'MovieHatAccess',
  props: {
    // `{ reason, email }`, as MovieHatAccessError carries them.
    error: { type: Object, default: null }
  },
  emits: ['connected'],
  data () {
    return { reconnecting: false, reconnectError: null };
  },
  computed: {
    // Each reason needs a different action, so each gets its own sentence.
    // 'denied' is the one worth naming the account for: a good token that the
    // rules still refuse almost always means the wrong Google account is
    // connected, and hat membership is per address.
    message () {
      const { reason, email } = this.error || {};
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
  methods: {
    // The whole point of the banner: the fix is one tap from the thing that
    // failed, rather than somewhere in Settings that nobody was told to open.
    async reconnect () {
      this.reconnecting = true;
      this.reconnectError = null;
      try {
        await this.$store.dispatch('connectMovieHat');
        // Both caches are keyed off a session that just changed; force the
        // contents refresh past its six-hour window so everything refills now.
        await Promise.all([
          this.$store.dispatch('loadMovieHatSummaries'),
          this.$store.dispatch('ensureMovieHatContents', { force: true })
        ]);
        this.$emit('connected');
      } catch (error) {
        // Dismissing the Google chooser is a choice, not a failure.
        if (!isSignInDismissal(error)) {
          this.reconnectError = error?.movieHatStage === 'lookup'
            ? "Signed in, but couldn't read your hats just now."
            : movieHatSignInMessage(error);
          ErrorLogService.error('Movie Hat reconnect failed', error);
        }
      } finally {
        this.reconnecting = false;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
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
</style>
