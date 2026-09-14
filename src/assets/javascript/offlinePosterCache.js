// Pure, store-free helpers for the Settings panel's "Download for offline"
// action. Deliberately separate from the Workbox runtime-caching config
// (vue.config.js): that config only caches an image the FIRST time it's
// actually requested (as you scroll/view it) — it does nothing proactively.
// This module is what makes "cache my WHOLE library" possible: it builds the
// full list of poster/backdrop URLs from movieLog and fetches each one so the
// already-registered CacheFirst route (see vue.config.js's 'tmdb-images'
// runtimeCaching entry) has a reason to store it.
const POSTER_SIZE = 'w342'; // matches the grid poster size (see CLAUDE.md's asset-perf notes)
const BACKDROP_SIZE = 'w500'; // matches MovieDetail's backdrop usage

// Exported so call sites that only have a single new poster/backdrop path
// (a fresh rating, a custom poster/backdrop pick) can build the exact same
// URL this module would've built during a full-library warm, and pass it to
// warmImageCache themselves — one source of truth for the size convention.
export function posterUrl (path) {
  return path ? `https://image.tmdb.org/t/p/${POSTER_SIZE}${path}` : null;
}

export function backdropUrl (path) {
  return path ? `https://image.tmdb.org/t/p/${BACKDROP_SIZE}${path}` : null;
}

export function collectImageUrls (movieLog) {
  const urls = new Set();

  Object.values(movieLog || {}).forEach((entry) => {
    const movie = entry?.movie;
    if (!movie) {
      return;
    }
    const poster = posterUrl(movie.poster_path);
    if (poster) {
      urls.add(poster);
    }
    const backdrop = backdropUrl(movie.backdrop_path);
    if (backdrop) {
      urls.add(backdrop);
    }
  });

  return Array.from(urls);
}

// mode: 'no-cors' is required (not optional) — image.tmdb.org doesn't send
// CORS headers, so a same-origin-mode fetch() (unlike an <img> tag, which
// isn't CORS-restricted) would reject outright. The resulting opaque
// response is still exactly what the service worker's fetch handler
// intercepts and caches (see the runtimeCaching route's
// `cacheableResponse: { statuses: [0, 200] }`) — we never need to read the
// response body here, only trigger the SW to store it.
export async function warmImageCache (urls, { concurrency = 6, onProgress, fetchFn = fetch, signal } = {}) {
  const total = urls.length;
  let completed = 0;
  let failed = 0;
  let nextIndex = 0;

  async function worker () {
    while (nextIndex < urls.length) {
      if (signal?.aborted) {
        return;
      }
      const url = urls[nextIndex];
      nextIndex += 1;

      try {
        await fetchFn(url, { mode: 'no-cors' });
      } catch {
        failed += 1;
      }

      completed += 1;
      if (onProgress) {
        onProgress({ completed, total, failed });
      }
    }
  }

  const workerCount = Math.min(concurrency, urls.length) || 1;
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { completed, total, failed };
}
