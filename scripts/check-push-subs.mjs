// Any push subscription created inside a given window? One-off integrity
// check after v1.116.3 shipped a corrupted VUE_APP_VAPID_PUBLIC_KEY: a
// subscription minted from a bad application server key can never receive a
// push, and the only ones at risk are those created while that build was live.
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
const from = Date.parse(process.argv[2]);
const to = Date.parse(process.argv[3]);
const shallow = await db.ref('/').get();
let checked = 0; const hits = [];
for (const key of Object.keys(shallow.val() || {})) {
  const subs = (await db.ref(`${key}/push/subscriptions`).get()).val();
  for (const [id, sub] of Object.entries(subs || {})) {
    checked += 1;
    const at = Number(sub?.createdAt) || 0;
    if (at >= from && at <= to) hits.push(`${key}/${id} created ${new Date(at).toISOString()}`);
  }
}
console.log(`${checked} subscriptions checked across all accounts`);
console.log(hits.length ? hits.join('\n') : 'none created in that window — nothing was affected');
process.exit(0);
