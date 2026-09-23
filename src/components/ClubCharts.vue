<template>
  <div class="club-charts">
    <BackLink/>

    <h1 class="cc-title">Club Charts</h1>
    <p class="cc-subtitle">Where your taste and everyone else's actually meet.</p>

    <!-- Gate on the roster, not on the current selection: deselecting every
         friend must never swallow the picker you'd need to undo it. -->
    <p v-if="!legend || legend.length < 2" class="cc-empty">
      Nothing to chart yet — these all need a friend with a published profile.
    </p>

    <template v-else>
      <!-- Who is who — and who is IN. The key doubles as the page-wide
           people picker (Matt, 2026-08-21: "let's pour a similar amount of
           customizability to the other charts in club charts"): tap a person
           to drop them from every chart below; tap again to bring them back.
           Everyone starts included. -->
      <div class="cc-key">
        <button
          v-for="member in legend"
          :key="member.key"
          type="button"
          class="cc-key-item"
          :class="{ excluded: !isSelected(member.key) }"
          @click="toggleMember(member.key)"
        >
          <span class="cc-swatch" :style="{ background: member.color }"></span>{{ member.name }}
        </button>
      </div>

      <!-- THE VENN — first, because every region is tappable and it's the
           chart people play with. -->
      <section class="cc-section">
        <h2 class="cc-section-title">The Venn</h2>
        <p class="cc-caption">
          Circles are libraries under the chosen lens; every region is a real list of films. Tap one.
        </p>
        <ClubVenn :selection="selectedKeys"/>
      </section>

      <!-- THE TASTE MAP -->
      <section v-if="map.length" class="cc-section">
        <h2 class="cc-section-title">The Taste Map</h2>
        <p class="cc-caption">
          Everyone placed by what they gave the films you've both seen, against what you gave them.
          The line is perfect agreement: above it they run hotter than you, below it cooler.
          Both axes are zoomed to the scores actually in play, so the dots spread out.
        </p>

        <div class="cc-scatter">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="cc-scatter-svg">
            <line x1="0" y1="100" x2="100" y2="0" class="cc-diagonal"/>
          </svg>
          <span class="cc-scatter-domain">{{ formatScore(mapDomain.min) }}–{{ formatScore(mapDomain.max) }}</span>
          <div
            v-for="point in map"
            :key="point.key"
            class="cc-point"
            :style="pointStyle(point)"
            :title="`${point.name}: you ${point.mine}, them ${point.theirs}, ${point.shared} shared`"
          >
            <span class="cc-point-label">{{ point.name }}</span>
          </div>
          <span class="cc-axis cc-axis-x">your score →</span>
          <span class="cc-axis cc-axis-y">&uarr; their score</span>
        </div>

        <ul class="cc-readout">
          <li v-for="point in map" :key="`r-${point.key}`">
            <span class="cc-swatch" :style="{ background: colorFor(point.key) }"></span>
            <strong>{{ point.name }}</strong>
            {{ leanPhrase(point) }} · {{ point.shared }} shared · {{ formatScore(point.alignment) }} aligned
          </li>
        </ul>
      </section>

      <!-- OVERLAP -->
      <section v-if="bars.length" class="cc-section">
        <h2 class="cc-section-title">How Much You Share</h2>
        <p class="cc-caption">
          Of everything each person has rated, how much you've seen too — and how much of their
          library is still waiting for you.
        </p>
        <div v-for="bar in bars" :key="bar.key" class="cc-overlap">
          <div class="cc-overlap-head">
            <span><span class="cc-swatch" :style="{ background: colorFor(bar.key) }"></span>{{ bar.name }}</span>
            <span class="cc-overlap-figure">{{ bar.coverage }}% of theirs</span>
          </div>
          <div class="cc-stack">
            <div class="cc-stack-shared" :style="{ width: sharePercent(bar.shared, bar) }"></div>
            <div class="cc-stack-theirs" :style="{ width: sharePercent(bar.onlyThem, bar), background: colorFor(bar.key) }"></div>
          </div>
          <p class="cc-overlap-line">
            <strong>{{ bar.shared }}</strong> together ·
            <strong>{{ bar.onlyThem }}</strong> only they've seen ·
            <strong>{{ bar.onlyYou }}</strong> only you have
          </p>
        </div>
      </section>

      <!-- AGREEMENT BY DECADE / GENRE -->
      <section v-if="byDecade.length || byGenre.length" class="cc-section">
        <h2 class="cc-section-title">Where You Agree</h2>
        <p class="cc-caption">
          Alignment is 10 minus how far apart your scores sit on average. Cut by decade and by
          genre, across the films you've both rated.
        </p>

        <p class="cc-scale-note">Bars are scaled to {{ formatScore(sliceDomain.min) }}–{{ formatScore(sliceDomain.max) }}, the range actually in play.</p>

        <div v-if="byDecade.length" class="cc-slice">
          <h3 class="cc-slice-title">By decade</h3>
          <div class="cc-slice-rows">
            <div v-for="row in byDecade" :key="`d-${row.value}`" class="cc-slice-row">
              <span class="cc-slice-label">{{ row.label }}</span>
              <div class="cc-slice-bars">
                <div
                  v-for="friend in row.friends"
                  :key="`d-${row.value}-${friend.key}`"
                  class="cc-slice-bar"
                  :style="{ width: sliceWidth(friend.alignment), background: colorFor(friend.key) }"
                  :title="`${friend.name}: ${friend.alignment} over ${friend.films} films`"
                >
                  <span class="cc-slice-who">{{ friend.name }}</span>
                  <span class="cc-slice-value">{{ formatScore(friend.alignment) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="byGenre.length" class="cc-slice">
          <h3 class="cc-slice-title">By genre</h3>
          <div class="cc-slice-rows">
            <div v-for="row in byGenre" :key="`g-${row.value}`" class="cc-slice-row">
              <span class="cc-slice-label">{{ row.label }}</span>
              <div class="cc-slice-bars">
                <div
                  v-for="friend in row.friends"
                  :key="`g-${row.value}-${friend.key}`"
                  class="cc-slice-bar"
                  :style="{ width: sliceWidth(friend.alignment), background: colorFor(friend.key) }"
                  :title="`${friend.name}: ${friend.alignment} over ${friend.films} films`"
                >
                  <span class="cc-slice-who">{{ friend.name }}</span>
                  <span class="cc-slice-value">{{ formatScore(friend.alignment) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- GENEROSITY -->
      <section v-if="curves.length > 1" class="cc-section">
        <h2 class="cc-section-title">Who's Generous</h2>
        <p class="cc-caption">
          Everyone's whole rating history, shaped. A curve leaning right hands out nines; one
          bunched left has never once been impressed.
        </p>
        <div v-for="curve in curves" :key="curve.key" class="cc-curve">
          <div class="cc-curve-head">
            <span><span class="cc-swatch" :style="{ background: colorFor(curve.key) }"></span>{{ curve.name }}</span>
            <span class="cc-curve-figure">avg {{ curve.average.toFixed(2) }}</span>
          </div>
          <div class="cc-histogram">
            <div v-for="(count, score) in curve.buckets" :key="`${curve.key}-${score}`" class="cc-hist-col">
              <div class="cc-hist-track">
                <div
                  class="cc-hist-fill"
                  :style="{ height: histHeight(count, curve), background: colorFor(curve.key) }"
                ></div>
              </div>
              <span class="cc-hist-label">{{ score }}</span>
            </div>
          </div>
        </div>
      </section>

      <!-- CONTRARIANS -->
      <section v-if="outliers.board.length" class="cc-section">
        <h2 class="cc-section-title">The Contrarian Scoreboard</h2>
        <p class="cc-caption">
          Across every film three or more of you have rated, how often each person is the one
          furthest from the group.
        </p>
        <div v-for="row in outliers.board" :key="`c-${row.key}`" class="cc-board-row">
          <span class="cc-board-name">
            <span class="cc-swatch" :style="{ background: colorFor(row.key) }"></span>
            <span class="cc-board-label">{{ row.name }}</span>
          </span>
          <div class="cc-board-track">
            <div class="cc-board-fill" :style="{ width: `${row.rate}%`, background: colorFor(row.key) }"></div>
          </div>
          <span class="cc-board-rate">{{ row.rate }}%</span>
        </div>

        <h3 v-if="outliers.moments.length" class="cc-slice-title">Furthest apart</h3>
        <div v-if="outliers.moments.length" class="cc-poster-row">
          <div
            v-for="moment in outliers.moments"
            :key="`m-${moment.id}`"
            class="cc-poster-card"
            role="button"
            :aria-label="moment.title"
            @click="openMovie(moment.id)"
          >
            <img v-if="moment.poster" :src="poster(moment.poster)" :alt="moment.title" class="cc-poster">
            <div v-else class="cc-poster cc-poster-blank">{{ moment.title }}</div>
            <span class="cc-poster-note" :style="{ color: colorFor(moment.whoKey) }">{{ moment.who }} {{ formatScore(moment.score) }}</span>
            <span class="cc-poster-sub">club {{ formatScore(moment.groupAverage) }}</span>
          </div>
        </div>
      </section>

      <!-- SYNC MOMENTS -->
      <section v-if="syncs.length" class="cc-section">
        <h2 class="cc-section-title">Watched at the Same Time</h2>
        <p class="cc-caption">Films you and someone else landed on within a week of each other, unplanned.</p>
        <div class="cc-poster-row">
          <div
            v-for="moment in syncs"
            :key="`s-${moment.key}-${moment.id}`"
            class="cc-poster-card"
            role="button"
            :aria-label="moment.title"
            @click="openMovie(moment.id)"
          >
            <img v-if="moment.poster" :src="poster(moment.poster)" :alt="moment.title" class="cc-poster">
            <div v-else class="cc-poster cc-poster-blank">{{ moment.title }}</div>
            <span class="cc-poster-note" :style="{ color: colorFor(moment.key) }">{{ moment.name }}</span>
            <span class="cc-poster-sub">{{ apartPhrase(moment.apart) }}</span>
          </div>
        </div>
      </section>

      <!-- ACTIVITY -->
      <section v-if="activity.series.length" class="cc-section">
        <h2 class="cc-section-title">Who's Been Watching</h2>
        <p class="cc-caption">Viewings a month across the club, over the last year.</p>
        <div class="cc-activity">
          <div v-for="(month, index) in activity.months" :key="`${month.year}-${month.month}`" class="cc-activity-col">
            <div class="cc-activity-stack">
              <div
                v-for="row in activity.series"
                :key="`${row.key}-${index}`"
                class="cc-activity-seg"
                :style="{
                  height: activityHeight(row.counts[index]),
                  background: colorFor(row.key)
                }"
                :title="`${row.name}: ${row.counts[index]} in ${month.label}`"
              ></div>
            </div>
            <span class="cc-activity-label">{{ month.label }}</span>
          </div>
        </div>
      </section>

      <!-- BLIND SPOTS -->
      <section v-if="spots.length" class="cc-section">
        <h2 class="cc-section-title">Your Blind Spots</h2>
        <p class="cc-caption">The club's shared canon, minus you — rated by two or more friends and never by you.</p>
        <div class="cc-poster-row">
          <div v-for="spot in spots" :key="`b-${spot.id}`" class="cc-poster-card">
            <div class="cc-poster-frame">
              <img v-if="spot.poster" :src="poster(spot.poster)" :alt="spot.title" class="cc-poster">
              <div v-else class="cc-poster cc-poster-blank">{{ spot.title }}</div>
              <SendToHat
                class="cc-poster-hat"
                variant="icon"
                :movies="hatMovieFor(spot)"
                :note="`A club blind spot — ${spot.friends} friends rated it ${formatScore(spot.average)}`"
              />
            </div>
            <span class="cc-poster-note">{{ formatScore(spot.average) }}</span>
            <span class="cc-poster-sub">{{ spot.friends }} friends</span>
          </div>
        </div>
      </section>

      <!-- CRITERION RADAR -->
      <section v-if="radar" class="cc-section">
        <h2 class="cc-section-title">Where the Disagreement Lives</h2>
        <p class="cc-caption">
          For friends who share their breakdown: which of the eight criteria you actually differ on.
        </p>
        <div v-for="row in radar" :key="`rad-${row.key}`" class="cc-radar">
          <div class="cc-curve-head">
            <span><span class="cc-swatch" :style="{ background: colorFor(row.key) }"></span>{{ row.name }}</span>
            <span class="cc-curve-figure">{{ row.films }} films</span>
          </div>
          <div v-for="axis in row.axes" :key="`${row.key}-${axis.label}`" class="cc-axis-row">
            <span class="cc-axis-label">{{ axis.label }}</span>
            <div class="cc-axis-track">
              <div class="cc-axis-mine" :style="{ width: axisWidth(axis.mine) }"></div>
              <div class="cc-axis-theirs" :style="{ width: axisWidth(axis.theirs), background: colorFor(row.key) }"></div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import { memoByIdentity } from '../utils/memoByIdentity.js';
import SendToHat from './SendToHat.vue';
import ClubVenn from './ClubVenn.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { CRITERIA } from '../assets/javascript/social.js';
import { formatScore, formatScoreGap } from '../assets/javascript/formatScore.js';
import {
  memberColors,
  YOU_COLOR,
  buildOverlaps,
  tasteMap,
  overlapBars,
  agreementByDecade,
  agreementByGenre,
  generosityCurves,
  contrarians,
  blindSpots,
  syncMoments,
  clubActivity,
  criterionRadar
} from '../assets/javascript/clubCharts.js';

// The one join every chart reads, ~290ms at desktop speed on each open
// (2026-09-23 speed sweep); pure in (my library, the active profiles).
const joinedMemo = memoByIdentity((entries, profiles) => buildOverlaps(entries, getRating, profiles));

export default {
  name: 'ClubCharts',
  components: { BackLink, SendToHat, ClubVenn },
  data () {
    return {
      // Ordered picker state: 'you' plus friend keys, in pick order (the
      // Venn draws the first three). Seeded to everyone once profiles load.
      selectedKeys: [],
      seeded: false
    };
  },
  computed: {
    myEntries () {
      return this.$store.getters.allMoviesAsArray || [];
    },
    profiles () {
      return this.$store.getters.filmClubProfiles || {};
    },
    // What the picker admits: every chart below sees only these friends.
    // Colours stay keyed on the FULL roster, so nobody changes colour by
    // being toggled.
    activeProfiles () {
      const active = {};
      Object.entries(this.profiles).forEach(([key, profile]) => {
        if (this.selectedKeys.includes(key)) active[key] = profile;
      });
      return active;
    },
    // One join, shared by nearly every chart on the page.
    joined () {
      return joinedMemo(this.myEntries, this.activeProfiles);
    },
    overlaps () {
      return this.joined.overlaps;
    },
    colors () {
      return memberColors(Object.keys(this.profiles));
    },
    // The full roster, whether currently included or not — an excluded
    // member has to stay visible to be brought back.
    legend () {
      return [
        { key: 'you', name: 'You', color: YOU_COLOR },
        ...Object.entries(this.profiles).map(([key, profile]) => ({
          key,
          name: profile?.name || 'A Cinema Roll user',
          color: this.colorFor(key)
        }))
      ];
    },
    map () {
      return tasteMap(this.overlaps);
    },
    bars () {
      return overlapBars(this.overlaps, this.myEntries.length);
    },
    byDecade () {
      return agreementByDecade(this.overlaps);
    },
    byGenre () {
      return agreementByGenre(this.overlaps);
    },
    curves () {
      return generosityCurves(this.myEntries, getRating, this.activeProfiles);
    },
    outliers () {
      return contrarians(this.myEntries, getRating, this.activeProfiles);
    },
    spots () {
      return blindSpots(this.myEntries, getRating, this.activeProfiles);
    },
    syncs () {
      return syncMoments(this.overlaps);
    },
    activity () {
      return clubActivity(this.myEntries, getRating, this.activeProfiles);
    },
    radar () {
      return criterionRadar(this.overlaps, CRITERIA);
    },
    mapDomain () {
      const values = this.map.flatMap((point) => [point.mine, point.theirs]);
      if (!values.length) return { min: 0, max: 10 };

      const low = Math.min(...values);
      const high = Math.max(...values);
      // A floor on the span keeps a single point (or a very tight club) off
      // the walls, and the padding stops any dot sitting exactly on an edge.
      const span = Math.max(high - low, 1.5);
      const mid = (low + high) / 2;
      return {
        min: Math.max(0, mid - span * 0.85),
        max: Math.min(10, mid + span * 0.85)
      };
    },
    sliceDomain () {
      const values = [...this.byDecade, ...this.byGenre]
        .flatMap((row) => row.friends.map((friend) => friend.alignment));
      if (!values.length) return { min: 0, max: 10 };
      return { min: Math.min(...values), max: Math.max(...values) };
    }
  },
  watch: {
    // Profiles arrive async; include everyone once, then never fight the
    // user's own picks. A friend who publishes later joins the roster but
    // not the selection — showing up mid-look would reshuffle every chart.
    profiles: {
      immediate: true,
      handler (profiles) {
        if (this.seeded || !Object.keys(profiles).length) return;
        this.seeded = true;
        this.selectedKeys = ['you', ...Object.keys(profiles)];
      }
    }
  },
  created () {
    // Reachable directly, so it can't assume the Film Club screen ran first.
    this.$store.dispatch('attachSocialListeners');
    this.$store.dispatch('fetchFriendProfiles');
  },
  methods: {
    // Template-exposed; two decimals on every score (bug report).
    formatScore,
    formatScoreGap,
    isSelected (key) {
      return this.selectedKeys.includes(key);
    },
    // Ordered toggle: re-including someone puts them at the END of the pick
    // order, which is what feeds the Venn its first-three.
    toggleMember (key) {
      const index = this.selectedKeys.indexOf(key);
      if (index >= 0) this.selectedKeys.splice(index, 1);
      else this.selectedKeys.push(key);
    },
    colorFor (key) {
      return key === 'you' ? YOU_COLOR : (this.colors[key] || '#9a9a9a');
    },
    poster (path) {
      return `https://image.tmdb.org/t/p/w185${path}`;
    },
    openMovie (id) {
      // Same rule as the Film Club feed: MovieDetail is a local lookup, so
      // don't send anyone to an empty page.
      if (!this.joined.mine.has(id)) return;
      this.$router.push(`/movie/${id}`);
    },
    hatMovieFor (spot) {
      return { id: spot.id, title: spot.title, poster_path: spot.poster, release_date: '', overview: '' };
    },
    // Scores run 0-10 on both axes; y is inverted because SVG counts down.
    // "We should try to adjust the scale of it so it zooms in on the relevant
    // data... I just want you to zoom in on the data." (2026-08-17) Averages
    // cluster hard around the middle of a 0-10 grid, so at full scale every
    // dot sat in the same square inch.
    //
    // ONE domain drives BOTH axes on purpose: the diagonal is the line y = x,
    // and it only stays corner-to-corner while the axes match. Zooming them
    // independently would leave the "perfect agreement" line lying about
    // where perfect agreement is.
    pointStyle (point) {
      const { min, max } = this.mapDomain;
      const span = max - min;
      return {
        left: `${((point.mine - min) / span) * 100}%`,
        bottom: `${((point.theirs - min) / span) * 100}%`,
        background: this.colorFor(point.key)
      };
    },
    leanPhrase (point) {
      if (Math.abs(point.lean) < 0.25) return 'rates them just like you';
      const amount = formatScoreGap(point.lean);
      return point.lean > 0 ? `runs ${amount} hotter` : `runs ${amount} cooler`;
    },
    apartPhrase (days) {
      if (days === 0) return 'same day';
      return `${days} ${days === 1 ? 'day' : 'days'} apart`;
    },
    // Alignment lands in a narrow band near the top of the 0-10 scale - on a
    // real club every bar came out between 8.6 and 9.7, which rendered as ten
    // identical bars saying nothing. Scaled to the range actually present, with
    // the true figure on every bar and the domain stated above them.
    sliceWidth (value) {
      const { min, max } = this.sliceDomain;
      if (max <= min) return '100%';
      return `${12 + ((value - min) / (max - min)) * 88}%`;
    },
    sharePercent (value, bar) {
      const total = bar.shared + bar.onlyThem;
      return total ? `${(value / total) * 100}%` : '0%';
    },
    histHeight (count, curve) {
      return `${Math.max(2, (count / Math.max(1, curve.peak)) * 100)}%`;
    },
    activityHeight (count) {
      return `${(count / Math.max(1, this.activity.peak)) * 100}%`;
    },
    axisWidth (value) {
      // Love and stickiness top out at 5, the rest at 10 — normalising to the
      // larger keeps every row on one scale rather than silently rescaling.
      return value == null ? '0%' : `${Math.min(100, (value / 10) * 100)}%`;
    }
  }
};
</script>

<style lang="scss" scoped>
.club-charts {
  color: #eee;
  padding: 0.75rem 1rem 3rem;
}

.cc-title { margin: 0.25rem 0 0; }
.cc-subtitle { color: #ccc; font-size: 0.85rem; margin: 0.25rem 0 1rem; }
.cc-empty { color: #ccc; padding: 2rem 0; text-align: center; }

.cc-key {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

/* The key rows are the picker now: buttons, 40px targets, and an excluded
   member reads as switched off — dimmed and struck through, still tappable. */
.cc-key-item {
  align-items: center;
  background: transparent;
  border: none;
  color: #ccc;
  display: flex;
  font-size: 0.75rem;
  min-height: 40px;
  padding: 0 0.25rem;

  &:active { opacity: 0.7; }

  &.excluded {
    opacity: 0.45;
    text-decoration: line-through;
  }
}

.cc-swatch {
  border-radius: 50%;
  display: inline-block;
  height: 9px;
  margin-right: 0.35rem;
  width: 9px;
}

.cc-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 1rem;
  padding: 0.9rem 1rem;
}

.cc-section-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.25rem; }
.cc-caption { color: #ccc; font-size: 0.78rem; margin: 0 0 0.9rem; }
.cc-scale-note { color: #7a7a7a; font-size: 0.68rem; margin: 0 0 0.5rem; }
.cc-slice-title { color: #b9b9b9; font-size: 0.7rem; letter-spacing: 0.08em; margin: 0.9rem 0 0.4rem; text-transform: uppercase; }

/* Taste map */
.cc-scatter {
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  height: 220px;
  margin-bottom: 0.6rem;
  position: relative;
}

.cc-scatter-svg { height: 100%; position: absolute; width: 100%; }
.cc-scatter-domain { bottom: 3px; color: #5f5f5f; font-size: 0.55rem; left: 6px; position: absolute; }
.cc-diagonal { stroke: #3a3a3a; stroke-dasharray: 3 3; stroke-width: 0.5; }

.cc-point {
  border-radius: 50%;
  height: 12px;
  margin: 0 0 -6px -6px;
  position: absolute;
  width: 12px;
}

.cc-point-label {
  color: #eee;
  font-size: 0.62rem;
  left: 14px;
  position: absolute;
  top: -3px;
  white-space: nowrap;
}

.cc-axis { color: #7a7a7a; font-size: 0.6rem; position: absolute; }
.cc-axis-x { bottom: 3px; right: 6px; }
.cc-axis-y { left: 6px; top: 6px; transform-origin: left top; }

.cc-readout { list-style: none; margin: 0; padding: 0; }
.cc-readout li { color: #b9b9b9; font-size: 0.75rem; padding: 0.15rem 0; }
.cc-readout strong { color: #eee; }

/* Overlap */
.cc-overlap { margin-bottom: 0.9rem; }
.cc-overlap:last-child { margin-bottom: 0; }

.cc-overlap-head {
  align-items: baseline;
  color: #eee;
  display: flex;
  font-size: 0.85rem;
  justify-content: space-between;
}

.cc-overlap-figure { color: #b9b9b9; font-size: 0.72rem; }

.cc-stack {
  background: #101010;
  border-radius: 999px;
  display: flex;
  height: 12px;
  margin: 0.3rem 0 0.25rem;
  overflow: hidden;
}

.cc-stack-shared { background: #f0f0f0; }
.cc-overlap-line { color: #b9b9b9; font-size: 0.7rem; margin: 0; }
.cc-overlap-line strong { color: #eee; }

/* Agreement slices */
.cc-slice-rows { display: flex; flex-direction: column; gap: 0.4rem; }
.cc-slice-row { align-items: center; display: flex; gap: 0.5rem; }
.cc-slice-label { color: #b9b9b9; flex: 0 0 74px; font-size: 0.68rem; line-height: 1.15; }
.cc-slice-bars { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-width: 0; }

.cc-slice-bar {
  align-items: center;
  border-radius: 3px;
  display: flex;
  gap: 0.3rem;
  height: 15px;
  justify-content: space-between;
  min-width: 2px;
  overflow: hidden;
  padding: 0 4px;
}

/* "The colors are not quite enough for me to identify who's who yet so we
   should probably label those" (2026-08-17). Dark text, because every bar is
   a light accent colour. */
.cc-slice-who {
  color: #101010;
  font-size: 0.58rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cc-slice-value { color: #101010; font-size: 0.58rem; font-weight: 700; }

/* Generosity */
.cc-curve { margin-bottom: 1rem; }
.cc-curve:last-child { margin-bottom: 0; }

.cc-curve-head {
  align-items: baseline;
  color: #eee;
  display: flex;
  font-size: 0.85rem;
  justify-content: space-between;
}

.cc-curve-figure { color: #b9b9b9; font-size: 0.72rem; }
.cc-histogram { align-items: flex-end; display: flex; gap: 2px; margin-top: 0.3rem; }
.cc-hist-col { display: flex; flex: 1 1 0; flex-direction: column; }
.cc-hist-track { align-items: flex-end; background: #101010; border-radius: 3px; display: flex; height: 48px; }
.cc-hist-fill { border-radius: 3px; width: 100%; }
.cc-hist-label { color: #7a7a7a; font-size: 0.55rem; text-align: center; }

/* Contrarians */
.cc-board-row { align-items: center; display: flex; gap: 0.5rem; padding: 0.25rem 0; }
/* Fixed width and clipped, so every bar starts at the same x however long a
   name is — "we need to make sure that the left edge of each of the bars all
   lineup" (2026-08-17). */
.cc-board-name {
  align-items: center;
  color: #eee;
  display: flex;
  flex: 0 0 96px;
  font-size: 0.78rem;
  min-width: 0;
  overflow: hidden;
}

.cc-board-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cc-board-track { background: #101010; border-radius: 999px; flex: 1 1 auto; height: 10px; overflow: hidden; }
.cc-board-fill { height: 100%; }
.cc-board-rate { color: #b9b9b9; flex: 0 0 34px; font-size: 0.72rem; text-align: right; }

/* Activity */
.cc-activity { align-items: flex-end; display: flex; gap: 3px; }
.cc-activity-col { display: flex; flex: 1 1 0; flex-direction: column; min-width: 0; }
.cc-activity-stack {
  align-items: stretch;
  background: #101010;
  border-radius: 3px;
  display: flex;
  flex-direction: column-reverse;
  height: 70px;
  overflow: hidden;
}
.cc-activity-seg { width: 100%; }
.cc-activity-label { color: #7a7a7a; font-size: 0.52rem; text-align: center; }

/* Radar rows — two bars per criterion beats an actual radar on a phone. */
.cc-radar { margin-bottom: 1rem; }
.cc-axis-row { align-items: center; display: flex; gap: 0.5rem; padding: 1px 0; }
.cc-axis-label { color: #b9b9b9; flex: 0 0 78px; font-size: 0.68rem; text-transform: capitalize; }
.cc-axis-track { display: flex; flex: 1 1 auto; flex-direction: column; gap: 2px; min-width: 0; }
.cc-axis-mine { background: #f0f0f0; border-radius: 2px; height: 7px; min-width: 2px; }
.cc-axis-theirs { border-radius: 2px; height: 7px; min-width: 2px; }

/* Poster rows, same treatment as everywhere else: fixed image height so the
   edges line up, text below free to run. */
.cc-poster-row {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
  -webkit-overflow-scrolling: touch;
}

.cc-poster-card { flex: 0 0 92px; width: 92px; }
.cc-poster-card:active { transform: scale(0.97); }
.cc-poster-frame { position: relative; }
.cc-poster { border-radius: 6px; display: block; height: 138px; object-fit: cover; width: 92px; }
/* Flush: the hat control is a corner ribbon. */
.cc-poster-hat { position: absolute; right: 0; top: 0; }

.cc-poster-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.68rem;
  justify-content: center;
  padding: 0.3rem;
  text-align: center;
}

.cc-poster-note { display: block; font-size: 0.7rem; font-weight: 700; margin-top: 0.2rem; }
.cc-poster-sub { color: #b9b9b9; display: block; font-size: 0.65rem; }
</style>
