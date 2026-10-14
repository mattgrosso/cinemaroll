import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('beforeSendError', () => {
  beforeEach(() => vi.resetModules());

  async function load (reloadTriggered) {
    vi.doMock('@/utils/staleChunkReload.js', async (importOriginal) => ({
      ...(await importOriginal()),
      staleChunkReloadTriggered: () => reloadTriggered
    }));
    return import('@/utils/sentryBeforeSend.js');
  }

  const preloadError = { exception: { values: [{ type: 'Error', value: 'Unable to preload CSS for /css/Login.0caee1b3.css' }] } };

  it('drops a stale-chunk error once the page is reloading over it', async () => {
    const { beforeSendError } = await load(true);
    expect(beforeSendError(preloadError, {})).toBeNull();
    expect(beforeSendError({ message: 'Loading chunk 12 failed' }, { originalException: new Error('Loading chunk 12 failed') })).toBeNull();
  });

  it('still reports a stale-chunk error the guard refused to reload for', async () => {
    const { beforeSendError } = await load(false);
    expect(beforeSendError(preloadError, {})).toBe(preloadError);
  });

  it('passes every other error through, scrubbed', async () => {
    const { beforeSendError } = await load(true);
    const event = { message: 'TypeError: x is not a function', request: { url: 'https://movie-log.example/?auth=SECRET' } };
    const sent = beforeSendError(event, { originalException: new TypeError('x is not a function') });
    expect(sent).toBe(event);
    expect(sent.request.url).not.toContain('SECRET');
  });
});

describe('isTestBrowser', () => {
  const page = (hostname, webdriver) => ({ location: { hostname }, navigator: { webdriver } });

  it('is a test when the browser is automated, even on the live site', async () => {
    const { isTestBrowser } = await import('@/utils/sentryBeforeSend.js');
    expect(isTestBrowser(page('www.cinemaroll.org', true))).toBe(true);
  });

  it('is a test when the build is served from this machine', async () => {
    const { isTestBrowser } = await import('@/utils/sentryBeforeSend.js');
    expect(isTestBrowser(page('localhost', false))).toBe(true);
    expect(isTestBrowser(page('127.0.0.1', undefined))).toBe(true);
  });

  it('is a user on the live site in an ordinary browser', async () => {
    const { isTestBrowser } = await import('@/utils/sentryBeforeSend.js');
    expect(isTestBrowser(page('www.cinemaroll.org', false))).toBe(false);
    expect(isTestBrowser(page('www.cinemaroll.org', undefined))).toBe(false);
  });
});
