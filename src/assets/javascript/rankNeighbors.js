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
