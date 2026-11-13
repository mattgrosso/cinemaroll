// Pure, store-free immutable nested-set helper. Given a slash-delimited path
// (e.g. "personalAwards/2024" or "tieBreakTournament") and a value, returns a
// NEW object with that value set at the given path — cloning only the
// objects actually along the path, leaving every sibling reference untouched.
//
// Backs applyDbPathLocally (store/index.js), the general-purpose counterpart
// to setMovieLogEntry for arbitrary settings/* (and deeper movieLog/*) paths
// — see that mutation's own comment for why a generic version was needed.
//
// A null (or undefined) leaf REMOVES the key, matching Firebase, where writing
// null is a delete. Keeping the key with a null value broke allMediaAsArray
// when a film's last viewing was deleted (Sentry, 2026-11-13).
export function setValueAtPath (obj, segments, value) {
  if (!segments.length) return value;
  const [head, ...rest] = segments;
  const base = (obj && typeof obj === 'object') ? obj : {};
  if (!rest.length && value == null) {
    const { [head]: _removed, ...remaining } = base; // eslint-disable-line no-unused-vars
    return remaining;
  }
  return { ...base, [head]: rest.length ? setValueAtPath(base[head], rest, value) : value };
}
