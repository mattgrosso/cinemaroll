<template>
  <div class="awards-board">
    <p v-if="!categories.length" class="board-empty">Nothing recorded for this year.</p>
    <div v-for="category in categories" :key="category.key" class="board-row" :class="{ open: isOpen(category) }">
      <!-- The same row the Groskers page uses: category, winner in gold, the
           nominee count, the winner's art behind a left-heavy scrim. -->
      <button
        type="button"
        class="category-btn"
        :class="{ 'has-banner': Boolean(banner(category)) }"
        :style="banner(category)"
        :aria-expanded="isOpen(category)"
        @click="toggle(category)"
      >
        <span class="category-row-main">
          <span class="category-name">{{ category.label }}</span>
          <span v-if="category.winners.length" class="category-winner">{{ winnerText(category) }}</span>
          <span v-else class="category-no-winner">No winner recorded</span>
          <span v-if="category.nominees.length" class="category-meta">{{ category.nomineeCount }} nominees</span>
        </span>
        <span class="category-row-side">
          <i class="bi bi-chevron-right category-chevron"></i>
        </span>
      </button>
      <div v-if="isOpen(category)" class="category-nominees">
        <div
          v-for="(pick, index) in picksOf(category)"
          :key="`${pick.won ? 'w' : 'n'}-${pick.movieId || pick.title}-${pick.name || ''}-${index}`"
          class="nominee-row"
          :class="{ won: pick.won, linked: Boolean(pick.movieId) }"
          @click="open(pick)"
        >
          <img v-if="pick.poster" :src="poster(pick.poster)" :alt="pick.title || ''" class="nominee-poster" loading="lazy">
          <span v-else class="nominee-poster nominee-poster--blank"></span>
          <span class="nominee-text">
            <span class="nominee-main">{{ pick.name || pick.title || 'Untitled' }}</span>
            <span v-if="pick.name && pick.title" class="nominee-sub">{{ pick.title }}</span>
          </span>
          <span v-if="pick.won" class="nominee-won"><i class="bi bi-trophy-fill"></i></span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// One year of one ceremony, in the shape of the Groskers page (Matt,
// 2026-10-07: "use the styles that we used for the Groskers as a template
// and make all of these awards fit to that"): a row per category with the
// winner, tap to unfold the nominees. Used for every tab on the awards
// screen except your own, which keeps the nominate-and-pick page. A pick
// with a TMDB id opens the film; one without (a festival title we could not
// place) is shown but not linked.
export default {
  name: 'AwardsBoard',
  props: {
    categories: { type: Array, default: () => [] }
  },
  emits: ['pick'],
  data () {
    return { openKey: null };
  },
  watch: {
    // A new year or ceremony starts folded.
    categories () { this.openKey = null; }
  },
  methods: {
    poster (path) {
      return path.startsWith('http') ? path : `https://image.tmdb.org/t/p/w185${path}`;
    },
    isOpen (category) {
      return this.openKey === category.key;
    },
    toggle (category) {
      this.openKey = this.isOpen(category) ? null : category.key;
    },
    banner (category) {
      const art = category.winners.find((p) => p.poster)?.poster;
      if (!art) return null;
      const url = art.startsWith('http') ? art : `https://image.tmdb.org/t/p/w342${art}`;
      return {
        backgroundImage: `linear-gradient(90deg, rgba(13, 13, 13, 0.94) 0%, rgba(13, 13, 13, 0.82) 45%, rgba(13, 13, 13, 0.35) 100%), url(${url})`,
        backgroundPosition: 'center 22%',
        backgroundSize: 'cover'
      };
    },
    // "The Odyssey" for a film; "Christopher Nolan · The Odyssey" for a
    // person; three editors who shared one award read as one line.
    winnerText (category) {
      const winners = category.winners;
      if (category.kind !== 'person') return winners.map((p) => p.title || p.name || 'Untitled').join(' · ');
      const films = new Set(winners.map((p) => p.title).filter(Boolean));
      const people = winners.map((p) => p.name || p.title || 'Untitled').join(', ');
      return films.size === 1 && winners.some((p) => p.name) ? `${people} · ${[...films][0]}` : people;
    },
    picksOf (category) {
      return [...category.winners.map((p) => ({ ...p, won: true })), ...category.nominees.map((p) => ({ ...p, won: false }))];
    },
    open (pick) {
      if (pick?.movieId) this.$emit('pick', pick);
    }
  }
};
</script>

<style lang="scss" scoped>
.awards-board { color: #eee; display: flex; flex-direction: column; gap: 0.5rem; }
.board-empty { color: #ccc; font-size: 0.9rem; }

.category-btn {
  align-items: center;
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 10px;
  color: #eee;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-height: 60px;
  padding: 0.7rem 0.9rem;
  text-align: left;
  transition: transform 0.1s, background-color 0.1s;
  width: 100%;

  &:active { background: #1f1f1f; transform: scale(0.985); }

  &.has-banner {
    border-color: #3a3a3a;
    min-height: 72px;
    .category-name, .category-winner { text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9); }
    .category-chevron { color: rgba(255, 255, 255, 0.75); }
    &:active { transform: scale(0.985); }
  }
}

.board-row.open .category-btn { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
.board-row.open .category-chevron { transform: rotate(90deg); }

.category-row-main { display: flex; flex-direction: column; min-width: 0; row-gap: 2px; }
.category-name { font-size: 0.9rem; font-weight: 600; line-height: 1.2; }
.category-winner { color: #ffd700; font-size: 0.75rem; line-height: 1.2; }
.category-no-winner { color: #999; font-size: 0.75rem; font-style: italic; }
.category-meta { color: #999; font-size: 0.75rem; }
.category-row-side { align-items: center; display: flex; flex: 0 0 auto; }
.category-chevron { color: #777; font-size: 0.9rem; transition: transform 0.15s; }

.category-nominees {
  background: #121212;
  border: 1px solid #2e2e2e;
  border-radius: 0 0 10px 10px;
  border-top: 0;
  display: flex;
  flex-direction: column;
  padding: 0.35rem 0.5rem 0.5rem;
}

.nominee-row {
  align-items: center;
  border-radius: 8px;
  display: flex;
  gap: 0.6rem;
  padding: 0.3rem 0.4rem;
  &.linked:active { background: #1f1f1f; }
  &.won .nominee-main { color: #ffd700; }
}
.nominee-poster { aspect-ratio: 2 / 3; background: rgba(255, 255, 255, 0.06); border-radius: 4px; flex: 0 0 2rem; object-fit: cover; width: 2rem; }
.nominee-text { display: flex; flex-direction: column; min-width: 0; row-gap: 1px; }
.nominee-main { color: #eee; font-size: 0.84rem; font-weight: 600; line-height: 1.2; overflow-wrap: anywhere; }
.nominee-sub { color: #bbb; font-size: 0.72rem; line-height: 1.2; }
.nominee-won { color: #ffd700; font-size: 0.8rem; margin-left: auto; }
</style>
