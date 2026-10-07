// How big are the things the app downloads? Admin read, bytes of JSON per
// node, for the audit (2026-10-06). Read-only.
import { readFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { loadEnvLocal } from './loadEnvLocal.mjs';
loadEnvLocal();
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))), databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com' });
const db = getDatabase();
const kb = async (path) => { const v = (await db.ref(path).get()).val(); return v == null ? 0 : Math.round(JSON.stringify(v).length / 1024); };
const me = 'mattgrosso-gmail-com';
console.log('Matt movieLog:', await kb(`${me}/movieLog`), 'KB | settings:', await kb(`${me}/settings`), 'KB | movieLogDeletions:', await kb(`${me}/movieLogDeletions`), 'KB');
console.log('Matt push subtree:', await kb(`${me}/push`), 'KB | letterboxd:', await kb(`${me}/letterboxd`), 'KB');
const profiles = (await db.ref('social/profiles').get()).val() || {};
for (const [key, p] of Object.entries(profiles)) console.log(`profile ${key}: ${Math.round(JSON.stringify(p).length / 1024)} KB, updatedAt ${p.updatedAt ? new Date(p.updatedAt).toISOString().slice(0, 10) : '-'}`);
const day = (await db.ref('social/dayProfiles').get()).val() || {};
console.log('dayProfiles:', Object.keys(day).map((k) => `${k}=${Math.round(JSON.stringify(day[k]).length / 1024)}KB`).join(' '));
console.log('clubDirectory:', await kb('clubDirectory'), 'KB | social/friends:', await kb('social/friends'), 'KB | social/requests:', await kb('social/requests'), 'KB');
console.log('letterboxdFilms:', await kb('letterboxdFilms'), 'KB | global academyAwardWinners:', await kb('global/academyAwardWinners'), 'KB | global allAcademyAwards:', await kb('global/allAcademyAwards'), 'KB');
const feeds = (await db.ref('clubFeed').get()).val() || {};
for (const [k, v] of Object.entries(feeds)) for (const [s, body] of Object.entries(v)) console.log(`clubFeed ${k}: ${Math.round(JSON.stringify(body).length / 1024)} KB`);
console.log('clubFeedSync total:', await kb('clubFeedSync'), 'KB');
const top = Object.keys((await db.ref().get()).val() || {});
console.log('top-level nodes:', top.length);
process.exit(0);
