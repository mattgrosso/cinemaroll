import { describe, it, expect } from 'vitest';
import {
  parseNotice, buildNotice, planInbox, coalesceNotices, negotiationUpdate, noticeTargets, queueNotices,
  afterNoticeSend, friendSyncDue, isNegotiated, currentFeedId, safeInboxUrl, newFeedId,
  NOTICE_MAX_AGE_MS, NOTICE_FUTURE_MS, NOTICE_BACKSTOP_MS, NOTICE_SEND_ATTEMPTS
} from '@/assets/javascript/clubNotices.js';
import { buildConnectRequest, normalizeInboxRequests } from '@/assets/javascript/interchange.js';

// Film Club spec 1.3.0 §6.3 (proposal 0003): change notices are hints from
// anyone holding an inbox link, bound to a friend only through a negotiated
// connection, and never a reason to read anything we can't attribute.

const NOW = 1791540000000;
const HEX = 'b'.repeat(32);
const OURS = 'c'.repeat(32);
const INBOX = 'https://other-db.firebaseio.com/clubInbox/brian/code1.json';
const notice = (patch = {}) => ({ kind: 'feedChanged', app: 'movielog', feed: 'f1', revision: HEX, at: NOW, ...patch });
const brian = (patch = {}) => ({ name: 'Brian', feedUrl: 'https://other-db.firebaseio.com/clubFeed/b/s.json', noticeFeed: 'f1', noticeApp: 'movielog', ...patch });

describe('a notice', () => {
  it('is exactly five bounded fields, unexpired', () => {
    expect(parseNotice(notice(), { now: NOW })).toEqual(notice());
    for (const patch of [{ kind: 'feedMoved' }, { kind: 'feedRevoked' }, { app: 'letterboxd' }, { feed: '' },
      { feed: 'a'.repeat(129) }, { feed: 'has space' }, { revision: 'B'.repeat(32) }, { revision: 'b'.repeat(31) },
      { at: '1' }, { at: Infinity }, { feedUrl: 'https://x' }, { name: 'Brian' }]) {
      expect(parseNotice(notice(patch), { now: NOW })).toBeNull();
    }
    expect(parseNotice(notice({ at: NOW - NOTICE_MAX_AGE_MS }), { now: NOW })).not.toBeNull();
    expect(parseNotice(notice({ at: NOW - NOTICE_MAX_AGE_MS - 1 }), { now: NOW })).toBeNull();
    expect(parseNotice(notice({ at: NOW + NOTICE_FUTURE_MS }), { now: NOW })).not.toBeNull();
    expect(parseNotice(notice({ at: NOW + NOTICE_FUTURE_MS + 1 }), { now: NOW })).toBeNull();
    expect(parseNotice(null)).toBeNull();
  });

  it('we build carries no URL or secret', () => {
    expect(buildNotice({ feed: OURS, revision: HEX, now: NOW })).toEqual({ kind: 'feedChanged', app: 'cinemaroll', feed: OURS, revision: HEX, at: NOW });
    expect(buildNotice({ feed: 'https://x/y', revision: HEX })).toBeNull();
  });
});

describe('our feed id', () => {
  it('is random hex and belongs to one secret: a new secret means a new id', () => {
    expect(newFeedId(new Uint8Array(16).fill(171))).toBe('ab'.repeat(16));
    expect(currentFeedId({ id: OURS, secret: 's1' }, 's1')).toBe(OURS);
    expect(currentFeedId({ id: OURS, secret: 's1' }, 's2')).toBeNull();
    expect(currentFeedId(null, 's1')).toBeNull();
  });
});

