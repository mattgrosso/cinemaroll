<template>
  <div class="name-row" :class="{ 'name-row--expanded': expanded, 'name-row--clipped': hiddenCount > 0 && !expanded }" :style="{ '--name-row-lines': lines }">
    <!-- Whole names only (Matt, 2026-10-06: "we shouldn't break a single
         person's name ... as many people's names as we can fit on that first
         row, and then it should say more"). Closed, the chips wrap onto a
         second line that is clipped away, so a name is either all there or
         not there; the count of clipped names is measured and shown as
         "+N more" at the end of the line. Every chip is a link with its film
         count, open or closed — no need to expand to tap one. -->
    <span ref="chips" class="name-row-chips">
      <button v-for="person in people" :key="person.name" type="button" class="name-chip" @click.stop="$emit('pick', person.name)">
        {{ person.name }}<CountMark :count="person.count" />
      </button>
    </span>
    <button v-if="hiddenCount > 0 && !expanded" type="button" class="name-row-more" @click.stop="$emit('more')">+{{ hiddenCount }} more</button>
  </div>
</template>

<script>
import CountMark from './CountMark.vue';

export default {
  name: 'NameRow',
  components: { CountMark },
  props: {
    // [{ name, count }] in display order; count is how many films in the
    // library share the person, shown as the usual small bubble.
    people: { type: Array, default: () => [] },
    // Open: every chip, wrapping freely, no "+N more".
    expanded: { type: Boolean, default: false },
    // How many lines show when closed. The cast gets two; a crew row, one.
    lines: { type: Number, default: 1 }
  },
  emits: ['pick', 'more'],
  data () {
    return { hiddenCount: 0 };
  },
  watch: {
    people () { this.$nextTick(() => this.measure()); },
    expanded () { this.$nextTick(() => this.measure()); }
  },
  mounted () {
    this.measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(this.$el);
    }
  },
  beforeUnmount () {
    this.observer?.disconnect();
  },
  methods: {
    // Chips that wrapped past the first line are the hidden ones. The "+N
    // more" pill then takes some of the line, so a second pass follows the
    // first; it stops there, so a name on the edge can't flicker.
    measure (pass = 1) {
      if (this.expanded) { this.hiddenCount = 0; return; }
      const chips = Array.from(this.$refs.chips?.children || []);
      if (!chips.length) { this.hiddenCount = 0; return; }
      const top = chips[0].offsetTop;
      // Anything past the last shown line is hidden; a chip's own height is
      // the line height, so the cut-off is lines × one chip.
      const lineHeight = chips[0].offsetHeight || 0;
      const limit = top + lineHeight * (this.lines - 1) + 1;
      const hidden = chips.filter((chip) => chip.offsetTop > limit).length;
      if (hidden === this.hiddenCount) return;
      this.hiddenCount = hidden;
      if (pass === 1) this.$nextTick(() => this.measure(2));
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/detail-scale';
.name-row {
  align-items: flex-end;
  display: flex;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.name-row-chips {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  gap: 0 12px;
  /* One line tall: anything that wrapped is out of sight, whole. */
  line-height: 1.5;
  max-height: calc(1.5em * var(--name-row-lines, 1));
  min-width: 0;
  overflow: hidden;
}

.name-row--expanded .name-row-chips { max-height: none; }

.name-chip {
  background: none;
  border: 0;
  color: #fff;
  font: inherit;
  line-height: 1.5;
  padding: 0;
  text-align: left;
  white-space: nowrap;

  &:active { color: #ccc; }
}

.name-row-more {
  background: rgba(255, 255, 255, 0.1);
  border: 0;
  border-radius: 999px;
  color: #fff;
  flex: 0 0 auto;
  font-size: ds(0.65rem);
  line-height: 1.5;
  padding: 0 8px;
  white-space: nowrap;

  &:active { background: rgba(255, 255, 255, 0.18); }
}

.small-count-bubble {
  bottom: 3px;
  font-size: ds(0.62rem);
  position: relative;
}
</style>
