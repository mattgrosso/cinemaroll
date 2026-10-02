// The router, for code that runs outside a component (the store's sign-in
// and sign-out actions), handed over by router/index.js once it exists.
//
// Why not just import the router? It is the one module that names every
// screen's file, so it has to live in the entry bundle - and anything that
// imports it gets its file name rewritten whenever ANY screen changes. The
// store importing it made every screen's file change on every deploy, and a
// phone re-downloaded most of the app for a one-screen tweak (bug report,
// Matt, 2026-10-02: the automatic update sat for 5+ seconds). See the
// manualChunks note in vite.config.mjs.
let appRouter = null;

export function setAppRouter (router) {
  appRouter = router;
}

export function pushRoute (location) {
  return appRouter?.push(location);
}
