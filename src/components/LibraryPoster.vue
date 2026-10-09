<template>
  <div class="library-poster-screen">
    <BackLink/>
    <h1 class="poster-title">Library Poster</h1>
    <p class="poster-subtitle">Turn your library into one big printable poster of all your little posters.</p>

    <div class="poster-options">
      <button
        v-for="option in modes"
        :key="option.mode"
        type="button"
        class="poster-mode"
        :class="{ selected: mode === option.mode }"
        :disabled="generating"
        @click="mode = option.mode"
      >
        {{ option.label }}
      </button>
    </div>
    <p class="poster-count-line">
      <template v-if="mode !== 'mosaic'">{{ selectedEntries.length }} movie{{ selectedEntries.length === 1 ? '' : 's' }} · </template>{{ layoutLabel }}
    </p>

    <!-- Fade-the-rest highlight (feedback): only meaningful on the grids. -->
    <div v-if="mode !== 'mosaic'" class="highlight-row">
      <input
        v-model="highlight"
        type="search"
        class="form-control highlight-input"
        placeholder="Highlight a genre, actor, keyword… (optional)"
        :disabled="generating"
        @focus="onHighlightFocus"
        @blur="onHighlightBlur"
      >
      <div v-if="highlightSuggestions.length" class="highlight-suggestions">
        <button
          v-for="option in highlightSuggestions"
          :key="option.kind + option.label"
          type="button"
          class="highlight-suggestion"
          @click="chooseHighlight(option)"
        >
          {{ option.label }} <span class="suggestion-kind">{{ option.kind }}</span>
        </button>
      </div>
    </div>

    <!-- Mosaic target picker: which poster to recreate from all the others -->
    <div v-if="mode === 'mosaic'" class="mosaic-picker">
      <div class="mosaic-detail-row">
        <button
          v-for="option in [{ key: 'classic', label: 'Classic' }, { key: 'fine', label: 'Fine detail' }]"
          :key="option.key"
          type="button"
          class="poster-mode mosaic-detail"
          :class="{ selected: mosaicDetail === option.key }"
          :disabled="generating"
          @click="mosaicDetail = option.key"
        >
          {{ option.label }}
        </button>
      </div>
      <div v-if="mosaicTarget" class="mosaic-target">
        <img :src="`https://image.tmdb.org/t/p/w185${mosaicTarget.movie.poster_path}`" :alt="mosaicTarget.movie.title" class="mosaic-target-poster">
        <span class="mosaic-target-name">{{ mosaicTarget.movie.title }}</span>
        <button type="button" class="mosaic-clear" @click="mosaicTarget = null">Change</button>
      </div>
      <template v-else>
        <input
          v-model="mosaicQuery"
          type="search"
          class="form-control highlight-input"
          placeholder="Search your library for the poster to recreate…"
          :disabled="generating"
        >
        <div v-if="mosaicMatches.length" class="mosaic-matches">
          <button
            v-for="match in mosaicMatches"
            :key="match.dbKey"
            type="button"
            class="mosaic-match"
            @click="mosaicTarget = match; mosaicQuery = ''"
          >
            <img :src="`https://image.tmdb.org/t/p/w92${match.movie.poster_path}`" :alt="match.movie.title" class="mosaic-match-poster">
            <span class="mosaic-match-name">{{ match.movie.title }}</span>
          </button>
        </div>
      </template>
    </div>

    <button
      type="button"
      class="btn-game btn-game-primary generate-btn"
      :disabled="generating || (mode === 'mosaic' ? !mosaicTarget : !selectedEntries.length)"
      @click="mode === 'mosaic' ? generateMosaic() : generate()"
    >
      {{ generating ? `Building… ${progress}/${progressTotal}` : (mode === 'mosaic' ? 'Make my mosaic' : 'Make my poster') }}
    </button>

    <p v-if="error" class="poster-error">{{ error }}</p>

    <div v-if="resultUrl" class="poster-result">
      <!-- The rendered artifact. On iOS the reliable "save this" path is the
           share sheet (button below) or long-pressing the image itself. -->
      <img :src="resultUrl" alt="Your library poster" class="poster-image">
      <div class="poster-actions">
        <button v-if="canShare" type="button" class="btn-game btn-game-primary" @click="share">Save / Share</button>
        <p class="poster-hint">{{ canShare ? 'Or long-press the image to save it.' : 'Long-press (or right-click) the image to save it.' }}</p>
      </div>
    </div>
  </div>
</template>

