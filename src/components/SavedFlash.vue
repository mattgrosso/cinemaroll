<template>
  <transition name="saved-flash">
    <div v-if="flash" class="saved-flash" role="status" aria-live="polite">
      <i class="bi bi-check2"></i> {{ flash.text }}
    </div>
  </transition>
</template>

<script>
// A quiet "Saved" pill, bottom centre, gone in 1.4s. Committed via the
// store's flashSaved mutation by in-place edits (a new poster, a deleted
// viewing, a stickiness score) that used to change the screen with no
// acknowledgment at all - or, worse, only once the network answered.
export default {
  name: 'SavedFlash',
  data () {
    return { flash: null, timer: null };
  },
  computed: {
    latest () {
      return this.$store.state.savedFlash;
    }
  },
  watch: {
    latest (value) {
      if (!value) return;
      this.flash = value;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.flash = null; }, 1400);
    }
  },
  beforeUnmount () {
    clearTimeout(this.timer);
  }
};
</script>

<style scoped>
.saved-flash {
  position: fixed;
  left: 50%;
  bottom: calc(24px + env(safe-area-inset-bottom));
  transform: translateX(-50%);
  background: rgba(33, 37, 41, 0.92);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  padding: 0.35rem 0.9rem;
  font-size: 0.85rem;
  z-index: 1900;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.saved-flash i {
  color: #ffc107;
}

.saved-flash-enter-active,
.saved-flash-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.saved-flash-enter-from,
.saved-flash-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
}
</style>
