<template>
  <div class="year-shelf">
    <div class="year-shelf-card">
      <p class="year-shelf-title">Films by release year</p>
      <p class="year-shelf-caption">One column per year, one block per film you've rated, best on top. Brighter blocks are your higher ratings. Tap a column.</p>
      <p v-if="!shelf.years.length" class="year-shelf-empty">Rate a film and its year shows up here.</p>
      <template v-else>
        <div ref="scroller" class="year-shelf-scroller">
          <svg
            class="year-shelf-chart"
            :width="chartWidth"
            :height="CHART_HEIGHT + AXIS_HEIGHT"
            :viewBox="`0 0 ${chartWidth} ${CHART_HEIGHT + AXIS_HEIGHT}`"
            role="img"
            :aria-label="ariaLabel"
          >
            <g v-for="decade in decades" :key="`d-${decade.year}`">
              <line class="year-shelf-decade-line" :x1="decade.x" :x2="decade.x" :y1="0" :y2="CHART_HEIGHT + 4"/>
              <text class="year-shelf-decade-label" :x="decade.x + 2" :y="CHART_HEIGHT + 16">{{ decade.year }}s</text>
            </g>
            <line class="year-shelf-baseline" x1="0" :x2="chartWidth" :y1="CHART_HEIGHT + 0.5" :y2="CHART_HEIGHT + 0.5"/>
            <g
              v-for="(column, index) in columns"
              :key="column.year"
              class="year-shelf-column"
              :class="{ dimmed: selectedYear !== null && selectedYear !== column.year }"
            >
              <rect
                v-for="(block, b) in column.blocks"
                :key="b"
                :x="index * STEP"
                :y="block.y"
                :width="COLUMN_WIDTH"
                :height="block.height"
                :fill="SHADES[block.shade]"
              />
              <!-- The whole column height (and its gap) is the tap target. -->
              <rect
                class="year-shelf-hit"
                :data-year="column.year"
                :x="index * STEP - GAP / 2"
                y="0"
                :width="STEP"
                :height="CHART_HEIGHT + AXIS_HEIGHT"
                @click="select(column.year)"
              />
            </g>
          </svg>
        </div>
        <div class="year-shelf-legend" aria-hidden="true">
          <span>Lower</span>
          <span v-for="(shade, i) in SHADES" :key="i" class="year-shelf-swatch" :style="{ background: shade }"></span>
          <span>Higher</span>
        </div>
        <div v-if="selected" class="year-shelf-detail">
          <button type="button" class="year-shelf-step" aria-label="Previous year" :disabled="selected.year <= shelf.first" @click="step(-1)"><i class="bi bi-chevron-left"></i></button>
          <div class="year-shelf-detail-text">
            <span class="year-shelf-detail-year">{{ selected.year }} · {{ selected.count }} film{{ selected.count === 1 ? '' : 's' }}</span>
            <span v-if="selected.top" class="year-shelf-detail-top">Best: {{ selected.top.movie.title }} ({{ formatScore(selected.films[0].rating) }})</span>
            <span v-else class="year-shelf-detail-top">Nothing from this year yet.</span>
          </div>
          <button type="button" class="year-shelf-step" aria-label="Next year" :disabled="selected.year >= shelf.last" @click="step(1)"><i class="bi bi-chevron-right"></i></button>
        </div>
        <button
          v-if="selected && selected.count"
          type="button"
          class="year-shelf-search"
          @click="$emit('updateSearchValue', String(selected.year))"
        >See {{ selected.year }}'s films</button>
      </template>
    </div>
  </div>
</template>

<script>
// Eras tab, top: how many films from each release year, and how good, in one
// picture. Counting and shading in releaseYearShelf.js (pure, tested). Plain
// SVG rather than Chart.js — a stack of per-film blocks isn't a chart type
// it has, and the earlier bar chart on this tab was turned down (2026-08-15).
import { getRating } from "../assets/javascript/GetRating.js";
import { releaseYearShelf } from "../assets/javascript/releaseYearShelf.js";
import { formatScore } from "../assets/javascript/formatScore.js";
import { memoByIdentity } from "../utils/memoByIdentity.js";

const COLUMN_WIDTH = 9;
const GAP = 2;
const STEP = COLUMN_WIDTH + GAP;
const CHART_HEIGHT = 180;
const AXIS_HEIGHT = 22;
// Tallest a single film's block gets, so a small library isn't all slabs.
const MAX_BLOCK = 8;
// Below this a 1px gap between blocks would eat the block, so runs of one
// shade are drawn as one rect instead.
const SEPARATE_BLOCKS_FROM = 4;
// Your bottom fifth to your top fifth, by the tab's coral. Every shade is
// lighter than the last, and the dimmest still reads against the dark page.
const SHADES = ['#a5544a', '#cf6152', '#ff7a6b', '#ffa898', '#ffe0da'];

const shelfMemo = memoByIdentity((entries, thisYear) => releaseYearShelf(entries, getRating, { thisYear }));