<script>
// Bug-report request: "produce some kind of actual like printable artifact
// something like when you reach 100 movies you can make a poster of all
// your little posters." Selection and grid math are pure
// (posterArtifact.js); this component draws the canvas and hands the PNG to
// the share sheet. Poster tiles load with crossOrigin so the canvas stays
// exportable — TMDB sends CORS headers (the same reliance Poster Zoom's
// pixel sampling already has).
import BackLink from './games/BackLink.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { pickPosterEntries, gridLayout, tilePosition, posterCaption, entryMatchesHighlight, assignMosaicCells, collectHighlightOptions, suggestHighlights } from '../assets/javascript/posterArtifact.js';
import { withoutShorts, includeShortsSetting } from '../assets/javascript/shorts.js';

const TILE_SOURCE_SIZE = 'w185';
const LOAD_CONCURRENCY = 12;

export default {
  name: 'LibraryPoster',
  components: { BackLink },
  data () {
    return {
      mode: 'top',
      generating: false,
      progress: 0,
      resultUrl: null,
      error: null,
      highlight: '', // fade non-matching tiles (genre/actor/keyword/director)
      highlightFocused: false,
      highlightOptions: null, // built lazily on first focus (large)
      mosaicQuery: '',
      mosaicTarget: null, // library entry whose poster the mosaic recreates
      // classic: bigger tiles you can still recognize up close.
      // fine: ~3x the cells — sharper image, posters become texture.
      mosaicDetail: 'classic'
    };
  },
  computed: {
    library () {
      return withoutShorts(this.$store.getters.allMoviesAsArray, includeShortsSetting(this.$store.state));
    },
    modes () {
      return [
        { mode: 'top', label: 'My top 100' },
        { mode: 'year', label: 'This year' },
        { mode: 'all', label: 'Everything' },
        { mode: 'mosaic', label: 'Mosaic' }
      ];
    },
    highlightSuggestions () {
      if (!this.highlightFocused || !this.highlightOptions) return [];
      return suggestHighlights(this.highlightOptions, this.highlight);
    },
    mosaicMatches () {
      const needle = this.mosaicQuery.trim().toLowerCase();
      if (!needle) return [];
      return this.library
        .filter((entry) => entry?.movie?.poster_path && (entry.movie.title || '').toLowerCase().includes(needle))
        .slice(0, 8);
    },
    selectedEntries () {
      return pickPosterEntries(this.library, this.mode, getRating);
    },
    layout () {
      return gridLayout(this.selectedEntries.length);
    },
    layoutLabel () {
      if (this.mode === 'mosaic') {
        return this.mosaicTarget ? `rebuilt from ${this.posterLibrary.length} posters` : 'pick a movie below';
      }
      return this.layout ? `${this.layout.cols} × ${this.layout.rows} grid` : 'nothing to show yet';
    },
    posterLibrary () {
      return this.library.filter((entry) => entry?.movie?.poster_path);
    },
    canShare () {
      return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
    },
    progressTotal () {
      return this.mode === 'mosaic' ? this.posterLibrary.length : this.selectedEntries.length;
    }
  },
  beforeUnmount () {
    if (this.resultUrl) URL.revokeObjectURL(this.resultUrl);
  },
  methods: {
    onHighlightFocus () {
      this.highlightFocused = true;
      if (!this.highlightOptions) {
        // Built once — every distinct genre/person/keyword in the library.
        this.highlightOptions = collectHighlightOptions(this.library);
      }
    },
    onHighlightBlur () {
      // Delayed so a tap on a suggestion lands before the list hides.
      setTimeout(() => { this.highlightFocused = false; }, 200);
    },
    chooseHighlight (option) {
      this.highlight = option.label;
      this.highlightFocused = false;
    },
    loadTile (path, size) {
      return new Promise((resolve) => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => resolve(image);
        // A dead poster URL becomes a dark tile rather than a failed poster.
        image.onerror = () => resolve(null);
        // ?canvas=1 misses the service worker's poster cache on purpose: that
        // cache is full of OPAQUE responses (cached from plain <img> loads),
        // and serving an opaque response to this crossOrigin request fails —
        // which is what blanked most tiles (bug report, with screenshot).
        // The param goes to TMDB directly, which sends real CORS headers.
        image.src = `https://image.tmdb.org/t/p/${size || TILE_SOURCE_SIZE}${path}?canvas=1`;
      });
    },
    async generate () {
      const entries = this.selectedEntries;
      const layout = this.layout;
      if (!entries.length || !layout || this.generating) return;

      this.generating = true;
      this.progress = 0;
      this.error = null;
      if (this.resultUrl) {
        URL.revokeObjectURL(this.resultUrl);
        this.resultUrl = null;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = layout.width;
        canvas.height = layout.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('canvas unavailable');

        context.fillStyle = '#141414';
        context.fillRect(0, 0, layout.width, layout.height);

        // Small worker pool — the service worker's CacheFirst rule for TMDB
        // images makes most of these instant after first view.
        let nextIndex = 0;
        const drawOne = async () => {
          while (nextIndex < entries.length) {
            const index = nextIndex++;
            const entry = entries[index];
            const tile = await this.loadTile(entry.movie.poster_path);
            const { x, y } = tilePosition(index, layout);
            if (tile) {
              context.drawImage(tile, x, y, layout.tileW, layout.tileH);
              // Highlight mode: non-matching tiles fade back so the matches
              // pop. A dark overlay, NOT ctx.filter — WebKit exposes the
              // filter property but doesn't implement it on canvas, so the
              // grayscale approach silently no-opped on iPhone (bug report:
              // "doesn't seem to make any difference at all").
              if (this.highlight.trim() && !entryMatchesHighlight(entry, this.highlight)) {
                context.fillStyle = 'rgba(10, 10, 10, 0.85)';
                context.fillRect(x, y, layout.tileW, layout.tileH);
              }
            } else {
              context.fillStyle = '#2a2a2a';
              context.fillRect(x, y, layout.tileW, layout.tileH);
            }
            this.progress += 1;
          }
        };
        await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, entries.length) }, drawOne));

        const caption = this.highlight.trim()
          ? `${this.highlight.trim()} · ${posterCaption(this.mode, entries.length)}`
          : posterCaption(this.mode, entries.length);
        await this.drawCaption(context, caption, layout.width, layout.height - layout.footer / 2, Math.max(24, Math.round(layout.width / 40)));

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw new Error('could not export the poster');
        this.resultBlob = blob;
        this.resultUrl = URL.createObjectURL(blob);
      } catch (error) {
        console.error('Poster generation failed:', error);
        this.error = "Couldn't build the poster — try again, or try a smaller selection.";
      } finally {
        this.generating = false;
      }
    },
    // ---- Mosaic (photomosaic, quadrant-signature matching, no deps) ----
    // A tile/cell signature is its 2x2 quadrant colors: 12 numbers. That
    // captures structure (dark-top/light-bottom), not just average tint —
    // round-two feedback: "finer tuned imagery... more pixels working."
    signatureOf (image) {
      const probe = document.createElement('canvas');
      probe.width = 2;
      probe.height = 2;
      const ctx = probe.getContext('2d');
      ctx.drawImage(image, 0, 0, 2, 2);
      return Array.from(ctx.getImageData(0, 0, 2, 2).data).filter((_, i) => i % 4 !== 3);
    },
    readSignatureCache () {
      try { return JSON.parse(localStorage.getItem('poster-signatures-v2') || '{}'); } catch { return {}; }
    },
    async generateMosaic () {
      if (!this.mosaicTarget || this.generating) return;
      this.generating = true;
      this.progress = 0;
      this.error = null;
      if (this.resultUrl) {
        URL.revokeObjectURL(this.resultUrl);
        this.resultUrl = null;
      }

      try {
        // 1. The target poster, downsampled into cells (2:3). Fine detail
        // trades recognizable-up-close tiles for a sharper far reading —
        // the only real cost of the bigger grid (compute is ~2s more).
        const COLS = this.mosaicDetail === 'fine' ? 80 : 48;
        const ROWS = this.mosaicDetail === 'fine' ? 120 : 72;
        const target = await this.loadTile(this.mosaicTarget.movie.poster_path);
        if (!target) throw new Error('target poster failed to load');
        // Sample at 2x the grid so each cell gets its own 2x2 signature.
        const grid = document.createElement('canvas');
        grid.width = COLS * 2;
        grid.height = ROWS * 2;
        const gridCtx = grid.getContext('2d');
        gridCtx.drawImage(target, 0, 0, COLS * 2, ROWS * 2);
        const pixels = gridCtx.getImageData(0, 0, COLS * 2, ROWS * 2).data;
        const pixelAt = (x, y) => {
          const i = (y * COLS * 2 + x) * 4;
          return [pixels[i], pixels[i + 1], pixels[i + 2]];
        };
        const cellSignatures = [];
        for (let cy = 0; cy < ROWS; cy++) {
          for (let cx = 0; cx < COLS; cx++) {
            cellSignatures.push([
              ...pixelAt(cx * 2, cy * 2), ...pixelAt(cx * 2 + 1, cy * 2),
              ...pixelAt(cx * 2, cy * 2 + 1), ...pixelAt(cx * 2 + 1, cy * 2 + 1)
            ]);
          }
        }

        // 2. Every library poster's signature (cached across builds).
        const cache = this.readSignatureCache();
        const tiles = this.posterLibrary;
        const tileSignatures = new Array(tiles.length);
        const tileImages = new Array(tiles.length);
        let nextIndex = 0;
        const worker = async () => {
          while (nextIndex < tiles.length) {
            const index = nextIndex++;
            const path = tiles[index].movie.poster_path;
            if (cache[path]) {
              tileSignatures[index] = cache[path];
              this.progress += 1;
              continue;
            }
            const image = await this.loadTile(path, 'w92');
            if (image) {
              tileSignatures[index] = this.signatureOf(image);
              tileImages[index] = image;
              cache[path] = tileSignatures[index];
            } else {
              tileSignatures[index] = new Array(12).fill(15);
            }
            this.progress += 1;
          }
        };
        await Promise.all(Array.from({ length: 12 }, worker));
        try { localStorage.setItem('poster-signatures-v2', JSON.stringify(cache)); } catch { /* full is fine */ }

        // 3. Assign (pure, loose reuse cap) and render.
        const assignment = assignMosaicCells(cellSignatures, tileSignatures, { cols: COLS });
        // Print-scale render (feedback: "doesn't seem big enough to really
        // print"): Classic 2688x4032 (~18x27in at 150 DPI), Fine 2400x3600
        // (~16x24in) — both under iOS's ~16M-pixel canvas ceiling, and the
        // w92 tiles are still DOWNscaling at these cell sizes.
        const CELL = this.mosaicDetail === 'fine' ? 30 : 56;
        const canvas = document.createElement('canvas');
        canvas.width = COLS * CELL;
        canvas.height = ROWS * CELL + Math.round(CELL * 2.2);
        const context = canvas.getContext('2d');
        context.fillStyle = '#141414';
        context.fillRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < assignment.length; i++) {
          const tileIdx = assignment[i];
          const x = (i % COLS) * CELL;
          const y = Math.floor(i / COLS) * CELL;
          let image = tileImages[tileIdx];
          if (!image) {
            image = await this.loadTile(tiles[tileIdx].movie.poster_path, 'w92');
            tileImages[tileIdx] = image;
          }
          if (image) context.drawImage(image, x, y, CELL, CELL);
          // Tint toward the cell's average color — sharpens the likeness.
          const sig = cellSignatures[i];
          const r = Math.round((sig[0] + sig[3] + sig[6] + sig[9]) / 4);
          const g = Math.round((sig[1] + sig[4] + sig[7] + sig[10]) / 4);
          const b = Math.round((sig[2] + sig[5] + sig[8] + sig[11]) / 4);
          context.fillStyle = `rgba(${r}, ${g}, ${b}, 0.34)`;
          context.fillRect(x, y, CELL, CELL);
        }

        await this.drawCaption(context, `${this.mosaicTarget.movie.title} · made of ${tiles.length} movies · Cinema Roll`, canvas.width, canvas.height - Math.round(canvas.width / 56), Math.round(canvas.width / 38));

        // JPEG, not PNG: a print-scale photographic mosaic as PNG is a
        // 30MB+ share-sheet chore; at 0.92 quality the JPEG is a fraction
        // of that with no visible cost on photographic content.
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
        if (!blob) throw new Error('could not export the mosaic');
        this.resultBlob = blob;
        this.resultUrl = URL.createObjectURL(blob);
      } catch (error) {
        console.error('Mosaic generation failed:', error);
        this.error = "Couldn't build the mosaic — try again.";
      } finally {
        this.generating = false;
      }
    },
    // Marquee-style caption (feedback: "old movie poster font... like a
    // marquee") — Limelight, the art-deco cinema-marquee face, loaded
    // before drawing so the canvas doesn't fall back mid-render.
    async drawCaption (context, text, canvasWidth, baselineY, size) {
      try { await document.fonts.load(`${size}px Limelight`); } catch { /* fallback below */ }
      context.fillStyle = '#ffc107';
      context.font = `${size}px Limelight, Georgia, serif`;
      context.textAlign = 'center';
      context.fillText(text, canvasWidth / 2, baselineY);
    },
    async share () {
      if (!this.resultBlob) return;
      try {
        const extension = this.resultBlob.type === 'image/jpeg' ? 'jpg' : 'png';
        const file = new File([this.resultBlob], `cinema-roll-poster.${extension}`, { type: this.resultBlob.type });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          await navigator.share({ title: 'Cinema Roll poster' });
          return;
        }
        await navigator.share({ files: [file], title: 'Cinema Roll poster' });
      } catch (error) {
        // Dismissing the share sheet rejects — nothing to surface.
        if (error?.name !== 'AbortError') console.error('Share failed:', error);
      }
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/screen-top';
@import '@/assets/scss/game-buttons';

