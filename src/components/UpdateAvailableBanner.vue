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
        {{ updating ? 'Updating Cinema Roll…' : 'A new version of Cinema Roll is ready.' }}
      </p>
      <button class="prompt-action prompt-action-app" :disabled="updating" @click.stop="reload">
        {{ updating ? 'One moment' : 'Refresh' }}
      </button>
    </span>
  </div>
</template>

<script>
import { reloadForUpdate } from '../utils/appUpdate.js';

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
  data () {
    return {
      updating: false
    };
  },
  methods: {
    async reload () {
      if (this.updating) return;
      this.updating = true;
      // The target lets a second tap for the SAME update escalate to a hard
      // reload instead of looping (appUpdate.js, bug report 2026-09-21).
      await reloadForUpdate({ target: this.$store.state.updateTargetBundle });
    },
    // The wait-out-the-install logic lives in utils/appUpdate.js, shared
    // with App.vue's automatic update path.
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
