import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import App from '@/App.vue'

// App.vue registers its update-check listeners directly on document/window
// and (being the app root) never tears them down in beforeUnmount - fine in
// production (it's mounted exactly once for the app's lifetime), but real
// dispatchEvent calls would leak listeners across tests in this file since
// nothing ever unregisters a previous test's mount. Spying on
// addEventListener and invoking the captured handler directly sidesteps
// that: each test only ever exercises the ONE App instance it just mounted.
function factory () {
  const listeners = {}
  vi.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
    listeners[`document:${event}`] = handler
  })
  vi.spyOn(window, 'addEventListener').mockImplementation((event, handler) => {
    listeners[`window:${event}`] = handler
  })

  const store = {
    state: { dbLoaded: false, isOnline: true },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  shallowMount(App, {
    global: {
      mocks: {
        $store: store
      }
    }
  })

  return { listeners, store }
}

describe('App - service worker update checks', () => {
  let updateMock
  let getRegistrationMock

  beforeEach(() => {
    vi.useFakeTimers()
    updateMock = vi.fn().mockResolvedValue(undefined)
    getRegistrationMock = vi.fn().mockResolvedValue({ update: updateMock })
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { getRegistration: getRegistrationMock },
      configurable: true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    delete navigator.serviceWorker
  })

  it('checks for an update on visibilitychange when the page becomes visible', async () => {
    const { listeners } = factory()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    listeners['document:visibilitychange']()
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
  })

  it('does NOT check on visibilitychange when the page becomes hidden', async () => {
    const { listeners } = factory()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })

    listeners['document:visibilitychange']()
    await Promise.resolve()

    expect(getRegistrationMock).not.toHaveBeenCalled()
  })

  // iOS's visibilitychange unreliability for standalone/home-screen PWAs is
  // exactly why these two exist as independent fallback triggers.
  it('also checks for an update on window pageshow (iOS visibilitychange fallback)', async () => {
    const { listeners } = factory()

    listeners['window:pageshow']()
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
  })

  it('also checks for an update on window focus (iOS visibilitychange fallback)', async () => {
    const { listeners } = factory()

    listeners['window:focus']()
    await vi.waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
  })

  it('re-checks periodically as a backstop that does not depend on any lifecycle event', async () => {
    factory()

    expect(updateMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(updateMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(updateMock).toHaveBeenCalledTimes(2)
  })

  it('does not throw when the service worker API is unavailable', async () => {
    delete navigator.serviceWorker
    const { listeners } = factory()

    listeners['window:focus']()
    await Promise.resolve()
    // Nothing to assert beyond "didn't throw" - getRegistration simply isn't there.
  })

  it('swallows a failed update check instead of throwing', async () => {
    getRegistrationMock.mockRejectedValue(new Error('network error'))
    const { listeners } = factory()

    listeners['window:focus']()
    await vi.waitFor(() => expect(getRegistrationMock).toHaveBeenCalledTimes(1))
  })
})

describe('App - offline detection + pending-write flush wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('flips store.state.isOnline and dispatches a flush on the online event', () => {
    const { listeners, store } = factory()

    listeners['window:online']()

    expect(store.commit).toHaveBeenCalledWith('setIsOnline', true)
    expect(store.dispatch).toHaveBeenCalledWith('flushPendingWrites')
  })

  it('flips store.state.isOnline to false on the offline event, without dispatching a flush', () => {
    const { listeners, store } = factory()

    listeners['window:offline']()

    expect(store.commit).toHaveBeenCalledWith('setIsOnline', false)
    expect(store.dispatch).not.toHaveBeenCalledWith('flushPendingWrites')
  })

  it('attempts a flush from each of the iOS-reliability triggers too, not just the online event', () => {
    const { listeners, store } = factory()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    listeners['document:visibilitychange']()
    listeners['window:pageshow']()
    listeners['window:focus']()

    expect(store.dispatch).toHaveBeenCalledWith('flushPendingWrites')
    expect(store.dispatch.mock.calls.filter((call) => call[0] === 'flushPendingWrites')).toHaveLength(3)
  })

  it('attempts a flush on the periodic interval backstop too', async () => {
    const { store } = factory()

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(store.dispatch).toHaveBeenCalledWith('flushPendingWrites')
  })
})

