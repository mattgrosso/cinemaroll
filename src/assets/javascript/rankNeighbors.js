// The films either side of a rating, for the Rate page's poster strip.
//
// `ranked` is the library best-first and `insertAt` is where the film being
// rated would slot in, so `ranked[insertAt - 1]` is the film just above it and
// `ranked[insertAt]` the one just below. Near the top or bottom of the
// rankings a side is simply shorter — nothing is padded or wrapped.
//
// `ahead` reads in the same order as the strip, furthest-above first, so the
// strip can render ahead, this film, behind left to right.
export function neighborWindow (ranked, insertAt, perSide) {
  const at = Math.max(0, Math.min(insertAt, ranked.length));
  return {
    ahead: ranked.slice(Math.max(0, at - perSide), at),
    behind: ranked.slice(at, at + perSide),
  };
}

// Cover Flow (2026-10-02: "the one in the center is facing you, but then as
// you go further out from the center, they become closer and closer to being
// edge on"). Indexed by distance from the centre: how far it turns (deg), how
// bright it is, and how far back it sits (in poster widths). Further out turns
// more, sits further back and dims. Beyond the last step a poster just takes
// the last pose.
const COVER_FLOW_STEPS = [
  { angle: 0, opacity: 1, depth: 0 },
  { angle: 40, opacity: 0.9, depth: 0.52 },
  { angle: 58, opacity: 0.75, depth: 1.04 },
  { angle: 70, opacity: 0.6, depth: 1.57 },
];

// Must match `.neighbor-posters { perspective }` in RateMovie.vue.
export const COVER_FLOW_PERSPECTIVE = 500;
// The centre poster is this much wider than its neighbours.
const CURRENT_SCALE = 1.17;
// Each poster tucks this much (in poster widths) under the one inside it.
const OVERLAP = 0.1;
// Neighbour poster width bounds (px). Below the minimum a narrow screen tucks
// the posters further under each other; above the maximum a wide one tucks
// them less (and past that, spaces them out) instead of growing the strip
// without end.
const MIN_POSTER = 46;
const MAX_POSTER = 70;
// What the strip is laid out for before it has been measured — a phone's.
const DEFAULT_STAGE = 346;

// Where a card's edges land on screen. A card of width `w` at (x, z), turned
// `angle` degrees about its vertical axis, has its edges at x ± (w/2)·cos and
// z ∓ (w/2)·sin; perspective then scales each by p / (p − z).
function projectedEdges (x, z, w, angle) {
  const rad = (Math.abs(angle) * Math.PI) / 180;
  const across = (w / 2) * Math.cos(rad);
  const deep = (w / 2) * Math.sin(rad);
  const p = COVER_FLOW_PERSPECTIVE;
  // Right-hand cards turn their outer edge toward you, inner edge away.
  return {
    inner: ((x - across) * p) / (p - (z - deep)),
    outer: ((x + across) * p) / (p - (z + deep)),
    outerScale: p / (p - (z + deep)),
  };
}

// Packs the posters out from the centre, each tucked `overlap` poster widths
// under the one inside it, for neighbours `poster` px wide. Solving "this
// card's inner edge lands at `target`" for x is linear, so no search is
// needed per card.
function packSteps (poster, overlap) {
  const p = COVER_FLOW_PERSPECTIVE;
  const steps = [{ ...COVER_FLOW_STEPS[0], x: 0, z: 0 }];
  let edge = (poster * CURRENT_SCALE) / 2;
  let tallest = 1;
  for (const step of COVER_FLOW_STEPS.slice(1)) {
    const rad = (step.angle * Math.PI) / 180;
    const z = -step.depth * poster;
    const target = edge - overlap * poster;
    const x = (target * (p - z + (poster / 2) * Math.sin(rad))) / p + (poster / 2) * Math.cos(rad);
    const edges = projectedEdges(x, z, poster, step.angle);
    steps.push({ ...step, x, z });
    edge = edges.outer;
    tallest = Math.max(tallest, edges.outerScale);
  }
  return { steps, reach: edge, tallest };
}

// 2026-10-04 bug report: the strip "doesn't use enough of the space". The
// spread used to be fixed px, filling about two thirds of a phone's width.
// Now the posters are sized so the packed row reaches the edges of the stage
// (`stageWidth`, px). Past the size cap the posters stop growing and spread
// apart to reach the edges instead; below the floor they squeeze together.
export function coverFlowLayout (stageWidth) {
  const half = (stageWidth > 0 ? stageWidth : DEFAULT_STAGE) / 2;
  // Reach grows with poster size and shrinks with overlap, so bisect for the
  // size that just fills; if that's out of bounds, clamp the size and bisect
  // the overlap instead.
  const bisect = (low, high, reachAt) => {
    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      if (reachAt(mid) < half) low = mid; else high = mid;
    }
    return (low + high) / 2;
  };
  const poster = Math.round(bisect(MIN_POSTER, MAX_POSTER, (size) => packSteps(size, OVERLAP).reach));
  // Bisect wants reach rising with the argument, so search on −overlap.
  const overlap = -bisect(-1, 1, (negOverlap) => packSteps(poster, -negOverlap).reach);
  const packed = packSteps(poster, overlap);
  const steps = packed.steps.map((step) => ({
    ...step,
    x: Math.round(step.x * 10) / 10,
    z: Math.round(step.z * 10) / 10,
  }));
  return {
    poster,
    current: Math.round(poster * CURRENT_SCALE),
    // Tall enough for the centre poster and for outer edges swung toward you.
    height: Math.ceil(Math.max(poster * CURRENT_SCALE, poster * packed.tallest) * 1.5) + 4,
    steps,
  };
}

// `offset` is a poster's place in the strip relative to the film being
// rated: negative above it (left), positive below it (right). Each side turns
// its inner edge away so the poster's face points at the centre — left
// posters rotate positive around Y, right ones negative.
export function coverFlowPose (offset, layout = coverFlowLayout()) {
  const { steps } = layout;
  const distance = Math.min(Math.abs(offset), steps.length - 1);
  const step = steps[distance];
  const side = Math.sign(offset);
  return {
    x: side * step.x,
    z: step.z,
    angle: side === 0 ? 0 : -side * step.angle,
    opacity: step.opacity,
    layer: steps.length - Math.abs(offset),
  };
}
