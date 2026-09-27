// Marks a bug report resolved AND tells the reporter, in plain language,
// what was wrong and what changed. The notice lands at
// `<topKey>/bugReportResolutions/<reportId>` in the reporter's own account,
// where BugResolutionNotice.vue shows it on their next launch.
//
//   yarn resolve-bug-report <reportId> \
//     --understood "What was going wrong, in their terms" \
//     --fixed "What we did about it"
//
//   yarn resolve-bug-report <id> [id...] --silent   # resolve without a notice
//
// Write the two texts for a smart 12-year-old: no jargon, no file names, no
// component names. "The list forgot your filters when you came back" beats
// "route state wasn't persisted". The reporter sees exactly these words.
//
// --silent exists for reports that need no reply: duplicates and QA noise.
// Matt's own reports get the notice too (he wants to see the fix land).
// Resolving WITHOUT saying which — texts or --silent — is refused, so
// closing the loop is the default shape of resolving a bug, not an optional extra.
//
// Requires FIREBASE_ADMIN_KEY_PATH in .env.local (same as fetch-bug-reports).

import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { emailToTopKey, snippetOf } from './bugResolutionHelpers.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

loadEnvLocal();

const databaseURL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;

if (!keyPath) {
  console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.');
  process.exit(1);
}

function usage () {
  console.error('Usage: yarn resolve-bug-report <reportId> --understood "..." --fixed "..."');
  console.error('       yarn resolve-bug-report <reportId> [reportId...] --silent');
  console.error('');
  console.error('The --understood / --fixed texts are shown to the reporter in the app,');
  console.error('word for word — write them for a smart 12-year-old, no jargon.');
  console.error('--silent skips the notice (duplicates, QA noise).');
  process.exit(1);
}

// Tiny argv parse: flags take the next token as their value; everything else
// is a report id.
const reportIds = [];
let understood = null;
let fixed = null;
let silent = false;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--understood') {
    understood = args[++i] ?? null;
  } else if (arg === '--fixed') {
    fixed = args[++i] ?? null;
  } else if (arg === '--silent') {
    silent = true;
  } else if (arg.startsWith('--')) {
    console.error(`Unknown flag ${arg}\n`);
    usage();
  } else {
    reportIds.push(arg);
  }
}

if (!reportIds.length) usage();

if (!silent && (!understood?.trim() || !fixed?.trim())) {
  console.error('Refusing to resolve without telling the reporter what happened.');
  console.error('Provide --understood and --fixed, or pass --silent to skip the notice.\n');
  usage();
}

if (!silent && reportIds.length > 1) {
  // One explanation cannot honestly describe several different reports.
  console.error('A notice describes ONE report — resolve them one at a time,');
  console.error('or pass --silent to close several without notices.');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
initializeApp({ credential: cert(serviceAccount), databaseURL });
const db = getDatabase();

for (const id of reportIds) {
  const reportRef = db.ref(`bugReports/${id}`);
  const snapshot = await reportRef.once('value');
  if (!snapshot.exists()) {
    console.error(`No report found with id ${id} - skipping.`);
    continue;
  }
  const report = snapshot.val();
  const resolvedAt = Date.now();

  const update = { resolved: true, resolvedAt };
  if (!silent) update.resolution = { understood, fixed };
  await reportRef.update(update);
  console.log(`Marked ${id} resolved.`);

  if (silent) continue;

  const topKey = emailToTopKey(report.reporterEmail);
  if (!topKey) {
    console.warn(`  ! ${id} has no reporter email — resolved, but there is nobody to notify.`);
    continue;
  }

  await db.ref(`${topKey}/bugReportResolutions/${id}`).set({
    understood,
    fixed,
    reportSnippet: snippetOf(report.transcript),
    reportedAt: report.createdAt || null,
    resolvedAt,
    seen: false
  });
  console.log(`  Notice queued for ${report.reporterEmail} — they'll see it on their next launch.`);
}

process.exit(0);
