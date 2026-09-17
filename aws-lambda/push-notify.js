// Push notification sender for Cinema Roll (Matt, 2026-08-27). Two entry
// modes in one function:
//
//   1. HTTP (API Gateway), Firebase-ID-token-gated like claude-ai.js:
//        POST /push/test          - test notification to the caller's devices
//        POST /push/friend-logged - fan a "friend logged a movie" push out to
//                                   the caller's MUTUAL friends who opted in
//   2. Scheduled (EventBridge, every 15 min): the chore sweep. Reads each
//      account's `{topKey}/push/` node - prefs, subscriptions, and the
//      DIGEST the app itself published (src/assets/javascript/pushDigest.js;
//      the client computes, this only formats and sends). WHEN to send is
//      entirely pushCadence.js's call: notify on NEWS (a film newly matured
//      into stickiness, a tiebreak that wasn't there, an unnamed award year)
//      inside waking hours, spaced by the user's allowance, never while the
//      app is open, and never re-reading a backlog already announced.
//
// Payloads use DECLARATIVE web push (`web_push: 8030`) so iOS Safari 18.4+
// renders them without waking the service worker; public/push-sw.js renders
// the same JSON on platforms that don't. Everything here is plain node
// crypto + fetch - no firebase-admin, no googleapis - keeping the zip tiny.
// The only dependency is web-push (VAPID + payload encryption).
//
// Env vars (set on the Lambda, never committed):
//   FIREBASE_SA        - service-account JSON (Project Settings -> Service
//                        Accounts). Grants admin RTDB access via OAuth below.
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
//
// Database rules are default-deny; this function authenticates to RTDB with
// an OAuth token minted from the service account, which the rules treat as
// admin. All reads/writes go through dbGet/dbSet.

const crypto = require('crypto');
const webpush = require('web-push');
const {
  dueFromDigest, nextBaseline, shouldSend, composeMessage, friendLogBody, EMPTY_BASELINE,
  gamesDue, shouldSendGames, composeGamesMessage,
  externalWatches, externalLogsDue
} = require('./pushCadence');

const FIREBASE_PROJECT_ID = 'movie-log-8c4d5';
const DATABASE_URL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const APP_URL = 'https://www.cinemaroll.org';

const ALLOWED_ORIGINS = [
  'https://www.cinemaroll.org',
  'https://cinemaroll.org',
  'http://localhost:8080'
];

// Top-level database keys that are NOT user accounts. The sweep discovers
// accounts by shallow-listing the root, so anything shared lives here.
const NON_ACCOUNT_ROOTS = new Set([
  'bugReports', 'social', 'clubDirectory', 'clubInbox', 'clubFeed',
  'mirrorFeed', 'testing-database'
]);
// Mirrors QA_ACCOUNT_KEYS in src/assets/javascript/databaseKey.js - the QA
// account never gets real notifications.
const QA_ACCOUNT_KEYS = new Set(['cinemaroll-tester-example-com']);

// Mirrors databaseKeyCharacters.json (FROZEN list - see that file).
const UNSAFE_KEY_CHARACTERS = ['-', '!', '$', '%', '@', '^', '&', '*', '(', ')', '_', '+', '|', '~', '=', '`', '{', '}', '[', ']', ':', '"', ';', "'", '<', '>', '?', ',', '.', '/'];
const UNSAFE_KEY_PATTERN = new RegExp(`[${UNSAFE_KEY_CHARACTERS.map((c) => `\\${c}`).join('')}]`, 'g');
const emailToDatabaseKey = (email) => (typeof email === 'string' && email ? email.replace(UNSAFE_KEY_PATTERN, '-') : null);

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:mattgrosso@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
});

let activeOrigin = ALLOWED_ORIGINS[0];
const response = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(activeOrigin),
  body: JSON.stringify(body)
});

// --- Firebase ID token verification (copied from claude-ai.js) --------------

let certCache = { keys: null, expiresAt: 0 };

const fetchCerts = async () => {
  if (certCache.keys && Date.now() < certCache.expiresAt) return certCache.keys;
  const res = await fetch(FIREBASE_CERT_URL);
  if (!res.ok) throw new Error(`Could not fetch Firebase certs: ${res.status}`);
  const keys = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  certCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
};

const fromBase64Url = (value) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const verifyIdToken = async (authorization) => {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(fromBase64Url(parts[0]).toString('utf8'));
    payload = JSON.parse(fromBase64Url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const certs = await fetchCerts();
  const cert = certs[header.kid];
  if (!cert) return null;

  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey(cert),
    fromBase64Url(parts[2])
  );
  if (!signatureValid) return null;

  // The audience and issuer checks are load-bearing - without them a valid
  // token from ANY Firebase project is accepted.
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) return null;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (!payload.sub) return null;

  return payload;
};

