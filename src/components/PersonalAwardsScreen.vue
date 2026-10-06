<template>
  <div class="personal-awards-screen">
    <BackLink/>

    <!-- Year strip: the same control the home screen uses for years, down to
         the Bootstrap button classes. Just the years — no progress marks, no
         trophies ("we don't need anything. It can just be the years and
         buttons. That's all I need", 2026-08-16). -->
    <div v-if="awardsYears.length" ref="yearScroller" class="awards-year-scroller">
      <button
        v-for="year in awardsYears"
        :key="year"
        type="button"
        class="btn btn-sm awards-year-pill"
        :class="year === activeYear ? 'btn-primary selected' : 'btn-outline-secondary'"
        @click="selectYear(year)"
      >{{ year }}</button>
    </div>

    <PersonalAwardsModal
      :allEntriesWithFlatKeywordsAdded="allEntriesWithFlatKeywordsAdded"
      :personalAwardName="personalAwardName"
      :awardNameWithThe="awardNameWithTheLabel"
      :awardNameSingular="awardNameSingularLabel"
      :selectedYear="yearFromRoute"
      :autoOpen="true"
      :pageMode="true"
      @closed="leave"
      @yearChanged="activeYear = $event"
    />
  </div>
</template>

<script>
// The Personal Awards flow as a real page (feedback: the modal "always
// feels a little bit janky... maybe it would feel better if it was just a
// full page like we do for other things"). This also fixes the
// intermittent open-failure for good: Insights/MovieDetail used to write
// three settings flags via setDBValue — which never commits locally — then
// navigate Home and hope the Firebase echo arrived before the modal gate
// looked. Now the year rides in the URL (/awards?year=1997) and there is
// no handoff to race.
//
// The old AwardsResults browser used to sit below this — a year <select>
// plus a winners table, relocated here from Insights. It's gone: the page
// above it now IS the view of a year's awards, and the year strip replaces
// its dropdown ("I don't think we need that anymore. I think we've replaced
// it with what we're looking at now", 2026-08-16).
import PersonalAwardsModal from './PersonalAwardsModal.vue';
import BackLink from './games/BackLink.vue';
import { navigationTarget, followNavigationTarget } from '../utils/navigationTarget.js';
import {
  awardNameWithThe,
  awardNameSingular,
  awardsBrowsableYears
} from '../assets/javascript/personalAwards.js';

export default {
  name: 'PersonalAwardsScreen',
  components: { PersonalAwardsModal, BackLink },
  data () {
    return {
      // Mirrors whichever year the modal is actually showing, which is not
      // always the one in the URL: arriving at /awards with no year lets the
      // modal pick, and the strip has to highlight what you're looking at.
      activeYear: null
    };
  },
  computed: {
    yearFromRoute () {
      const year = Number(this.$route.query.year);
      return Number.isFinite(year) ? year : null;
    },
    awardsYears () {
      return awardsBrowsableYears(this.allEntriesWithFlatKeywordsAdded, this.$store.state.settings);
    },
    personalAwardName () {
      const value = this.$store.state.settings?.personalAwardName;
      return (typeof value === 'string' && value.length > 0) ? value : 'Oscar';
    },
    awardNameWithTheLabel () {
      return awardNameWithThe(this.personalAwardName);
    },
    awardNameSingularLabel () {
      return awardNameSingular(this.personalAwardName);
    },
    // Same movie-entry shape Home/Insights hand the awards component.
    allEntriesWithFlatKeywordsAdded () {
      return (this.$store.getters.allMoviesAsArray || []).map((result) => ({
        ...result,
        movie: {
          ...result.movie,
          flatKeywords: result.movie.keywords ? result.movie.keywords.map((keyword) => keyword.name) : []
        }
      }));
    }
  },
  watch: {
    activeYear () {
      this.$nextTick(() => this.centerYearPill());
    },
    awardsYears: {
      immediate: true,
      handler (years) {
        if (!years.length) return;
        // The library arrives after the first render, so on a cold load the
        // strip is empty and neither of these can happen yet.
        this.defaultToMostRecentYear(years);
        this.$nextTick(() => this.centerYearPill());
      }
    }
  },
  methods: {
    // Arriving with no year at all — the Awards card on Insights does exactly
    // that — used to leave the modal to pick, and its picker answers "which
    // year needs work", returning null once every year is finished. The page
    // then rendered with no year and no values in it at all (Matt, 2026-08-16:
    // "it just takes me to an empty Awards page, like all null values. It
    // should just default to the most recent year").
    //
    // The picker is left alone: null is the right answer to its own question,
    // which is what the home screen's "a year is ready" prompt asks.
    defaultToMostRecentYear (years) {
      if (this.yearFromRoute != null) return;
      this.$router.replace({ path: '/awards', query: { year: years[years.length - 1] } });
    },
    selectYear (year) {
      if (year === this.activeYear) return;
      // replace, not push: stepping through years shouldn't bury the way back.
      this.$router.replace({ path: '/awards', query: { year } });
    },
    // Positioned by hand rather than with scrollIntoView({ inline: 'center' }),
    // which left the last year clipped by ~26px when the page defaults to it —
    // the most common landing of all. Clamping to the scroll range centers
    // where it can and butts up against the end where it can't.
    centerYearPill () {
      const scroller = this.$refs.yearScroller;
      const pill = scroller?.querySelector('.awards-year-pill.selected');
      if (!scroller || !pill) return;

      const centered = pill.offsetLeft - (scroller.clientWidth - pill.offsetWidth) / 2;
      const furthest = scroller.scrollWidth - scroller.clientWidth;
      scroller.scrollLeft = Math.max(0, Math.min(centered, furthest));
    },
    leave () {
      // window.history.length counts entries from before this app was ever
      // opened, so it is not a reliable "is there anywhere to go back to".
      // history.state.back is, and it is the same rule BackLink follows.
      const target = navigationTarget({
        backPath: this.$router?.options?.history?.state?.back,
        currentPath: this.$route?.fullPath,
        parentPath: this.$route?.meta?.parent || '/',
        avoid: ['/login']
      });
      followNavigationTarget(this.$router, target);
    }
  }
};
</script>

<style scoped>
.personal-awards-screen {
  color: #eee;
  /* Side padding only. The old 2.5rem top "BackLink safety margin" was a
     misunderstanding: BackLink is position:absolute and floats over the
     global header banner, so the reserved space was pure dead air below
     the header image (feedback, twice). */
  padding: 0.75rem 1rem 2rem;
}

.awards-year-scroller {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.9rem;
  overflow-x: auto;
  padding: 0.15rem 0.1rem;
  -webkit-overflow-scrolling: touch;
}

.awards-year-pill {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Bootstrap's btn-outline-secondary paints its label #6c757d, which is the
   same ~2.6:1 against this background that makes .text-muted unreadable here.
   #ccc is the house replacement (~9:1). */
.awards-year-pill.btn-outline-secondary {
  border-color: #4a4a4a;
  color: #ccc;
}

/* Mobile-first: press feedback is :active only. A tapped pill would keep a
   hover state forever on an installed PWA. Same convention as the home
   screen's year scroller. */
.awards-year-pill:active {
  opacity: 0.7;
}
</style>
