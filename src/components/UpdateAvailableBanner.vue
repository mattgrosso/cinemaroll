<template>
  <div
    v-if="$store.state.updateAvailable"
    class="prompt-card update-available-banner"
    @click="reload"
  >
    <span class="prompt-badge prompt-badge-app"><i class="bi bi-arrow-repeat"></i></span>
    <span class="prompt-body">
      <span class="prompt-label">App update</span>
      <p class="prompt-text">
        {{ isUpdating ? 'Updating Cinema Roll…' : (isDeferred ? 'A new version of Cinema Roll is waiting for a better connection. This one keeps working.' : 'A new version of Cinema Roll is ready.') }}
      </p>
      <button class="prompt-action prompt-action-app" :disabled="isUpdating" @click.stop="reload">
        {{ isUpdating ? 'One moment' : (isDeferred ? 'Try again' : 'Refresh') }}
      </button>
    </span>
  </div>
</template>

<script>
import { reloadForUpdate, watchForStalledReload } from '../utils/appUpdate.js';
import { trackEvent } from '../utils/usage.js';

// Shows once App.vue's deploy check flags a new version. Since 2026-08-15
// updates normally apply THEMSELVES at a quiet moment (App.vue's
// auto-update watcher, feedback: "the user shouldn't have to take an
// action") — this card is the visible state while waiting and the manual
// fallback whenever a quiet moment never comes (typing, mid-game, modal
// open).
//
// Since 2026-08-21 it renders as a prompt-card in Home's .home-notices
// section — the unified notification space — rather than as a full-width
// yellow banner over every screen. The neutral "app" accent marks it as
// the app talking about itself, not movie homework.
export default {
  name: 'UpdateAvailableBanner',
  // The version waiting, or null — for Home's one-at-a-time slot
  // (homeNotices.js). A dismissed update comes back for the NEXT version.
  emits: ['notice'],
  data () {
    return {
      updating: false,
      // The connection couldn't carry the new version (appUpdate.js), so
      // the page stayed on the working one; say so rather than spin.
      deferred: false,
      cancelStallWatch: null
    };
  },
  computed: {
    noticeSignature () {
      if (!this.$store.state.updateAvailable) return null;
      return this.$store.state.updateTargetBundle || 'update';
    },
    // Also true while App.vue applies the update on its own (bug report
    // 2026-09-30: a Refresh button during the automatic update left Matt
    // wondering whether to tap it, and a tap only made it slower).
    isUpdating () {
      return this.updating || Boolean(this.$store.state.updateApplying);
    },
    isDeferred () {
      return this.deferred || Boolean(this.$store.state.updateDeferred);
    }
  },
  watch: {
    noticeSignature: {
      immediate: true,
      handler (signature) {
        this.$emit('notice', signature);
      }
    }
  },
  methods: {
    async reload () {
      trackEvent('update-tapped');
      if (this.isUpdating) return;
      this.updating = true;
      // The target lets a second tap for the SAME update escalate to a hard
      // reload instead of looping (appUpdate.js, bug report 2026-09-21).
      const outcome = await reloadForUpdate({ target: this.$store.state.updateTargetBundle });
      if (outcome === 'deferred') {
        this.updating = false;
        this.deferred = true;
      } else if (outcome === 'reloaded' || outcome === 'hard') {
        // The reload can be silently ignored (2026-10-14); don't leave the
        // button greyed out for good. A second tap goes hard.
        this.cancelStallWatch?.();
        this.cancelStallWatch = watchForStalledReload(() => {
          this.cancelStallWatch = null;
          this.updating = false;
        });
      }
    },
    // The wait-out-the-install logic lives in utils/appUpdate.js, shared
    // with App.vue's automatic update path.
  },
  beforeUnmount () {
    this.cancelStallWatch?.();
  }
}
</script>

<style lang="scss" scoped>
@import '@/assets/scss/prompt-card';

/* The action is a real <button> (it disables while updating), dressed as
   the prompt-action link every other card in the space uses. */
.prompt-action {
  background: none;
  border: none;
  padding: 0;
  text-align: left;

  &:disabled {
    color: #9a9a9a;
    cursor: default;
  }
}
</style>
