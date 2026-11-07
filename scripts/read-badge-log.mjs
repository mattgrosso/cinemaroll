// Read-only: the account's push/badgeLog and push/swLog, newest last.
// node scripts/read-badge-log.mjs [topKey]. Read this FIRST for any "wrong
// number on the icon" report - every badge is written down with its parts.
import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
loadEnvLocal();
initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))), databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com' });
const db = getDatabase();
const k = process.argv[2] || 'mattgrosso-gmail-com';
for (const p of ['push/badgeLog', 'push/swLog']) {
  const v = (await db.ref(`${k}/${p}`).get()).val();
  console.log('=== ' + p);
  const arr = Array.isArray(v) ? v : Object.values(v || {});
  for (const e of arr.slice(-40)) console.log(new Date(e.at).toISOString(), JSON.stringify(e).slice(0, 500));
}
process.exit(0);
