// Initialize the Film Club v2 sync tree for every account that already
// publishes a feed (Brian's guide, 2026-10-06), then verify what a reader
// sees. Admin credentials from FIREBASE_ADMIN_KEY_PATH (.env.local), like
// backup-database.mjs.
//
//   node scripts/init-club-feed-sync.mjs           # dry run: report only
//   node scripts/init-club-feed-sync.mjs --write   # publish snapshots
//
// The existing legacy body IS the canonical public projection, so the
// initial snapshot is built from it (a fresh epoch, sequence 0). Live-mode
// accounts republish from the phone within six hours of opening the app;
// day-mode accounts are republished by the Lambda at the next day boundary.
// Either extends this head.
import { readFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { buildRebuild } from '../aws-lambda/filmClubSync.js';
import { contentRevision } from '../aws-lambda/feedRevision.js';

loadEnvLocal();
const write = process.argv.includes('--write');
const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;
if (!keyPath) { console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.'); process.exit(1); }
const databaseURL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))), databaseURL });
const db = getDatabase();

const owners = Object.keys((await db.ref('clubFeed').get()).val() || {});
console.log(`${owners.length} account(s) publish a feed${write ? '' : ' (dry run; pass --write to publish)'}`);
for (const owner of owners) {
  const secret = (await db.ref(`${owner}/settings/clubFeedKey`).get()).val();
  const secrets = Object.keys((await db.ref(`clubFeed/${owner}`).get()).val() || {});
  for (const published of secrets) {
    if (published !== secret) {
      console.log(`  ${owner}: feed at a stale secret ${published.slice(0, 6)}… (current ${String(secret).slice(0, 6)}…) — unreadable under the new rules; ${write ? 'removing' : 'would remove'}`);
      if (write) await db.ref(`clubFeed/${owner}/${published}`).remove();
    }
  }
  if (!secret || !secrets.includes(secret)) { console.log(`  ${owner}: no feed at the current secret, skipped`); continue; }
  const feed = (await db.ref(`clubFeed/${owner}/${secret}`).get()).val();
  if (!feed || !Array.isArray(feed.movies)) { console.log(`  ${owner}: feed has no movies array, skipped`); continue; }
  const existing = (await db.ref(`clubFeedSync/${owner}/${secret}/meta`).get()).val();
  const legacyRevision = feed.revision;
  if (existing && existing.bodyRevision === legacyRevision && legacyRevision) {
    console.log(`  ${owner}: already certified (sequence ${existing.sequence}, ${existing.movieCount} films)`);
    continue;
  }
  const { updates, meta } = buildRebuild({ owner, secret, feed, epoch: randomBytes(16).toString('hex'), now: Date.now(), databaseUrl: databaseURL });
  console.log(`  ${owner}: ${write ? 'publishing' : 'would publish'} a fresh snapshot — ${meta.movieCount} films, revision ${meta.revision.slice(0, 8)}… (legacy had ${legacyRevision ? legacyRevision.slice(0, 8) + '…' : 'none'})`);
  if (write) {
    await db.ref().update(updates);
    // Verify as a reader would: public REST, no credentials.
    const rev = await (await fetch(`${databaseURL}/clubFeed/${owner}/${secret}/revision.json`)).json();
    const seen = await (await fetch(`${databaseURL}/clubFeedSync/${owner}/${secret}/meta.json`)).json();
    const page = await (await fetch(`${databaseURL}/clubFeedSync/${owner}/${secret}/movies.json?orderBy=%22%24key%22&limitToFirst=250`)).json();
    const ok = rev === meta.revision && seen?.bodyRevision === rev && seen?.snapshotComplete === true && page && Object.keys(page).length === Math.min(250, meta.movieCount);
    console.log(`  ${owner}: public read-back ${ok ? 'OK' : 'MISMATCH'} — /revision.json=${String(rev).slice(0, 8)}… meta.bodyRevision=${String(seen?.bodyRevision).slice(0, 8)}… first page ${page ? Object.keys(page).length : 0} films`);
    expect(contentRevision(feed) === meta.revision, 'revision derivation');
  }
}
process.exit(0);

function expect (cond, what) { if (!cond) { console.error(`  check failed: ${what}`); process.exitCode = 1; } }
