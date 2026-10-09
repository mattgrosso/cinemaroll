<template>
  <div class="personal-awards-screen">
    <BackLink/>

    <!-- Ceremony strip (Matt, 2026-10-07): yours, then every friend who
         publishes awards, then the real ceremonies. Flip through "the
         history of any award that we have access to". -->
    <div v-if="tabs.length > 1" ref="tabScroller" class="ceremony-scroller">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="ceremony-tab"
        :class="{ on: tab.id === ceremonyId }"
        @click="selectCeremony(tab.id)"
      >{{ tab.label }}<span v-if="tab.who" class="ceremony-who">{{ tab.who }}</span></button>
    </div>

    <!-- Year strip: the same control the home screen uses for years, down to
         the Bootstrap button classes. Just the years — no progress marks, no
         trophies ("we don't need anything. It can just be the years and
         buttons. That's all I need", 2026-08-16). -->
    <div v-if="stripYears.length" ref="yearScroller" class="awards-year-scroller">
      <button
        v-for="year in stripYears"
        :key="year"
        type="button"
        class="btn btn-sm awards-year-pill"
        :class="year === stripActiveYear ? 'btn-primary selected' : 'btn-outline-secondary'"
        @click="selectYear(year)"
      >{{ year }}</button>
    </div>

    <template v-if="ceremonyId !== 'mine'">
      <div class="text-center board-header">
        <h2 class="mb-1">{{ boardYear }} {{ activeTab.label }}</h2>
        <p class="mb-0 board-caption">{{ boardCaption }}</p>
      </div>
      <AwardsBoard :categories="boardCategories" @pick="openMovie"/>
    </template>

    <PersonalAwardsModal
      v-else
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
import AwardsBoard from './AwardsBoard.vue';
import BackLink from './games/BackLink.vue';
import otherAwardsWinners from '../assets/data/otherAwardsWinners.json';
import {
  ceremonyTabs,
  boardFromEntries,
  entriesFromProfile,
  entriesFromAcademy,
  entriesFromOther,
  titleIndex,
  ACADEMY_BOARD_OPTIONS,
  OTHER_CEREMONIES
} from '../assets/javascript/ceremonies.js';
import { navigationTarget, followNavigationTarget } from '../utils/navigationTarget.js';
import {
  awardNameWithThe,
  awardNameSingular,
  awardsBrowsableYears
} from '../assets/javascript/personalAwards.js';

export default {
  name: 'PersonalAwardsScreen',
  components: { PersonalAwardsModal, AwardsBoard, BackLink },
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
    // --- the other ceremonies ------------------------------------------------
    // `mine` is the default and has no query param, so every existing link to
    // /awards?year=1997 still lands on your own awards. The friends' tabs are
    // keyed by the club key the Film Club screen uses; the real ceremonies by
    // short stable ids.
    ceremonyId () {
      const id = this.$route.query.ceremony;
      return typeof id === 'string' && this.tabs.some((tab) => tab.id === id) ? id : 'mine';
    },
    friends () {
      return (this.$store.getters.filmClubFriends || []).filter((friend) => friend.profile);
    },
    tabs () {
      return ceremonyTabs({ mine: this.awardNameWithTheLabel, friends: this.friends });
    },
    activeTab () {
      return this.tabs.find((tab) => tab.id === this.ceremonyId) || this.tabs[0];
    },
    // Built only for the tab you are looking at: the Oscars board walks ~11k
    // records and the title index every library in the club.
    board () {
      const id = this.ceremonyId;
      if (id === 'mine') return [];
      if (id.startsWith('friend:')) {
        const tab = this.activeTab;
        const friend = this.friends.find((f) => f.key === tab?.friendKey);
        return boardFromEntries(entriesFromProfile(friend?.profile, { ceremony: tab?.ceremony, fallbackName: friend?.name }));
      }
      if (id === 'oscars') return boardFromEntries(entriesFromAcademy(this.$store.state.allAcademyAwards), ACADEMY_BOARD_OPTIONS);
      const other = OTHER_CEREMONIES.find((c) => c.id === id);
      if (!other) return [];
      const index = titleIndex({ library: this.$store.getters.allMoviesAsArray || [], profiles: this.friends.map((f) => f.profile) });
      return boardFromEntries(entriesFromOther(otherAwardsWinners, other.ceremony, index));
    },
    boardYears () {
      return this.board.map((entry) => entry.year).sort((a, b) => a - b);
    },
    boardYear () {
      if (this.yearFromRoute != null && this.boardYears.includes(this.yearFromRoute)) return this.yearFromRoute;
      return this.boardYears[this.boardYears.length - 1] ?? null;
    },
    boardCategories () {
      return this.board.find((entry) => entry.year === this.boardYear)?.categories || [];
    },
    boardCaption () {
      if (this.activeTab?.who) return `${this.activeTab.who}'s own annual awards`;
      if (this.ceremonyId === 'oscars') {
        const ceremony = this.board.find((entry) => entry.year === this.boardYear)?.meta?.ceremony;
        return ceremony ? `${ceremony} · films of ${this.boardYear}` : 'Every winner and nominee, from the first ceremony';
      }
      return this.board.some((entry) => entry.categories.some((c) => c.nominees.length)) ? 'Winners and nominees' : 'Winners';
    },
    // The one strip serves both views.
    stripYears () {
      return this.ceremonyId === 'mine' ? this.awardsYears : this.boardYears;
    },
    stripActiveYear () {
      return this.ceremonyId === 'mine' ? this.activeYear : this.boardYear;
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
    stripActiveYear () {
      this.$nextTick(() => this.centerYearPill());
    },
    ceremonyId: {
      immediate: true,
      handler () {
        this.$nextTick(() => { this.centerYearPill(); this.centerTab(); });
      }
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
  mounted () {
    // Friends' awards ride on their profiles; a cold load straight onto this
    // page needs them fetched, as Home does.
    this.$store.dispatch?.('fetchFriendProfiles');
    this.$store.dispatch?.('syncExternalFriends');
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
      if (this.yearFromRoute != null || this.ceremonyId !== 'mine') return;
      this.$router.replace({ path: '/awards', query: { year: years[years.length - 1] } });
    },
    query (changes) {
      const query = { ...this.$route.query, ...changes };
      Object.keys(query).forEach((key) => { if (query[key] == null) delete query[key]; });
      return query;
    },
    selectYear (year) {
      if (year === this.stripActiveYear) return;
      // replace, not push: stepping through years shouldn't bury the way back.
      this.$router.replace({ path: '/awards', query: this.query({ year }) });
    },
    // Switching ceremony keeps the year (Matt, 2026-10-08: "if I select a
    // year, and then I switch to a different award... I want to maintain the
    // year"). A board without it shows its newest, but the URL keeps the one
    // you picked, so the next tab that has it lands on it. Your own awards
    // are the exception: an off-list year there would leave the page empty,
    // so it lands on your newest instead.
    selectCeremony (id) {
      if (id === this.ceremonyId) return;
      let year = this.yearFromRoute ?? this.stripActiveYear ?? null;
      if (id === 'mine' && year != null && !this.awardsYears.includes(year)) {
        year = this.awardsYears[this.awardsYears.length - 1] ?? null;
      }
      this.$router.replace({ path: '/awards', query: this.query({ ceremony: id === 'mine' ? null : id, year }) });
    },
    openMovie (pick) {
      if (pick?.movieId) this.$router.push(`/movie/${pick.movieId}`);
    },
    centerTab () {
      const scroller = this.$refs.tabScroller;
      const tab = scroller?.querySelector('.ceremony-tab.on');
      if (!scroller || !tab) return;
      const centered = tab.offsetLeft - (scroller.clientWidth - tab.offsetWidth) / 2;
      scroller.scrollLeft = Math.max(0, Math.min(centered, scroller.scrollWidth - scroller.clientWidth));
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
.ceremony-scroller {
  display: flex;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
  overflow-x: auto;
  padding: 0.15rem 0.1rem;
  -webkit-overflow-scrolling: touch;
}

.ceremony-tab {
  background: rgba(255, 255, 255, 0.08);
  border: 0;
  border-radius: 999px;
  color: #eee;
  flex-shrink: 0;
  font-size: 0.82rem;
  padding: 0.3rem 0.8rem;
  white-space: nowrap;
}

.ceremony-tab.on {
  background: #ffc107;
  color: #000;
  font-weight: 700;
}

.ceremony-tab:active {
  opacity: 0.7;
}

.ceremony-who {
  font-size: 0.68rem;
  font-weight: 400;
  margin-left: 0.35rem;
  opacity: 0.75;
}

.board-header {
  margin: 0.4rem 0 1rem;
}

.board-header h2 {
  font-size: 1.5rem;
}

.board-caption {
  color: #ccc;
  font-size: 0.9rem;
}

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
