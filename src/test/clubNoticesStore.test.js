import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The store's half of Film Club change notices (spec 1.3.0 §6.3): what a
// notice in the inbox makes the app do, and what it never does. Real store,
// faked Firebase, faked feed reader, faked network.
vi.mock('axios');
vi.mock('@sentry/vue');

const calls = [];
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn((path, value) => { calls.push(['set', path, value]); return Promise.resolve(); }),
  update: vi.fn(() => Promise.resolve()),
  query: vi.fn((target) => target),
  orderByChild: vi.fn(),
  orderByKey: vi.fn(),
  limitToFirst: vi.fn(),
  startAt: vi.fn(),
  push: vi.fn(() => ({ key: 'k' })),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  OAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => { callback(null); return vi.fn(); })
}));
vi.mock('@/utils/pendingWriteQueue.js', () => ({
  listPendingWrites: vi.fn(() => Promise.resolve([])),
  removePendingWrite: vi.fn(),
  updatePendingWrite: vi.fn(),
  enqueueWrite: vi.fn((entry) => Promise.resolve({ id: 'queued-id', ...entry }))
}));
const snapshots = {};
vi.mock('@/utils/offlineStore.js', () => ({
  loadSnapshot: vi.fn((key, kind) => Promise.resolve(snapshots[kind] ?? null)),
  saveSnapshot: vi.fn((key, kind, value) => { snapshots[kind] = value; return Promise.resolve(); })
}));
const refreshExternalFeed = vi.fn();
vi.mock('@/utils/filmClubSyncClient.js', () => ({
  refreshExternalFeed: (...args) => refreshExternalFeed(...args),
  feedFromSyncCache: vi.fn()
}));

const ME = 'matt-example-com';
const SECRET = 'a'.repeat(32);
const OURS = 'c'.repeat(32);
const HEX = 'b'.repeat(32);
const INBOX_PATH = `clubInbox/${ME}/code1234`;
const THEIR_INBOX = 'https://other-db.firebaseio.com/clubInbox/brian/code1.json';
const FEED = 'https://other-db.firebaseio.com/clubFeed/brian/s.json';
const notice = (patch = {}) => ({ kind: 'feedChanged', app: 'movielog', feed: 'f1', revision: HEX, at: Date.now(), ...patch });

let store;
let fetchMock;

function setFriends (friends) {
  store.commit('setSettings', { clubFeedKey: SECRET, clubInviteCode: 'code1234', clubFeedId: { id: OURS, secret: SECRET }, externalFriends: friends });
}
const brian = (patch = {}) => ({ name: 'Brian', feedUrl: FEED, addedAt: 1, noticeFeed: 'f1', noticeApp: 'movielog', sentFeedId: OURS, ...patch });
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));
const deletes = () => calls.filter(([kind, path, value]) => kind === 'set' && path.startsWith(INBOX_PATH) && value === null).map(([, path]) => path.split('/').pop());
const friendWrites = (field) => calls.filter(([, path]) => path.endsWith(`/externalFriends/ext1/${field}`)).map(([, , value]) => value);

beforeEach(async () => {
  calls.length = 0;
  Object.keys(snapshots).forEach((key) => delete snapshots[key]);
  refreshExternalFeed.mockReset();
  refreshExternalFeed.mockResolvedValue({ status: 'unchanged' });
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(null) }));
  vi.stubGlobal('fetch', fetchMock);
  vi.resetModules();
  store = (await import('@/store/index.js')).default;
  store.commit('setDatabaseTopKey', ME);
  store.state.isOnline = true;
  store.commit('setExternalFriendProfile', { id: 'ext1', profile: { name: 'Brian' } });
});
afterEach(() => vi.unstubAllGlobals());

