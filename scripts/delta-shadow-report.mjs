// Reads the delta-sync shadow readings and says whether phase 2 is safe.
//
//   yarn delta-shadow-report
//   yarn delta-shadow-report --account someone-example-com
//
// Shadow mode has been running since v1.45.15: every launch reconstructs the
// library from the previous snapshot plus an `updatedAt` delta query, then
// compares that against the full download it did anyway. Identical every
// time means the delta path can safely replace the full download.
//
// Until now the answer lived in localStorage error logs on whichever device
// ran the check, so "is it safe yet" could only be answered by someone
// reading their own phone. The readings are recorded in the account now and
// this summarises them.
//
// It deliberately does NOT decide for you. It reports the streak, the
// divergences and how long the evidence covers, because "no divergence in
// three launches" and "no divergence in three weeks" are different answers.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const DEFAULT_ACCOUNT = 'mattgrosso-gmail-com';

/** Turns raw readings into the numbers the decision actually rests on. */
export function summarize (readings, now = Date.now()) {
  const list = Object.values(readings || {})
    .filter((reading) => reading && reading.at)
    .sort((a, b) => a.at - b.at);

  if (!list.length) return { count: 0 };

  // A write race (a save landing between the full download and the delta
  // query, isWriteRaceOnly) is the delta path being ahead, not wrong: it
  // neither counts as a divergence nor breaks the streak.
  const clean = (reading) => reading.identical || reading.race;
  const diverged = list.filter((reading) => !clean(reading));
  const races = list.filter((reading) => !reading.identical && reading.race);
  // The streak that matters is the CURRENT one: a divergence three weeks ago
  // that has not recurred is a different story from one yesterday.
  let streak = 0;
  for (let i = list.length - 1; i >= 0 && clean(list[i]); i--) streak += 1;

  const DAY = 24 * 60 * 60 * 1000;
  return {
    count: list.length,
    diverged,
    races,
    streak,
    first: list[0].at,
    last: list[list.length - 1].at,
    spanDays: Math.round((list[list.length - 1].at - list[0].at) / DAY),
    sinceLastDays: Math.round((now - list[list.length - 1].at) / DAY),
    entries: list[list.length - 1].compared,
    deltaEntries: list[list.length - 1].deltaEntries
  };
}

async function main () {
  const { loadEnvLocal } = await import('./loadEnvLocal.mjs');
  const { initializeApp, cert } = await import('firebase-admin/app');
  const { getDatabase } = await import('firebase-admin/database');

  loadEnvLocal();
  const keyPath = process.env.FIREBASE_ADMIN_KEY_PATH;
  if (!keyPath) {
    console.error('Missing FIREBASE_ADMIN_KEY_PATH in .env.local.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const accountIndex = args.indexOf('--account');
  const account = accountIndex === -1 ? DEFAULT_ACCOUNT : args[accountIndex + 1];

  initializeApp({
    credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))),
    databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com'
  });

  const readings = (await getDatabase().ref(`${account}/settings/deltaShadowReadings`).get()).val();
  const summary = summarize(readings);

  if (!summary.count) {
    console.log(`No shadow readings recorded for ${account} yet.`);
    console.log('\nThey are written on launch, once the app has been opened on a version');
    console.log('that records them. Before that the readings only ever existed in the');
    console.log("device's own error logs.");
    return;
  }

  console.log(`${summary.count} shadow readings for ${account}`);
  console.log(`  spanning       : ${summary.spanDays} day(s), most recent ${summary.sinceLastDays} day(s) ago`);
  console.log(`  library size   : ${summary.entries} entries, ${summary.deltaEntries} arriving via the delta query`);
  console.log(`  divergences    : ${summary.diverged.length}`);
  console.log(`  write races    : ${summary.races.length} (a save between the two reads; not a divergence)`);
  console.log(`  clean streak   : ${summary.streak} consecutive`);

  if (summary.diverged.length) {
    console.log('\nDivergences (these are what phase 2 would get wrong):');
    summary.diverged.slice(-5).forEach((reading) => {
      console.log(`  ${new Date(reading.at).toISOString()}  ${reading.summary || `missing ${reading.missing}, stale ${reading.stale}, extra ${reading.extra}`}`);
    });
  }

  console.log('');
  if (summary.diverged.length) {
    console.log('NOT safe: the delta path reconstructed a library that differs from the');
    console.log('full download. Phase 2 would ship those differences to real devices.');
  } else if (summary.spanDays < 3 || summary.count < 5) {
    console.log('Clean so far, but thin: too few launches over too few days to say much.');
    console.log('Keep using the app normally and check again.');
  } else {
    console.log('Clean across every recorded launch. The remaining question is judgement,');
    console.log('not data: whether this span covers the editing patterns you care about');
    console.log('(offline edits, deletions, edits from a second device).');
  }
}

// Only when run directly: importing this file (the tests do, for summarize)
// must not connect to anything or exit the process.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // The explicit exit matters: firebase-admin holds an open connection, so
  // the process would otherwise sit there after the report is printed.
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Failed:', error.message);
      process.exit(1);
    });
}
