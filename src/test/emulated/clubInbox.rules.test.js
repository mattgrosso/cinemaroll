import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { ref, get, set } from 'firebase/database';

// The connect inbox (Film Club spec §6.2) and change notices (1.3.0 §6.3):
// strangers create, never overwrite or delete; only the owner reads and
// deletes; a notice is exactly five bounded fields.
let testEnv;
const OWNER_EMAIL = 'matt@example.com';
const OWNER_KEY = 'matt-example-com';
const INBOX = `clubInbox/${OWNER_KEY}/abcdef0123456789`;
const HEX = 'b'.repeat(32);

const notice = (patch = {}) => ({ kind: 'feedChanged', app: 'movielog', feed: 'a'.repeat(32), revision: HEX, at: Date.now(), ...patch });
const request = (patch = {}) => ({ name: 'Brian', app: 'movielog', feedUrl: 'https://x.firebaseio.com/clubFeed/b/s.json', replyInboxUrl: 'https://x.firebaseio.com/clubInbox/b/c.json', at: Date.now(), ...patch });

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'movie-log-8c4d5',
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 }
  });
});
afterAll(async () => { if (testEnv) await testEnv.cleanup(); });
beforeEach(async () => { await testEnv.clearDatabase(); });

const anon = () => testEnv.unauthenticatedContext().database();
const owner = () => testEnv.authenticatedContext('uid-matt', { email: OWNER_EMAIL, email_verified: true }).database();
const stranger = () => testEnv.authenticatedContext('uid-x', { email: 'x@example.com', email_verified: true }).database();

describe('clubInbox rules', () => {
  it('a stranger may drop a valid notice; only the owner reads and deletes it', async () => {
    await assertSucceeds(set(ref(anon(), `${INBOX}/n1`), notice()));
    await assertSucceeds(set(ref(stranger(), `${INBOX}/n2`), notice({ app: 'cinemaroll', feed: 'feed_-1' })));
    await assertFails(get(ref(anon(), INBOX)));
    await assertFails(get(ref(stranger(), INBOX)));
    await assertSucceeds(get(ref(owner(), INBOX)));
    await assertFails(set(ref(anon(), `${INBOX}/n1`), null));
    await assertFails(set(ref(anon(), `${INBOX}/n1`), notice({ revision: 'c'.repeat(32) })));
    await assertSucceeds(set(ref(owner(), `${INBOX}/n1`), null));
  });

  it('a notice is exactly five bounded fields', async () => {
    const bad = [
      notice({ kind: 'feedMoved' }), notice({ kind: 'feedRevoked' }), notice({ app: 'other' }),
      notice({ feed: '' }), notice({ feed: 'a'.repeat(129) }), notice({ feed: 'has space' }),
      notice({ revision: 'B'.repeat(32) }), notice({ revision: 'b'.repeat(31) }),
      notice({ at: 'soon' }), notice({ at: Date.now() + 10 * 60 * 1000 }), notice({ at: Date.now() - 8 * 24 * 60 * 60 * 1000 }),
      notice({ feedUrl: 'https://x/clubFeed/b/s.json' }), notice({ name: 'Brian' }), notice({ extra: 1 }),
      notice({ replyInboxUrl: 'https://x/i.json' }), notice({ notices: true })
    ];
    for (const value of bad) await assertFails(set(ref(anon(), `${INBOX}/bad`), value));
    for (const field of ['kind', 'app', 'feed', 'revision', 'at']) {
      const missing = notice(); delete missing[field];
      await assertFails(set(ref(anon(), `${INBOX}/bad`), missing));
    }
    await assertSucceeds(set(ref(anon(), `${INBOX}/edge`), notice({ feed: 'a'.repeat(128) })));
  });

  it('connect requests still work, with and without the negotiation fields', async () => {
    await assertSucceeds(set(ref(anon(), `${INBOX}/r1`), request()));
    await assertSucceeds(set(ref(anon(), `${INBOX}/r2`), request({ feed: 'a'.repeat(32), notices: true })));
    await assertSucceeds(set(ref(anon(), `${INBOX}/r3`), request({ replyInboxUrl: null, somethingNew: 'ok' })));
    await assertFails(set(ref(anon(), `${INBOX}/r4`), request({ feed: 'not valid!' })));
    await assertFails(set(ref(anon(), `${INBOX}/r5`), request({ notices: 'yes' })));
    await assertFails(set(ref(anon(), `${INBOX}/r6`), { app: 'movielog', at: Date.now() }));
  });
});
