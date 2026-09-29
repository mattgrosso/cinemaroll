// Mirror the owner's published theater board onto the QA account so the
// Showtimes screen can be driven signed in as the tester (2026-09-28).
// Admin SDK, so rules don't apply; the push Lambda writes the same mirror
// on every sweep - this is for the moment right after a deploy.
import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

loadEnvLocal();
initializeApp({
  credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))),
  databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com'
});
const db = getDatabase();
const snap = await db.ref('mattgrosso-gmail-com/theaters/board').get();
const board = snap.val();
if (!board) { console.error('no board'); process.exit(1); }
const theaters = board.theaters || [];
const total = theaters.reduce((n, t) => n + (t.listings || []).length, 0);
const withPoster = theaters.reduce((n, t) => n + (t.listings || []).filter((l) => l.poster).length, 0);
console.log(`board updated ${new Date(board.updatedAt).toISOString()}: ${theaters.length} theaters, ${total} listings, ${withPoster} with a feed poster`);
theaters.forEach((t) => console.log(`  ${t.key}: ${(t.listings || []).length} listings, ${(t.listings || []).filter((l) => l.poster).length} posters, sample ${(t.listings || [])[0]?.poster || '-'}`));
await db.ref('cinemaroll-tester-example-com/theaters/board').set(board);
console.log('mirrored to the tester');
process.exit(0);
