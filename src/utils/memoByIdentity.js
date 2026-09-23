// Remember the last result of a pure function of reference-typed inputs.
//
// Speed sweep (Matt, 2026-09-23: "make every interaction really snappy").
// Home, Insights and the Film Club each derive big tables from the library
// (flattened keywords, per-entity counts, club summaries) inside component
// computeds - which die with the component, so every return to Home paid
// for all of them again (~0.9s at phone speed, 1.6s coming from Insights).
// The inputs are cached Vuex getters: the same array object until the
// library actually changes. So "same inputs by identity" is a safe cache
// key, and one entry is all that's needed - there is one library.
//
// Only for PURE functions of their arguments. Anything that reads the
// clock, settings or other state must pass that in as an argument too.
export function memoByIdentity (fn) {
  let lastArgs = null;
  let lastValue;
  const memoized = (...args) => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => a === args[i])) {
      return lastValue;
    }
    lastValue = fn(...args);
    lastArgs = args;
    return lastValue;
  };
  memoized.reset = () => { lastArgs = null; lastValue = undefined; };
  return memoized;
}
