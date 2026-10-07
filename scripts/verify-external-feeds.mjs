// Read every external friend's feed exactly as the app would (v2 first), and
// report what came back — head validity, how it was read, awards present.
// Admin is used only to look up the signed-in user's external friends list.
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { refreshExternalFeed } from '../src/utils/filmClubSyncClient.js';
import { syncRootFor, childUrl, validateMeta } from '../src/assets/javascript/filmClubSync.js';
import { profileFromFeed } from '../src/assets/javascript/interchange.js';
import { friendAwardsForMovie } from '../src/assets/javascript/awardsShare.js';

loadEnvLocal();
const account = process.argv[2] || 'mattgrosso-gmail-com';
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))), databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com' });
const friends = (await getDatabase().ref(`${account}/settings/externalFriends`).get()).val() || {};
const redact = (url) => url.replace(/clubFeed(Sync)?\/([^/]{6})[^/]*\/[^/.]+/, 'clubFeed$1/$2…/<secret>');
let ok = true;
for (const [id, friend] of Object.entries(friends)) {
  console.log(`\n## ${friend.name} (${id}) — ${redact(friend.feedUrl)}`);
  const sync = syncRootFor(friend.feedUrl);
  const [metaRes, revRes] = await Promise.all([fetch(childUrl(sync, 'meta')), fetch(childUrl(friend.feedUrl, 'revision'))]);
  const meta = metaRes.ok ? await metaRes.json() : null; const rev = revRes.ok ? await revRes.json() : null;
  console.log(`  head: meta ${metaRes.status} ${meta ? (validateMeta(meta) ? 'valid' : 'INVALID') : 'null'}${meta ? ` v${meta.version} seq ${meta.sequence} ${meta.movieCount} films changeCount ${meta.changeCount} bodyRevision ${String(meta.bodyRevision).slice(0, 8)}…` : ''} | legacy revision ${revRes.status} ${rev ? String(rev).slice(0, 8) + '…' : rev} | bound: ${meta && rev && meta.bodyRevision === rev}`);
  const calls = [];
  const fetchFn = async (url, opts) => { const r = await fetch(url, opts); calls.push(`${r.status} ${redact(url).replace(/\?.*/, (q) => q.slice(0, 50))}`); return r; };
  let t = Date.now();
  const first = await refreshExternalFeed({ feedUrl: friend.feedUrl, fetchFn });
  console.log(`  bootstrap: ${first.status}${first.reason ? ` (${first.reason})` : ''}, ${Object.keys(first.cache?.movies || {}).length} movies, ${Date.now() - t} ms, ${calls.length} requests`);
  calls.length = 0; t = Date.now();
  const second = await refreshExternalFeed({ feedUrl: friend.feedUrl, cache: first.cache, fetchFn });
  console.log(`  again: ${second.status}${second.reason ? ` (${second.reason})` : ''}, ${Date.now() - t} ms, ${calls.length} requests`);
  if (first.status !== 'updated' || second.status !== 'unchanged') ok = false;
  if (first.feed) {
    const profile = profileFromFeed(first.feed, { fallbackName: friend.name });
    const withAwards = Object.entries(profile.ratings || {}).filter(([, r]) => r.a?.length);
    console.log(`  profile: ${profile.counts.titles} titles, awardsName ${JSON.stringify(profile.awardsName)}, films with awards: ${withAwards.length}`);
    if (withAwards.length) {
      const [tmdbId] = withAwards[0];
      console.log(`  sample: ${JSON.stringify(friendAwardsForMovie([{ name: friend.name, profile }], tmdbId)[0])}`);
    } else {
      const sample = first.feed.movies.find((m) => m.awards) || first.feed.movies[0];
      console.log(`  sample movie record keys: ${Object.keys(sample || {}).join(', ')}`);
    }
  }
}
process.exit(ok ? 0 : 1);
