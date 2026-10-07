// Reads an account's Film Club feed exactly as a v2 peer would — bootstrap,
// then an unchanged refresh — over public REST with no credentials, and
// checks the rules refuse what they should. Admin is used only to look up
// the owner's current feed secret.
//
//   node scripts/verify-club-feed-sync.mjs [account-key]   (default: Matt)
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { refreshExternalFeed } from '../src/utils/filmClubSyncClient.js';
import { profileFromFeed } from '../src/assets/javascript/interchange.js';

loadEnvLocal();
const DB = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const owner = process.argv[2] || 'mattgrosso-gmail-com';
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))), databaseURL: DB });
const secret = (await getDatabase().ref(`${owner}/settings/clubFeedKey`).get()).val();
if (!secret) { console.error(`${owner} has no feed secret`); process.exit(1); }
const feedUrl = `${DB}/clubFeed/${owner}/${secret}.json`;
const calls = [];
const fetchFn = async (url, opts) => {
  const r = await fetch(url, opts);
  calls.push(`${r.status} ${url.replace(DB, '').replace(secret, '<secret>').replace(/\?(.{0,60}).*/, '?$1')}`);
  return r;
};
let t = Date.now();
const first = await refreshExternalFeed({ feedUrl, fetchFn });
console.log(`bootstrap: ${first.status}, ${Object.keys(first.cache?.movies || {}).length} movies, ${Date.now() - t} ms`);
console.log(calls.map((c) => `  ${c}`).join('\n')); calls.length = 0;
t = Date.now();
const second = await refreshExternalFeed({ feedUrl, cache: first.cache, fetchFn });
console.log(`again: ${second.status}, ${Date.now() - t} ms`);
console.log(calls.map((c) => `  ${c}`).join('\n'));
if (first.feed) {
  const profile = profileFromFeed(first.feed);
  console.log(`profile: ${profile.counts.titles} titles, revision ${String(profile.revision).slice(0, 8)}…`);
}
const status = async (url) => (await fetch(url)).status;
console.log('rules — unbounded movies read:', await status(`${DB}/clubFeedSync/${owner}/${secret}/movies.json`),
  '| 251-page:', await status(`${DB}/clubFeedSync/${owner}/${secret}/movies.json?orderBy=%22%24key%22&limitToFirst=251`),
  '| wrong secret:', await status(`${DB}/clubFeed/${owner}/${'0'.repeat(32)}.json`),
  '| legacy body:', await status(feedUrl),
  '| changeIndex (public):', await status(`${DB}/clubFeedSync/${owner}/${secret}/changeIndex.json?orderBy=%22%24key%22&limitToFirst=2`));
process.exit(first.status === 'updated' && second.status === 'unchanged' ? 0 : 1);
