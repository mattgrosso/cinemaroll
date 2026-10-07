import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { refreshExternalFeed } from '../src/utils/filmClubSyncClient.js';
loadEnvLocal();
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))), databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com' });
const friends = (await getDatabase().ref(`mattgrosso-gmail-com/settings/externalFriends`).get()).val() || {};
const brian = Object.values(friends).find((f) => f.name.startsWith('Brian'));
const res = await refreshExternalFeed({ feedUrl: brian.feedUrl, fetchFn: fetch });
const feed = res.feed;
console.log('top-level keys', Object.keys(feed));
console.log('awardsName', feed.awardsName, 'institutions', JSON.stringify(feed.institutions || feed.awardsInstitutions || null)?.slice(0, 600));
const withA = feed.movies.filter((m) => m.awards);
console.log('movies with awards', withA.length);
console.log('first raw:', JSON.stringify(withA[0], null, 1).slice(0, 2500));
const prefixes = {}; const results = {}; const years = {}; const shapes = {}; const cats = {};
for (const m of withA) {
  const list = Array.isArray(m.awards) ? m.awards : Object.values(m.awards);
  for (const a of list) {
    const label = a.label || a.category || '';
    const p = label.split(':')[0]; prefixes[p] = (prefixes[p] || 0) + 1;
    results[a.result] = (results[a.result] || 0) + 1;
    years[a.year] = (years[a.year] || 0) + 1;
    shapes[Object.keys(a).sort().join(',')] = (shapes[Object.keys(a).sort().join(',')] || 0) + 1;
    cats[label] = (cats[label] || 0) + 1;
  }
}
console.log('prefixes', prefixes); console.log('results', results); console.log('shapes', shapes);
console.log('years', Object.keys(years).sort().join(' '));
console.log('distinct labels', Object.keys(cats).length); console.log(Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,60));
