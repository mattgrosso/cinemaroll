<template>
  <div class="box-office-years">
    <div class="box-office-card">
      <p class="box-office-title">Biggest box office years</p>
      <p class="box-office-caption">Release years ranked by the worldwide gross of the films you've rated from them. Tap a year to see its films.</p>
      <div class="dollar-toggle" role="group" aria-label="Which dollars to sum">
        <button type="button" class="dollar-option" :class="{ active: adjusted }" :aria-pressed="adjusted" @click="setAdjusted(true)">Today's dollars</button>
        <button type="button" class="dollar-option" :class="{ active: !adjusted }" :aria-pressed="!adjusted" @click="setAdjusted(false)">As released</button>
      </div>
      <p v-if="!years.length" class="box-office-empty">No box office figures yet — the Settings panel's backfill fetches them.</p>
      <ul v-else>
        <li v-for="(item, index) in years" :key="item.year" class="year-row" @click="$emit('updateSearchValue', String(item.year))">
          <span class="year-rank">{{ index + 1 }}</span>
          <span class="year-info">
            <span class="year-name">{{ item.year }}</span>
            <span class="year-top" v-if="item.top">{{ item.top.movie.title }} · {{ money(item.topGross) }}</span>
          </span>
          <span class="year-numbers">{{ money(item.total) }} <span class="year-count">· {{ item.count }} film{{ item.count === 1 ? '' : 's' }}</span></span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
// Sibling of YearlyAverage (best years by Log Score): same card, same rows,
// a different question — which years took the most money, counting only
// what's in this library. Math in boxOfficeYears.js.
import { boxOfficeByYear } from "../assets/javascript/boxOfficeYears.js";
import { formatMoneyShort } from "../assets/javascript/formatMoney.js";

// Which dollars the list was last read in. Persists like the Insights tab
// itself; today's dollars by default, because a sum across decades in
// as-released dollars is the misleading one (inflation.js).
const DOLLARS_KEY = 'cinemaRoll.insights.boxOfficeDollars';

export default {
  name: "BoxOfficeYears",
  props: {
    resultsWithRatings: {
      type: Array,
      required: true
    }
  },
  emits: ['updateSearchValue'],
  data () {
    let remembered = null;
    try {
      remembered = localStorage.getItem(DOLLARS_KEY);
    } catch {
      remembered = null;
    }
    return {
      adjusted: remembered !== 'released'
    };
  },
  computed: {
    years () {
      return boxOfficeByYear(this.resultsWithRatings, { adjusted: this.adjusted });
    }
  },
  methods: {
    money (value) {
      return formatMoneyShort(value, '—');
    },
    setAdjusted (adjusted) {
      this.adjusted = adjusted;
      try {
        localStorage.setItem(DOLLARS_KEY, adjusted ? 'today' : 'released');
      } catch {
        // Private mode, or storage full: the choice just doesn't persist.
      }
    }
  }
};
</script>

<style lang="scss" scoped>
/* Mirrors YearlyAverage.vue so the two year lists read as a pair. */
.box-office-years {
  width: 100%;
}

.box-office-card {
  border: 1px solid white;
  border-radius: 3px;
  color: white;
  overflow: hidden;

  .box-office-title {
    background: var(--accent, #3b5aaa);
    color: var(--accent-text, white);
    border-bottom: 1px solid white;
    font-size: 0.8rem;
    margin: 0;
    padding: 2px 8px;
    text-align: center;
  }

  .box-office-caption {
    color: #ccc;
    font-size: 0.72rem;
    margin: 0;
    padding: 0.4rem 0.6rem 0;
  }

  .box-office-empty {
    color: #ccc;
    font-size: 0.78rem;
    margin: 0;
    padding: 0.5rem 0.6rem 0.6rem;
  }

  .dollar-toggle {
    display: flex;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem 0.1rem;
  }

  .dollar-option {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    /* #ccc on the dark pane, ~6:1. */
    color: #ccc;
    flex: 1 1 0;
    font-size: 0.72rem;
    /* House minimum tap height. */
    min-height: 40px;
    padding: 0 0.6rem;

    &.active {
      background: rgba(255, 255, 255, 0.14);
      border-color: white;
      color: white;
      font-weight: 700;
    }

    /* Press feedback only — never :hover on a touch screen. */
    &:active {
      opacity: 0.6;
    }
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0.6rem 0.4rem;
    max-height: 15rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .year-row {
    align-items: baseline;
    border-top: 1px solid rgba(255, 255, 255, 0.15);
    cursor: pointer;
    display: flex;
    gap: 0.6rem;
    padding: 0.35rem 0;

    &:first-child {
      border-top: none;
    }

    &:active {
      opacity: 0.6;
    }
  }

  .year-rank {
    color: #9ec5fe;
    flex: 0 0 1.4em;
    font-size: 0.8rem;
    text-align: right;
  }

  .year-info {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  .year-name {
    font-weight: 700;
  }

  .year-top {
    color: #ccc;
    font-size: 0.72rem;
    overflow-wrap: anywhere;
  }

  .year-numbers {
    flex: 0 0 auto;
    font-weight: 700;
  }

  .year-count {
    color: #ccc;
    font-size: 0.75rem;
    font-weight: 400;
  }
}
</style>