describe('reading the inbox', () => {
  const friends = { ext1: brian(), ext2: { name: 'Seth', feedUrl: 'https://other-db.firebaseio.com/clubFeed/s/t.json' } };

  it('attributes a notice only to the one friend negotiated under that id', () => {
    const plan = planInbox({ raw: { a: notice(), b: notice({ feed: 'nobody' }), c: notice({ app: 'cinemaroll' }), d: notice({ kind: 'feedMoved' }) }, friends, now: NOW });
    expect(plan.notices).toEqual([
      { key: 'a', friendId: 'ext1', revision: HEX, at: NOW },
      { key: 'b', friendId: null, revision: HEX, at: NOW },
      { key: 'c', friendId: null, revision: HEX, at: NOW },
      { key: 'd', friendId: null }
    ]);
    expect(plan.requests).toEqual({});
  });

  it('an id two friends share is ambiguous: nobody is read', () => {
    const plan = planInbox({ raw: { a: notice() }, friends: { ...friends, ext3: brian({ feedUrl: 'https://other-db.firebaseio.com/clubFeed/b/other.json' }) }, now: NOW });
    expect(plan.notices[0].friendId).toBeNull();
  });

  it('never matches by app and revision, name or anything but the negotiated id', () => {
    const plan = planInbox({ raw: { a: notice({ feed: 'Brian' }) }, friends: { ext1: brian({ noticeFeed: undefined }) }, now: NOW });
    expect(plan.notices[0].friendId).toBeNull();
  });

  it('a request carrying an existing friend\'s exact feed URL is a negotiation, never a new request', () => {
    const exact = buildConnectRequest({ name: 'Brian', feedUrl: friends.ext1.feedUrl, replyInboxUrl: INBOX, feed: 'f2', now: NOW });
    const other = buildConnectRequest({ name: 'Brian', feedUrl: `${friends.ext1.feedUrl}?x`, now: NOW });
    const plan = planInbox({ raw: { r1: exact, r2: other }, friends, now: NOW });
    expect(plan.negotiations).toEqual([{ key: 'r1', friendId: 'ext1', request: exact }]);
    expect(Object.keys(plan.requests)).toEqual(['r2']);
  });

  it('a burst is one refresh, at the newest revision', () => {
    const pending = coalesceNotices([
      { key: 'a', friendId: 'ext1', revision: 'a'.repeat(32), at: 1 },
      { key: 'b', friendId: 'ext1', revision: 'c'.repeat(32), at: 3 },
      { key: 'c', friendId: 'ext1', revision: 'b'.repeat(32), at: 2 },
      { key: 'd', friendId: null }
    ]);
    expect(pending).toEqual({ ext1: { revision: 'c'.repeat(32), at: 3 } });
  });
});

describe('negotiating', () => {
  const request = (patch = {}) => normalizeInboxRequests({ r: { ...buildConnectRequest({ name: 'Brian', app: 'movielog', feedUrl: brian().feedUrl, replyInboxUrl: INBOX, feed: 'f2', now: NOW }), ...patch } }, { now: NOW })[0];

  it('binds their feed id and answers once, without a reply inbox, when they hold our feed and name the callback on record', () => {
    const friend = brian({ noticeFeed: undefined, sentFeedId: OURS, negotiatedInbox: INBOX });
    const first = negotiationUpdate({ friend, request: request(), feedId: OURS });
    expect(first).toEqual({ changes: { noticeFeed: 'f2', noticeInbox: INBOX }, answer: INBOX, proven: true });
    const again = negotiationUpdate({ friend: { ...friend, noticeFeed: 'f2', noticeInbox: INBOX, answeredFeedId: OURS }, request: request(), feedId: OURS });
    expect(again).toEqual({ changes: {}, answer: null, proven: true });
  });

  it('knowing a friend\'s feed URL is not enough: a new callback gets nothing sent and nothing bound', () => {
    const forged = request({ replyInboxUrl: 'https://other-db.firebaseio.com/clubInbox/forger/x.json' });
    const result = negotiationUpdate({ friend: brian({ noticeFeed: undefined, sentFeedId: OURS, negotiatedInbox: INBOX }), request: forged, feedId: OURS });
    expect(result).toEqual({ changes: {}, answer: null, proven: false });
  });

  it('an automatic negotiation never replaces a feed id already bound', () => {
    const result = negotiationUpdate({ friend: brian({ sentFeedId: OURS, negotiatedInbox: INBOX }), request: request(), feedId: OURS });
    expect(result.changes.noticeFeed).toBeUndefined();
  });

  it('never sends our feed to someone we can\'t show already has it, and binds nothing until the owner accepts', () => {
    const friend = brian({ noticeFeed: undefined });
    const result = negotiationUpdate({ friend, request: request(), feedId: OURS });
    expect(result).toEqual({ changes: {}, answer: null, proven: false });
    expect(negotiationUpdate({ friend, request: request(), feedId: OURS, explicit: true }).changes).toEqual({ noticeFeed: 'f2', noticeInbox: INBOX });
  });

  it('a proof for an older secret proves nothing', () => {
    expect(negotiationUpdate({ friend: brian({ sentFeedId: 'd'.repeat(32), negotiatedInbox: INBOX }), request: request(), feedId: OURS }).proven).toBe(false);
  });

  it('an answer without a reply inbox calls back only where we sent our own request', () => {
    const answer = request({ replyInboxUrl: undefined });
    expect(negotiationUpdate({ friend: brian({ sentFeedId: OURS }), request: answer, feedId: OURS }).changes.noticeInbox).toBeUndefined();
    expect(negotiationUpdate({ friend: brian({ sentFeedId: OURS, negotiatedInbox: INBOX }), request: answer, feedId: OURS }).changes.noticeInbox).toBe(INBOX);
  });

  it('without notices: true there is no callback', () => {
    const result = negotiationUpdate({ friend: brian({ sentFeedId: OURS }), request: request({ notices: false }), feedId: OURS });
    expect(result.changes.noticeInbox).toBeUndefined();
  });

  it('offers our id and notices in every request we send', () => {
    expect(buildConnectRequest({ name: 'Matt', feedUrl: 'https://f', feed: OURS, now: 1 })).toEqual({ name: 'Matt', app: 'cinemaroll', feedUrl: 'https://f', at: 1, feed: OURS, notices: true });
    expect(buildConnectRequest({ name: 'Matt', feedUrl: 'https://f', now: 1 })).toEqual({ name: 'Matt', app: 'cinemaroll', feedUrl: 'https://f', at: 1 });
  });
});

