<template>
  <!-- The first-look tour (onboarding.js says when). One card at a time,
       swipe or Next; Skip and the last card's Done both close it. Each card
       draws a small piece of the real screen rather than a screenshot, so it
       never goes stale when the screen changes colour or size. -->
  <Teleport to="body">
    <div class="tour-backdrop" role="dialog" aria-modal="true" aria-label="A quick tour of Cinema Roll" @click.self="close">
      <div
        class="tour-card"
        @touchstart.passive="touchStart"
        @touchend="touchEnd"
      >
        <div class="tour-top">
          <span class="tour-step">{{ index + 1 }} of {{ cards.length }}</span>
          <button type="button" class="tour-skip" @click="close">Skip</button>
        </div>

        <div class="tour-picture" aria-hidden="true">
          <div v-if="card.picture === 'parts'" class="pic-parts">
            <div v-for="(part, i) in parts" :key="part" class="pic-part">
              <span class="pic-part-name">{{ part }}</span>
              <span class="pic-part-bar"><span :style="{ width: `${partWidths[i]}%` }"></span></span>
            </div>
          </div>

          <div v-else-if="card.picture === 'search'" class="pic-search">
            <div class="pic-search-box">
              <span>Search...</span>
              <i class="bi bi-lightning-charge"></i>
            </div>
            <div class="pic-search-chips">
              <span>Kubrick</span><span>1970s</span><span>Comedy</span>
            </div>
          </div>

          <div v-else-if="card.picture === 'rainbow'" class="pic-rainbow">
            <div class="pic-rainbow-bar">
              <span v-for="chip in chips" :key="chip.key" class="pic-chip" :style="{ background: chip.colour, color: chip.ink }">
                <i v-if="chip.icon" class="bi" :class="chip.icon"></i>
                <b v-else>{{ chip.text }}</b>
              </span>
            </div>
            <ul class="pic-rainbow-key">
              <li v-for="chip in chips" :key="chip.key">
                <span class="pic-swatch" :style="{ background: chip.colour }"></span>{{ chip.label }}
              </li>
            </ul>
          </div>

          <div v-else-if="card.picture === 'insights'" class="pic-rows">
            <div class="pic-row"><i class="bi bi-camera-reels"></i>Directors</div>
            <div class="pic-row"><i class="bi bi-calendar3"></i>Eras</div>
            <div class="pic-row"><i class="bi bi-trophy"></i>Your awards</div>
          </div>

          <div v-else-if="card.picture === 'club'" class="pic-club">
            <span class="pic-club-badge"><i class="bi bi-suit-club"></i></span>
            <div class="pic-row"><span class="pic-dot">J</span>Jane logged <b>Heat</b></div>
            <div class="pic-row"><span class="pic-dot">S</span>Sam logged <b>Paddington 2</b></div>
          </div>

          <div v-else-if="card.picture === 'more'" class="pic-rows">
            <div class="pic-row"><i class="bi bi-binoculars"></i>Watchlist</div>
            <div class="pic-row"><i class="bi bi-film"></i>Showtimes</div>
            <div class="pic-row"><i class="bi bi-dice-5"></i>Games</div>
            <div class="pic-row"><i class="bi bi-newspaper"></i>Newsletter</div>
          </div>
        </div>

        <h2 class="tour-title">{{ card.title }}</h2>
        <p v-for="(line, i) in card.lines" :key="i" class="tour-line">{{ line }}</p>

        <div class="tour-dots" aria-hidden="true">
          <span v-for="(c, i) in cards" :key="c.key" :class="{ on: i === index }"></span>
        </div>

        <div class="tour-buttons">
          <button v-if="index > 0" type="button" class="tour-back" @click="index--">Back</button>
          <button v-if="!isLast" type="button" class="tour-next" @click="index++">Next</button>
          <button v-else type="button" class="tour-next" @click="close">Start</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script>
import { TOUR_CARDS, RAINBOW_CHIPS, RATING_PARTS } from '../assets/javascript/onboarding.js';

// Bar lengths for the rating picture: a made-up film, never the user's.
const PART_WIDTHS = [80, 70, 85, 75, 55, 90, 85, 65];
const SWIPE_PX = 50;

