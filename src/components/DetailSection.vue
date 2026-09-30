<template>
  <section class="detail-section" :class="[`detail-section--${tone}`, { open }]">
    <button type="button" class="detail-section-header" :aria-expanded="open ? 'true' : 'false'" @click="toggle">
      <span class="detail-section-label">{{ label }}</span>
      <span v-if="!open" class="detail-section-summary">{{ summary }}</span>
      <span class="detail-section-actions" @click.stop><slot name="actions"/></span>
      <i class="bi detail-section-chevron" :class="open ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
    </button>
    <div v-show="open" class="detail-section-body">
      <slot/>
    </div>
  </section>
</template>

<script>
// One row of the movie page (2026-09-30 redesign — Matt: "The movie detail
// page has gotten away from us. There's too much info for the current
// design."). Closed, a section is its label and a one-line summary of what's
// inside; open, it is the full list. The choice is remembered per section
// across films, because someone who always wants the cast open always wants
// it open. The body is v-show, not v-if: the content stays in the DOM for
// in-page search and the tests, it just folds.
const STORAGE_PREFIX = 'cinemaRoll.movieDetail.open.';

export default {
  name: 'DetailSection',
  props: {
    id: { type: String, required: true },
    label: { type: String, required: true },
    summary: { type: String, default: '' },
    defaultOpen: { type: Boolean, default: false },
    // Colour family for the label — matches the page's existing groups.
    tone: { type: String, default: 'film' }
  },
  data () {
    return { open: this.remembered() ?? this.defaultOpen };
  },
  methods: {
    remembered () {
      try {
        const value = window.localStorage.getItem(STORAGE_PREFIX + this.id);
        return value === null ? null : value === '1';
      } catch {
        return null;
      }
    },
    toggle () {
      this.open = !this.open;
      try {
        window.localStorage.setItem(STORAGE_PREFIX + this.id, this.open ? '1' : '0');
      } catch {
        // Private browsing or a full quota: the choice just isn't remembered.
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.detail-section {
  border-top: 1px solid rgba(255, 255, 255, 0.08);

  &:last-child { border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
}

.detail-section-header {
  align-items: baseline;
  background: none;
  border: 0;
  color: #fff;
  display: flex;
  gap: 0.5rem;
  padding: 0.55rem 0;
  text-align: left;
  width: 100%;

  &:active { background: rgba(255, 255, 255, 0.05); }
}

.detail-section-label {
  color: var(--sec, #ccc);
  flex: 0 0 auto;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  min-width: 5.2rem;
}

.detail-section-summary {
  color: #ccc;
  flex: 1 1 auto;
  font-size: 0.8rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.open .detail-section-label { flex: 1 1 auto; }

.detail-section-actions {
  display: inline-flex;
  flex: 0 0 auto;
}

.detail-section-chevron {
  color: #9a9a9a;
  flex: 0 0 auto;
  font-size: 0.7rem;
}

.detail-section-body {
  padding: 0 0 0.6rem;
}

/* The page's existing colour groups, so a label reads as its family. */
.detail-section--people { --sec: #cd7fe8; }
.detail-section--film { --sec: #6fd39b; }
.detail-section--awards { --sec: #ffc107; }
.detail-section--you { --sec: #6fb8ff; }
.detail-section--plain { --sec: #ccc; }
</style>
