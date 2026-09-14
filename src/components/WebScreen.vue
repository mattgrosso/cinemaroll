<template>
  <div class="web-screen">
    <BackLink/>

    <div class="web-head">
      <h1 class="web-title">{{ heading }}</h1>
      <p class="web-subtitle">{{ subtitle }}</p>
    </div>

    <div v-if="!ready" class="web-empty">
      <p>Rate a few films that share people before there is a web to look at.</p>
    </div>

    <template v-else>
      <div ref="stage" class="web-stage">
        <!-- One canvas, redrawn on every change. touch-action: none — the
             screen is the picture; a finger on it pans, two zoom, and the
             page has nothing below worth scrolling to. -->
        <canvas
          ref="canvas"
          class="web-canvas"
          role="img"
          :aria-label="ariaLabel"
          @pointerdown="onPointerDown"
          @wheel="onWheel"
        ></canvas>

        <div class="web-zoom">
          <button type="button" aria-label="Zoom in" @click="zoomBy(1.6)">+</button>
          <button type="button" aria-label="Zoom out" @click="zoomBy(1 / 1.6)">−</button>
          <button type="button" aria-label="Fit the whole web" @click="fitView(true)"><i class="bi bi-arrows-fullscreen"></i></button>
        </div>

        <div v-if="settling" class="web-settling">
          <span class="web-settling-dot"></span> weaving… {{ settlingPercent }}%
        </div>

        <!-- The card for whatever was tapped. Lives over the canvas so the
             picture never jumps when it appears. -->
        <div v-if="selected" class="web-card" :class="`web-card-${selected.kind}`">
          <button type="button" class="web-card-close" aria-label="Close" @click="select(null)">&times;</button>
          <div class="web-card-head">
            <img v-if="selected.kind === 'movie' && selected.poster" :src="posterUrl(selected, 'w92')" :alt="selected.title" class="web-card-poster">
            <div class="web-card-titles">
              <h2 class="web-card-title">
                <span :style="selected.kind === 'movie' ? { color: scoreColor(selected.score) } : null">{{ selected.label }}</span>
                <span v-if="selected.kind === 'movie' && selected.year" class="web-card-year">({{ selected.year }})</span>
              </h2>
              <p class="web-card-line">{{ selectedLine }}</p>
            </div>
          </div>
          <div class="web-card-actions">
            <button v-if="selected.kind === 'movie'" type="button" class="web-btn" @click="openMovie(selected)">
              <i class="bi bi-film"></i> Open film
            </button>
            <button v-if="selected.id !== focusId" type="button" class="web-btn web-btn-accent" @click="focusOn(selected)">
              <i class="bi bi-diagram-3"></i> {{ selected.kind === 'movie' ? 'Web around it' : 'Web around them' }}
            </button>
          </div>
          <div v-if="selectedNeighbours.length" class="web-card-links">
            <button
              v-for="node in selectedNeighbours"
              :key="node.id"
              type="button"
              class="web-chip"
              :class="`web-chip-${node.kind}`"
              @click="select(node)"
            >{{ node.label }}<span v-if="node.kind === 'movie' && node.year" class="web-chip-year"> {{ node.year }}</span></button>
          </div>
        </div>
      </div>

      <div class="web-foot">
        <button v-if="focusId" type="button" class="web-btn" @click="showWhole">
          <i class="bi bi-globe2"></i> Whole library
        </button>
        <p class="web-legend">
          <span class="web-legend-swatch" :style="{ background: scoreColor(5.5) }"></span> cooler films
          <span class="web-legend-swatch" :style="{ background: scoreColor(9.5) }"></span> warmer films
          <span class="web-legend-swatch web-legend-person"></span> people in more than one
        </p>
      </div>
    </template>
  </div>
</template>

<script>
// The Web: your library as one picture you can pinch, pan and walk.
//
// Matt, 2026-09-08: "a visualization that lets me zoom in and pan around to
// look at the web of my whole database." The data half lives in web.js
// (pure, tested); this file lays it out with d3-force on a canvas and
// handles the fingers.
//
// Two ways in. `/web` is the WHOLE library — every rated film and everyone
// who appears in more than one — laid out once and remembered (module cache
// plus localStorage, keyed by the web's shape) so the second visit is
// instant. `/web?movie=<tmdbId>` or `/web?person=<name>` is the web AROUND
// one node: two hops out, laid out afresh each time, small enough to label
// everything and to draw posters. Tapping a node shows a card; the card's
// "web around" button walks you to that node's own web, so the thing you
// can do all day is hop person -> film -> person across the library.
import { markRaw } from 'vue';
import { forceSimulation, forceLink, forceManyBody, forceX, forceY, forceCollide } from 'd3-force';
import { quadtree } from 'd3-quadtree';
import BackLink from './games/BackLink.vue';
import { getRating } from '../assets/javascript/GetRating.js';
import { formatScore } from '../assets/javascript/formatScore.js';
import { hashString } from '../assets/javascript/games/gameUtils.js';
import {
  buildWeb,
  focusWeb,
  neighboursOf,
  resolveFocus,
  scoreColor,
  layoutSignature,
  topByDegree,
  webEntries,
  PERSON_COLOR
} from '../assets/javascript/web.js';