// --- Admin RTDB access via service-account OAuth ----------------------------
// Mint an access token by signing a JWT with the service-account key and
// exchanging it at Google's token endpoint. ~30 lines instead of the whole
// firebase-admin dependency tree.

let dbTokenCache = { token: null, expiresAt: 0 };

const toBase64Url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const getDbToken = async () => {
  if (dbTokenCache.token && Date.now() < dbTokenCache.expiresAt - 60000) {
    return dbTokenCache.token;
  }
  const sa = JSON.parse(process.env.FIREBASE_SA);
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const signature = toBase64Url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${signature}`
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  dbTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return dbTokenCache.token;
};

const dbGet = async (path, params = '') => {
  const token = await getDbToken();
  const res = await fetch(`${DATABASE_URL}/${path}.json?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status}`);
  return res.json();
};

const dbSet = async (path, value) => {
  const token = await getDbToken();
  const res = await fetch(`${DATABASE_URL}/${path}.json`, {
    method: value === null ? 'DELETE' : 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: value === null ? undefined : JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`RTDB ${value === null ? 'DELETE' : 'PUT'} ${path} failed: ${res.status}`);
};

// --- Sending ----------------------------------------------------------------

// Declarative web push envelope. iOS 18.4+ renders this without running any
// service worker JS; public/push-sw.js renders the same JSON elsewhere.
const buildPayload = ({ title, body, navigate = '/', tag, appBadge }) => {
  const notification = { title, body, navigate: `${APP_URL}/#${navigate}` };
  if (tag) notification.tag = tag;
  if (typeof appBadge === 'number') notification.app_badge = appBadge;
  return JSON.stringify({ web_push: 8030, notification });
};

/**
 * Send one payload to every subscription under an account. A 404/410 means
 * the endpoint is dead (app deleted, permission revoked, endpoint rotated) -
 * prune it so future sends stop paying for it. Returns how many landed.
 */
const sendToAccount = async (topKey, subscriptions, payload) => {
  let delivered = 0;
  await Promise.all(Object.entries(subscriptions || {}).map(async ([id, sub]) => {
    if (!sub || !sub.endpoint || !sub.keys) return;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        payload,
        { TTL: 24 * 3600, urgency: 'normal' }
      );
      delivered += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await dbSet(`${topKey}/push/subscriptions/${id}`, null).catch(() => {});
      } else {
        console.error(`Push to ${topKey}/${id} failed:`, error.statusCode || error.message);
      }
    }
  }));
  return delivered;
};

// --- The daily digest sweep -------------------------------------------------

const localHour = (tz, at = new Date()) => {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at)) % 24;
  } catch {
    return at.getUTCHours();
  }
};

/**
 * The sweep. Runs every 15 minutes; every decision about WHETHER to send
 * lives in pushCadence.js (pure and unit-tested — the anti-nagging rules are
 * the hard part of this feature, not the plumbing).
 *
 * The baseline write is unconditional and matters as much as the send: it is
 * how a finished chore re-arms, so doing all your stickiness ratings means
 * the next film to mature is news again.
 */
