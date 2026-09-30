<template>
  <section v-if="facts.length" class="fun-facts">
    <!-- No header: "we should just get rid of the header Fun Facts, leave the
         boxes and all the information but we don't need that header"
         (2026-08-17). The boxes say what they are. -->
    <div class="fun-facts-row">
      <div v-for="fact in facts" :key="fact.key" class="fun-fact-card">
        <span class="fun-fact-label">{{ fact.label }}</span>
        <span class="fun-fact-value">{{ fact.value }}</span>
        <span v-if="fact.detail" class="fun-fact-detail">{{ fact.detail }}</span>
      </div>
    </div>
  </section>
</template>

<script>
// The "more fun data about my ratings and watching habits" request, wired
// at last (board item 8): funFacts.js has been pure and tested since the
// overnight build — this is just the shelf it sits on. Lives at the top of
// Insights; fully offline (store reads only).
import { getRating } from '../assets/javascript/GetRating.js';
import { allFunFacts } from '../assets/javascript/funFacts.js';
import { withoutShorts, includeShortsSetting } from '../assets/javascript/shorts.js';

export default {
  name: 'FunFactsRow',
  computed: {
    facts () {
      // Shorts by the setting, like every other screen: "Biggest movie day"
      // counted a run of shorts with shorts switched off (2026-09-29).
      const library = withoutShorts(this.$store.getters.allMoviesAsArray, includeShortsSetting(this.$store.state));
      return allFunFacts(library, getRating);
    }
  }
};
</script>

<style lang="scss" scoped>
.fun-facts {
  /* Top margin is the point: with none, this sat flush against the link
     cards above it — "I need some more padding between the fun facts and
     the buttons above them. They just are touching immediately on each
     other" (report -P-HGwQj9ZJAeXY5mqTk). A little more than the 0.75rem
     the link grid gives itself, because this is a change of section
     rather than another row of the same thing. */
  margin: 1.25rem 0 1rem;
  /* Never let the rigid card row dictate an ancestor's min-content width. */
  max-width: 100%;
  min-width: 0;
}


.fun-facts-title {
  color: #eee;
  font-size: 1rem;
  font-weight: 700;
  margin: 0 0 0.5rem;
}

/* Two columns, everything visible — no horizontal scroll (Matt). */
.fun-facts-row {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(2, 1fr);
  max-width: 100%;
}

/* An odd count (Biggest movie day hides on thin data) leaves the last
   tile alone in its row; let it span both columns so there's never a gap
   ("I don't like that we have an odd number of tiles", 2026-09-29). */
.fun-fact-card:last-child:nth-child(odd) {
  grid-column: 1 / -1;
}

/* Deliberately NOT the filled-header tile used above: Overview stacked ~17
   accent-filled strips and read as a wall of one colour (Matt, 2026-08-16:
   "we need to figure out how to break up the wall of yellow"). The accent
   survives as the value's colour instead of a block of fill — colour
   interspersed through the page rather than banded across it. */
.fun-fact-card {
  border: 1px solid #4a4a4a;
  border-radius: 3px;
  color: white;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  text-align: center;
}

.fun-fact-label {
  /* #b9b9b9 on the card, ~8:1 — .text-muted would fail here. */
  color: #b9b9b9;
  font-size: 0.62rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 6px 6px 0;
  text-transform: uppercase;
}

.fun-fact-value {
  color: var(--accent, white);
  font-size: 1.3rem;
  font-weight: 700;
  line-height: 1.2;
  padding: 0.35rem 0.5rem 0;
}

.fun-fact-detail {
  color: #ccc;
  font-size: 0.75rem;
  line-height: 1.3;
  padding: 0 0.5rem 0.5rem;
}
</style>
