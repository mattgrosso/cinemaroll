// What the Letterboxd sync has done so far, read straight from the database
// with the admin key — no browser, no sign-in.
//
//   yarn letterboxd-status
//
// Prints each connected account's last sync (when, how many feed entries,
// how many with review text, any error), how many films the shared
// letterboxdFilms cache holds, and the freshest/stalest of them. The sweep
// itself lives in aws-lambda/letterboxd.js; this only looks.
//
// Requires FIREBASE_ADMIN_KEY_PATH in .env.local.
import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { JWT } from 'google-auth-library';

const DB_URL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const NON_ACCOUNT_ROOTS = new Set(['bugReports', 'social', 'clubDirectory', 'clubInbox', 'clubFeed', 'mirrorFeed', 'letterboxdFilms']);

loadEnvLocal();
const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;
if (!keyPath) {
  console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.');
  process.exit(1);
}
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const client = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email']
});
const { access_token: token } = await client.authorize();
const get = async (path, params = '') => {
  const res = await fetch(`${DB_URL}/${path}.json?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
};

const when = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

const roots = Object.keys((await get('', 'shallow=true')) || {}).filter((root) => !NON_ACCOUNT_ROOTS.has(root));
for (const topKey of roots) {
  const sync = await get(`${topKey}/letterboxd/sync`);
  if (!sync) continue;
  const reviews = (await get(`${topKey}/letterboxd/reviews`, 'shallow=true')) || {};
  console.log(`${topKey} (${sync.username})`);
  console.log(`  last sync ${when(sync.lastAt)} — ${sync.count ?? 0} feed entries, ${sync.reviews ?? 0} with text${sync.error ? ` — ERROR: ${sync.error}` : ''}`);
  console.log(`  films with diary entries stored: ${Object.keys(reviews).length}`);
}

const films = (await get('letterboxdFilms')) || {};
const records = Object.entries(films);
const fetched = records.filter(([, film]) => film.fetchedAt && !film.missing);
const missing = records.filter(([, film]) => film.missing);
const failed = records.filter(([, film]) => film.failedAt && !film.fetchedAt);
console.log(`\nletterboxdFilms: ${records.length} cached — ${fetched.length} with stats, ${missing.length} unknown to Letterboxd, ${failed.length} failed`);
if (fetched.length) {
  const byTime = fetched.map(([id, film]) => ({ id, ...film })).sort((a, b) => a.fetchedAt - b.fetchedAt);
  console.log(`  stalest: ${byTime[0].title || byTime[0].id} (${when(byTime[0].fetchedAt)})`);
  console.log(`  freshest: ${byTime.at(-1).title || byTime.at(-1).id} — ★ ${byTime.at(-1).rating} from ${byTime.at(-1).ratingCount} ratings, ${byTime.at(-1).fans} fans (${when(byTime.at(-1).fetchedAt)})`);
}
if (failed.length) {
  for (const [id, film] of failed.slice(0, 5)) console.log(`  failed ${id}: ${film.failure} (${when(film.failedAt)})`);
}
