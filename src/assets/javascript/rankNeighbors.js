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
// edge on"). Indexed by distance from the centre: how far across it sits
// (px), how far back (px), how far it turns (deg) and how bright it is.
// Further out turns more, sits further back and dims; neighbours overlap a
// little. Beyond the last step a poster just takes the last pose.
const COVER_FLOW_STEPS = [
  { x: 0, z: 0, angle: 0, opacity: 1 },
  { x: 48, z: -24, angle: 40, opacity: 0.9 },
  { x: 80, z: -48, angle: 58, opacity: 0.75 },
  { x: 106, z: -72, angle: 70, opacity: 0.6 },
];

// `offset` is a poster's place in the strip relative to the film being
// rated: negative above it (left), positive below it (right). Each side turns
// its inner edge away so the poster's face points at the centre — left
// posters rotate positive around Y, right ones negative.
export function coverFlowPose (offset) {
  const distance = Math.min(Math.abs(offset), COVER_FLOW_STEPS.length - 1);
  const step = COVER_FLOW_STEPS[distance];
  const side = Math.sign(offset);
  return {
    x: side * step.x,
    z: step.z,
    angle: side === 0 ? 0 : -side * step.angle,
    opacity: step.opacity,
    layer: COVER_FLOW_STEPS.length - Math.abs(offset),
  };
}
