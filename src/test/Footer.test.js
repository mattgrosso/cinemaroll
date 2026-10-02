import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Footer from '@/components/Footer.vue';
import { setBuildInfo } from '@/assets/javascript/buildStamp.js';

function factory (devModeValue) {
  const commit = vi.fn();
  const dispatch = vi.fn(() => Promise.resolve());
  const wrapper = mount(Footer, {
    global: {
      mocks: {
        $store: {
          getters: { devMode: devModeValue },
          commit,
          dispatch
        }
      }
    }
  });
  return { wrapper, commit, dispatch };
}

describe('Footer build stamp', () => {
  // The house standard (Matt, 2026-08-22): one muted line, version and the
  // time the BUILD was made — not page-load time — so a stale tab is obvious.
  // main.js hands the build's values over (buildStamp.js setBuildInfo).
  afterEach(() => {
    setBuildInfo({});
  });

  it('renders version and build time in the house format', () => {
    // Local parts in, local time out — no timezone drift.
    setBuildInfo({ version: '1.96.4', buildTime: new Date(2026, 7, 22, 1, 32).toISOString() });

    const { wrapper } = factory(false);

    const stamp = wrapper.find('.build-stamp');
    expect(stamp.exists()).toBe(true);
    expect(stamp.text()).toBe(
      `v1.96.4 · built Aug 22${new Date().getFullYear() === 2026 ? '' : ', 2026'}, 1:32 AM`
    );
  });

  it('still shows the version when no build time was injected', () => {
    setBuildInfo({ version: '1.96.4' });

    const { wrapper } = factory(false);

    expect(wrapper.find('.build-stamp').text()).toBe('v1.96.4');
  });
});

describe('Footer devMode toggle', () => {
  it('reflects $store.getters.devMode rather than tracking its own copy', () => {
    const { wrapper } = factory(true);
    expect(wrapper.find('.dev-mode-switch').classes()).toContain('dev-mode-on');
  });

  it('shows the off state when the store getter is false', () => {
    const { wrapper } = factory(false);
    expect(wrapper.find('.dev-mode-switch').classes()).toContain('dev-mode-off');
  });

  it('toggling commits setDevMode with the flipped value, then re-initializes and reloads', async () => {
    const reloadSpy = vi.fn();
    const originalLocation = window.location;
    delete window.location;
    window.location = { ...originalLocation, reload: reloadSpy };

    const { wrapper, commit, dispatch } = factory(false);
    await wrapper.find('.dev-mode-switch').trigger('click');

    expect(commit).toHaveBeenCalledWith('setDevMode', true);
    expect(dispatch).toHaveBeenCalledWith('initializeDB');
    expect(reloadSpy).toHaveBeenCalled();

    window.location = originalLocation;
  });
});