.library-poster-screen {
  color: #eee;
  padding: $screen-top-gap 1rem 2rem;
  text-align: center;
}

.highlight-row,
.mosaic-picker {
  margin: 0 auto 0.75rem;
  max-width: 420px;
}

.highlight-suggestions {
  background: #161616;
  border: 1px solid #2e2e2e;
  border-radius: 8px;
  margin-top: 0.35rem;
  max-height: 240px;
  overflow-y: auto;
  text-align: left;
}

.highlight-suggestion {
  background: none;
  border: none;
  color: #eee;
  display: block;
  font-size: 0.85rem;
  min-height: 40px;
  padding: 0.4rem 0.8rem;
  text-align: left;
  width: 100%;

  &:active {
    background: #1f1f1f;
  }
}

.suggestion-kind {
  color: #888;
  font-size: 0.7rem;
  margin-left: 0.4rem;
}

.highlight-input {
  background: #101010;
  border-color: #3a3a3a;
  color: #eee;
  min-width: 0;

  &::placeholder { color: #888; }
  &:focus { background: #101010; border-color: #666; box-shadow: none; color: #eee; }
}

.mosaic-detail-row {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
  margin-bottom: 0.75rem;
}

.mosaic-detail {
  font-size: 0.8rem;
}

.mosaic-matches {
  display: flex;
  gap: 0.6rem;
  margin-top: 0.6rem;
  overflow-x: auto;
  padding-bottom: 0.3rem;
}

.mosaic-match {
  background: none;
  border: none;
  color: #ccc;
  flex: 0 0 72px;
  padding: 0;
  width: 72px;
}

.mosaic-match-poster {
  border: 1px solid #2e2e2e;
  border-radius: 6px;
  height: 108px;
  object-fit: cover;
  width: 72px;
}

.mosaic-match-name {
  display: block;
  font-size: 0.7rem;
  line-height: 1.2;
  margin-top: 0.25rem;
}

.mosaic-target {
  align-items: center;
  display: flex;
  flex-direction: column;
  row-gap: 0.3rem;
}

.mosaic-target-poster {
  border: 1px solid #2e2e2e;
  border-radius: 6px;
  height: 138px;
  width: 92px;
}

.mosaic-target-name {
  color: #eee;
  font-size: 0.85rem;
  font-weight: 600;
}

.mosaic-clear {
  background: none;
  border: none;
  color: #999;
  font-size: 0.75rem;
  min-height: 32px;
  text-decoration: underline;
}

.poster-title {
  margin: 0;
}

.poster-subtitle {
  color: #adb5bd;
  font-size: 0.85rem;
  margin: 0.25rem auto 1.25rem;
  max-width: 26rem;
}

.poster-options {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.poster-mode {
  background: rgba(255, 255, 255, 0.04);
  border: 1.5px solid #333;
  border-radius: 999px;
  color: #eee;
  font-size: 0.85rem;
  padding: 0.4rem 0.9rem;
}

.poster-mode.selected {
  border-color: #ffc107;
  color: #ffc107;
}

/* Mobile-first: press state, no hover. */
.poster-mode:active:not(:disabled) {
  opacity: 0.7;
}

.poster-count-line {
  color: #adb5bd;
  font-size: 0.8rem;
  margin: 0.5rem 0 1rem;
}

.generate-btn {
  margin: 0 auto;
  max-width: 320px;
  width: 100%;
}

.poster-error {
  color: #ff6a6a;
  font-size: 0.85rem;
  margin-top: 0.75rem;
}

.poster-result {
  margin-top: 1.25rem;
}

.poster-image {
  border: 1px solid #333;
  border-radius: 0.35rem;
  max-width: 100%;
}

.poster-actions {
  margin-top: 0.75rem;
}

.poster-hint {
  color: #adb5bd;
  font-size: 0.75rem;
  margin-top: 0.5rem;
}
</style>
