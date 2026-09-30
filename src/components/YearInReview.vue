<template>
  <div class="year-in-review">
    <!-- There was no way off this screen at all: `returnHome` existed but
         nothing ever called it (2026-08-16 navigation pass). -->
    <BackLink/>

    <div class="page-header">
      <h2 class="page-title">{{ selectedYear }}</h2>
      <p class="page-subtitle">Year in Review</p>
    </div>

    <!-- The same year strip the Awards screen and Home use. A <select> hid the
         other years behind a tap; this shows them. -->
    <div v-if="availableYears.length" class="yir-year-scroller">
      <button
        v-for="year in availableYears"
        :key="year"
        type="button"
        class="btn btn-sm yir-year-pill"
        :class="year === selectedYear ? 'btn-primary selected' : 'btn-outline-secondary'"
        @click="selectedYear = year"
      >{{ year }}</button>
    </div>

    <div class="page-content">
      <div v-if="!viewings.length" class="yir-empty">
        Nothing recorded in {{ selectedYear }}.
      </div>

      <template v-else>
        <!-- Headline -->
        <section class="yir-section yir-headline">
          <p class="yir-lede">
            You watched <strong>{{ viewings.length }}</strong>
            {{ viewings.length === 1 ? 'film' : 'films' }} on
            <strong>{{ calendar.watchedDays }}</strong>
            {{ calendar.watchedDays === 1 ? 'day' : 'days' }}, which came to
            <strong>{{ timeSpent }}</strong> — about
            <strong>{{ percentOfYear }}%</strong> of your waking hours.
          </p>

          <div v-if="comparison" class="yir-deltas">
            <div class="yir-delta">
              <span class="yir-delta-value" :class="deltaClass(comparison.countDelta)">
                {{ signed(comparison.countDelta) }}
              </span>
              <span class="yir-delta-label">
                films vs {{ selectedYear - 1 }}{{ comparison.partial ? ' so far' : '' }}
              </span>
            </div>
            <div class="yir-delta">
              <span class="yir-delta-value" :class="deltaClass(comparison.minutesDelta)">
                {{ signed(Math.round(comparison.minutesDelta / 60)) }}h
              </span>
              <span class="yir-delta-label">watching time</span>
            </div>
            <div v-if="comparison.averageDelta !== null" class="yir-delta">
              <span class="yir-delta-value" :class="deltaClass(comparison.averageDelta)">
                {{ signed(comparison.averageDelta) }}
              </span>
              <span class="yir-delta-label">average score</span>
            </div>
          </div>
        </section>

        <!-- The shape of the year -->
        <section class="yir-section">
          <h3 class="yir-title">The Shape of the Year</h3>
          <p class="yir-caption">
            Every day of {{ selectedYear }}, a row per month. The brighter the square, the
            more you watched that day.
          </p>
          <div class="yir-heat-grid">
            <div v-for="row in calendar.months" :key="`hm-${row.month}`" class="yir-heat-row">
              <span class="yir-heat-month">{{ monthNames[row.month] }}</span>
              <span
                v-for="cell in row.days"
                :key="`h-${row.month}-${cell.day}`"
                class="yir-heat-cell"
                :class="heatClass(cell)"
                :title="`${monthNames[row.month]} ${cell.day}: ${cell.count} watched`"
              ></span>
            </div>
          </div>
          <div class="yir-heat-key">
            <span class="yir-heat-key-label">Less</span>
            <span class="yir-heat-cell yir-heat-0"></span>
            <span class="yir-heat-cell yir-heat-1"></span>
            <span class="yir-heat-cell yir-heat-2"></span>
            <span class="yir-heat-cell yir-heat-3"></span>
            <span class="yir-heat-cell yir-heat-4"></span>
            <span class="yir-heat-key-label">More</span>
          </div>
        </section>

        <!-- Bookends -->
        <section v-if="ends" class="yir-section">
          <h3 class="yir-title">How It Opened, How It Closed</h3>
          <div class="yir-poster-row">
            <div class="yir-poster-card" role="button" :aria-label="ends.first.movie.title" @click="goToMovie(ends.first.movie)">
              <img v-if="ends.first.movie.poster_path" :src="poster(ends.first.movie)" :alt="ends.first.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ ends.first.movie.title }}</div>
              <span class="yir-poster-note gold">First</span>
              <span class="yir-poster-note">{{ dayLabel(ends.first.at) }}</span>
            </div>
            <div class="yir-poster-card" role="button" :aria-label="ends.last.movie.title" @click="goToMovie(ends.last.movie)">
              <img v-if="ends.last.movie.poster_path" :src="poster(ends.last.movie)" :alt="ends.last.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ ends.last.movie.title }}</div>
              <span class="yir-poster-note gold">Last</span>
              <span class="yir-poster-note">{{ dayLabel(ends.last.at) }}</span>
            </div>
          </div>
        </section>

        <!-- Month by month -->
        <section v-if="monthsWithFilms.length" class="yir-section">
          <h3 class="yir-title">Month by Month</h3>
          <p class="yir-caption">The best thing you saw in each month of {{ selectedYear }}.</p>
          <div class="yir-poster-row">
            <div
              v-for="month in monthsWithFilms"
              :key="`mb-${month.month}`"
              class="yir-poster-card"
              role="button"
              :aria-label="month.best.movie.title"
              @click="goToMovie(month.best.movie)"
            >
              <img v-if="month.best.movie.poster_path" :src="poster(month.best.movie)" :alt="month.best.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ month.best.movie.title }}</div>
              <span class="yir-poster-note gold">{{ monthNames[month.month] }}</span>
              <span class="yir-poster-note">{{ month.count }} watched</span>
            </div>
          </div>
        </section>

        <!-- Rhythm -->
        <section v-if="rhythm" class="yir-section">
          <h3 class="yir-title">Your Rhythm</h3>
          <div class="yir-facts">
            <div class="yir-fact">
              <span class="yir-fact-value">{{ rhythm.longest.length }}</span>
              <span class="yir-fact-label">
                {{ rhythm.longest.length === 1 ? 'day' : 'days' }} in a row
                <em v-if="rhythm.longest.length > 1">from {{ shortDay(rhythm.longest.from) }}</em>
              </span>
            </div>
            <div v-if="rhythm.drought" class="yir-fact">
              <span class="yir-fact-value">{{ rhythm.drought.length }}</span>
              <span class="yir-fact-label">
                days without a film
                <em>after {{ shortDay(rhythm.drought.from) }}</em>
              </span>
            </div>
            <div v-if="weekday.busiest" class="yir-fact">
              <span class="yir-fact-value">{{ weekday.busiest.name.slice(0, 3) }}</span>
              <span class="yir-fact-label">
                busiest day
                <em>{{ weekday.busiest.count }} films, {{ weekday.share }}% of the year</em>
              </span>
            </div>
            <div class="yir-fact">
              <span class="yir-fact-value">{{ calendar.busiest }}</span>
              <span class="yir-fact-label">
                in one day
                <em>your biggest sitting</em>
              </span>
            </div>
          </div>

          <div class="yir-weekbars">
            <div v-for="day in weekday.days" :key="day.name" class="yir-weekbar">
              <div class="yir-weekbar-track">
                <div
                  class="yir-weekbar-fill"
                  :class="{ peak: weekday.busiest && day.index === weekday.busiest.index }"
                  :style="{ height: weekBarHeight(day.count) }"
                ></div>
              </div>
              <span class="yir-weekbar-label">{{ day.name.slice(0, 1) }}</span>
            </div>
          </div>
        </section>

        <!-- Extremes -->
        <section v-if="extremeCards.length" class="yir-section">
          <h3 class="yir-title">The Extremes</h3>
          <div class="yir-poster-row">
            <div
              v-for="card in extremeCards"
              :key="card.label"
              class="yir-poster-card"
              role="button"
              :aria-label="card.viewing.movie.title"
              @click="goToMovie(card.viewing.movie)"
            >
              <img v-if="card.viewing.movie.poster_path" :src="poster(card.viewing.movie)" :alt="card.viewing.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ card.viewing.movie.title }}</div>
              <span class="yir-poster-note gold">{{ card.label }}</span>
              <span class="yir-poster-note">{{ card.detail }}</span>
            </div>
          </div>
        </section>

        <!-- You vs the Letterboxd crowd, for this year's films (2026-09-29:
             "anywhere where we're looking at my numbers, comparing them to
             the Letterboxd numbers seems like a worthwhile thing to do"). -->
        <section v-if="crowd.ready" class="yir-section">
          <h3 class="yir-title">You vs the Crowd</h3>
          <p class="yir-caption">
            Across the {{ crowd.count }} films from this year Letterboxd has rated, your ranking and the
            crowd's were <strong>{{ crowd.label }}</strong> (rank correlation {{ crowd.spearman.toFixed(2) }}).
          </p>
          <div v-if="crowdCards.length" class="yir-poster-row">
            <div
              v-for="card in crowdCards"
              :key="card.label"
              class="yir-poster-card"
              role="button"
              :aria-label="card.row.viewing.movie.title"
              @click="goToMovie(card.row.viewing.movie)"
            >
              <img v-if="card.row.viewing.movie.poster_path" :src="poster(card.row.viewing.movie)" :alt="card.row.viewing.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ card.row.viewing.movie.title }}</div>
              <span class="yir-poster-note gold">{{ card.label }}</span>
              <span class="yir-poster-note">you {{ card.row.mine.toFixed(2) }} · ★ {{ card.row.crowd.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <!-- What was different -->
        <section v-if="signature.length" class="yir-section">
          <h3 class="yir-title">What Was Different About {{ selectedYear }}</h3>
          <p class="yir-caption">
            Compared with how you normally watch, these are the things you leaned into hardest.
          </p>
          <div class="yir-signals">
            <div v-for="signal in signature" :key="`${signal.facet}-${signal.value}`" class="yir-signal">
              <span class="yir-signal-facet">{{ signal.facet }}</span>
              <span class="yir-signal-value">{{ signal.value }}</span>
              <span class="yir-signal-ratio">{{ signal.ratio }}&times; usual</span>
            </div>
          </div>
        </section>

        <!-- New releases vs catalogue -->
        <section v-if="spread" class="yir-section">
          <h3 class="yir-title">New Releases, and Everything Else</h3>
          <p class="yir-caption">
            {{ spread.currentShare }}% of what you watched came out in {{ selectedYear }}.
            All told you ranged across {{ spread.span }} years of cinema.
          </p>
          <div class="yir-decades">
            <div v-for="decade in spread.decades" :key="decade.decade" class="yir-decade">
              <div class="yir-decade-track">
                <div class="yir-decade-fill" :style="{ height: decadeHeight(decade.count) }"></div>
              </div>
              <span class="yir-decade-label">{{ String(decade.decade).slice(2) }}</span>
              <span class="yir-decade-count">{{ decade.count }}</span>
            </div>
          </div>
          <p v-if="spread.oldest" class="yir-footnote">
            The oldest thing you watched was
            <button type="button" class="yir-link" @click="goToMovie(spread.oldest.movie)">
              {{ spread.oldest.movie.title }}
            </button>
            ({{ spread.oldest.releaseYear }}).
          </p>
        </section>

        <!-- Discoveries -->
        <section v-if="mix" class="yir-section">
          <h3 class="yir-title">New to You</h3>
          <p class="yir-caption">
            {{ mix.firstTime.length }} first-time
            {{ mix.firstTime.length === 1 ? 'watch' : 'watches' }} and
            {{ mix.revisits.length }}
            {{ mix.revisits.length === 1 ? 'return' : 'returns' }} to something you'd seen before.
          </p>
          <div class="yir-split">
            <div class="yir-split-fill discoveries" :style="{ width: discoveryShare + '%' }"></div>
          </div>
          <div class="yir-split-key">
            <span><i class="bi bi-circle-fill discoveries-dot"></i> First-time</span>
            <span><i class="bi bi-circle-fill revisits-dot"></i> Revisits</span>
          </div>
          <div v-if="bestDiscoveries.length" class="yir-poster-row">
            <div
              v-for="viewing in bestDiscoveries"
              :key="`d-${viewing.dbKey}-${viewing.at}`"
              class="yir-poster-card"
              role="button"
              :aria-label="viewing.movie.title"
              @click="goToMovie(viewing.movie)"
            >
              <img v-if="viewing.movie.poster_path" :src="poster(viewing.movie)" :alt="viewing.movie.title" class="yir-poster">
              <div v-else class="yir-poster yir-poster-blank">{{ viewing.movie.title }}</div>
              <span class="yir-poster-note gold">{{ viewing.score.toFixed(2) }}</span>
            </div>
          </div>
        </section>

        <!-- Rating shape -->
        <section v-if="shape.scored" class="yir-section">
          <h3 class="yir-title">How You Scored It All</h3>
          <p class="yir-caption">
            {{ shape.scored }} scored {{ shape.scored === 1 ? 'viewing' : 'viewings' }},
            averaging {{ averageScore }}.
          </p>
          <div class="yir-histogram">
            <div v-for="bucket in shape.buckets" :key="bucket.score" class="yir-hist-col">
              <div class="yir-hist-track">
                <div class="yir-hist-fill" :style="{ height: histHeight(bucket.count) }"></div>
              </div>
              <span class="yir-hist-label">{{ bucket.score }}</span>
            </div>
          </div>
        </section>

        <!-- People -->
        <section v-if="topActors.length" class="yir-section">
          <h3 class="yir-title">Faces of the Year</h3>
          <div class="yir-people">
            <div v-for="actor in topActors.slice(0, 6)" :key="actor.name" class="yir-person">
              <img v-if="actor.profile_path" :src="headshot(actor)" :alt="actor.name" class="yir-person-photo">
              <div v-else class="yir-person-photo yir-person-blank"><i class="bi bi-person-fill"></i></div>
              <span class="yir-person-name">{{ actor.name }}</span>
              <span class="yir-person-count">{{ actor.count }}</span>
            </div>
          </div>
        </section>

        <section v-if="topDirectors.length" class="yir-section">
          <h3 class="yir-title">Behind the Camera</h3>
          <ol class="yir-directors">
            <li v-for="director in topDirectors.slice(0, 6)" :key="director.name" class="yir-director">
              <span class="yir-director-name">{{ director.name }}</span>
              <span class="yir-director-count">{{ director.count }}</span>
            </li>
          </ol>
        </section>
      </template>
    </div>
  </div>
</template>

<script>
import BackLink from './games/BackLink.vue';
import { getAllRatings } from '../assets/javascript/GetRating.js';
import {
  allViewings,
  bookends,
  calendarGrid,
  monthlyBests,
  streaks,
  weekdayPattern,
  releaseSpread,
  discoveryMix,
  yearSignature,
  superlatives,
  versusPreviousYear,
  scoreShape
} from '../assets/javascript/yearInReview.js';
import { yearVsCrowd } from '../assets/javascript/letterboxdCompare.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default {
  name: 'YearInReview',
  components: { BackLink },
  data () {
    return {
      selectedYear: new Date().getFullYear(),
      actorDetails: {},
      monthNames: MONTH_NAMES
    };
  },
  watch: {
    // Driven by the names themselves, not by mounted() or by selectedYear.
    // The library arrives asynchronously, so a fetch fired from mounted()
    // asks for the top actors of an empty list and never retries — which is
    // exactly why every headshot rendered as a placeholder icon.
    topActorNames: {
      immediate: true,
      handler (names, previous) {
        if (!names.length) return;
        if (previous && names.join('|') === previous.join('|')) return;
        this.fetchActorDetails(names);
      }
    }
  },
  mounted () {
    this.$store.dispatch?.('ensureLetterboxdData');
    // Default to the most recent year that actually has something in it,
    // rather than to a possibly-empty current year.
    if (this.availableYears.length && !this.availableYears.includes(this.selectedYear)) {
      this.selectedYear = this.availableYears[0];
    }
    this.$nextTick(() => {
      const root = document.querySelector('.year-in-review');
      if (root) root.scrollIntoView({ behavior: 'instant', block: 'start' });
    });
  },
  computed: {
    includeShorts () {
      return this.$store.state.settings?.includeShorts === true;
    },
    // One pass over the whole library; every section below filters this.
    // getAllRatings re-normalizes each rating it touches, so walking the
    // library once per section would be three or four full passes.
    everyViewing () {
      return allViewings(
        this.$store.getters.allMediaAsArray,
        getAllRatings,
        { includeShorts: this.includeShorts }
      );
    },
    availableYears () {
      return [...new Set(this.everyViewing.map((viewing) => viewing.year))].sort((a, b) => b - a);
    },
    viewings () {
      return this.everyViewing.filter((viewing) => viewing.year === this.selectedYear);
    },
    previousViewings () {
      return this.everyViewing.filter((viewing) => viewing.year === this.selectedYear - 1);
    },
    totalMinutes () {
      return this.viewings.reduce((total, viewing) => total + (viewing.runtime || 0), 0);
    },
    timeSpent () {
      const days = Math.floor(this.totalMinutes / (60 * 24));
      const hours = Math.floor((this.totalMinutes % (60 * 24)) / 60);
      const parts = [];
      if (days) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
      if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
      return parts.length ? parts.join(' and ') : `${this.totalMinutes} minutes`;
    },
    percentOfYear () {
      // 16 waking hours a day. A year still in progress is measured against
      // the days that have actually happened, or January looks superhuman.
      const now = new Date();
      const isCurrentYear = now.getFullYear() === this.selectedYear;
      const dayOfYear = Math.ceil((now - new Date(this.selectedYear, 0, 1)) / 86400000);
      const days = isCurrentYear
        ? Math.max(1, dayOfYear)
        : (this.selectedYear % 4 === 0 ? 366 : 365);
      return ((this.totalMinutes / (16 * 60 * days)) * 100).toFixed(1);
    },
    calendar () {
      return calendarGrid(this.viewings, this.selectedYear);
    },
    ends () {
      return bookends(this.viewings);
    },
    monthsWithFilms () {
      return monthlyBests(this.viewings).filter((month) => month.best);
    },
    rhythm () {
      return streaks(this.viewings, this.selectedYear);
    },
    weekday () {
      return weekdayPattern(this.viewings);
    },
    spread () {
      return releaseSpread(this.viewings, this.selectedYear);
    },
    mix () {
      return discoveryMix(this.viewings, getAllRatings);
    },
    discoveryShare () {
      const total = this.mix.firstTime.length + this.mix.revisits.length;
      return total ? Math.round((this.mix.firstTime.length / total) * 100) : 0;
    },
    bestDiscoveries () {
      return [...this.mix.firstTime]
        .filter((viewing) => viewing.score !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
    },
    signature () {
      return yearSignature(this.viewings, this.everyViewing);
    },
    crowd () {
      const films = this.$store.state.letterboxdFilms;
      if (!films) return { ready: false, count: 0 };
      return yearVsCrowd(this.viewings, films);
    },
    crowdCards () {
      if (!this.crowd.ready) return [];
      const used = new Set();
      return [
        { key: 'hottest', label: 'Your hottest take', row: this.crowd.hottest },
        { key: 'crowdPick', label: "The crowd's, not yours", row: this.crowd.crowdPick },
        { key: 'agreed', label: 'You both loved', row: this.crowd.agreed }
      ].filter((card) => {
        if (!card.row || used.has(card.row.tmdbId)) return false;
        used.add(card.row.tmdbId);
        return true;
      });
    },
    extremeCards () {
      const best = superlatives(this.viewings);
      const cards = [
        { key: 'best', label: 'Loved most', detail: best.best && `${best.best.score.toFixed(2)}` },
        { key: 'worst', label: 'Loved least', detail: best.worst && `${best.worst.score.toFixed(2)}` },
        { key: 'longest', label: 'Longest', detail: best.longest && `${best.longest.runtime} min` },
        { key: 'shortest', label: 'Shortest', detail: best.shortest && `${best.shortest.runtime} min` },
        { key: 'oldest', label: 'Oldest', detail: best.oldest && `${best.oldest.releaseYear}` }
      ];
      // With one film in a year the same poster is all five cards; dedupe so
      // a thin year doesn't render as a wall of the same image.
      const used = new Set();
      return cards.filter((card) => {
        const viewing = best[card.key];
        if (!viewing || used.has(viewing.dbKey)) return false;
        used.add(viewing.dbKey);
        card.viewing = viewing;
        return true;
      });
    },
    comparison () {
      // A year still in progress is compared against the same span of the
      // year before, not against a complete one — otherwise every delta on
      // the current year reads negative purely because it's August.
      const throughDate = this.selectedYear === new Date().getFullYear() ? Date.now() : null;
      return versusPreviousYear(this.viewings, this.previousViewings, { throughDate });
    },
    shape () {
      return scoreShape(this.viewings);
    },
    averageScore () {
      const scored = this.viewings.filter((viewing) => viewing.score !== null);
      if (!scored.length) return '—';
      return (scored.reduce((sum, viewing) => sum + viewing.score, 0) / scored.length).toFixed(2);
    },
    topActors () {
      const counts = {};
      this.viewings.forEach((viewing) => {
        (viewing.movie.cast || []).slice(0, 10).forEach((member) => {
          if (member.name) counts[member.name] = (counts[member.name] || 0) + 1;
        });
      });
      return Object.entries(counts)
        .map(([name, count]) => ({ name, count, profile_path: this.actorDetails[name]?.profile_path }))
        .sort((a, b) => b.count - a.count);
    },
    topActorNames () {
      return this.topActors.slice(0, 6).map((actor) => actor.name);
    },
    topDirectors () {
      const counts = {};
      this.viewings.forEach((viewing) => {
        (viewing.movie.crew || [])
          .filter((member) => member.job === 'Director')
          .forEach((director) => {
            if (director.name) counts[director.name] = (counts[director.name] || 0) + 1;
          });
      });
      return Object.entries(counts)
        .map(([name, count]) => ({ name, count }))
        // A director you saw once isn't a director of the year; in a thin
        // year that left the list padded out with 1s.
        .filter((director) => director.count > 1)
        .sort((a, b) => b.count - a.count);
    }
  },
  methods: {
    goToMovie (movie) {
      this.$router.push(`/movie/${movie.id}`);
    },
    poster (movie) {
      return `https://image.tmdb.org/t/p/w185${movie.poster_path}`;
    },
    headshot (actor) {
      return `https://image.tmdb.org/t/p/w185${actor.profile_path}`;
    },
    signed (value) {
      return value > 0 ? `+${value}` : `${value}`;
    },
    deltaClass (value) {
      if (value > 0) return 'up';
      if (value < 0) return 'down';
      return '';
    },
    dayLabel (ms) {
      return new Date(ms).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
    },
    shortDay (key) {
      const [year, month, day] = key.split('-').map(Number);
      return new Date(year, month - 1, day)
        .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },
    heatClass (cell) {
      // A day that hasn't happened yet is not a day you watched nothing.
      if (cell.future) return 'yir-heat-future';
      if (!cell.count) return 'yir-heat-0';
      // Four steps, scaled to the year's own busiest day so a quiet year
      // still shows contrast rather than a uniform dim wash.
      const step = Math.ceil((cell.count / Math.max(1, this.calendar.busiest)) * 4);
      return `yir-heat-${Math.min(4, Math.max(1, step))}`;
    },
    weekBarHeight (count) {
      const peak = Math.max(...this.weekday.days.map((day) => day.count), 1);
      return `${Math.max(4, (count / peak) * 100)}%`;
    },
    decadeHeight (count) {
      const peak = Math.max(...this.spread.decades.map((decade) => decade.count), 1);
      return `${Math.max(4, (count / peak) * 100)}%`;
    },
    histHeight (count) {
      return `${Math.max(2, (count / Math.max(1, this.shape.peak)) * 100)}%`;
    },
    async fetchActorDetails (names) {
      const details = {};

      for (const name of names) {
        const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${encodeURIComponent(name)}`;
        try {
          const response = await fetch(url);
          if (response.ok) {
            const data = await response.json();
            if (data.results?.length) details[name] = data.results[0];
          }
        } catch (error) {
          console.error('Error fetching actor details:', error);
        }
      }

      this.actorDetails = details;
    }
  }
};
</script>

<style scoped lang="scss">
/* No `position: relative` here, however tempting. BackLink is absolutely
   positioned at top:6px and depends on there being NO positioned ancestor, so
   it escapes to the page's initial containing block and lands up in the
   header alongside every other screen's back link. A positioned root traps it
   at the top of this component's own content instead, which is why this page
   alone had its back link sitting below the header. */
.year-in-review {
  color: #fff;
  padding-bottom: 4rem;
}

/* BackLink floats over the top-left. Padding stays symmetric — at phone width
   it ends around 115px and a centred title starts around 133px, so they don't
   collide, and padding the left to clear it just throws the title off-centre
   the other way. */
.page-header {
  background: linear-gradient(135deg, #1f1147 0%, #43296b 55%, #7b3f6b 100%);
  border-bottom: 1px solid #2e2e2e;
  padding: 1.5rem 1rem 1.25rem;
  text-align: center;
}

.page-title {
  font-size: 2.4rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  margin: 0;
}

.page-subtitle {
  color: #d6ccec;
  font-size: 0.8rem;
  letter-spacing: 0.16em;
  margin: 0.15rem 0 0;
  text-transform: uppercase;
}

.yir-year-scroller {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  padding: 0.7rem 0.75rem 0.2rem;
  -webkit-overflow-scrolling: touch;
}

.yir-year-pill {
  flex-shrink: 0;
  white-space: nowrap;
}

/* Bootstrap paints btn-outline-secondary's label #6c757d, the same ~2.6:1
   against a dark surface that makes .text-muted unreadable here. */
.yir-year-pill.btn-outline-secondary {
  border-color: #4a4a4a;
  color: #ccc;
}

/* Mobile-first: press feedback is :active only. A tapped pill on iOS keeps
   its hover state forever, with no mouse to leave it. */
.yir-year-pill:active {
  transform: scale(0.96);
}

.page-content {
  margin: 0 auto;
  max-width: 800px;
  padding: 0.75rem;
}

.yir-empty {
  color: #ccc;
  padding: 2rem 0;
  text-align: center;
}

.yir-section {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  margin-bottom: 1rem;
  padding: 0.9rem 1rem;
}

.yir-title { font-size: 1.1rem; font-weight: 700; margin: 0 0 0.25rem; }
.yir-caption { color: #ccc; font-size: 0.78rem; margin: 0 0 0.75rem; }
.yir-footnote { color: #ccc; font-size: 0.78rem; margin: 0.6rem 0 0; }

.yir-lede { font-size: 0.95rem; line-height: 1.5; margin: 0; }
.yir-lede strong { color: #ffc107; }

.yir-deltas {
  border-top: 1px solid #2e2e2e;
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
}

.yir-delta { display: flex; flex-direction: column; }
.yir-delta-value { color: #eee; font-size: 1.15rem; font-weight: 700; }
.yir-delta-value.up { color: #6ddc8b; }
.yir-delta-value.down { color: #ff9a8b; }
.yir-delta-label { color: #b9b9b9; font-size: 0.7rem; }

/* Heatmap: twelve month rows by day-of-month, matching the all-time grid on
   Insights' Activity tab. A 31-column grid rather than a flex row, because
   flexed cells would make February's wider than January's and the columns —
   which are the dates — would stop lining up. 1fr means it fits any width
   without scrolling sideways. */
.yir-heat-grid { display: flex; flex-direction: column; gap: 2px; }

.yir-heat-row {
  align-items: center;
  display: grid;
  gap: 2px;
  grid-template-columns: 24px repeat(31, 1fr);
}

.yir-heat-month {
  color: #b9b9b9;
  font-size: 0.6rem;
  text-align: right;
}

.yir-heat-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  display: block;
  min-width: 0;
}

/* A date that hasn't arrived yet isn't a day you watched nothing, so it
   reads as absent rather than as an empty square. */
.yir-heat-future { background: #1b1b1b; opacity: 0.4; }
.yir-heat-0 { background: #242424; }
.yir-heat-1 { background: #5c451a; }
.yir-heat-2 { background: #8a6415; }
.yir-heat-3 { background: #c08d10; }
.yir-heat-4 { background: #ffc107; }

.yir-heat-key {
  align-items: center;
  color: #b9b9b9;
  display: flex;
  font-size: 0.65rem;
  gap: 3px;
  justify-content: flex-end;
  margin-top: 0.5rem;
}

/* The swatches are outside the grid, so they need an explicit size — 1fr
   and aspect-ratio give them nothing to size against in a flex row. */
.yir-heat-key .yir-heat-cell { height: 10px; width: 10px; }

.yir-heat-key-label { margin: 0 0.3rem; }

/* Poster rows: fixed image height so every top and bottom edge lines up,
   text below free to run to as many lines as it needs. */
.yir-poster-row {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.4rem;
  -webkit-overflow-scrolling: touch;
}

.yir-poster-card { cursor: pointer; flex: 0 0 92px; width: 92px; }
.yir-poster-card:active { transform: scale(0.97); }
.yir-poster { border-radius: 6px; display: block; height: 138px; object-fit: cover; width: 92px; }

.yir-poster-blank {
  align-items: center;
  background: #2b2b2b;
  color: #ccc;
  display: flex;
  font-size: 0.68rem;
  justify-content: center;
  padding: 0.3rem;
  text-align: center;
}

.yir-poster-note { color: #ccc; display: block; font-size: 0.7rem; line-height: 1.25; margin-top: 0.2rem; }
.yir-poster-note.gold { color: #ffc107; font-weight: 700; }

/* Rhythm */
.yir-facts {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, 1fr);
}

.yir-fact {
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
}

.yir-fact-value { color: #ffc107; display: block; font-size: 1.4rem; font-weight: 800; line-height: 1.1; }
.yir-fact-label { color: #ccc; display: block; font-size: 0.72rem; }
.yir-fact-label em { color: #b9b9b9; display: block; font-style: normal; font-size: 0.68rem; }

.yir-weekbars {
  align-items: flex-end;
  display: flex;
  gap: 0.4rem;
  margin-top: 0.9rem;
}

.yir-weekbar { display: flex; flex: 1 1 0; flex-direction: column; }
.yir-weekbar-track { align-items: flex-end; background: #101010; border-radius: 4px; display: flex; height: 48px; }
.yir-weekbar-fill { background: #4a4a4a; border-radius: 4px; width: 100%; }
.yir-weekbar-fill.peak { background: #ffc107; }
.yir-weekbar-label { color: #b9b9b9; font-size: 0.65rem; text-align: center; }

/* Signature */
.yir-signals { display: flex; flex-direction: column; gap: 0.5rem; }

.yir-signal {
  align-items: baseline;
  background: #101010;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 0.7rem;
}

.yir-signal-facet { color: #9a9a9a; font-size: 0.6rem; letter-spacing: 0.06em; text-transform: uppercase; }
.yir-signal-value { color: #fff; flex: 1 1 auto; font-weight: 700; min-width: 0; }
.yir-signal-ratio { color: #ffc107; font-weight: 700; white-space: nowrap; }

/* Decades */
.yir-decades { align-items: flex-end; display: flex; gap: 0.35rem; }
.yir-decade { display: flex; flex: 1 1 0; flex-direction: column; min-width: 0; }
.yir-decade-track { align-items: flex-end; background: #101010; border-radius: 4px; display: flex; height: 56px; }
.yir-decade-fill { background: #7b5cd6; border-radius: 4px; width: 100%; }
.yir-decade-label { color: #ccc; font-size: 0.62rem; text-align: center; }
.yir-decade-count { color: #b9b9b9; font-size: 0.6rem; text-align: center; }

.yir-link {
  background: none;
  border: none;
  color: #ffc107;
  font: inherit;
  padding: 0;
  text-decoration: underline;
}

/* Discoveries */
.yir-split { background: #7b5cd6; border-radius: 999px; height: 10px; overflow: hidden; }
.yir-split-fill.discoveries { background: #ffc107; height: 100%; }

.yir-split-key {
  color: #ccc;
  display: flex;
  font-size: 0.7rem;
  gap: 1rem;
  margin: 0.4rem 0 0.7rem;
}

.discoveries-dot { color: #ffc107; font-size: 0.55rem; }
.revisits-dot { color: #7b5cd6; font-size: 0.55rem; }

/* Histogram */
.yir-histogram { align-items: flex-end; display: flex; gap: 0.25rem; }
.yir-hist-col { display: flex; flex: 1 1 0; flex-direction: column; }
.yir-hist-track { align-items: flex-end; background: #101010; border-radius: 3px; display: flex; height: 64px; }
.yir-hist-fill { background: #4fa3e3; border-radius: 3px; width: 100%; }
.yir-hist-label { color: #b9b9b9; font-size: 0.62rem; text-align: center; }

/* People */
.yir-people { display: flex; gap: 0.6rem; overflow-x: auto; padding-bottom: 0.4rem; }
.yir-person { flex: 0 0 74px; width: 74px; }
.yir-person-photo { border-radius: 8px; display: block; height: 96px; object-fit: cover; width: 74px; }

.yir-person-blank {
  align-items: center;
  background: #2b2b2b;
  color: #9a9a9a;
  display: flex;
  font-size: 1.6rem;
  justify-content: center;
}

.yir-person-name { color: #eee; display: block; font-size: 0.68rem; line-height: 1.2; margin-top: 0.25rem; }
.yir-person-count { color: #ffc107; display: block; font-size: 0.66rem; font-weight: 700; }

/* Directors */
.yir-directors { list-style: none; margin: 0; padding: 0; }

.yir-director {
  align-items: center;
  border-bottom: 1px solid #242424;
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
}

.yir-director:last-child { border-bottom: none; }
.yir-director-name { color: #eee; font-size: 0.85rem; }
.yir-director-count { color: #ffc107; font-weight: 700; }
</style>