// Every number here is a dial.
const LAYOUT_STORAGE_KEY = 'cinemaRoll.web.layout';
const REBUILD_QUIET_MS = 600;
const TAP_SLOP_PX = 6;
const TAP_RADIUS_PX = 16;
const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const CANVAS_BG = '#111418';

// Whole-library layout: many small nodes, weak repulsion, a gentle pull to
// the middle so the films that share nobody make a halo instead of flying
// off. Focus layout: few nodes, room for labels and posters.
// Whole: measured on the real library (3,617 nodes, 7,554 threads) and
// chosen by looking at the result. No collide force and a coarse theta halve
// the cost of a tick. `linkStrength: null` is d3's default (1 / the smaller
// degree), so a hub's threads are slack — a fixed strength pinned every
// co-star at one radius. `chargeMax` is effectively off: a short repulsion
// cutoff piled nodes into shells at exactly that distance from every hub
// (rings all over the picture, 2026-09-09). The whole layout runs in a
// worker (webLayout.worker.js) when the browser has one; `ticksPerFrame` is
// for the main-thread fallback.
const WHOLE = { charge: -30, chargeMax: 1500, theta: 1.2, linkDistance: 22, linkStrength: null, gravity: 0.06, alphaDecay: 0.04, ticksPerFrame: 2, collide: 0 };
const FOCUS = { charge: -260, chargeMax: 900, theta: 0.9, linkDistance: 70, linkStrength: 0.7, gravity: 0.06, alphaDecay: 0.035, ticksPerFrame: 6, collide: 1.4 };
// Bump when the dials change: a remembered layout made with old dials is a
// picture of the old dials.
const LAYOUT_VERSION = 2;
const LABEL_FONT = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const WHOLE_PERSON_LABELS = 28;   // the best-connected people are always named
const WHOLE_MOVIE_LABELS = 90;    // once zoomed in, films in view get names too
const WHOLE_MOVIE_LABEL_SCALE = 2.6;
// In a focus web the centre and its first hop are always named; the second
// hop is named only when the whole thing is small or you have zoomed in —
// 97 labels on a phone-width picture is a wall of text, not a web.
const FOCUS_LABEL_EVERYTHING_UP_TO = 40;
const FOCUS_LABEL_ALL_SCALE = 1.3;
const POSTER_MIN_SCREEN_PX = 34;
const POSTER_MIN_SCALE = 0.4;      // a phone-width focus web sits around 0.6
const POSTER_FOCUS_UP_TO = 260;

// The whole-library layout, kept for the life of the page load. The
// signature is the web's shape; if a film or a credit changed, this is stale.
let layoutCache = { signature: null, positions: null };

function linkForce (links, dial) {
  const force = forceLink(links).id((d) => d.id).distance(dial.linkDistance);
  return dial.linkStrength == null ? force : force.strength(dial.linkStrength);
}

function readStoredLayout () {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.signature || !parsed?.xy) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredLayout (signature, nodes) {
  try {
    const xy = {};
    nodes.forEach((node) => { xy[node.id] = [Math.round(node.x * 10) / 10, Math.round(node.y * 10) / 10]; });
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ signature, xy }));
  } catch {
    // Quota or private mode: the layout is just recomputed next time.
  }
}

