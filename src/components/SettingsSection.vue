<template>
  <section class="settings-section">
    <component
      :is="collapsible || to ? 'button' : 'div'"
      :type="collapsible || to ? 'button' : null"
      class="settings-section-header"
      :class="{ collapsible: collapsible || to }"
      @click="headerTapped"
    >
      <span class="settings-section-heading">
        <span class="settings-section-title">{{ title }}</span>
        <span v-if="hint" class="settings-section-hint">{{ hint }}</span>
      </span>
      <i v-if="to" class="bi bi-chevron-right settings-section-chevron"></i>
      <i v-else-if="collapsible" class="bi bi-chevron-down settings-section-chevron" :class="{ open }"></i>
    </component>
    <div v-if="!to" v-show="open" class="settings-section-body">
      <slot></slot>
    </div>
  </section>
</template>

<script>
// One consistent chrome for every group in the settings pane (feedback:
// the pane grew "patchwork... streamline, clarify, and make the whole
// thing tighter and neater and more consistent for discovery"). House
// card surface matching RatingCurveSettings; rarely-used groups
// (maintenance, developer) collapse by default so the everyday controls
// stay scannable.
export default {
  name: 'SettingsSection',
  props: {
    title: { type: String, required: true },
    // A title alone is opaque once every group is collapsed, so each one
    // carries a line saying what's inside.
    hint: { type: String, default: '' },
    collapsible: { type: Boolean, default: false },
    // A group that is a way somewhere else rather than a set of controls
    // (the Newsletter, 2026-09-29): the header becomes a link to this route
    // and there is no body.
    to: { type: String, default: '' },
    startOpen: { type: Boolean, default: true }
  },
  data () {
    return {
      open: this.collapsible ? this.startOpen : true
    };
  },
  methods: {
    headerTapped () {
      if (this.to) this.$router.push(this.to);
      else if (this.collapsible) this.open = !this.open;
    }
  }
};
</script>

<style lang="scss" scoped>
.settings-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.settings-section-header {
  align-items: center;
  background: none;
  border: none;
  color: #eee;
  display: flex;
  justify-content: space-between;
  padding: 0.8rem 1rem 0.5rem;
  text-align: left;
  width: 100%;

  &.collapsible {
    min-height: 44px;
    padding-bottom: 0.8rem;

    &:active {
      background: #1f1f1f;
    }
  }
}

.settings-section-heading {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  padding-right: 0.75rem;
}

.settings-section-title {
  font-size: 0.95rem;
  font-weight: 700;
}

.settings-section-hint {
  color: #9a9a9a;
  font-size: 0.75rem;
  font-weight: 400;
  line-height: 1.25;
}

.settings-section-chevron {
  color: #777;
  flex: 0 0 auto;
  transition: transform 0.2s;

  &.open {
    transform: rotate(180deg);
  }
}

.settings-section-body {
  padding: 0 1rem 0.9rem;
}

/* When a collapsible section is closed the header carries all the padding. */
</style>