const runSweep = async () => {
  const now = Date.now();
  const roots = await dbGet('', 'shallow=true');
  const accounts = Object.keys(roots || {})
    .filter((key) => !NON_ACCOUNT_ROOTS.has(key) && !QA_ACCOUNT_KEYS.has(key));

  const results = [];
  for (const topKey of accounts) {
    try {
      const push = await dbGet(`${topKey}/push`);
      if (!push || !push.subscriptions || !push.digest) continue;

      const prefs = push.prefs || {};
      const tz = prefs.tz || 'America/New_York';
      const hourNow = localHour(tz);
      const digestUpdatedAt = Number(push.digest.updatedAt) || 0;
      const baseline = push.state?.baseline || EMPTY_BASELINE;
      const due = dueFromDigest(push.digest, prefs, now);

      const decision = shouldSend({
        due,
        prefs,
        baseline,
        now,
        localHour: hourNow,
        lastSentAt: Number(push.state?.lastSentAt) || 0,
        digestUpdatedAt
      });

      let delivered = 0;
      if (decision.send) {
        const message = composeMessage(due, push.digest, decision.news, now);
        if (message) {
          const appBadge = due.stickinessCount + (due.tiebreak ? 1 : 0) + due.awardYears.length;
          // `?open=<chore>` lands on Home with that prompt already expanded
          // (Home.vue reads it once and strips it from the URL).
          const navigate = message.open ? `/?open=${message.open}` : '/';
          const payload = buildPayload({ ...message, navigate, tag: 'chores', appBadge });
          delivered = await sendToAccount(topKey, push.subscriptions, payload);
        }
      }

      // Record what we've now said (or ratchet the baseline down) regardless
      // of the outcome — see nextBaseline.
      const sent = delivered > 0;
      await dbSet(`${topKey}/push/state/baseline`, nextBaseline(due, baseline, sent));
      if (sent) await dbSet(`${topKey}/push/state/lastSentAt`, now);

      if (sent || decision.send) results.push({ topKey, delivered, reason: decision.reason });

      // The games reminder: its own stream, its own once-a-day stamp, its own
      // tag (so it never replaces a chores notification on the lock screen),
      // and no badge — the badge counts chores, and a game isn't one.
      const games = shouldSendGames({
        prefs,
        now,
        localHour: hourNow,
        lastGamesSentAt: Number(push.state?.gamesSentAt) || 0,
        digestUpdatedAt
      });
      if (games.send) {
        const message = composeGamesMessage(gamesDue(push.digest, prefs, now, tz), (push.digest.games?.list || []).length);
        if (message) {
          const gamesDelivered = await sendToAccount(topKey, push.subscriptions, buildPayload({ ...message, tag: 'games' }));
          if (gamesDelivered > 0) await dbSet(`${topKey}/push/state/gamesSentAt`, now);
          results.push({ topKey, delivered: gamesDelivered, reason: games.reason });
        }
      }

      // Friends on other apps: same opt-outs as the native friend-log push,
      // because to the recipient it is the same notification.
      if (prefs.enabled !== false && prefs.friendLogs !== false) {
        const extDelivered = await notifyExternalLogs(topKey, push, prefs);
        if (extDelivered > 0) results.push({ topKey, delivered: extDelivered, reason: "external-friend-log" });
      }
    } catch (error) {
      console.error(`Sweep failed for ${topKey}:`, error.message);
    }
  }
  console.log('Sweep:', JSON.stringify(results));
  return results;
};

// --- Friends on other apps --------------------------------------------------
//
// The native fan-out above is driven by the LOGGER's client. A friend on Movie
// Log has no client of ours to announce anything, so their new viewings are
// only ever discovered by reading their published feed - which, until now,
// only happened while Matt's app was open, and never produced a notification
// (report -P1jvQ2VY03wwbsTEwD-: "they show up in my film club, but I don't get
// a notification like I do if a cinema roll user logs a movie").
//
// The sweep already visits every account every 15 minutes, so it reads the
// feeds too. All of the quiet-keeping is in pushCadence's externalLogsDue,
// where the tests are; this function fetches, sends and records.
const notifyExternalLogs = async (topKey, push, prefs) => {
  const friends = (await dbGet(`${topKey}/settings/externalFriends`)) || {};
  const entries = Object.entries(friends).filter(([, friend]) => friend && friend.feedUrl);
  if (!entries.length) return 0;

  const seen = (push.state && push.state.externalSeen) || {};
  let delivered = 0;
  let seeded = 0;

  for (const [id, friend] of entries) {
    try {
      const response = await fetch(friend.feedUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`feed responded ${response.status}`);
      const watches = externalWatches(await response.json());
      const { announce, nextSeenAt } = externalLogsDue({
        watches,
        seenAt: Number(seen[id]) || 0,
        now: Date.now()
      });

      for (const watch of announce) {
        const scoreLine = Number.isFinite(watch.score) ? `They gave it a ${watch.score.toFixed(2)}.` : null;
        // Same badge arithmetic as the native fan-out: the recipient's own
        // chores plus this log, which the app clears when it opens.
        const due = dueFromDigest(push.digest, prefs, Date.now());
        const payload = buildPayload({
          title: `${friend.name || 'A friend'} logged ${watch.title}`,
          body: friendLogBody(scoreLine, prefs),
          // An external friend's film may not be in Matt's library at all, so
          // the movie page is still the right landing - FriendsWhoSaw fetches
          // its own club data (see the 2026-08-29 cold-start fix).
          navigate: watch.tmdbId ? `/movie/${watch.tmdbId}` : '/',
          tag: `friend-log-ext-${id}-${watch.tmdbId || 'x'}`,
          appBadge: due.stickinessCount + (due.tiebreak ? 1 : 0) + due.awardYears.length + 1
        });
        delivered += await sendToAccount(topKey, push.subscriptions, payload);
      }

      // Record the marker even when nothing was sent - that is what makes the
      // first sight silent and an unchanged feed silent afterwards.
      if (nextSeenAt && nextSeenAt !== Number(seen[id])) {
        await dbSet(`${topKey}/push/state/externalSeen/${id}`, nextSeenAt);
        seeded += 1;
      }
    } catch (error) {
      console.error(`External-friend sweep for ${topKey}/${id} failed:`, error.message);
    }
  }

  // One line per account that has any, so a silent sweep is still legible:
  // "3 feed(s), 0 sent" is working as designed; no line at all means the
  // account has no friends on other apps.
  console.log(`External friends for ${topKey}: ${entries.length} feed(s), ${delivered} sent, ${seeded} marker(s) moved`);
  return delivered;
};

