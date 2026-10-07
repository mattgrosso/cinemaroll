<template>
  <div class="awards-board">
    <p v-if="!categories.length" class="board-empty">Nothing recorded for this year.</p>
    <div v-for="category in categories" :key="category.key" class="board-category">
      <span class="board-label">{{ category.label }}</span>
      <div v-if="category.winners.length" class="board-winners">
        <div
          v-for="(pick, index) in category.winners"
          :key="`w-${pick.movieId || pick.title}-${index}`"
          class="board-pick"
          :class="{ linked: Boolean(pick.movieId) }"
          @click="open(pick)"
        >
          <img v-if="pick.poster" :src="poster(pick.poster)" :alt="pick.title || ''" class="board-poster" loading="lazy">
          <span v-else class="board-poster board-poster--blank">{{ pick.title || pick.name }}</span>
          <span class="board-title">{{ pick.name || pick.title || 'Untitled' }}</span>
          <span v-if="pick.name && pick.title" class="board-for">{{ pick.title }}</span>
        </div>
      </div>
      <div v-if="category.nominees.length" class="board-nominees">
        <span class="board-nominees-head">Nominated</span>
        <button
          v-for="(pick, index) in category.nominees"
          :key="`n-${pick.movieId || pick.title}-${index}`"
          type="button"
          class="board-nominee"
          :class="{ linked: Boolean(pick.movieId) }"
          @click="open(pick)"
        >{{ nomineeText(pick) }}</button>
      </div>
    </div>
  </div>
</template>

<script>
// One year of one ceremony: categories in order, winners as poster cards,
// nominees as a compact wrapped list. Used for every tab on the awards screen
// except your own (which keeps the nominate-and-pick page). A pick with a
// TMDB id opens the film; one without (the other-ceremonies dataset has
// titles only) is shown but not linked.
export default {
  name: 'AwardsBoard',
  props: {
    categories: { type: Array, default: () => [] }
  },
  emits: ['pick'],
  methods: {
    poster (path) {
      return path.startsWith('http') ? path : `https://image.tmdb.org/t/p/w185${path}`;
    },
    nomineeText (pick) {
      if (pick.name && pick.title) return `${pick.name} · ${pick.title}`;
      return pick.name || pick.title || 'Untitled';
    },
    open (pick) {
      if (pick?.movieId) this.$emit('pick', pick);
    }
  }
};
</script>

<style scoped>
.awards-board { color: #eee; }
.board-empty { color: #ccc; font-size: 0.9rem; }
.board-category { margin: 0 0 1.1rem; }
.board-label { color: #ccc; display: block; font-size: 0.72rem; letter-spacing: 0.06em; margin-bottom: 0.35rem; text-transform: uppercase; }
.board-winners { display: flex; gap: 0.5rem; overflow-x: auto; padding-bottom: 0.25rem; -webkit-overflow-scrolling: touch; }
.board-pick { display: flex; flex: 0 0 5.6rem; flex-direction: column; min-width: 0; }
.board-pick.linked:active { opacity: 0.7; }
.board-poster { aspect-ratio: 2 / 3; background: rgba(255, 255, 255, 0.06); border-radius: 4px; object-fit: cover; width: 100%; }
.board-poster--blank { align-items: center; color: #ccc; display: flex; font-size: 0.72rem; justify-content: center; line-height: 1.2; overflow: hidden; padding: 0.4rem; text-align: center; }
.board-title { color: #fff; font-size: 0.78rem; font-weight: 600; line-height: 1.2; margin-top: 0.3rem; overflow-wrap: anywhere; }
.board-for { color: #ccc; font-size: 0.7rem; line-height: 1.2; }
.board-nominees { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.3rem 0.4rem; margin-top: 0.45rem; }
.board-nominees-head { color: #999; font-size: 0.65rem; letter-spacing: 0.05em; text-transform: uppercase; }
.board-nominee { background: rgba(255, 255, 255, 0.07); border: 0; border-radius: 999px; color: #ddd; font-size: 0.74rem; line-height: 1.2; padding: 0.2rem 0.6rem; text-align: left; }
.board-nominee:not(.linked) { color: #bbb; }
.board-nominee.linked:active { background: rgba(255, 255, 255, 0.16); }
</style>
