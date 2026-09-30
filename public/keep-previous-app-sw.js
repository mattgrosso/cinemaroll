/* eslint-disable no-undef */
// Keeps the previous version's screen files on the phone after an update.
// Pulled into the generated Workbox service worker via importScripts
// (vite.config.mjs), like push-sw.js.
//
// Why (bug report, Matt, 2026-09-30, one bar of signal at his therapist's):
// every screen is its own file, loaded the first time it's opened. When a
// new version's worker takes over, Workbox deletes the old version's files
// from its precache - but a page that's still running the old version
// (open in the background since before the deploy) asks for the OLD files
// the next time you open a screen. Not in the cache any more, so they go to
// the network, and on a connection that's there-but-not-really that request
// never finishes: the loading bar creeps across and stops.
//
// So, while a new worker installs (the old precache is still intact then),
// copy the running version's hashed js/css/font files into their own cache.
// vite.config.mjs routes hashed files the new precache doesn't know about
// to that cache first. Exactly one version back is kept: each install
// replaces the set, so it never grows past one extra copy of the app.

var PREVIOUS_APP_CACHE = 'cinema-roll-previous-app';
var HASHED_APP_FILE = /\/(js|css|fonts)\/[^/?]+\.[0-9a-f]{8}\.(js|css|woff2?|ttf)$/;

async function keepPreviousAppFiles (cacheStorage) {
  var names = await cacheStorage.keys();
  var precaches = names.filter(function (name) { return name.indexOf('cinema-roll-precache') === 0; });
  if (!precaches.length) return 0; // first install: nothing to keep yet
  var previous = await cacheStorage.open(PREVIOUS_APP_CACHE);
  var kept = new Set();
  for (var i = 0; i < precaches.length; i++) {
    var cache = await cacheStorage.open(precaches[i]);
    var requests = await cache.keys();
    for (var j = 0; j < requests.length; j++) {
      var path = new URL(requests[j].url).pathname;
      if (!HASHED_APP_FILE.test(path) || kept.has(path)) continue;
      kept.add(path);
      if (await previous.match(path)) continue;
      var response = await cache.match(requests[j]);
      if (response) await previous.put(path, response);
    }
  }
  // Anything older than the version being replaced goes.
  var stored = await previous.keys();
  for (var k = 0; k < stored.length; k++) {
    if (!kept.has(new URL(stored[k].url).pathname)) await previous.delete(stored[k]);
  }
  return kept.size;
}

self.keepPreviousAppFiles = keepPreviousAppFiles;

self.addEventListener('install', function (event) {
  // Best effort: a failure here must never fail the new worker's install.
  event.waitUntil(keepPreviousAppFiles(caches).catch(function () {}));
});