export default {
  name: 'AppTour',
  emits: ['close'],
  data () {
    return {
      index: 0,
      cards: TOUR_CARDS,
      chips: RAINBOW_CHIPS,
      parts: RATING_PARTS,
      partWidths: PART_WIDTHS,
      touchX: null
    };
  },
  computed: {
    card () {
      return this.cards[this.index];
    },
    isLast () {
      return this.index === this.cards.length - 1;
    }
  },
  mounted () {
    document.addEventListener('keydown', this.onKey);
  },
  beforeUnmount () {
    document.removeEventListener('keydown', this.onKey);
  },
  methods: {
    close () {
      this.$emit('close');
    },
    onKey (event) {
      if (event.key === 'Escape') this.close();
      else if (event.key === 'ArrowRight' && !this.isLast) this.index++;
      else if (event.key === 'ArrowLeft' && this.index > 0) this.index--;
    },
    touchStart (event) {
      this.touchX = event.touches[0]?.clientX ?? null;
    },
    touchEnd (event) {
      if (this.touchX === null) return;
      const dx = (event.changedTouches[0]?.clientX ?? this.touchX) - this.touchX;
      this.touchX = null;
      if (dx <= -SWIPE_PX && !this.isLast) this.index++;
      else if (dx >= SWIPE_PX && this.index > 0) this.index--;
    }
  }
};
</script>

<style lang="scss" scoped>
.tour-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(16px, env(safe-area-inset-top, 0px)) 16px max(16px, env(safe-area-inset-bottom, 0px));
}

.tour-card {
  width: 100%;
  max-width: 400px;
  max-height: 100%;
  overflow-y: auto;
  background: #161616;
  border: 1px solid #333;
  border-radius: 14px;
  padding: 16px 20px 20px;
  color: #f2f2f2;
}

.tour-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.tour-step {
  font-size: 0.8rem;
  color: #aaa;
}

.tour-skip {
  background: none;
  border: none;
  color: #ccc;
  font-size: 0.9rem;
  padding: 6px 0 6px 12px;

  &:active { color: #fff; }
}

.tour-picture {
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 16px;
  min-height: 150px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.pic-parts {
  display: grid;
  gap: 6px;
}

.pic-part {
  display: grid;
  grid-template-columns: 6.5rem 1fr;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #ddd;
}

.pic-part-bar {
  height: 6px;
  background: #2a2a2a;
  border-radius: 3px;
  overflow: hidden;

  span {
    display: block;
    height: 100%;
    background: #24d776;
  }
}

.pic-search-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  color: #777;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 0.9rem;

  i { color: #333; }
}

.pic-search-chips {
  display: flex;
  gap: 6px;
  margin-top: 10px;
  flex-wrap: wrap;

  span {
    background: #2a2a2a;
    color: #eee;
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.8rem;
  }
}

.pic-rainbow-bar {
  display: flex;
  border-radius: 8px;
  overflow: hidden;
}

.pic-chip {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  font-size: 0.95rem;
}

.pic-rainbow-key {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  font-size: 0.8rem;
  color: #ddd;

  li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
}

.pic-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex: none;
}

.pic-rows {
  display: grid;
  gap: 8px;
}

.pic-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  color: #eee;

  i {
    font-size: 1.1rem;
    width: 1.3rem;
    text-align: center;
    color: #24d776;
  }
}

.pic-club {
  display: grid;
  gap: 8px;
}

.pic-club-badge {
  justify-self: start;
  background: #1D8BF1;
  color: #000;
  border-radius: 8px;
  padding: 4px 12px;
  font-size: 1.1rem;
  margin-bottom: 4px;
}

.pic-dot {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: #2a2a2a;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  flex: none;
}

.tour-title {
  font-size: 1.3rem;
  margin: 0 0 8px;
  text-wrap: balance;
}

.tour-line {
  font-size: 0.95rem;
  line-height: 1.45;
  color: #ddd;
  margin: 0 0 6px;
}

.tour-dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 14px 0;

  span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #444;

    &.on { background: #fff; }
  }
}

.tour-buttons {
  display: flex;
  gap: 10px;

  button {
    flex: 1;
    border-radius: 8px;
    padding: 10px;
    font-size: 1rem;
    border: none;
  }
}

.tour-back {
  background: #2a2a2a;
  color: #fff;

  &:active { background: #3a3a3a; }
}

.tour-next {
  background: #1D8BF1;
  color: #000;
  font-weight: 600;

  &:active { background: #4aa3f5; }
}
</style>
