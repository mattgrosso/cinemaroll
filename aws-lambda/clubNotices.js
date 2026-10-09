// GENERATED from src/assets/javascript — edit the ESM source and run scripts/sync-lambda-twins.mjs.
// Film Club change notices (Film Club spec 1.3.0 §6.3, proposal 0003).
//
// When a feed moves, its publisher drops a five-field "feedChanged" hint in
// each negotiated friend's inbox, so readers can poll hourly instead of every
// five minutes. A notice is UNAUTHENTICATED — anyone holding an inbox link can
// write one — so its only power is to make us refresh, through the ordinary
// v2 read, a feed we already accepted. It never adds, replaces or removes a
// friend, and it never carries a URL or a secret.
//
// Friend records (settings/externalFriends/<id>) gain:
//   noticeFeed, noticeApp  their opaque feed id, bound ONLY through a connect
//                          request whose feedUrl is exactly this friend's
//   noticeInbox            where they read notices (they said notices: true)
//   negotiatedInbox        the inbox we sent our own request to, the only
//                          place a reply without replyInboxUrl may call back
//   sentFeedId             our feed id when we last sent them our feed URL:
//                          proof they hold our CURRENT capability (the id is
//                          new with every secret)
//   answeredFeedId         the feed id we last answered a negotiation with,
//                          so an exact-feed negotiation is answered once
//   noticePending          { revision, at }: a notice persisted before it was
//                          deleted from the inbox, cleared once refreshed
//
// Pure: the store, the push Lambda (a generated twin) and the tests share it.

const NOTICE_KIND = 'feedChanged';
const NOTICE_APPS = ['cinemaroll', 'movielog'];
const NOTICE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const NOTICE_FUTURE_MS = 5 * 60 * 1000;
const NOTICE_MAX_BYTES = 1024;
// The automatic backstop for a negotiated friend (spec §5.1).
const NOTICE_BACKSTOP_MS = 60 * 60 * 1000;
// Inbox entries read per page.
const INBOX_PAGE = 50;
// A notice that would not send is retried this many times, one per session.
const NOTICE_SEND_ATTEMPTS = 5;

const FEED_ID = /^[A-Za-z0-9_-]{1,128}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const NOTICE_FIELDS = ['kind', 'app', 'feed', 'revision', 'at'];

function isFeedId (value) {
  return typeof value === 'string' && FEED_ID.test(value);
}

/** A strictly valid, unexpired notice, or null. */
function parseNotice (raw, { now = Date.now() } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== NOTICE_FIELDS.length || NOTICE_FIELDS.some((key) => !keys.includes(key))) return null;
  if (raw.kind !== NOTICE_KIND || !NOTICE_APPS.includes(raw.app)) return null;
  if (!isFeedId(raw.feed) || typeof raw.revision !== 'string' || !HEX32.test(raw.revision)) return null;
  if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null;
  if (now - raw.at > NOTICE_MAX_AGE_MS || raw.at - now > NOTICE_FUTURE_MS) return null;
  if (JSON.stringify(raw).length > NOTICE_MAX_BYTES) return null;
  return { kind: raw.kind, app: raw.app, feed: raw.feed, revision: raw.revision, at: raw.at };
}

function buildNotice ({ feed, revision, app = 'cinemaroll', now = Date.now() }) {
  if (!isFeedId(feed) || !HEX32.test(String(revision))) return null;
  return { kind: NOTICE_KIND, app, feed, revision, at: now };
}

