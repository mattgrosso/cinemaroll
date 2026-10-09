<template>
  <!-- How to play, the house standard from Matt's other game apps: the card
       opens by itself the first time a game is played on this device, and
       the ? keeps it one tap away after that. Which game, and what the card
       says, both come from the route and gameList.js — nothing per game
       lives in the game components but the one <GameHowTo/> tag. -->
  <template v-if="game">
    <button
      type="button"
      class="howto-button"
      aria-label="How to play"
      @click="open = true"
    ><i class="bi bi-question-lg"></i></button>

    <Teleport to="body">
      <div v-if="open" class="howto-backdrop" @click.self="close">
        <div class="howto-card" role="dialog" :aria-label="`How to play ${game.name}`">
          <img :src="game.banner" :alt="game.name" class="howto-art">
          <div class="howto-body">
            <h2 class="howto-title">How to play</h2>
            <ul class="howto-lines">
              <li v-for="(line, index) in game.howTo" :key="index" class="howto-line">
                <i class="bi" :class="line.icon"></i>
                <span>{{ line.text }}</span>
              </li>
            </ul>
            <button type="button" class="btn-game btn-game-primary full-width" @click="close">Got it</button>
          </div>
        </div>
      </div>
    </Teleport>
  </template>
</template>

<script>
import { gameForPath, howToSeen, markHowToSeen } from '../../assets/javascript/games/gameList.js';

export default {
  name: 'GameHowTo',
  data () {
    return {
      open: false
    };
  },
  computed: {
    game () {
      return gameForPath(this.$route?.path);
    }
  },
  created () {
    if (this.game && !howToSeen(this.game.path)) this.open = true;
  },
  methods: {
    // Seen means dismissed, not merely shown: a card closed by leaving the
    // screen mid-read comes back next time.
    close () {
      this.open = false;
      if (this.game) markHowToSeen(this.game.path);
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/game-buttons';

// Mirrors BackLink on the opposite corner: same dark pill over the header
// banner, same 40px target. The version badge sits bottom-right, so the top
// right corner is free.
.howto-button {
  align-items: center;
  background: rgba(0, 0, 0, 0.6);
  border: none;
  border-radius: 6px;
  color: #eee;
  display: flex;
  font-size: 1.1rem;
  justify-content: center;
  min-height: 40px;
  min-width: 40px;
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 600;
}

.howto-button:active {
  opacity: 0.7;
}

.howto-backdrop {
  align-items: center;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: fixed;
  z-index: 2000;
}

.howto-card {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 12px;
  color: #eee;
  max-height: calc(100dvh - 2rem);
  max-width: 400px;
  overflow-y: auto;
  width: 100%;
}

// The game's own banner art, which carries its name — so the card needs no
// separate title for the game.
// Every banner is 16:9; reserving it keeps the lines from jumping when the
// art arrives.
.howto-art {
  aspect-ratio: 16 / 9;
  border-radius: 12px 12px 0 0;
  display: block;
  width: 100%;
}

.howto-body {
  padding: 1rem 1.25rem 1.25rem;
}

.howto-title {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0 0 0.75rem;
}

.howto-lines {
  list-style: none;
  margin: 0 0 1.25rem;
  padding: 0;
}

.howto-line {
  align-items: flex-start;
  display: flex;
  font-size: 0.95rem;
  gap: 0.75rem;
  line-height: 1.35;
  margin-bottom: 0.7rem;

  i {
    color: #ffc107;
    flex: 0 0 1.25rem;
    font-size: 1.1rem;
    line-height: 1.3;
    text-align: center;
  }
}
</style>
