// Publishing the Film Club feed, v2 (Brian's guide §3–§4), with all I/O
// injected so the phone (Firebase SDK) and the end-of-day Lambda (admin
// REST) share one procedure. Twin generated for the Lambda, like
// filmClubSync.js.
//
//   io.get(path)             → value at a database path (root-relative)
//   io.firstIndexKeys(path)  → the first two keys of the retention index
//   io.update(updates)       → one atomic multi-path update at the root
//   io.newKey()              → a push key for the journal
//   io.randomHex()           → 32 lowercase hex for a fresh epoch
//
// The head is read fresh every time and extended only when it certifies
// itself (meta valid, bound to the legacy revision, snapshot count agreeing);
// otherwise a complete rebuild with a new epoch. Two writers (the phone and
// the Lambda) can therefore never extend each other's stale view — the
// worst case is one rebuild, which readers bootstrap from.
import { buildAppend, buildRebuild, headIsExtendable, moviesMapFromSnapshot, MAX_BATCHES } from './filmClubSync.js';

export async function publishFeedV2 ({ owner, secret, feed, databaseUrl, io, lastPublished = null, now = Date.now() }) {
  const root = `clubFeedSync/${owner}/${secret}`;
  const [meta, legacyRevision] = await Promise.all([io.get(`${root}/meta`), io.get(`clubFeed/${owner}/${secret}/revision`)]);

  if (headIsExtendable({ meta, legacyRevision })) {
    // The snapshot the head certifies: our own copy when we published that
    // exact head, otherwise read back (the other writer may have moved it).
    const prevMovies = lastPublished?.meta?.revision === meta.revision && lastPublished.movies
      ? lastPublished.movies
      : moviesMapFromSnapshot(await io.get(`${root}/movies`));
    if (headIsExtendable({ meta, legacyRevision, prevMovies })) {
      let oldestKey = null;
      if (meta.changeCount >= MAX_BATCHES) {
        const keys = await io.firstIndexKeys(`${root}/changeIndex`);
        oldestKey = keys?.[0] || null;
        // A full count with an index that does not agree is not a head to
        // extend: rebuild rather than guess.
        if (!oldestKey || (meta.minCursor && oldestKey <= meta.minCursor) || oldestKey > meta.cursor) return rebuild();
      }
      const out = buildAppend({ owner, secret, feed, prevMeta: meta, prevMovies, newKey: io.newKey(), oldestKey, now, databaseUrl });
      if (!out) return { mode: 'unchanged', meta, movies: prevMovies };
      await io.update(out.updates);
      return { mode: 'append', meta: out.meta, movies: out.movies, batch: out.batch };
    }
  }
  return rebuild();

  async function rebuild () {
    const out = buildRebuild({ owner, secret, feed, epoch: io.randomHex(), now, databaseUrl });
    await io.update(out.updates);
    return { mode: 'rebuild', meta: out.meta, movies: out.movies };
  }
}