export default {
  name: 'WebScreen',
  components: { BackLink },
  data () {
    return {
      web: null,          // the whole thing, from web.js
      graph: null,        // what is on screen: { nodes, links, focus }
      focusId: null,
      selectedId: null,
      settling: false,
      settlingPercent: 0,
      view: { k: 1, tx: 0, ty: 0 },
      size: { w: 0, h: 0 },
      // Non-reactive bits live on `this` outside data(): the simulation, the
      // canvas context, the poster image cache, gesture state.
      pointers: markRaw(new Map()),
      gesture: null,
      tracking: false
    };
  },
  computed: {
    entries () {
      const includeShorts = this.$store.state?.settings?.includeShorts === true;
      return webEntries(this.$store.getters.allMediaAsArray, includeShorts);
    },
    ready () {
      return Boolean(this.web && this.web.links.length);
    },
    focusNode () {
      return this.focusId && this.web ? this.web.byId.get(this.focusId) : null;
    },
    selected () {
      if (!this.selectedId || !this.graph) return null;
      return this.graph.nodes.find((node) => node.id === this.selectedId) || null;
    },
    selectedNeighbours () {
      if (!this.selected || !this.graph) return [];
      const ids = neighboursOf(this.web, this.selected.id);
      const present = new Map(this.graph.nodes.map((node) => [node.id, node]));
      const list = [...ids].map((id) => present.get(id)).filter(Boolean);
      list.sort((a, b) => b.degree - a.degree || String(a.label).localeCompare(String(b.label)));
      return list.slice(0, 40);
    },
    selectedLine () {
      const node = this.selected;
      if (!node) return '';
      if (node.kind === 'movie') {
        const score = node.score == null ? 'unscored' : `${formatScore(node.score)} from you`;
        const threads = node.degree === 1 ? '1 thread' : `${node.degree} threads`;
        return `${score} · ${threads} into your library`;
      }
      const films = node.count === 1 ? '1 film' : `${node.count} films`;
      const directed = node.directed ? ` · directed ${node.directed === node.count ? (node.count === 1 ? 'it' : 'all of them') : node.directed}` : '';
      return `${films} in your library${directed}`;
    },
    heading () {
      const focus = this.focusNode;
      if (!focus) return 'Your web';
      return focus.kind === 'movie' ? `Around ${focus.title}` : `Around ${focus.name}`;
    },
    subtitle () {
      if (!this.web) return 'Weaving your library…';
      if (!this.ready) return '';
      const people = this.web.nodes.filter((node) => node.kind === 'person').length;
      const films = this.web.nodes.length - people;
      if (this.focusNode && this.graph) {
        const here = this.graph.nodes.length - 1;
        return `${here} ${here === 1 ? 'thing' : 'things'} within two steps. Tap to look closer, pinch to zoom.`;
      }
      return `${films.toLocaleString()} films and ${people.toLocaleString()} people who appear in more than one, joined by ${this.web.links.length.toLocaleString()} credits. Pinch to zoom, drag to pan, tap anything.`;
    },
    ariaLabel () {
      return this.heading + (this.graph ? `: ${this.graph.nodes.length} nodes` : '');
    }
  },
  watch: {
    // Wait for the library, don't read it once: a deep link mounts before
    // Firebase data arrives (games rule, learned the hard way).
    // Debounced: while the library streams in from Firebase the getter
    // changes many times a second, and each rebuild is 1,400 ratings plus a
    // fresh layout. Wait for it to go quiet, then build once.
    entries: { immediate: true, handler: 'scheduleRebuild' },
    '$route.query': { handler: 'applyRoute' }
  },
  // The whole screen is the picture (bug report, 2026-09-13: "it's hard to
  // get it to use the whole screen... maybe just a redesign so that it uses
  // more of the real estate"). The shared header comes down for the
  // duration — the one screen in the app that does this — and goes back up
  // on the way out, the way Six Degrees restores its banner.
  created () {
    this.$store.commit?.('setShowHeader', false);
  },
  mounted () {
    window.addEventListener('resize', this.onResize);
    this.posters = new Map();
    this.$nextTick(this.onResize);
  },
  beforeUnmount () {
    this.$store.commit?.('setShowHeader', true);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    window.removeEventListener('resize', this.onResize);
    this.stopTracking();
    this.stopSimulation();
    if (this.frame) cancelAnimationFrame(this.frame);
  },
  methods: {
    scoreColor,
    posterUrl (node, size = 'w92') {
      return node.poster ? `https://image.tmdb.org/t/p/${size}${node.poster}` : null;
    },

    // --- Building -----------------------------------------------------------
    scheduleRebuild () {
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      // The first build is immediate when the library is already here (a
      // hash navigation from another screen); later changes wait for quiet.
      const delay = this.web ? REBUILD_QUIET_MS : (this.entries.length ? 0 : REBUILD_QUIET_MS);
      this.rebuildTimer = setTimeout(() => { this.rebuildTimer = null; this.rebuildWeb(); }, delay);
    },
    rebuildWeb () {
      if (!this.entries.length) { this.web = null; this.graph = null; return; }
      // Same films, same credits: nothing to rebuild (the store hands back a
      // new array for every unrelated commit).
      const stamp = `${this.entries.length}:${hashString(this.entries.map((entry) => `${entry.dbKey || entry.movie.id}@${entry.updatedAt || ''}`).join('|'))}`;
      if (this.web && stamp === this.entriesStamp) return;
      this.entriesStamp = stamp;
      const scoreFor = (entry) => {
        const rating = getRating(entry);
        return rating && typeof rating.calculatedTotal === 'number' ? rating.calculatedTotal : null;
      };
      // markRaw: 3,600 nodes behind Vue proxies made every draw ten times
      // slower and the weave unwatchable. Nothing here needs to be reactive
      // per node; `graph` and `web` are swapped whole when they change.
      this.web = markRaw(buildWeb(this.entries, { scoreFor }));
      this.applyRoute();
    },
    applyRoute () {
      if (!this.web) return;
      const focusId = resolveFocus(this.web, this.$route?.query || {});
      this.focusId = focusId;
      this.selectedId = null;
      if (focusId) this.showFocus(focusId);
      else this.showWholeGraph();
      this.$nextTick(() => { this.onResize(); });
    },
    showFocus (focusId) {
      const cut = markRaw(focusWeb(this.web, focusId));
      this.graph = cut;
      this.selectedId = focusId;
      this.layout(cut, FOCUS, null);
    },
    showWholeGraph () {
      const signature = `${LAYOUT_VERSION}:${layoutSignature(this.web)}`;
      const nodes = this.web.nodes.map((node) => ({ ...node }));
      const links = this.web.links.map((link) => ({ ...link }));
      this.graph = markRaw({ nodes, links, focus: null });

      let positions = layoutCache.signature === signature ? layoutCache.positions : null;
      if (!positions) {
        const stored = readStoredLayout();
        if (stored && stored.signature === signature) positions = stored.xy;
      }
      this.layout(this.graph, WHOLE, positions ? { signature, positions } : null);
    },

    // --- Layout ---------------------------------------------------------------
    layout (graph, dial, remembered) {
      this.stopSimulation();
      const nodes = graph.nodes;
      const links = graph.links;

      // Links carry ids from web.js; drawing wants the node objects on both
      // ends (d3 would do this itself, but the remembered path skips d3).
      const byId = new Map(nodes.map((node) => [node.id, node]));
      links.forEach((link) => {
        link.source = byId.get(typeof link.source === 'string' ? link.source : link.source.id);
        link.target = byId.get(typeof link.target === 'string' ? link.target : link.target.id);
      });

      if (remembered) {
        let placed = 0;
        nodes.forEach((node) => {
          const xy = remembered.positions[node.id];
          if (xy) { node.x = xy[0]; node.y = xy[1]; placed += 1; }
        });
        if (placed === nodes.length) {
          this.settling = false;
          this.settled = true;
          this.fitView(false);
          this.draw();
          return;
        }
      }

      // Start on a disc whose area grows with the node count, so the first
      // frames aren't a single exploding point.
      const radius = Math.sqrt(nodes.length) * 12;
      nodes.forEach((node, i) => {
        if (node.x == null) {
          const angle = i * 2.399963;              // golden angle: even spread
          const r = radius * Math.sqrt((i + 0.5) / nodes.length);
          node.x = Math.cos(angle) * r;
          node.y = Math.sin(angle) * r;
        }
      });
      if (graph.focus) {
        const focus = nodes.find((node) => node.id === graph.focus);
        if (focus) { focus.x = 0; focus.y = 0; focus.fx = 0; focus.fy = 0; }
      }

      this.dial = dial;
      this.settled = false;
      this.settling = true;
      this.settlingPercent = 0;
      this.signature = remembered?.signature || (graph.focus ? null : `${LAYOUT_VERSION}:${layoutSignature(this.web)}`);
      this.fitView(false);

      if (!graph.focus && typeof Worker !== 'undefined') {
        this.layoutInWorker(graph, dial);
        return;
      }

      const simulation = forceSimulation(nodes)
        .force('link', linkForce(links, dial))
        .force('charge', forceManyBody().strength(dial.charge).distanceMax(dial.chargeMax).theta(dial.theta))
        .force('x', forceX(0).strength(dial.gravity))
        .force('y', forceY(0).strength(dial.gravity))
        .alphaDecay(dial.alphaDecay)
        .stop();
      if (dial.collide) simulation.force('collide', forceCollide((d) => this.nodeRadiusWorld(d, 1) * dial.collide).iterations(1));
      this.simulation = simulation;
      this.frame = requestAnimationFrame(this.step);
    },
    // The whole library settles in a worker; the screen only copies positions
    // in and draws. If the worker fails to start (a strict CSP, an old
    // browser), the main-thread path takes over.
    layoutInWorker (graph, dial) {
      let worker;
      try {
        worker = new Worker(new URL('../assets/javascript/webLayout.worker.js', import.meta.url));
      } catch {
        this.layoutOnMainThread(graph, dial);
        return;
      }
      this.worker = worker;
      const nodes = graph.nodes;
      const min = 0.001;
      worker.onmessage = (event) => {
        if (this.worker !== worker) return;
        const { type, alpha, positions } = event.data;
        for (let i = 0; i < nodes.length; i += 1) { nodes[i].x = positions[i * 2]; nodes[i].y = positions[i * 2 + 1]; }
        if (type === 'tick') {
          this.settlingPercent = Math.min(99, Math.round((1 - Math.log(alpha) / Math.log(min)) * 100));
          this.fitView(false);
          this.draw();
          return;
        }
        this.worker = null;
        worker.terminate();
        this.finishLayout();
      };
      worker.onerror = () => {
        if (this.worker !== worker) return;
        this.worker = null;
        worker.terminate();
        this.layoutOnMainThread(graph, dial);
      };
      worker.postMessage({
        nodes: nodes.map((node) => ({ id: node.id, x: node.x, y: node.y, fx: node.fx ?? null, fy: node.fy ?? null, r: this.nodeRadiusWorld(node, 1) })),
        links: graph.links.map((link) => ({ source: link.source.id, target: link.target.id })),
        dial
      });
    },
    layoutOnMainThread (graph, dial) {
      const simulation = forceSimulation(graph.nodes)
        .force('link', linkForce(graph.links, dial))
        .force('charge', forceManyBody().strength(dial.charge).distanceMax(dial.chargeMax).theta(dial.theta))
        .force('x', forceX(0).strength(dial.gravity))
        .force('y', forceY(0).strength(dial.gravity))
        .alphaDecay(dial.alphaDecay)
        .stop();
      if (dial.collide) simulation.force('collide', forceCollide((d) => this.nodeRadiusWorld(d, 1) * dial.collide).iterations(1));
      this.simulation = simulation;
      this.frame = requestAnimationFrame(this.step);
    },
    finishLayout () {
      this.settling = false;
      this.settled = true;
      this.simulation = null;
      this.fitView(false);
      this.draw();
      if (this.signature && this.graph && !this.graph.focus) {
        layoutCache = { signature: this.signature, positions: Object.fromEntries(this.graph.nodes.map((node) => [node.id, [node.x, node.y]])) };
        writeStoredLayout(this.signature, this.graph.nodes);
      }
    },
    step () {
      const simulation = this.simulation;
      if (!simulation) return;
      for (let i = 0; i < this.dial.ticksPerFrame; i += 1) simulation.tick();
      const alpha = simulation.alpha();
      const min = simulation.alphaMin();
      this.settlingPercent = Math.min(99, Math.round((1 - Math.log(alpha) / Math.log(min)) * 100));
      // Follow the layout while it settles: a still-growing web that drifts
      // out of frame is just confusing.
      this.fitView(false);
      this.draw();
      if (alpha > min) {
        this.frame = requestAnimationFrame(this.step);
        return;
      }
      this.finishLayout();
    },
    stopSimulation () {
      if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; }
      if (this.simulation) { this.simulation.stop(); this.simulation = null; }
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      this.settling = false;
    },

    // --- Sizes ------------------------------------------------------------------
    onResize () {
      const stage = this.$refs.stage;
      const canvas = this.$refs.canvas;
      if (!stage || !canvas) return;
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      const changed = w !== this.size.w || h !== this.size.h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      this.size = { w, h };
      this.dpr = dpr;
      this.ctx = canvas.getContext('2d');
      if (changed && this.settled) this.fitView(false);
      this.draw();
    },
    // Node radius in WORLD units at scale k, chosen so nodes grow with the
    // zoom but slower than it: sqrt(k) on screen.
    nodeRadiusWorld (node, k) {
      const base = node.kind === 'movie' ? 2.6 + 0.45 * Math.sqrt(node.degree || 0) : 1.7 + 0.55 * Math.sqrt(node.count || 1);
      return (base * Math.sqrt(k)) / k;
    },

    // --- The view: world -> screen is x*k + tx ---------------------------------
    fitView (animate) {
      const nodes = this.graph?.nodes;
      if (!nodes?.length || !this.size.w) return;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      nodes.forEach((node) => {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
      });
      if (!Number.isFinite(minX)) return;
      const pad = 28;
      const w = Math.max(1, maxX - minX);
      const h = Math.max(1, maxY - minY);
      const k = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((this.size.w - pad * 2) / w, (this.size.h - pad * 2) / h)));
      const target = { k, tx: this.size.w / 2 - ((minX + maxX) / 2) * k, ty: this.size.h / 2 - ((minY + maxY) / 2) * k };
      if (!animate) { this.view = target; return; }
      this.animateView(target);
    },
    animateView (target) {
      const from = { ...this.view };
      const start = performance.now();
      const duration = 260;
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = 1 - Math.pow(1 - t, 3);
        this.view = { k: from.k + (target.k - from.k) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e };
        this.draw();
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    toWorld (sx, sy) {
      const { k, tx, ty } = this.view;
      return { x: (sx - tx) / k, y: (sy - ty) / k };
    },
    stagePoint (event) {
      const rect = this.$refs.canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    zoomAt (factor, about) {
      const { k, tx, ty } = this.view;
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, k * factor));
      const f = next / k;
      const ax = about ? about.x : this.size.w / 2;
      const ay = about ? about.y : this.size.h / 2;
      this.view = { k: next, tx: ax - (ax - tx) * f, ty: ay - (ay - ty) * f };
      this.draw();
    },
    zoomBy (factor) {
      this.zoomAt(factor, null);
    },
    panBy (dx, dy) {
      this.view = { ...this.view, tx: this.view.tx + dx, ty: this.view.ty + dy };
      this.draw();
    },

    // --- Gestures (the CoverageMap pattern: one pointer drags, two pinch,
    // and a gesture that moved is not a tap) ---------------------------------
    onPointerDown (event) {
      this.pointers.set(event.pointerId, this.stagePoint(event));
      const points = [...this.pointers.values()];
      this.gesture = {
        moved: this.gesture?.moved || false,
        start: points.length === 1 ? points[0] : null,
        last: points.length === 1 ? points[0] : null,
        pinch: points.length === 2 ? this.pinchState(points) : null
      };
      if (!this.tracking) {
        this.tracking = true;
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
      }
    },
    stopTracking () {
      if (!this.tracking) return;
      this.tracking = false;
      window.removeEventListener('pointermove', this.onPointerMove);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
    },
    onPointerMove (event) {
      if (!this.pointers.has(event.pointerId) || !this.gesture) return;
      this.pointers.set(event.pointerId, this.stagePoint(event));
      const points = [...this.pointers.values()];
      if (points.length >= 2) {
        const now = this.pinchState(points);
        const before = this.gesture.pinch || now;
        const factor = before.distance > 0 ? now.distance / before.distance : 1;
        this.zoomAt(factor, before.mid);
        this.panBy(now.mid.x - before.mid.x, now.mid.y - before.mid.y);
        this.gesture.pinch = now;
        this.gesture.moved = true;
        return;
      }
      const last = this.gesture.last;
      if (!last) { this.gesture.last = points[0]; return; }
      const dx = points[0].x - last.x;
      const dy = points[0].y - last.y;
      if (!this.gesture.moved && Math.hypot(points[0].x - this.gesture.start.x, points[0].y - this.gesture.start.y) < TAP_SLOP_PX) return;
      this.gesture.moved = true;
      this.gesture.last = points[0];
      this.panBy(dx, dy);
    },
    onPointerUp (event) {
      const point = this.pointers.get(event.pointerId);
      this.pointers.delete(event.pointerId);
      if (this.pointers.size) {
        const points = [...this.pointers.values()];
        this.gesture.last = points.length === 1 ? points[0] : null;
        this.gesture.start = this.gesture.last;
        this.gesture.pinch = points.length === 2 ? this.pinchState(points) : null;
        return;
      }
      this.stopTracking();
      const moved = this.gesture?.moved;
      this.gesture = null;
      if (!moved && point) this.tapAt(point);
    },
    pinchState ([a, b]) {
      return { distance: Math.hypot(b.x - a.x, b.y - a.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    },
    // A wheel is a zoom here — the screen is the picture, there is no page
    // under it to scroll. A trackpad pinch arrives the same way with ctrlKey.
    onWheel (event) {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      this.zoomAt(factor, this.stagePoint(event));
    },
    tapAt (point) {
      const node = this.nodeAt(point);
      this.select(node);
    },
    nodeAt (point) {
      if (!this.graph) return null;
      const { x, y } = this.toWorld(point.x, point.y);
      const tree = quadtree(this.graph.nodes, (d) => d.x, (d) => d.y);
      const radius = TAP_RADIUS_PX / this.view.k;
      return tree.find(x, y, radius) || null;
    },

    // --- Selection and walking ----------------------------------------------------
    select (node) {
      this.selectedId = node ? node.id : null;
      this.draw();
      if (node) this.ensureVisible(node);
    },
    ensureVisible (node) {
      const { k, tx, ty } = this.view;
      const sx = node.x * k + tx;
      const sy = node.y * k + ty;
      const margin = 40;
      // The card covers the bottom of the stage; keep the node above it.
      const cardTop = this.size.h * 0.55;
      let dx = 0; let dy = 0;
      if (sx < margin) dx = margin - sx;
      if (sx > this.size.w - margin) dx = this.size.w - margin - sx;
      if (sy < margin) dy = margin - sy;
      if (sy > cardTop - margin) dy = cardTop - margin - sy;
      if (dx || dy) this.animateView({ k, tx: tx + dx, ty: ty + dy });
    },
    focusOn (node) {
      const query = node.kind === 'movie' ? { movie: String(node.tmdbId) } : { person: node.name };
      this.$router.push({ path: '/web', query });
    },
    showWhole () {
      this.$router.push({ path: '/web' });
    },
    openMovie (node) {
      this.$router.push(`/movie/${node.tmdbId}`);
    },

    // --- Drawing ------------------------------------------------------------------
    draw () {
      const ctx = this.ctx;
      const graph = this.graph;
      if (!ctx || !graph || !this.size.w) return;
      const { k, tx, ty } = this.view;
      const dpr = this.dpr || 1;
      const { w, h } = this.size;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = CANVAS_BG;
      ctx.fillRect(0, 0, w, h);
      ctx.translate(tx, ty);
      ctx.scale(k, k);

      const selected = this.selected;
      const lit = selected ? new Set([selected.id, ...neighboursOf(this.web, selected.id)]) : null;
      const isFocus = Boolean(graph.focus);

      // What is on screen, in world units, with a margin for labels.
      const left = -tx / k - 40; const top = -ty / k - 40;
      const right = (w - tx) / k + 40; const bottom = (h - ty) / k + 40;
      const onScreen = (node) => node.x >= left && node.x <= right && node.y >= top && node.y <= bottom;

      // Threads. One pass dim, one pass lit, so the lit ones sit on top.
      ctx.lineWidth = (isFocus ? 1.1 : 0.7) / k;
      ctx.lineCap = 'round';
      ctx.strokeStyle = lit ? 'rgba(255,255,255,0.05)' : (isFocus ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.11)');
      ctx.beginPath();
      graph.links.forEach((link) => {
        if (lit && (link.source.id === selected.id || link.target.id === selected.id)) return;
        if (!onScreen(link.source) && !onScreen(link.target)) return;
        ctx.moveTo(link.source.x, link.source.y);
        ctx.lineTo(link.target.x, link.target.y);
      });
      ctx.stroke();
      if (lit) {
        ctx.lineWidth = 1.6 / k;
        ctx.strokeStyle = 'rgba(255, 214, 120, 0.85)';
        ctx.beginPath();
        graph.links.forEach((link) => {
          if (link.source.id !== selected.id && link.target.id !== selected.id) return;
          ctx.moveTo(link.source.x, link.source.y);
          ctx.lineTo(link.target.x, link.target.y);
        });
        ctx.stroke();
      }

      // Nodes. People first so films sit on top where they overlap.
      const drawPosters = isFocus && graph.nodes.length <= POSTER_FOCUS_UP_TO && k >= POSTER_MIN_SCALE;
      const order = graph.nodes.slice().sort((a, b) => (a.kind === 'person' ? 0 : 1) - (b.kind === 'person' ? 0 : 1));
      order.forEach((node) => {
        if (!onScreen(node)) return;
        const r = this.nodeRadiusWorld(node, k);
        const dim = lit && !lit.has(node.id);
        ctx.globalAlpha = dim ? 0.28 : 1;
        if (node.kind === 'movie' && drawPosters && this.posterFor(node)) {
          const img = this.posterFor(node);
          const ph = Math.max(r * 5.2, POSTER_MIN_SCREEN_PX / k); const pw = ph * (2 / 3);
          ctx.save();
          this.roundRect(ctx, node.x - pw / 2, node.y - ph / 2, pw, ph, 2 / k);
          ctx.clip();
          ctx.drawImage(img, node.x - pw / 2, node.y - ph / 2, pw, ph);
          ctx.restore();
          ctx.lineWidth = 1.5 / k;
          ctx.strokeStyle = scoreColor(node.score);
          this.roundRect(ctx, node.x - pw / 2, node.y - ph / 2, pw, ph, 2 / k);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fillStyle = node.kind === 'movie' ? scoreColor(node.score) : PERSON_COLOR;
          ctx.fill();
          if (node.kind === 'person' && node.directed) {
            // A ring marks a director; the more they directed, the fuller.
            ctx.lineWidth = 1.2 / k;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.stroke();
          }
        }
        if (selected && node.id === selected.id) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 4 / k, 0, Math.PI * 2);
          ctx.lineWidth = 2 / k;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;

      // Labels: a budget, spent on what matters at this zoom.
      const labelled = this.labelSet(graph, lit, isFocus, k, onScreen);
      ctx.font = LABEL_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.save();
      // Draw labels at screen scale so they stay 11px whatever the zoom.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      labelled.forEach((node) => {
        const r = this.nodeRadiusWorld(node, k) * k;
        const sx = node.x * k + tx + r + 4;
        const sy = node.y * k + ty;
        const dim = lit && !lit.has(node.id);
        const text = node.kind === 'movie' && node.year ? `${node.label} ’${String(node.year).slice(2)}` : node.label;
        const width = ctx.measureText(text).width;
        ctx.globalAlpha = dim ? 0.35 : 1;
        ctx.fillStyle = 'rgba(17,20,24,0.78)';
        ctx.fillRect(sx - 2, sy - 8, width + 4, 16);
        ctx.fillStyle = node.kind === 'movie' ? '#fff' : '#d6dde5';
        ctx.fillText(text, sx, sy);
      });
      ctx.restore();
      ctx.globalAlpha = 1;
    },
    labelSet (graph, lit, isFocus, k, onScreen) {
      const out = new Map();
      const add = (node) => { if (node && onScreen(node)) out.set(node.id, node); };
      if (this.selected) {
        add(this.selected);
        this.selectedNeighbours.slice(0, 30).forEach(add);
      }
      if (isFocus) {
        const focus = graph.nodes.find((node) => node.id === graph.focus);
        add(focus);
        const firstHop = neighboursOf(this.web, graph.focus);
        graph.nodes.forEach((node) => { if (firstHop.has(node.id)) add(node); });
        if (graph.nodes.length <= FOCUS_LABEL_EVERYTHING_UP_TO || k >= FOCUS_LABEL_ALL_SCALE) graph.nodes.forEach(add);
        return [...out.values()];
      }
      if (!this.topPeople || this.topPeopleFor !== graph) {
        this.topPeople = topByDegree(graph.nodes, WHOLE_PERSON_LABELS, 'person');
        this.topPeopleFor = graph;
      }
      this.topPeople.forEach(add);
      if (k >= WHOLE_MOVIE_LABEL_SCALE) {
        let budget = WHOLE_MOVIE_LABELS;
        for (const node of graph.nodes) {
          if (budget <= 0) break;
          if (node.kind === 'movie' && onScreen(node) && !out.has(node.id)) { out.set(node.id, node); budget -= 1; }
        }
        // People too, once there is room to read them.
        if (k >= WHOLE_MOVIE_LABEL_SCALE * 1.6) {
          budget = WHOLE_MOVIE_LABELS;
          for (const node of graph.nodes) {
            if (budget <= 0) break;
            if (node.kind === 'person' && onScreen(node) && !out.has(node.id)) { out.set(node.id, node); budget -= 1; }
          }
        }
      }
      return [...out.values()];
    },
    roundRect (ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    },
    // Posters are fetched only in focus mode, once per film per page load,
    // and the picture is redrawn when one arrives.
    posterFor (node) {
      if (!node.poster) return null;
      if (!this.posters) this.posters = new Map();
      const cached = this.posters.get(node.id);
      if (cached) return cached.ready ? cached.img : null;
      const img = new Image();
      const record = { img, ready: false };
      this.posters.set(node.id, record);
      img.onload = () => {
        record.ready = true;
        if (this.redrawQueued) return;
        this.redrawQueued = true;
        requestAnimationFrame(() => { this.redrawQueued = false; this.draw(); });
      };
      img.src = this.posterUrl(node, 'w92');
      return null;
    }
  }
};
</script>