describe('sending', () => {
  it('goes only to negotiated friends holding our current feed, at a real inbox', () => {
    const friends = {
      a: brian({ sentFeedId: OURS, noticeInbox: INBOX }),
      b: brian({ sentFeedId: 'd'.repeat(32), noticeInbox: INBOX }),
      c: brian({ sentFeedId: OURS }),
      d: brian({ sentFeedId: OURS, noticeInbox: 'http://169.254.169.254/latest.json' }),
      e: brian({ sentFeedId: OURS, noticeInbox: 'https://evil.example/clubInbox/a/b.json' })
    };
    expect(noticeTargets(friends, OURS)).toEqual([{ id: 'a', inboxUrl: INBOX }]);
    expect(safeInboxUrl('https://x.firebasedatabase.app/clubInbox/a/b.json')).toBeTruthy();
    expect(safeInboxUrl('https://x.firebaseio.com/clubFeed/a/b.json')).toBeNull();
  });

  it('keeps one pending revision per friend and gives up after a few tries', () => {
    let outbox = queueNotices({}, [{ id: 'a' }], 'r1');
    outbox = queueNotices(outbox, [{ id: 'a' }], 'r2');
    expect(outbox).toEqual({ a: { revision: 'r2', attempts: 0 } });
    expect(afterNoticeSend(outbox, 'a', true)).toEqual({});
    for (let i = 0; i < NOTICE_SEND_ATTEMPTS - 1; i += 1) outbox = afterNoticeSend(outbox, 'a', false);
    expect(outbox.a.attempts).toBe(NOTICE_SEND_ATTEMPTS - 1);
    expect(afterNoticeSend(outbox, 'a', false)).toEqual({});
  });
});

describe('when a friend\'s feed is read', () => {
  const FIVE = 5 * 60 * 1000;
  it('a negotiated friend is on the hourly backstop; others keep five minutes', () => {
    const friend = brian({ sentFeedId: OURS });
    expect(isNegotiated(friend, OURS)).toBe(true);
    expect(isNegotiated(brian(), OURS)).toBe(false);
    const at = (age, negotiated) => friendSyncDue({ friend, syncedAt: NOW - age, maxAgeMs: FIVE, negotiated, now: NOW });
    expect(at(FIVE + 1, false)).toBe(true);
    expect(at(FIVE + 1, true)).toBe(false);
    expect(at(NOTICE_BACKSTOP_MS + 1, true)).toBe(true);
  });

  it('a pending notice, a missing profile or a manual refresh is due now', () => {
    const base = { syncedAt: NOW, maxAgeMs: FIVE, negotiated: true, now: NOW };
    expect(friendSyncDue({ ...base, friend: brian({ noticePending: { revision: HEX, at: NOW } }) })).toBe(true);
    expect(friendSyncDue({ ...base, friend: brian(), hasProfile: false })).toBe(true);
    expect(friendSyncDue({ ...base, friend: brian(), force: true })).toBe(true);
    expect(friendSyncDue({ ...base, friend: brian() })).toBe(false);
  });
});
