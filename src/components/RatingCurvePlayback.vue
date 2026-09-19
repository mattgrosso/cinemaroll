<template>
  <div class="curve-playback">
    <LineChart :chartData="displayData" :options="displayOptions"/>

    <!-- A library of one has no curve to build; the deck would be a button
         that does nothing. -->
    <div v-if="canPlay" class="curve-playback__bar">
      <button
        class="curve-playback__play"
        :disabled="building"
        @click="toggle"
      >
        <span aria-hidden="true">{{ building ? '…' : playing ? '❚❚' : finished ? '↺' : '▶' }}</span>
        {{ building ? 'Getting ready' : playing ? 'Pause' : finished ? 'Watch it again' : 'Watch it build' }}
      </button>

      <!-- Reserves its own height whether or not there's a frame to describe,
           so pressing play doesn't shove the chart upward. -->
      <p class="curve-playback__caption">
        <template v-if="frame">
          <span class="curve-playback__date">{{ frameDate }}</span>
          <span class="curve-playback__films">{{ frame.films.toLocaleString() }} films</span>
        </template>
      </p>
    </div>

    <div v-if="canPlay" class="curve-playback__track" :class="{ 'is-idle': !frames.length }">
      <div class="curve-playback__progress" :style="{ width: `${progress}%` }"></div>
    </div>
  </div>
</template>

<script>
// "Watch it build" — the ratings curve, replayed.
//
// Bug report -P1mlsyZlwk2RTeYxOit (2026-09-18): "I would like to be able to
// animate the ratings curve graph. I want to hit play and see an animation of
// all of my ratings in the order I rated them being added to the graph,
// eventually arriving at my current curve."
//
// The arithmetic is all in assets/javascript/ratingCurvePlayback.js, which
// explains why a film MOVES between buckets rather than accumulating in them
// — that's what makes the last frame identical to the static chart instead of
// merely similar to it. This component is the playback deck.
//
// It takes the live chart's own `chartData` and `options` as props and only
// substitutes the dataset's numbers while playing. Recomputing the static
// curve here would be a second implementation of the thing the animation is
// supposed to land on, and the two would drift.
import { LineChart } from "vue-chart-3";
import { getAllRatings } from "../assets/javascript/GetRating.js";
import { ratingEvents, playbackFrames } from "../assets/javascript/ratingCurvePlayback.js";

// Nine seconds, ninety frames. Long enough that the shape emerging is the
// thing you're watching rather than a flicker; short enough to sit through
// twice. The chart's own tween runs slightly longer than the tick so bars
// glide between frames instead of stepping.
const FRAME_COUNT = 90;
const FRAME_MS = 100;

export default {
  name: "RatingCurvePlayback",
  components: { LineChart },
  props: {
    // The static chart, exactly as the page draws it when nothing is playing.
    chartData: { type: Object, required: true },
    options: { type: Object, required: true },
    // Library entries with ratings — the same list the static chart counts.
    entries: { type: Array, default: () => [] }
  },
  data () {
    return {
      building: false,
      playing: false,
      frames: [],
      buckets: [],
      index: -1,
      timer: null
    };
  },
  computed: {
    canPlay () {
      return (this.entries || []).length > 1;
    },
    frame () {
      return this.frames[this.index] || null;
    },
    finished () {
      return this.frames.length > 0 && this.index >= this.frames.length - 1;
    },
    progress () {
      if (!this.frames.length) return 0;
      return ((this.index + 1) / this.frames.length) * 100;
    },
    frameDate () {
      // Null while every rating so far is undated — those films are on the
      // chart from the first frame because we know they exist, just not when.
      if (!this.frame?.at) return "Before the record starts";
      return new Date(this.frame.at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    },
    /**
     * The tallest any bar ever gets. Pinned as the axis maximum for the whole
     * replay, so the bars grow into a fixed frame instead of the y-axis
     * rescaling under them every tick — which reads as the chart standing
     * still while the numbers change.
     */
    peak () {
      let highest = 0;
      this.frames.forEach((frame) => {
        frame.counts.forEach((count) => { highest = Math.max(highest, count); });
      });
      return highest;
    },
    displayData () {
      if (!this.frame) return this.chartData;

      const base = this.chartData?.datasets?.[0] || {};
      return {
        labels: this.buckets.map(String),
        datasets: [{ ...base, data: this.frame.counts }]
      };
    },
    displayOptions () {
      if (!this.frame) return this.options;

      return {
        ...this.options,
        // Slightly longer than the tick, so each frame is still easing into
        // place as the next arrives.
        animation: { duration: FRAME_MS + 40 },
        scales: {
          ...(this.options.scales || {}),
          y: { ...(this.options.scales?.y || {}), beginAtZero: true, max: this.peak }
        }
      };
    }
  },
  methods: {
    /**
     * Built once, on the first press, and kept. A whole library's ratings is
     * real work and there's no reason to make someone wait for it if they
     * never press play — and no reason to make them wait twice if they do.
     */
    build () {
      if (this.frames.length) return;
      this.building = true;
      const events = ratingEvents(this.entries, getAllRatings);
      const { buckets, frames } = playbackFrames(events, { frameCount: FRAME_COUNT });
      this.buckets = buckets;
      this.frames = frames;
      this.building = false;
    },
    toggle () {
      if (this.playing) {
        this.pause();
        return;
      }
      if (!this.canPlay) return;
      this.build();
      if (this.frames.length < 2) return;
      // Pressing play on a finished replay starts it over rather than
      // sitting on the last frame doing nothing.
      if (this.finished) this.index = -1;
      this.playing = true;
      this.tick();
    },
    tick () {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.playing) return;
        this.index += 1;
        if (this.index >= this.frames.length - 1) {
          this.index = this.frames.length - 1;
          this.playing = false;
          return;
        }
        this.tick();
      }, FRAME_MS);
    },
    pause () {
      this.playing = false;
      clearTimeout(this.timer);
      this.timer = null;
    }
  },
  beforeUnmount () {
    this.pause();
  }
};
</script>

<style lang="scss" scoped>
.curve-playback__bar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.curve-playback__play {
  background: #1d8bf1;
  border: none;
  border-radius: 999px;
  color: #fff;
  flex: none;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0.4rem 0.9rem;

  // Mobile-first: :active, never :hover. This is an installed PWA and a
  // tapped button keeps a hover state with no mouse to leave it.
  &:active:not(:disabled) { background: #1876ce; }
  &:disabled { opacity: 0.6; }
}

.curve-playback__caption {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  // Holds the row's height whether or not there is a caption, so the chart
  // above doesn't jump when playback starts.
  min-height: 1.1rem;
  margin: 0;
  // #b9b9b9 on this app's dark panels, the same grey the club charts use for
  // their figures — .text-muted fails here.
  color: #b9b9b9;
  font-size: 0.72rem;
  justify-content: flex-end;
}

.curve-playback__films { color: #e4e4e4; }

.curve-playback__track {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  height: 3px;
  margin-top: 0.5rem;
  overflow: hidden;

  &.is-idle { opacity: 0; }
}

.curve-playback__progress {
  background: #1d8bf1;
  height: 100%;
  transition: width 100ms linear;
}
</style>