export default {
  name: "ReleaseYearShelf",
  props: {
    resultsWithRatings: {
      type: Array,
      required: true
    }
  },
  emits: ['updateSearchValue'],
  data () {
    return { selectedYear: null, COLUMN_WIDTH, GAP, STEP, CHART_HEIGHT, AXIS_HEIGHT, SHADES };
  },
  computed: {
    shelf () {
      return shelfMemo(this.resultsWithRatings, new Date().getFullYear());
    },
    chartWidth () {
      return Math.max(this.shelf.years.length * STEP, STEP);
    },
    blockHeight () {
      return Math.min(MAX_BLOCK, CHART_HEIGHT / Math.max(this.shelf.maxCount, 1));
    },
    columns () {
      const h = this.blockHeight;
      const separate = h >= SEPARATE_BLOCKS_FROM;
      return this.shelf.years.map(({ year, films }) => {
        const blocks = [];
        // Films come best first (the detail's "Best:" reads films[0]); stack
        // from the lowest-rated up so the best sit on top (report 2026-10-24).
        [...films].reverse().forEach((film, i) => {
          const bottom = CHART_HEIGHT - i * h;
          const last = blocks[blocks.length - 1];
          if (!separate && last && last.shade === film.shade) {
            last.y -= h;
            last.height += h;
            return;
          }
          blocks.push({ shade: film.shade, y: bottom - h, height: separate ? h - 1 : h });
        });
        return { year, blocks };
      });
    },
    decades () {
      return this.shelf.years
        .map((y, index) => ({ year: y.year, x: index * STEP - GAP / 2 }))
        .filter((y) => y.year % 10 === 0);
    },
    selected () {
      return this.shelf.years.find((y) => y.year === this.selectedYear) || null;
    },
    ariaLabel () {
      const busiest = this.shelf.years.reduce((a, b) => (b.count > a.count ? b : a), this.shelf.years[0]);
      return `Films by release year, ${this.shelf.first} to ${this.shelf.last}. Most from ${busiest.year}: ${busiest.count}.`;
    }
  },
  mounted () {
    // Open on the recent years; the old ones are a flick to the left.
    this.$nextTick(() => {
      const scroller = this.$refs.scroller;
      if (scroller) scroller.scrollLeft = scroller.scrollWidth;
    });
  },
  methods: {
    formatScore,
    select (year) {
      this.selectedYear = this.selectedYear === year ? null : year;
    },
    step (delta) {
      const next = this.selectedYear + delta;
      if (next < this.shelf.first || next > this.shelf.last) return;
      this.selectedYear = next;
    }
  }
};
</script>

<style lang="scss" scoped>
.year-shelf {
  width: 100%;
}

.year-shelf-card {
  border: 1px solid white;
  border-radius: 3px;
  color: white;
  overflow: hidden;
}

.year-shelf-title {
  background: var(--accent, #3b5aaa);
  color: var(--accent-text, white);
  border-bottom: 1px solid white;
  font-size: 0.8rem;
  margin: 0;
  padding: 2px 8px;
  text-align: center;
}

.year-shelf-caption,
.year-shelf-empty {
  color: #ccc;
  font-size: 0.72rem;
  margin: 0;
  padding: 0.4rem 0.6rem 0;
}

.year-shelf-empty {
  padding-bottom: 0.6rem;
}

.year-shelf-scroller {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0.6rem 0.6rem 0;
}

.year-shelf-chart {
  display: block;
}

.year-shelf-column {
  transition: opacity 0.15s;

  &.dimmed {
    opacity: 0.35;
  }
}

.year-shelf-hit {
  cursor: pointer;
  fill: transparent;
}

.year-shelf-baseline {
  stroke: #555;
  stroke-width: 1;
}

.year-shelf-decade-line {
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}

.year-shelf-decade-label {
  fill: #ccc;
  font-size: 11px;
}

.year-shelf-legend {
  align-items: center;
  color: #ccc;
  display: flex;
  font-size: 0.7rem;
  gap: 0.3rem;
  justify-content: center;
  padding: 0.3rem 0.6rem 0.4rem;
}

.year-shelf-swatch {
  border-radius: 2px;
  display: inline-block;
  height: 10px;
  width: 14px;
}

.year-shelf-detail {
  align-items: center;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  gap: 0.4rem;
  padding: 0.3rem 0.4rem;
}

.year-shelf-detail-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  text-align: center;
}

.year-shelf-detail-year {
  font-weight: 700;
}

.year-shelf-detail-top {
  color: #ccc;
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}

.year-shelf-step {
  background: none;
  border: 1px solid #3a3a3a;
  border-radius: 999px;
  color: white;
  flex: 0 0 auto;
  height: 40px;
  width: 40px;

  &:active {
    opacity: 0.6;
  }

  &:disabled {
    opacity: 0.3;
  }
}

/* Black on the tab accent is legible (the rainbow bar's rule). */
.year-shelf-search {
  background: var(--accent, #ffc107);
  border: none;
  color: #000;
  display: block;
  font-size: 0.8rem;
  font-weight: 700;
  min-height: 40px;
  width: 100%;

  &:active {
    opacity: 0.75;
  }
}
</style>
