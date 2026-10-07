// Mints a sign-in token for the dedicated automated-testing account.
//
//   yarn mint-test-token                     # ensure account, print URL
//   yarn mint-test-token --seed-from <key>   # also clone that account's
//                                            #   movieLog+settings into the
//                                            #   tester branch first
//
// Why (Matt, 2026-08-15): "the fact that you have to log in as me and I
// have to click the button... seems inconvenient... can we build something
// out so that you can have access without needing me to authenticate?"
//
// The tester is a real Firebase Auth user (cinemaroll-tester@example.com)
// whose email-derived branch (cinemaroll-tester-example-com) the deployed
// rules scope it to — it can never read or write anyone else's data. The
// printed URL carries a ~1h Admin-SDK custom token; opening it signs the
// browser into the tester account via Login.vue's testToken hook. Note the
// browser's ONE Firebase session per origin: opening this on a device
// signed in as a real user switches that device to the tester until they
// sign back in.
//
// Requires FIREBASE_ADMIN_KEY_PATH in .env.local.

import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const TESTER_EMAIL = 'cinemaroll-tester@example.com';
const TESTER_UID = 'cinemaroll-tester';
const TESTER_KEY = 'cinemaroll-tester-example-com';

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

const auth = getAuth();
const db = getDatabase();

// Ensure the tester auth user exists (idempotent).
try {
  await auth.getUser(TESTER_UID);
} catch {
  await auth.createUser({ uid: TESTER_UID, email: TESTER_EMAIL, emailVerified: true });
  console.log(`created auth user ${TESTER_EMAIL} (uid ${TESTER_UID})`);
}

const seedFlag = process.argv.indexOf('--seed-from');
if (seedFlag !== -1) {
  const source = process.argv[seedFlag + 1];
  if (!source) {
    console.error('--seed-from needs an account key (e.g. mattgrosso-gmail-com)');
    process.exit(1);
  }
  console.log(`seeding ${TESTER_KEY} from ${source}…`);
  const snapshot = await db.ref(source).once('value');
  const data = snapshot.val();
  if (!data) {
    console.error(`source account '${source}' is empty or missing`);
    process.exit(1);
  }
  await db.ref(TESTER_KEY).set({
    movieLog: data.movieLog || null,
    settings: data.settings || null,
    // Personal awards moved out of settings on 2026-10-06 (their own node, so
    // settings stays small); the tester needs them to show the "mine" tab.
    personalAwards: data.personalAwards || null,
    personalAwardsMeta: data.personalAwardsMeta || null,
    academyAwardWinners: data.academyAwardWinners || null
  });
  console.log(`✔ seeded ${Object.keys(data.movieLog || {}).length} movieLog entries`);
}

const token = await auth.createCustomToken(TESTER_UID);
console.log('\nSign-in URL (token valid ~1 hour):\n');
console.log(`https://www.cinemaroll.org/#/login?testToken=${token}`);
process.exit(0);