describe('App - global banners', () => {
  it('renders the whole-app state banners, and NOT the Home-scoped notices', () => {
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {})
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {})

    const wrapper = shallowMount(App, {
      global: {
        mocks: { $store: { state: { dbLoaded: false, isOnline: true, updateAvailable: false }, commit: vi.fn(), dispatch: vi.fn() } }
      }
    })

    // Offline and access banners are states of the whole app, so they stay
    // global. The update card and bug-resolution card are NOTIFICATIONS,
    // and every notification renders in Home's .home-notices section — a
    // second copy here would show the update twice (2026-08-21 unification).
    expect(wrapper.findComponent({ name: 'OfflineBanner' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'LibraryAccessBanner' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'UpdateAvailableBanner' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BugResolutionNotice' }).exists()).toBe(false)
    vi.restoreAllMocks()
  })
})

describe('App - noticing a new deploy without the service worker', () => {
  // The banner is driven by registerServiceWorker's updated() hook, which
  // only fires while a new worker is in the `installed` state — but this app
  // builds with skipWaiting: true, so a worker activates itself immediately.
  // The hook is therefore a race the banner often loses (bug report: "I
  // didn't get my refresh for new version banner"). Comparing bundle names
  // doesn't depend on worker timing.
  const mountWithBundle = (bundleSrc, commit) => {
    document.body.innerHTML = '';
    if (bundleSrc) {
      const script = document.createElement('script');
      script.setAttribute('src', bundleSrc);
      document.body.appendChild(script);
    }
    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    return shallowMount(App, {
      global: {
        mocks: {
          $store: { state: { updateAvailable: false }, commit, dispatch: vi.fn(), getters: {} },
          $route: { path: '/' },
          $router: { push: vi.fn() }
        }
      }
    });
  };

  afterEach(() => {
    document.body.innerHTML = '';
    delete global.fetch;
    vi.restoreAllMocks();
  });

  it('flags an update when the server serves a different bundle', async () => {
    const commit = vi.fn();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<script src="/js/app.9f2c1a7b.js"></script>')
    }));

    const wrapper = mountWithBundle('/js/app.oldhash.js', commit);
    await wrapper.vm.checkDeployedBundle();

    expect(commit).toHaveBeenCalledWith('setUpdateAvailable', true);
  });

  it('stays quiet when the bundle is unchanged', async () => {
    const commit = vi.fn();
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      text: () => Promise.resolve('<script src="/js/app.samehash.js"></script>')
    }));

    const wrapper = mountWithBundle('/js/app.samehash.js', commit);
    await wrapper.vm.checkDeployedBundle();

    expect(commit).not.toHaveBeenCalledWith('setUpdateAvailable', true);
  });

  it('busts the cache so the service worker cannot serve its precached copy', async () => {
    const commit = vi.fn();
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }));

    const wrapper = mountWithBundle('/js/app.oldhash.js', commit);
    await wrapper.vm.checkDeployedBundle();

    expect(global.fetch.mock.calls[0][0]).toMatch(/updateCheck=\d+/);
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('does not re-check once an update is already flagged', async () => {
    const commit = vi.fn();
    global.fetch = vi.fn();
    document.body.innerHTML = '';
    const script = document.createElement('script');
    script.setAttribute('src', '/js/app.oldhash.js');
    document.body.appendChild(script);

    vi.spyOn(document, 'addEventListener').mockImplementation(() => {});
    vi.spyOn(window, 'addEventListener').mockImplementation(() => {});
    const wrapper = shallowMount(App, {
      global: {
        mocks: {
          $store: { state: { updateAvailable: true }, commit, dispatch: vi.fn(), getters: {} },
          $route: { path: '/' },
          $router: { push: vi.fn() }
        }
      }
    });
    await wrapper.vm.checkDeployedBundle();

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('survives the check failing, e.g. offline', async () => {
    const commit = vi.fn();
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));

    const wrapper = mountWithBundle('/js/app.oldhash.js', commit);
    await expect(wrapper.vm.checkDeployedBundle()).resolves.toBeUndefined();
    expect(commit).not.toHaveBeenCalledWith('setUpdateAvailable', true);
  });
});

// Bug report (2026-09-27): "This app never shows badges when it has things I
// need to do." Opening or returning to the app used to CLEAR the icon badge;
// now it recounts the chores still waiting, both ways through the door.
describe('App - icon badge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('recounts the badge (never blanket-clears it) when the app comes back and when it leaves', () => {
    const clearAppBadge = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clearAppBadge', { value: clearAppBadge, configurable: true })
    const { listeners, store } = factory()

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    listeners['document:visibilitychange']()
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    listeners['document:visibilitychange']()

    expect(store.dispatch.mock.calls.filter((call) => call[0] === 'refreshAppBadge')).toHaveLength(2)
    expect(clearAppBadge).not.toHaveBeenCalled()
    delete navigator.clearAppBadge
  })
})