/** A fresh random feed id: 32 hex, never derived from the secret. */
function newFeedId (randomBytes) {
  return Array.from(randomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Our feed id when it belongs to the current secret; otherwise null (mint a new one). */
function currentFeedId (record, secret) {
  return record && secret && record.secret === secret && isFeedId(record.id) ? record.id : null;
}

/** An inbox a notice may be POSTed to: https, a Firebase RTDB clubInbox path. */
function safeInboxUrl (value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (!/^[a-z0-9-]+\.(firebaseio\.com|firebasedatabase\.app)$/i.test(url.hostname)) return null;
    if (!/^\/clubInbox\/[^/]+\/[^/]+\.json$/.test(url.pathname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

const sameUrl = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim();

/** The friend whose accepted feed URL is EXACTLY this one, or null. */
function friendByExactFeed (friends, feedUrl) {
  const match = Object.entries(friends || {}).find(([, friend]) => sameUrl(friend?.feedUrl, feedUrl));
  return match ? match[0] : null;
}

/**
 * A friend we hear notices from AND who has been told we read them. Our
 * acknowledgement travels with our feed URL, so sentFeedId at the current
 * id means they have it.
 */
function isNegotiated (friend, feedId) {
  return Boolean(friend && isFeedId(friend.noticeFeed) && feedId && friend.sentFeedId === feedId);
}

/**
 * Split a page of inbox entries into what the app does with each:
 *   requests      entries to show as requests (everything that isn't below)
 *   notices       { key, friendId (null: unknown/ambiguous/invalid), revision, at }
 *   negotiations  { key, friendId, request } — a request whose feedUrl is
 *                 exactly an accepted friend's: never a new friend request
 * Anything carrying `kind` is a notice attempt and is never shown as a request.
 */
function planInbox ({ raw, friends, now = Date.now() } = {}) {
  const requests = {};
  const notices = [];
  const negotiations = [];
  for (const [key, entry] of Object.entries(raw || {})) {
    if (entry && typeof entry === 'object' && 'kind' in entry) {
      const notice = parseNotice(entry, { now });
      if (!notice) { notices.push({ key, friendId: null }); continue; }
      const matches = Object.entries(friends || {})
        .filter(([, friend]) => friend?.noticeFeed === notice.feed && (!friend.noticeApp || friend.noticeApp === notice.app));
      notices.push({ key, friendId: matches.length === 1 ? matches[0][0] : null, revision: notice.revision, at: notice.at });
      continue;
    }
    const friendId = entry && typeof entry.feedUrl === 'string' ? friendByExactFeed(friends, entry.feedUrl) : null;
    if (friendId) negotiations.push({ key, friendId, request: entry });
    else requests[key] = entry;
  }
  return { requests, notices, negotiations };
}

/** Newest notice per friend: a burst is one refresh. */
function coalesceNotices (notices) {
  const byFriend = {};
  for (const notice of notices || []) {
    if (!notice.friendId) continue;
    const prior = byFriend[notice.friendId];
    if (!prior || notice.at >= prior.at) byFriend[notice.friendId] = { revision: notice.revision, at: notice.at };
  }
  return byFriend;
}

/**
 * What an exact-feed negotiation (or an accepted request) changes on the
 * friend record, and whether we answer it. Only fields that change are
 * returned. We answer — with our feed URL — only when they demonstrably hold
 * our current capability already (sentFeedId), never twice for the same feed
 * id, and only when they gave a replyInboxUrl; otherwise the owner decides
 * (the request stays on screen as an ordinary one).
 */
function negotiationUpdate ({ friend, request, feedId }) {
  const changes = {};
  if (isFeedId(request?.feed)) {
    if (friend?.noticeFeed !== request.feed) changes.noticeFeed = request.feed;
    const app = NOTICE_APPS.includes(request.app) ? request.app : null;
    if (app && friend?.noticeApp !== app) changes.noticeApp = app;
  }
  const proven = Boolean(feedId && friend?.sentFeedId === feedId);
  if (request?.notices === true && proven) {
    const callback = safeInboxUrl(request.replyInboxUrl) || safeInboxUrl(friend?.negotiatedInbox);
    if (callback && friend?.noticeInbox !== callback) changes.noticeInbox = callback;
  }
  const replyTo = safeInboxUrl(request?.replyInboxUrl);
  const answer = proven && replyTo && friend?.answeredFeedId !== feedId ? replyTo : null;
  return { changes, answer, proven };
}

/** The friends a notice of our feed goes to, with where. */
function noticeTargets (friends, feedId) {
  if (!isFeedId(feedId)) return [];
  return Object.entries(friends || {})
    .filter(([, friend]) => friend?.feedUrl && friend.sentFeedId === feedId && safeInboxUrl(friend.noticeInbox))
    .map(([id, friend]) => ({ id, inboxUrl: safeInboxUrl(friend.noticeInbox) }));
}

/** The outbox after a publish: one pending revision per connection, newest wins. */
function queueNotices (outbox, targets, revision) {
  const next = { ...(outbox || {}) };
  for (const target of targets || []) next[target.id] = { revision, attempts: 0 };
  return next;
}

/** The outbox after one send attempt for a friend. */
function afterNoticeSend (outbox, id, ok) {
  const next = { ...(outbox || {}) };
  const entry = next[id];
  if (!entry) return next;
  const attempts = (entry.attempts || 0) + 1;
  if (ok || attempts >= NOTICE_SEND_ATTEMPTS) delete next[id];
  else next[id] = { ...entry, attempts };
  return next;
}

/**
 * Is this friend's feed due for an automatic refresh? A pending notice
 * always is. A negotiated friend is on the hourly backstop (never longer
 * than a surface asks for being shorter than that); everyone else keeps the
 * caller's cadence. A notice never resets `syncedAt`.
 */
function friendSyncDue ({ friend, hasProfile = true, syncedAt = 0, maxAgeMs, negotiated = false, now = Date.now(), force = false }) {
  if (!friend?.feedUrl) return false;
  if (force || !hasProfile || friend.noticePending) return true;
  const age = now - (Number(syncedAt) || 0);
  return age > (negotiated ? Math.max(maxAgeMs, NOTICE_BACKSTOP_MS) : maxAgeMs);
}

module.exports = { isFeedId, parseNotice, buildNotice, newFeedId, currentFeedId, safeInboxUrl, friendByExactFeed, isNegotiated, planInbox, coalesceNotices, negotiationUpdate, noticeTargets, queueNotices, afterNoticeSend, friendSyncDue, NOTICE_KIND, NOTICE_APPS, NOTICE_MAX_AGE_MS, NOTICE_FUTURE_MS, NOTICE_MAX_BYTES, NOTICE_BACKSTOP_MS, INBOX_PAGE, NOTICE_SEND_ATTEMPTS };
