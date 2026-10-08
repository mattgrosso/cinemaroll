import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createReporter, framesFrom, normalize, scrub, parseDsn } = require('../../aws-lambda/sentryLambda.js');

const DSN = 'https://abc123@o999.ingest.us.sentry.io/4242';

function reporter (overrides = {}) {
  const fetchFn = vi.fn(async () => ({ ok: true, status: 200 }));
  const r = createReporter({ dsn: DSN, functionName: 'cinemaroll-newsletter', fetchFn, now: () => 1_760_000_000_000, ...overrides });
  const sent = () => fetchFn.mock.calls.map(([url, opts]) => {
    const [header, , event] = opts.body.split('\n').map((line) => JSON.parse(line));
    return { url, header, event, headers: opts.headers };
  });
  return { r, fetchFn, sent };
}

// House module (2026-10-08): the Lambdas report to Sentry over its envelope
// endpoint, with no SDK in the bundle.
describe('sentryLambda', () => {
  it('posts an envelope to the project in the DSN, authenticated by its key', async () => {
    const { r, sent } = reporter();
    await r.captureException(new Error('boom'));
    const [one] = sent();
    expect(one.url).toBe('https://o999.ingest.us.sentry.io/api/4242/envelope/');
    expect(one.headers['x-sentry-auth']).toContain('sentry_key=abc123');
    expect(one.header.dsn).toBe(DSN);
    expect(one.event.platform).toBe('node');
    expect(one.event.server_name).toBe('cinemaroll-newsletter');
    expect(one.event.tags).toMatchObject({ runtime: 'lambda', function: 'cinemaroll-newsletter', handled: 'yes' });
    expect(one.event.exception.values[0]).toMatchObject({ type: 'Error', value: 'boom' });
    expect(one.event.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
  });

  it('wrapHandler reports a thrown error as unhandled and rethrows it', async () => {
    const { r, sent } = reporter();
    const handler = r.wrapHandler(async () => { throw new Error('newsletter blew up'); });
    await expect(handler({}, {})).rejects.toThrow('newsletter blew up');
    const [one] = sent();
    expect(one.event.tags.handled).toBe('no');
    expect(one.event.exception.values[0].mechanism.handled).toBe(false);
  });

  it('wrapHandler reports console.error calls made during the invocation, once per shape', async () => {
    const { r, sent } = reporter();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = r.wrapHandler(async () => {
      console.error('push failed for user 12', new Error('410 Gone'));
      console.error('push failed for user 13', new Error('410 Gone'));
      console.error('feed fetch failed https://x.y/feed.json?auth=SECRET');
      return 'done';
    });
    expect(await handler({}, {})).toBe('done');
    quiet.mockRestore();
    const events = sent().map((s) => s.event);
    expect(events).toHaveLength(2);
    expect(events[0].exception.values[0].value).toBe('410 Gone');
    expect(events[0].message).toBe('push failed for user 12 410 Gone');
    expect(events[1].message).toBe('feed fetch failed https://x.y/feed.json?auth=[Filtered]');
    expect(events[1].fingerprint).toEqual(['console', 'feed fetch failed URL']);
    expect(typeof console.error).toBe('function');
  });

  it('warns before the function times out', async () => {
    vi.useFakeTimers();
    const { r, sent } = reporter();
    const handler = r.wrapHandler(() => new Promise((resolve) => setTimeout(() => resolve('late'), 10_000)));
    const run = handler({}, { getRemainingTimeInMillis: () => 6000 });
    await vi.advanceTimersByTimeAsync(4600);
    expect(sent().map((s) => s.event.message)).toEqual(['cinemaroll-newsletter is about to time out']);
    await vi.advanceTimersByTimeAsync(6000);
    expect(await run).toBe('late');
    vi.useRealTimers();
  });

  it('never throws into the handler when Sentry is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { r } = reporter({ fetchFn: async () => { throw new Error('ENOTFOUND'); } });
    await expect(r.captureException(new Error('x'))).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('[sentry] not sent: ENOTFOUND');
    warn.mockRestore();
  });

  it('parses stacks oldest-first with node_modules frames marked out of app', () => {
    const stack = 'Error: x\n    at inner (/var/task/index.js:10:5)\n    at Object.<anonymous> (/var/task/node_modules/web-push/index.js:3:1)';
    expect(framesFrom(stack)).toEqual([
      { function: 'Object.<anonymous>', filename: '/var/task/node_modules/web-push/index.js', lineno: 3, colno: 1, in_app: false },
      { function: 'inner', filename: '/var/task/index.js', lineno: 10, colno: 5, in_app: true }
    ]);
  });

  it('scrubs credentials and groups by message shape', () => {
    expect(scrub('https://a.b/c.json?auth=TOKEN&x=1')).toBe('https://a.b/c.json?auth=[Filtered]&x=1');
    expect(normalize('sent 12 pushes to 3 users')).toBe('sent # pushes to # users');
    expect(parseDsn('nope')).toBeNull();
  });
});
