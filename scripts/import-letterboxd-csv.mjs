// Import a Letterboxd data export into an account's letterboxd/reviews
// branch with the admin key — the same records the in-app CSV import and
// the Lambda's feed sync write, so the film page shows them all as one list.
//
//   yarn import-letterboxd <export-dir-or-zip> [--account <topKey>] [--write]
//
// Without --write it only reports: how many rows matched a film in the
// library (by title + year, since the CSV carries no TMDB id), and which
// didn't. reviews.csv is every diary entry WITH text; diary.csv is every
// diary entry, so a diary row is imported only when no review row covers
// the same title, year and watched date — otherwise one viewing would show
// twice. Defaults to Matt's account.
import { readFileSync, existsSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { parseCsv, reviewsCsvToUpdates } from '../src/assets/javascript/letterboxdFormat.js';

const args = process.argv.slice(2);
const source = args.find((arg) => !arg.startsWith('--'));
const accountFlag = args.indexOf('--account');
const topKey = accountFlag !== -1 ? args[accountFlag + 1] : 'mattgrosso-gmail-com';
const write = args.includes('--write');
if (!source) {
  console.error('Usage: yarn import-letterboxd <export-dir-or-zip> [--account <topKey>] [--write]');
  process.exit(1);
}

let dir = source;
if (source.endsWith('.zip')) {
  dir = mkdtempSync(join(tmpdir(), 'letterboxd-export-'));
  execFileSync('unzip', ['-q', '-o', source, '-d', dir]);
}
const reviewsPath = join(dir, 'reviews.csv');
const diaryPath = join(dir, 'diary.csv');
if (!existsSync(reviewsPath) && !existsSync(diaryPath)) {
  console.error(`No reviews.csv or diary.csv in ${dir}`);
  process.exit(1);
}

loadEnvLocal();
const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;
if (!keyPath) {
  console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.');
  process.exit(1);
}
initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
  databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com'
});
const db = getDatabase();

const movieLog = (await db.ref(`${topKey}/movieLog`).once('value')).val() || {};
const entries = Object.values(movieLog);
console.log(`${topKey}: ${entries.length} library entries`);

const reviewRows = existsSync(reviewsPath) ? parseCsv(readFileSync(reviewsPath, 'utf8')) : [];
const diaryRows = existsSync(diaryPath) ? parseCsv(readFileSync(diaryPath, 'utf8')) : [];
const viewingKey = (row) => `${row.Name}|${row.Year}|${row['Watched Date'] || row.Date}`;
const reviewed = new Set(reviewRows.map(viewingKey));
const plainWatches = diaryRows.filter((row) => !reviewed.has(viewingKey(row)));
const rows = [...reviewRows, ...plainWatches];
console.log(`${reviewRows.length} review rows + ${plainWatches.length} diary-only rows (${diaryRows.length - plainWatches.length} diary rows already covered by a review)`);

const { updates, matched, unmatched } = reviewsCsvToUpdates(rows, entries);
const withText = Object.values(updates).filter((record) => record.review).length;
const films = new Set(Object.keys(updates).map((key) => key.split('/')[0]));
console.log(`matched ${matched} of ${rows.length} rows -> ${films.size} films, ${withText} with review text`);
if (unmatched.length) {
  const seen = new Set();
  const list = unmatched.filter((row) => { const k = `${row.title}|${row.year}`; if (seen.has(k)) return false; seen.add(k); return true; });
  console.log(`\n${list.length} titles not in the library (not imported):`);
  for (const row of list) console.log(`  ${row.title}${row.year ? ` (${row.year})` : ''}`);
}

if (!write) {
  console.log('\nDry run — add --write to import.');
  process.exit(0);
}
await db.ref(`${topKey}/letterboxd/reviews`).update(updates);
console.log(`\n✔ wrote ${Object.keys(updates).length} records under ${topKey}/letterboxd/reviews`);
process.exit(0);
