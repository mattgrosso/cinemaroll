// Prints every UNRESOLVED bug report submitted via the in-app "Report a bug"
// button (src/components/BugReportButton.vue -> src/utils/bugReports.js),
// newest first. Uses the Firebase Admin SDK, which bypasses
// database.rules.json entirely (that file just leaves read/write wide open,
// same as the rest of this app's data) — this is simply the convenient
// read/triage path.
//
// Once triaged, resolve with `yarn resolve-bug-report <reportId>
// --understood "..." --fixed "..."` (scripts/resolve-bug-report.mjs) — the
// two texts are shown to the reporter in the app on their next launch, so
// write them in plain language. `--silent` skips the notice for duplicates
// and QA noise.
//
// Requires one env var, read from .env.local by scripts/loadEnvLocal.mjs
// (Node's native --env-file flag needs 20.6+; this repo is pinned to 18):
//   FIREBASE_ADMIN_KEY_PATH - path to a service-account JSON key
//                              (Firebase Console -> Project Settings ->
//                              Service Accounts -> Generate new private key).
//                              Not committed to git.
//
// Run with: yarn fetch-bug-reports          (unresolved only)
//       or: yarn fetch-bug-reports --all    (everything, resolved or not)

import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

loadEnvLocal();

// Matches the databaseURL hardcoded in src/store/index.js — this app has one
// Firebase project, so there's nothing to configure per-environment.
const databaseURL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;

if (!keyPath) {
  console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.');
  console.error('Firebase Console -> Project Settings -> Service Accounts -> Generate new private key.');
  process.exit(1);
}

const showAll = process.argv.includes('--all');

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL });

// Only the unresolved ones come down (audit, 2026-10-08): Bug Desk runs this
// every five minutes, and the whole node — every resolved report ever, half
// a megabyte — was 140 MB a day of download. A report has no `resolved`
// until it is resolved, and Firebase orders absent before false before
// true, so endAt(false) is "absent or false". Indexed in database.rules.json.
const query = showAll ? getDatabase().ref('bugReports') : getDatabase().ref('bugReports').orderByChild('resolved').endAt(false);
const snapshot = await query.once('value');
const reports = snapshot.val() || {};
const allEntries = Object.entries(reports).sort(
  ([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0),
);
const entries = showAll ? allEntries : allEntries.filter(([, report]) => !report.resolved);
const resolvedCount = allEntries.length - allEntries.filter(([, report]) => !report.resolved).length;

if (!allEntries.length) {
  console.log(showAll ? 'No bug reports yet.' : 'No unresolved bug reports.');
  process.exit(0);
}
if (!entries.length) {
  console.log(`No unresolved bug reports (${resolvedCount} resolved — rerun with --all to see them).`);
  process.exit(0);
}

for (const [id, report] of entries) {
  const when = report.createdAt ? new Date(report.createdAt).toISOString() : 'unknown time';
  const appState = typeof report.appState === 'string' ? JSON.parse(report.appState) : (report.appState || null);

  console.log('='.repeat(72));
  console.log(`report ${id} - ${when}${report.resolved ? ' [RESOLVED]' : ''}`);
  console.log(`reporter: ${report.reporterEmail || 'unknown'}`);
  console.log(`url: ${report.url || 'unknown'}`);
  console.log(`userAgent: ${report.userAgent || 'unknown'}`);
  console.log(`screenSize: ${report.screenSize || 'unknown'}${report.devicePixelRatio ? ` @${report.devicePixelRatio}x` : ''}`);
  console.log('---');
  console.log(report.transcript || '(empty)');
  if (appState) {
    console.log('--- app state at time of report ---');
    console.log(JSON.stringify(appState, null, 2));
  }
}

console.log('='.repeat(72));
console.log(`${entries.length} report(s) shown${showAll ? '' : ` (${resolvedCount} resolved report(s) hidden — rerun with --all to see them)`}.`);

// Flush stdout before the hard exit. process.exit() tears the process down
// without draining async stream writes, and stdout to a PIPE is async (to a
// TTY it's synchronous) - so `yarn fetch-bug-reports | grep/awk/less` was
// silently truncated at the ~64KB pipe buffer while plain terminal runs
// looked complete. A zero-length write's callback only fires after every
// previously queued write has drained (stream writes are ordered), making
// this a reliable flush barrier. The hard exit itself stays: the Admin
// SDK's open RTDB connection otherwise keeps the event loop alive for
// minutes after the work is done.
await new Promise((resolve) => { process.stdout.write('', resolve); });
process.exit(0);
