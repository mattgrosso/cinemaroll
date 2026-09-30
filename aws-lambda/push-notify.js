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
  externalWatches, externalLogsDue,
  signupsDue, composeSignupMessages,
  alamoListings, veeziListings, afiListings, boxofficeListings, afiFirstShowtime,
  cinemaclockListings, uncovered, boardForApp, remindersDue, composeReminderMessage, listingsDue, composeListingMessages
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
  'mirrorFeed', 'letterboxdFilms', 'testing-database'
]);
// Mirrors QA_ACCOUNT_KEYS in src/assets/javascript/databaseKey.js - the QA
// account never gets real notifications.
const QA_ACCOUNT_KEYS = new Set(['cinemaroll-tester-example-com']);
const QA_BOARD_ACCOUNT_KEY = 'cinemaroll-tester-example-com';
// The one account told about new sign-ups. The list of accounts already seen
// lives in its own push state, which only this function writes.
const OWNER_ACCOUNT_KEY = 'mattgrosso-gmail-com';

// Theaters whose new listings the owner is told about (Matt, 2026-09-28:
// "notify me when new movies are listed for my local Alamo", then "the AFI
// in Silver Spring … the Miracle Theater … a really small independent
// theater in Fairfax" - Cinema Arts). Each one's seen-listings map lives at
// `push/state/theaters/<key>`; `listings()` fetches its public feed or page
// and returns [{ slug, title, firstShowTime, url }] via the pure parsers in
// pushCadence.js. Adding a theater is adding an entry here. Alamo market
// ids are numeric and sequential (0500 northern-virginia, 1100 dc-metro-area).
const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; cinemaroll-push; mailto:mattgrosso@gmail.com)' };
const fetchText = async (url, accept = 'text/html') => {
  const res = await fetch(url, { cache: 'no-store', headers: { ...FETCH_HEADERS, accept } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
};
const fetchJson = async (url) => JSON.parse(await fetchText(url, 'application/json'));

const CINEMA_ARTS_URL = 'https://www.cinemaartstheatre.com';
// Gatsby static-query hash of the site's movie list; stable until the
// query text changes. If it 404s, the index page's hash list is scanned.
const CINEMA_ARTS_MOVIES_HASH = '3836549025';
const cinemaArtsMovies = async () => {
  const load = async (hash) => (await fetchJson(`${CINEMA_ARTS_URL}/page-data/sq/d/${hash}.json`)).data;
  try {
    const data = await load(CINEMA_ARTS_MOVIES_HASH);
    if (data && data.allMovie) return data.allMovie;
  } catch (error) {
    console.warn('Cinema Arts movie list moved:', error.message);
  }
  const index = await fetchJson(`${CINEMA_ARTS_URL}/page-data/index/page-data.json`);
  for (const hash of index.staticQueryHashes || []) {
    const data = await load(hash).catch(() => null);
    if (data && data.allMovie) return data.allMovie;
  }
  return { nodes: [] };
};

// The chains (Regal, AMC) and www.si.edu all refuse a plain fetch; CinemaClock
// lists them all, and marks which showtimes are on the IMAX screen. It is
// only ever READ: every link Matt sees goes to the theater's own site ("I
// don't ever want to go to that movie clock intermediate page").
const CINEMACLOCK_URL = 'https://www.cinemaclock.com/movie-theaters';
const SHOWTIME_BACKFILL_PER_SWEEP = 8;
// Every screen counts ("I'd be interested in the non-IMAX screens at these
// other theaters as well"); a film's `imax` flag says which ones are.
const viaCinemaclock = (key, name, page, site, { smithsonian = false } = {}) => ({
  key,
  name,
  url: site,
  listings: async () => cinemaclockListings(await fetchText(`${CINEMACLOCK_URL}/${page}`), { url: site }),
  // The Smithsonian theaters publish in batches every few weeks; a quiet
  // board there is real, not a broken fetch.
  mayBeEmpty: smithsonian
});

// THE ORDER IS THE PECKING ORDER. A new listing is only news at the first
// theater in this list that has it ("I'll always go to the Alamo first"; an
// IMAX only when "there are no showtimes at the Alamo or any of the other
// theaters"; among the IMAXs "Udvar-Hazy the best, then the Mall, then
// Silver Spring"). AFI's place after Cinema Arts is a guess he hasn't
// confirmed.
const THEATERS = [
  {
    key: 'alamo-bryant-street',
    name: 'Alamo Bryant Street',
    url: 'https://drafthouse.com/dc-metro-area/theater/dc-bryant-street',
    listings: async () => alamoListings(await fetchJson('https://drafthouse.com/s/mother/v2/schedule/market/dc-metro-area'), '1101')
  },
  {
    key: 'miracle-theatre',
    name: 'the Miracle Theatre',
    url: 'https://ticketing.useast.veezi.com/sessions/?siteToken=m8rg867jdpj1g3vn7sq1f1wfg4',
    listings: async (now) => veeziListings(
      await fetchText('https://ticketing.useast.veezi.com/sessions/?siteToken=m8rg867jdpj1g3vn7sq1f1wfg4'),
      { now, fallbackUrl: 'https://themiracletheatre.com/' }
    )
  },
  {
    key: 'cinema-arts',
    name: 'Cinema Arts',
    url: `${CINEMA_ARTS_URL}/`,
    listings: async () => {
      const [scheduled, movies] = await Promise.all([
        fetchJson(`${CINEMA_ARTS_URL}/api/gatsby-source-boxofficeapi/scheduledMovies?theaters=X050X`),
        cinemaArtsMovies()
      ]);
      return boxofficeListings(scheduled, movies, CINEMA_ARTS_URL);
    }
  },
  {
    key: 'afi-silver',
    name: 'AFI Silver',
    url: 'https://silver.afi.com/now-playing/',
    listings: async () => afiListings(await fetchText('https://silver.afi.com/now-playing/')),
    // The grid has no dates; the film's own page does. Fetched only for
    // listings about to be announced.
    enrich: async (listing) => ({ ...listing, firstShowTime: afiFirstShowtime(await fetchText(listing.url)) })
  },
  viaCinemaclock('imax-udvar-hazy', 'the Udvar-Hazy IMAX', 'airbus-imax-theater', 'https://www.si.edu/theaters/airbus', { smithsonian: true }),
  viaCinemaclock('imax-air-and-space', 'the Air and Space IMAX', 'lockheed-martin-imax-theater', 'https://www.si.edu/theaters/lockheedmartin', { smithsonian: true }),
  viaCinemaclock('imax-regal-majestic', 'Regal Majestic', 'regal-majestic-imax', 'https://www.regmovies.com/theatres/regal-majestic-1862'),
  viaCinemaclock('imax-amc-georgetown', 'AMC Georgetown', 'amc-loews-georgetown-14', 'https://www.amctheatres.com/movie-theatres/washington-d-c/amc-georgetown-14'),
  // AMC Hoffman Center was here until 2026-09-29: "I don't really know where
  // AMC Hoffman Center is. You should just remove that from my list."
  viaCinemaclock('imax-amc-tysons', 'AMC Tysons', 'amc-tysons-corner-16', 'https://www.amctheatres.com/movie-theatres/washington-d-c/amc-tysons-corner-16')
];

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
  // An absolute URL (a theater's ticket page) is opened as-is; anything else
  // is a route inside the app.
  const target = /^https?:\/\//.test(navigate) ? navigate : `${APP_URL}/#${navigate}`;
  const notification = { title, body, navigate: target };
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
  try {
    const signups = await notifySignups(accounts, now);
    if (signups) results.push({ topKey: OWNER_ACCOUNT_KEY, delivered: signups, reason: 'signup' });
  } catch (error) {
    console.error('Sign-up check failed:', error.message);
  }
  try {
    const listingsDelivered = await notifyTheaterListings(now);
    if (listingsDelivered) results.push({ topKey: OWNER_ACCOUNT_KEY, delivered: listingsDelivered, reason: 'listings' });
  } catch (error) {
    console.error('Listings check failed:', error.message);
  }
  try {
    const delivered = await notifyReminders(now);
    if (delivered) results.push({ topKey: OWNER_ACCOUNT_KEY, delivered, reason: 'reminders' });
  } catch (error) {
    console.error('Reminders check failed:', error.message);
  }

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

// --- New sign-ups -----------------------------------------------------------
//
// Matt, 2026-09-28: "It would be cool if I knew when someone signed up." An
// account key the sweep hasn't seen before is a sign-up; signupsDue (tested)
// decides, including the silent first run. Send first, then record, so a
// failed write repeats the news rather than losing it.
const notifySignups = async (accounts, now) => {
  const known = await dbGet(`${OWNER_ACCOUNT_KEY}/push/state/knownAccounts`);
  const { fresh, nextKnown, seeded } = signupsDue({ known, current: accounts, now });
  if (seeded) {
    await dbSet(`${OWNER_ACCOUNT_KEY}/push/state/knownAccounts`, nextKnown);
    console.log(`Sign-ups: first run, recorded ${Object.keys(nextKnown).length} existing account(s)`);
    return 0;
  }
  if (!fresh.length) return 0;

  // A brand-new account rarely has a name yet; use one if it's there.
  const named = await Promise.all(fresh.map(async (key) => {
    const [social, directory] = await Promise.all([
      dbGet(`${key}/settings/social/displayName`).catch(() => null),
      dbGet(`social/directory/${key}/name`).catch(() => null)
    ]);
    const name = [social, directory].find((value) => typeof value === 'string' && value.trim());
    return { key, name: name ? name.trim() : '' };
  }));

  let delivered = 0;
  const subscriptions = await dbGet(`${OWNER_ACCOUNT_KEY}/push/subscriptions`);
  for (const message of composeSignupMessages(named)) {
    delivered += await sendToAccount(OWNER_ACCOUNT_KEY, subscriptions, buildPayload({ ...message, navigate: '/' }));
  }
  await dbSet(`${OWNER_ACCOUNT_KEY}/push/state/knownAccounts`, nextKnown);
  console.log(`Sign-ups: ${fresh.length} new, ${delivered} push(es) delivered`);
  return delivered;
};

// --- New theater listings ---------------------------------------------------
//
// Matt refreshes his Alamo's showtimes page by hand to catch new films the
// moment tickets open. The sweep reads every theater's board instead and
// tells him what wasn't on a board last time; listingsDue (tested) decides,
// including the silent first run and the fortnight of memory that lets a
// repertory film be news again. Boards are all fetched first because the
// pecking order needs them: a fresh listing is dropped when a better theater
// currently has the film (uncovered, tested). If a better theater's board
// could not be read this sweep, the lower theater waits - announcing
// something the Alamo may well have is worse than a 15-minute delay. Every
// theater's news goes out as ONE push a sweep (2026-09-29: "too many
// notifications"). Send first, then record; covered listings are recorded
// too, and a theater whose news failed to send is not, so it comes again.
const notifyTheaterListings = async (now) => {
  const boards = await Promise.all(THEATERS.map(async (theater) => {
    try {
      const listings = await theater.listings(now);
      // An empty board is a broken fetch until proven otherwise - never let
      // it age everything out and re-announce the whole schedule later.
      if (!listings.length && !theater.mayBeEmpty) throw new Error('returned no listings');
      return { theater, listings };
    } catch (error) {
      console.error(`Listings (${theater.key}) fetch failed:`, error.message);
      return { theater, listings: null };
    }
  }));

  const knownByKey = {};
  const pending = [];
  for (let i = 0; i < boards.length; i += 1) {
    const { theater, listings } = boards[i];
    if (!listings) continue;
    const better = boards.slice(0, i);
    if (better.some((b) => !b.listings)) {
      console.log(`Listings (${theater.key}): waiting, a better theater's board is unreadable`);
      continue;
    }
    const statePath = `${OWNER_ACCOUNT_KEY}/push/state/theaters/${theater.key}`;
    try {
      const known = await dbGet(statePath);
      const { fresh, nextKnown, seeded } = listingsDue({ known, current: listings, now });
      if (seeded) {
        await dbSet(statePath, nextKnown);
        knownByKey[theater.key] = nextKnown;
        console.log(`Listings (${theater.key}): first run, recorded ${listings.length} listing(s)`);
        continue;
      }
      // A grid without dates: learn a few showtimes a sweep into the seen-
      // state, so the app's board fills in and reminders have a time to aim at.
      if (theater.enrich) {
        const missing = listings.filter((l) => !l.firstShowTime && !(nextKnown[l.slug] && nextKnown[l.slug].s)).slice(0, SHOWTIME_BACKFILL_PER_SWEEP);
        await Promise.all(missing.map(async (l) => {
          try {
            const { firstShowTime } = await theater.enrich(l);
            if (firstShowTime) nextKnown[l.slug].s = firstShowTime;
          } catch (error) {
            console.warn(`Listings (${theater.key}) showtime for ${l.slug}:`, error.message);
          }
        }));
      }
      const { keep, dropped } = uncovered(fresh, better.map((b) => b.listings));
      if (dropped.length) console.log(`Listings (${theater.key}): ${dropped.length} covered by a better theater (${dropped.map((l) => l.title).join(', ')})`);
      if (keep.length) console.log(`Listings (${theater.key}): ${keep.length} new (${keep.map((l) => l.slug).join(', ')})`);
      pending.push({ theater, statePath, nextKnown, keep });
    } catch (error) {
      console.error(`Listings (${theater.key}) failed:`, error.message);
    }
  }

  const announced = pending.flatMap((p) => p.keep);
  let delivered = 0;
  let sendFailed = false;
  if (announced.length) {
    try {
      const subscriptions = await dbGet(`${OWNER_ACCOUNT_KEY}/push/subscriptions`);
      for (const message of composeListingMessages(announced)) {
        delivered += await sendToAccount(OWNER_ACCOUNT_KEY, subscriptions, buildPayload({ ...message, appBadge: 1 }));
      }
      console.log(`Listings: ${announced.length} new across ${pending.filter((p) => p.keep.length).length} theater(s), ${delivered} push(es) delivered`);
    } catch (error) {
      sendFailed = true;
      console.error('Listings push failed:', error.message);
    }
  }
  for (const { theater, statePath, nextKnown, keep } of pending) {
    if (sendFailed && keep.length) continue;
    try {
      await dbSet(statePath, nextKnown);
      knownByKey[theater.key] = nextKnown;
    } catch (error) {
      console.error(`Listings (${theater.key}) record failed:`, error.message);
    }
  }

  // The app's copy: everything on every board, in pecking order, with what
  // a better theater also has marked rather than dropped (the screen has a
  // toggle). Written even when a board failed - the screen says so.
  try {
    const board = boardForApp(boards, knownByKey, now);
    await dbSet(`${OWNER_ACCOUNT_KEY}/theaters/board`, board);
    // The QA account gets the same board, so the Showtimes screen can be
    // driven signed in as the tester (scripts/mint-test-token.mjs).
    await dbSet(`${QA_BOARD_ACCOUNT_KEY}/theaters/board`, board);
  } catch (error) {
    console.error('Theater board publish failed:', error.message);
  }
  return delivered;
};

// --- Reminders --------------------------------------------------------------
//
// A left swipe on the Showtimes screen writes theaters/reminders/<theater>/
// <slug> with a remindAt the app chose (a week before the showing, else the
// day before, else three hours before). Send, then stamp sentAt so the card
// returns to the screen; a failed write repeats the reminder next sweep
// rather than losing it.
const notifyReminders = async (now) => {
  const reminders = await dbGet(`${OWNER_ACCOUNT_KEY}/theaters/reminders`);
  const due = remindersDue(reminders, now);
  if (!due.length) return 0;
  const subscriptions = await dbGet(`${OWNER_ACCOUNT_KEY}/push/subscriptions`);
  let delivered = 0;
  for (const reminder of due) {
    const sent = await sendToAccount(OWNER_ACCOUNT_KEY, subscriptions, buildPayload({ ...composeReminderMessage(reminder), appBadge: 1 }));
    delivered += sent;
    await dbSet(`${OWNER_ACCOUNT_KEY}/theaters/reminders/${reminder.theaterKey}/${reminder.slug}/sentAt`, now);
  }
  console.log(`Reminders: ${due.length} due (${due.map((r) => r.title).join(', ')}), ${delivered} push(es) delivered`);
  return delivered;
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
