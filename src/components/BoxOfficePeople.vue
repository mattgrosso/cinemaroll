<template>
  <div class="box-office-people">
    <div class="box-office-card">
      <p class="box-office-title">Highest grossing people</p>
      <p class="box-office-caption">People ranked by the worldwide gross of your films they made. Performers count their top-billed roles only. Tap a name to see their films.</p>
      <div class="role-row" role="group" aria-label="Which role to rank">
        <button v-for="option in roles" :key="option.key" type="button" class="role-option" :class="{ active: option.key === role }" :aria-pressed="option.key === role" @click="setRole(option.key)">{{ option.label }}</button>
      </div>
      <div class="dollar-toggle" role="group" aria-label="Which dollars to sum">
        <button type="button" class="dollar-option" :class="{ active: adjusted }" :aria-pressed="adjusted" @click="setAdjusted(true)">Today's dollars</button>
        <button type="button" class="dollar-option" :class="{ active: !adjusted }" :aria-pressed="!adjusted" @click="setAdjusted(false)">As released</button>
      </div>
      <p v-if="!people.length" class="box-office-empty">No box office figures yet — the Settings panel's backfill fetches them.</p>
      <ul v-else>
        <li v-for="(item, index) in people" :key="item.name" class="person-row" @click="$emit('updateSearchValue', item.name)">
          <span class="person-rank">{{ index + 1 }}</span>
          <span class="person-info">
            <span class="person-name">{{ item.name }}</span>
            <span class="person-top" v-if="item.top">{{ item.top.movie.title }} · {{ money(item.topGross) }}</span>
          </span>
          <span class="person-numbers">{{ money(item.total) }} <span class="person-count">· {{ item.count }} film{{ item.count === 1 ? '' : 's' }}</span></span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script>
// Sibling of BoxOfficeYears: same card, same rows, the people instead of
// the years — "highest grossing directors and highest grossing performers,
// and maybe even crew" (bug report, 2026-09-15). Math in boxOfficePeople.js.
import { boxOfficeByPerson, ROLES } from "../assets/javascript/boxOfficePeople.js";
import { formatMoneyShort } from "../assets/javascript/formatMoney.js";

// Same key BoxOfficeYears reads, so the two cards open in the same dollars.
const DOLLARS_KEY = 'cinemaRoll.insights.boxOfficeDollars';
const ROLE_KEY = 'cinemaRoll.insights.boxOfficeRole';

const remember = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

export default {
  name: "BoxOfficePeople",
  props: {
    resultsWithRatings: {
      type: Array,
      required: true
    }
  },
  emits: ['updateSearchValue'],
  data () {
    const rememberedRole = remember(ROLE_KEY);
    return {
      roles: ROLES,
      role: ROLES.some((option) => option.key === rememberedRole) ? rememberedRole : ROLES[0].key,
      adjusted: remember(DOLLARS_KEY) !== 'released'
    };
  },
  computed: {
    people () {
      return boxOfficeByPerson(this.resultsWithRatings, { role: this.role, adjusted: this.adjusted })
        .slice(0, 25);
    }
  },
  methods: {
    money (value) {
      return formatMoneyShort(value, '—');
    },
    setRole (role) {
      this.role = role;
      try {
        localStorage.setItem(ROLE_KEY, role);
      } catch {
        // Private mode, or storage full: the choice just doesn't persist.
      }
    },
    setAdjusted (adjusted) {
      this.adjusted = adjusted;
      try {
        localStorage.setItem(DOLLARS_KEY, adjusted ? 'today' : 'released');
      } catch {
        // Same.
      }
    }
  }
};
</script>

<style lang="scss" scoped>
/* Mirrors BoxOfficeYears.vue so the two money lists read as a pair. */
.box-office-people {
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

  /* One sideways row of roles; it scrolls rather than wrapping into a
     three-line block on a phone. */
  .role-row {
    display: flex;
    gap: 0.4rem;
    overflow-x: auto;
    padding: 0.45rem 0.6rem 0;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
    }
  }

  .role-option,
  .dollar-option {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 999px;
    /* #ccc on the dark pane, ~6:1. */
    color: #ccc;
    font-size: 0.72rem;
    /* House minimum tap height. */
    min-height: 40px;
    padding: 0 0.6rem;
    white-space: nowrap;

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

  .role-option {
    flex: 0 0 auto;
  }

  .dollar-toggle {
    display: flex;
    gap: 0.4rem;
    padding: 0.45rem 0.6rem 0.1rem;
  }

  .dollar-option {
    flex: 1 1 0;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.25rem 0.6rem 0.4rem;
    max-height: 15rem;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }

  .person-row {
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

  .person-rank {
    color: #9ec5fe;
    flex: 0 0 1.4em;
    font-size: 0.8rem;
    text-align: right;
  }

  .person-info {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
  }

  .person-name {
    font-weight: 700;
  }

  .person-top {
    color: #ccc;
    font-size: 0.72rem;
    overflow-wrap: anywhere;
  }

  .person-numbers {
    flex: 0 0 auto;
    font-weight: 700;
  }

  .person-count {
    color: #ccc;
    font-size: 0.75rem;
    font-weight: 400;
  }
}
</style>