<style lang="scss">
/* A viewport-tall column: compact head, the stage taking every pixel left,
   a one-line foot. The header is hidden while this screen is up (see
   created), so 100dvh here IS the screen — not the "phantom scroll" the
   vue-ui rule warns about, which comes from a full viewport stacked under
   a header. dvh, so the iOS toolbars coming and going don't leave the foot
   under them; vh is the fallback for engines without it. The footer still
   sits below, reachable by dragging the head or foot strips — the canvas
   itself is touch-action: none, so a finger on the picture only ever moves
   the picture. */
.web-screen {
  color: #fff;
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  padding: 0;

  .web-head {
    /* Room on the left for BackLink, which sits in the top corner now that
       there is no header above it. */
    flex: 0 0 auto;
    padding: 10px 16px 6px 56px;
  }
  .web-title {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0;
  }
  .web-subtitle {
    color: #ccc;
    font-size: 0.78rem;
    margin: 0;
  }
  .web-empty {
    color: #ccc;
    padding: 24px 16px;
  }

  .web-stage {
    background: #111418;
    flex: 1 1 auto;
    min-height: 240px;
    overflow: hidden;
    position: relative;
    width: 100%;
  }
  .web-canvas {
    display: block;
    height: 100%;
    touch-action: none;
    width: 100%;
  }

  .web-zoom {
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: absolute;
    right: 10px;
    top: 10px;
    button {
      align-items: center;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 8px;
      color: #fff;
      display: flex;
      font-size: 1.1rem;
      height: 36px;
      justify-content: center;
      line-height: 1;
      width: 36px;
      &:active { background: rgba(255, 255, 255, 0.3); }
    }
  }

  .web-settling {
    align-items: center;
    background: rgba(17, 20, 24, 0.8);
    border-radius: 999px;
    color: #ddd;
    display: flex;
    font-size: 0.8rem;
    gap: 8px;
    left: 10px;
    padding: 6px 12px;
    position: absolute;
    top: 10px;
  }
  .web-settling-dot {
    animation: web-pulse 1s ease-in-out infinite;
    background: #ffd678;
    border-radius: 50%;
    height: 8px;
    width: 8px;
  }
  @keyframes web-pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .web-card {
    background: rgba(28, 31, 36, 0.96);
    border-top: 1px solid rgba(255, 255, 255, 0.12);
    bottom: 0;
    left: 0;
    max-height: 45%;
    overflow-y: auto;
    padding: 12px 14px 14px;
    position: absolute;
    right: 0;
    -webkit-overflow-scrolling: touch;
  }
  .web-card-close {
    background: none;
    border: none;
    color: #ccc;
    font-size: 1.5rem;
    line-height: 1;
    padding: 4px 8px;
    position: absolute;
    right: 6px;
    top: 4px;
    &:active { color: #fff; }
  }
  .web-card-head {
    align-items: center;
    display: flex;
    gap: 12px;
    padding-right: 28px;
  }
  .web-card-poster {
    border-radius: 4px;
    flex: 0 0 auto;
    height: 72px;
    object-fit: cover;
    width: 48px;
  }
  .web-card-title {
    font-size: 1.1rem;
    font-weight: 700;
    line-height: 1.2;
    margin: 0 0 4px;
  }
  .web-card-year {
    color: #ccc;
    font-weight: 400;
    margin-left: 6px;
  }
  .web-card-line {
    color: #ccc;
    font-size: 0.85rem;
    margin: 0;
  }
  .web-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .web-card-links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .web-chip {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 999px;
    color: #eee;
    font-size: 0.78rem;
    padding: 4px 10px;
    &:active { background: rgba(255, 255, 255, 0.22); }
  }
  .web-chip-person {
    border-style: dashed;
  }
  .web-chip-year {
    color: #bbb;
    margin-left: 4px;
  }

  .web-btn {
    align-items: center;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 8px;
    color: #fff;
    display: inline-flex;
    font-size: 0.85rem;
    font-weight: 600;
    gap: 6px;
    padding: 8px 12px;
    &:active { background: rgba(255, 255, 255, 0.25); }
  }
  .web-btn-accent {
    background: rgba(255, 214, 120, 0.18);
    border-color: rgba(255, 214, 120, 0.6);
    color: #ffd678;
    &:active { background: rgba(255, 214, 120, 0.35); }
  }

  .web-foot {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 12px 16px 0;
  }
  .web-legend {
    align-items: center;
    color: #ccc;
    display: flex;
    flex-wrap: wrap;
    font-size: 0.78rem;
    gap: 6px 8px;
    margin: 0;
  }
  .web-legend-swatch {
    border-radius: 50%;
    display: inline-block;
    height: 10px;
    width: 10px;
  }
  .web-legend-person {
    background: #b9c2cc;
  }
}
</style>