// --- Friend-log fan-out -----------------------------------------------------

const notifyFriendsOfLog = async (myKey, { tmdbId, title, score }) => {
  if (!title || typeof title !== 'string') return { notified: 0 };

  const [edges, myProfileName, myDirectory] = await Promise.all([
    dbGet('social/friends'),
    dbGet(`social/profiles/${myKey}/name`),
    dbGet(`social/directory/${myKey}/name`)
  ]);

  const name = myProfileName || myDirectory || 'A friend';
  const mutuals = Object.keys(edges?.[myKey] || {}).filter(
    (key) => edges?.[key]?.[myKey] && !QA_ACCOUNT_KEYS.has(key) && key !== myKey
  );

  const navigate = tmdbId ? `/movie/${tmdbId}` : '/';
  const scoreNumber = Number(score);
  const scoreLine = Number.isFinite(scoreNumber) ? `They gave it a ${scoreNumber.toFixed(2)}.` : null;

  let notified = 0;
  await Promise.all(mutuals.map(async (friendKey) => {
    try {
      const push = await dbGet(`${friendKey}/push`);
      if (!push || !push.subscriptions) return;
      const prefs = push.prefs || {};
      if (prefs.enabled === false || prefs.friendLogs === false) return;

      // The RECIPIENT decides whether the score is in the notification
      // (prefs.friendLogScores); a null score means the rater doesn't share
      // ratings at all. Both cases live in friendLogBody, where the tests are.
      const body = friendLogBody(scoreLine, prefs);

      // Icon badge: the recipient's own chore count plus this log — a badge
      // should say "things waiting for you", and the friend's log is one of
      // them until the app is opened (which clears it). The digest rides in
      // the same node just read, so this costs nothing extra.
      const due = dueFromDigest(push.digest, prefs, Date.now());
      const appBadge = due.stickinessCount + (due.tiebreak ? 1 : 0) + due.awardYears.length + 1;

      const payload = buildPayload({
        title: `${name} logged ${title}`,
        body,
        navigate,
        tag: `friend-log-${myKey}-${tmdbId || 'x'}`,
        appBadge
      });
      notified += await sendToAccount(friendKey, push.subscriptions, payload);
    } catch (error) {
      console.error(`Friend-log push to ${friendKey} failed:`, error.message);
    }
  }));
  return { notified };
};

// --- Handler ----------------------------------------------------------------

exports.handler = async (event) => {
  // EventBridge schedule - no HTTP context at all.
  if (event.source === 'aws.events') {
    await runSweep();
    return { ok: true };
  }

  activeOrigin = event.headers?.origin || event.headers?.Origin || ALLOWED_ORIGINS[0];
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || '';

  if (method === 'OPTIONS') return response(204, {});
  if (method !== 'POST') return response(405, { error: 'POST only' });

  const auth = await verifyIdToken(event.headers?.authorization || event.headers?.Authorization);
  if (!auth || !auth.email) return response(401, { error: 'Invalid or missing token' });

  const myKey = emailToDatabaseKey(auth.email);
  if (!myKey) return response(401, { error: 'Token has no email' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return response(400, { error: 'Invalid JSON' });
  }

  try {
    if (path.endsWith('/push/test')) {
      const push = await dbGet(`${myKey}/push`);
      if (!push?.subscriptions) return response(404, { error: 'No subscriptions on this account' });
      const payload = buildPayload({
        title: 'Cinema Roll can reach you here',
        body: 'This is what a notification will look like.',
        navigate: '/',
        tag: 'test'
      });
      const delivered = await sendToAccount(myKey, push.subscriptions, payload);
      return response(200, { delivered });
    }

    if (path.endsWith('/push/friend-logged')) {
      const result = await notifyFriendsOfLog(myKey, body);
      return response(200, result);
    }

    return response(404, { error: 'Unknown route' });
  } catch (error) {
    console.error('push-notify error:', error);
    return response(500, { error: 'Internal error' });
  }
};