describe('a notice in the inbox', () => {
  it('that names nobody we negotiated with is deleted and reads nothing', async () => {
    setFriends({ ext1: brian() });
    await store.dispatch('processClubInbox', { raw: { a: notice({ feed: 'stranger' }), b: notice({ kind: 'feedRevoked' }), c: { kind: 'junk' } }, path: INBOX_PATH });
    await settled();
    expect(deletes().sort()).toEqual(['a', 'b', 'c']);
    expect(refreshExternalFeed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is persisted as a pending refresh before it is deleted, and a burst is one refresh', async () => {
    setFriends({ ext1: brian() });
    const first = Date.now() - 2000;
    await store.dispatch('processClubInbox', { raw: { a: notice({ at: first, revision: 'd'.repeat(32) }), b: notice({ at: first + 1000 }) }, path: INBOX_PATH });
    await settled();
    const pendingAt = calls.findIndex(([, path]) => path.endsWith('/externalFriends/ext1/noticePending'));
    const firstDelete = calls.findIndex(([kind, path, value]) => kind === 'set' && path.startsWith(INBOX_PATH) && value === null);
    expect(pendingAt).toBeGreaterThan(-1);
    expect(pendingAt).toBeLessThan(firstDelete);
    expect(friendWrites('noticePending')[0]).toEqual({ revision: HEX, at: first + 1000 });
    expect(refreshExternalFeed).toHaveBeenCalledTimes(1);
    expect(refreshExternalFeed.mock.calls[0][0].feedUrl).toBe(FEED);
    // Refreshed: the marker is cleared.
    expect(friendWrites('noticePending').at(-1)).toBeNull();
  });

  it('naming the revision we already hold costs the friend nothing', async () => {
    setFriends({ ext1: brian() });
    snapshots['externalSync:ext1'] = { meta: { revision: HEX } };
    await store.dispatch('processClubInbox', { raw: { a: notice() }, path: INBOX_PATH });
    await settled();
    expect(refreshExternalFeed).not.toHaveBeenCalled();
    expect(friendWrites('noticePending').at(-1)).toBeNull();
  });

  it('a refresh that fails keeps the pending marker', async () => {
    setFriends({ ext1: brian() });
    refreshExternalFeed.mockResolvedValue({ status: 'unreachable', reason: 'offline' });
    await store.dispatch('processClubInbox', { raw: { a: notice() }, path: INBOX_PATH });
    await settled();
    expect(refreshExternalFeed).toHaveBeenCalledTimes(1);
    expect(friendWrites('noticePending')).toEqual([{ revision: HEX, at: expect.any(Number) }]);
  });

  it('is never a friend request', () => {
    setFriends({ ext1: brian() });
    store.commit('setClubInboxRequests', { a: notice() });
    expect(store.getters.clubInboxRequests).toEqual([]);
  });
});

describe('an existing friend negotiating', () => {
  const negotiation = (patch = {}) => ({ name: 'Brian', app: 'movielog', feedUrl: FEED, replyInboxUrl: THEIR_INBOX, feed: 'f2', notices: true, at: Date.now(), ...patch });

  it('who provably holds our feed is answered once, with no reply inbox, and never shown', async () => {
    setFriends({ ext1: brian({ noticeFeed: undefined, negotiatedInbox: THEIR_INBOX }) });
    store.commit('setClubInboxRequests', { r1: negotiation() });
    expect(store.getters.clubInboxRequests).toEqual([]);
    await store.dispatch('processClubInbox', { raw: { r1: negotiation() }, path: INBOX_PATH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(THEIR_INBOX);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ app: 'cinemaroll', feed: OURS, notices: true });
    expect(body.replyInboxUrl).toBeUndefined();
    expect(friendWrites('noticeFeed')).toEqual(['f2']);
    expect(friendWrites('noticeInbox')).toEqual([THEIR_INBOX]);
    expect(friendWrites('answeredFeedId')).toEqual([OURS]);
    expect(deletes()).toEqual(['r1']);

    await store.dispatch('processClubInbox', { raw: { r2: negotiation() }, path: INBOX_PATH });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('whom we can\'t show has our feed is left to the owner as an ordinary request', async () => {
    setFriends({ ext1: brian({ sentFeedId: undefined }) });
    store.commit('setClubInboxRequests', { r1: negotiation() });
    await store.dispatch('processClubInbox', { raw: { r1: negotiation() }, path: INBOX_PATH });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
    expect(friendWrites('noticeFeed')).toEqual([]);
    expect(store.getters.clubInboxRequests.map((r) => r.id)).toEqual(['r1']);
  });

  it('carrying their exact feed URL but a new reply inbox is never answered automatically', async () => {
    setFriends({ ext1: brian({ negotiatedInbox: THEIR_INBOX }) });
    const forged = negotiation({ replyInboxUrl: 'https://other-db.firebaseio.com/clubInbox/forger/x.json', feed: 'forged' });
    store.commit('setClubInboxRequests', { r1: forged });
    await store.dispatch('processClubInbox', { raw: { r1: forged }, path: INBOX_PATH });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deletes()).toEqual([]);
    expect(friendWrites('noticeFeed')).toEqual([]);
    expect(friendWrites('noticeInbox')).toEqual([]);
    expect(store.getters.clubInboxRequests.map((r) => r.id)).toEqual(['r1']);
  });

  it('the owner accepting binds what it carries', async () => {
    setFriends({ ext1: brian({ sentFeedId: undefined, noticeFeed: undefined }) });
    await store.dispatch('acceptClubRequest', { id: 'r1', ...negotiation() });
    expect(friendWrites('sentFeedId')).toEqual([OURS]);
    expect(friendWrites('noticeFeed')).toEqual(['f2']);
    expect(friendWrites('noticeInbox')).toEqual([THEIR_INBOX]);
  });
});

describe('sending notices', () => {
  it('goes to negotiated friends holding our current feed, once per publish', async () => {
    setFriends({
      ext1: brian({ noticeInbox: THEIR_INBOX }),
      ext2: brian({ feedUrl: 'https://other-db.firebaseio.com/clubFeed/seth/t.json', noticeInbox: THEIR_INBOX.replace('brian', 'seth'), sentFeedId: 'e'.repeat(32) }),
      ext3: brian({ feedUrl: 'https://other-db.firebaseio.com/clubFeed/kim/u.json', noticeInbox: undefined })
    });
    await store.dispatch('sendClubNotices', { revision: HEX });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(THEIR_INBOX);
    expect(JSON.parse(options.body)).toEqual({ kind: 'feedChanged', app: 'cinemaroll', feed: OURS, revision: HEX, at: expect.any(Number) });
    expect(snapshots.clubNoticeOutbox).toEqual({});
  });

  it('a failed send waits for the next session, and never throws', async () => {
    setFriends({ ext1: brian({ noticeInbox: THEIR_INBOX }) });
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(store.dispatch('sendClubNotices', { revision: HEX })).resolves.toBeUndefined();
    expect(snapshots.clubNoticeOutbox).toEqual({ ext1: { revision: HEX, attempts: 1 } });
    fetchMock.mockResolvedValue({ ok: true });
    await store.dispatch('sendClubNotices');
    expect(snapshots.clubNoticeOutbox).toEqual({});
  });

  it('stops for a friend who was removed', async () => {
    setFriends({ ext1: brian({ noticeInbox: THEIR_INBOX }) });
    snapshots.clubNoticeOutbox = { ext1: { revision: HEX, attempts: 1 } };
    setFriends({});
    await store.dispatch('sendClubNotices');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshots.clubNoticeOutbox).toEqual({});
  });
});

describe('the backstop', () => {
  it('a negotiated friend read ten minutes ago waits for the hour; an ordinary one does not', async () => {
    setFriends({ ext1: brian(), ext2: { name: 'Seth', feedUrl: 'https://other-db.firebaseio.com/clubFeed/seth/t.json', addedAt: 2 } });
    store.commit('setExternalFriendProfile', { id: 'ext2', profile: { name: 'Seth' } });
    store.commit('markExternalFriendsSynced', { ids: ['ext1', 'ext2'], at: Date.now() - 10 * 60 * 1000 });
    await store.dispatch('syncExternalFriends');
    expect(refreshExternalFeed.mock.calls.map(([args]) => args.feedUrl)).toEqual(['https://other-db.firebaseio.com/clubFeed/seth/t.json']);
  });

  it('a notice-driven refresh never postpones it', async () => {
    setFriends({ ext1: brian({ noticePending: { revision: HEX, at: 1 } }) });
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    store.commit('markExternalFriendsSynced', { ids: ['ext1'], at: tenMinutesAgo });
    await store.dispatch('syncExternalFriends');
    expect(refreshExternalFeed).toHaveBeenCalledTimes(1);
    expect(store.state.externalFriendSyncedAt.ext1).toBe(tenMinutesAgo);
  });
});

describe('adding a friend', () => {
  it('still works with an inbox that refuses the negotiation fields', async () => {
    setFriends({});
    fetchMock.mockImplementation((url, options) => Promise.resolve({ ok: !JSON.parse(options.body).feed }));
    const result = await store.dispatch('sendClubRequest', JSON.stringify({ format: 'film-club-invite/1', name: 'Brian', feedUrl: FEED, inboxUrl: THEIR_INBOX }));
    expect(result).toMatchObject({ ok: true, replied: true });
    const posts = fetchMock.mock.calls.filter(([url]) => url === THEIR_INBOX);
    expect(posts).toHaveLength(2);
    expect(JSON.parse(posts[0][1].body).feed).toBe(OURS);
    expect(JSON.parse(posts[1][1].body).feed).toBeUndefined();
  });
});
