<template>
  <!-- A prompt-card in Home's unified notification space, wearing the
       neutral "app" accent (the app talking about itself). Tapping opens
       the full story; ANY dismissal of that panel marks the notices seen —
       the point is "your report mattered, here's what happened", not a
       task to acknowledge. -->
  <div v-if="notices.length && !open" class="prompt-card" @click="open = true">
    <span class="prompt-badge prompt-badge-app"><i class="bi bi-bug-fill"></i></span>
    <span class="prompt-body">
      <span class="prompt-label">Bug report</span>
      <p class="prompt-text">
        {{ notices.length === 1
          ? 'A bug you reported has been fixed.'
          : `${notices.length} bugs you reported have been fixed.` }}
      </p>
      <a class="prompt-action prompt-action-app" @click.stop="open = true">See what happened</a>
    </span>
  </div>

  <div v-if="notices.length && open" class="bug-resolution-backdrop" @click.self="dismiss">
    <div class="bug-resolution-panel" role="dialog" aria-label="A bug you reported was fixed">
      <h2 class="bug-resolution-panel__title">
        <i class="bi bi-check-circle-fill"></i>
        {{ notices.length === 1 ? 'A bug you reported is fixed' : 'Bugs you reported are fixed' }}
      </h2>
      <p class="bug-resolution-panel__thanks">
        Thanks for telling us — here's what happened.
      </p>

      <div v-for="notice in notices" :key="notice.id" class="bug-resolution-notice">
        <p v-if="notice.reportSnippet" class="bug-resolution-notice__quote">
          You said: &ldquo;{{ notice.reportSnippet }}&rdquo;
        </p>
        <p v-if="notice.understood" class="bug-resolution-notice__section">
          <span class="bug-resolution-notice__label">What was going wrong</span>
          {{ notice.understood }}
        </p>
        <p v-if="notice.fixed" class="bug-resolution-notice__section">
          <span class="bug-resolution-notice__label">What we did about it</span>
          {{ notice.fixed }}
        </p>
        <p v-if="notice.resolvedAt" class="bug-resolution-notice__date">
          Fixed {{ formatDate(notice.resolvedAt) }}
        </p>
      </div>

      <div class="bug-resolution-panel__actions">
        <button type="button" class="btn btn-sm btn-warning" @click="dismiss">
          Got it, thanks
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { fetchUnseenResolutions, markResolutionsSeen } from '../utils/bugResolutions';

export default {
  name: 'BugResolutionNotice',
  // Tells Home what this card is about, so the one-at-a-time notice slot
  // (homeNotices.js) can rank it: the fixes waiting, or null.
  emits: ['notice'],
  data () {
    return {
      notices: [],
      open: false,
      checked: false
    };
  },
  computed: {
    ready () {
      // Wait for the library so the card never races the login screen or
      // appears over a half-loaded app.
      return Boolean(this.$store.state.dbLoaded && this.$store.getters.databaseTopKey);
    }
  },
  watch: {
    notices: {
      immediate: true,
      handler (notices) {
        this.$emit('notice', notices.length ? notices.map((notice) => notice.id).join(',') : null);
      }
    },
    ready: {
      immediate: true,
      async handler (ready) {
        if (!ready || this.checked) return;
        this.checked = true;
        this.notices = await fetchUnseenResolutions(this.$store);
      }
    },
    // Same convention as every other modal here (Favorite* etc.): the page
    // behind the panel must not scroll while it's up.
    open (open) {
      document.body.classList.toggle('no-scroll', open);
    }
  },
  beforeUnmount () {
    if (this.open) document.body.classList.remove('no-scroll');
  },
  methods: {
    dismiss () {
      const ids = this.notices.map((notice) => notice.id);
      this.notices = [];
      this.open = false;
      markResolutionsSeen(this.$store, ids);
    },
    formatDate (timestamp) {
      return new Date(timestamp).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/prompt-card';

/* The detail panel keeps the bug-report family's look — dark surface,
   #ccc-or-brighter text, :active only. */
.bug-resolution-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1150;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.bug-resolution-panel {
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 0.6rem;
  padding: 1.25rem 1.5rem;
  max-width: min(440px, 90vw);
  width: 100%;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.bug-resolution-panel__title {
  color: #eee;
  font-size: 1.05rem;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.bug-resolution-panel__title .bi-check-circle-fill {
  color: #7ac97a;
}

.bug-resolution-panel__thanks {
  color: #ccc;
  font-size: 0.9rem;
  margin: 0;
}

.bug-resolution-notice {
  background: #0d0d0d;
  border: 1px solid #2e2e2e;
  border-radius: 0.4rem;
  padding: 0.75rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.bug-resolution-notice__quote {
  color: #ccc;
  font-style: italic;
  font-size: 0.9rem;
  margin: 0;
}

.bug-resolution-notice__section {
  color: #eee;
  font-size: 0.95rem;
  margin: 0;
}

.bug-resolution-notice__label {
  display: block;
  color: #ccc;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.15rem;
}

.bug-resolution-notice__date {
  color: #ccc;
  font-size: 0.75rem;
  margin: 0;
}

.bug-resolution-panel__actions {
  display: flex;
  justify-content: flex-end;
}

/* 40px minimum touch target. */
.bug-resolution-panel__actions .btn {
  min-height: 40px;
}
</style>
