import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AppHeader from '@/components/Header.vue';
import { setBuildInfo } from '@/assets/javascript/buildStamp.js';

function factory (stateOverrides = {}) {
  return mount(AppHeader, {
    global: {
      mocks: {
        $store: {
          state: { showHeader: true, hideHeaderLogo: false, bannerUrl: null, ...stateOverrides },
          getters: { allMediaAsArray: [], devMode: false },
          commit: vi.fn()
        },
        $router: { push: vi.fn() }
      }
    }
  });
}

describe('Header', () => {
  it('shows the "Cinema Roll" home-link by default', () => {
    const wrapper = factory();
    expect(wrapper.find('.home-link').exists()).toBe(true);
  });

  it('hides the home-link when hideHeaderLogo is true (a game with its own baked-in branding)', () => {
    const wrapper = factory({ hideHeaderLogo: true });
    expect(wrapper.find('.home-link').exists()).toBe(false);
  });

  it('still renders the banner image when the logo is hidden - hideHeaderLogo only affects the overlay, not showHeader', () => {
    const wrapper = factory({ hideHeaderLogo: true, bannerUrl: 'https://example.com/banner.png' });
    expect(wrapper.find('.random-banner img').exists()).toBe(true);
    expect(wrapper.find('.home-link').exists()).toBe(false);
  });

  it('clicking the banner navigates home, same as clicking the "Cinema Roll" title (bug report: needed once hideHeaderLogo hides that title)', async () => {
    const wrapper = factory({ bannerUrl: 'https://example.com/banner.png' });
    await wrapper.find('.random-banner').trigger('click');

    expect(wrapper.vm.$store.commit).toHaveBeenCalledWith('setGoHome', true);
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/');
  });

  describe('version number stays visible even when the logo is hidden (bug report: "the version number... doesn\'t appear with our new game headers... just the exact same spot")', () => {
    it('shows the version inside .home-link by default', () => {
      const wrapper = factory();
      expect(wrapper.find('.home-link .version').exists()).toBe(true);
      expect(wrapper.find('.version-only').exists()).toBe(false);
    });

    it('falls back to a standalone .version-only element when hideHeaderLogo is true', () => {
      const wrapper = factory({ hideHeaderLogo: true });
      expect(wrapper.find('.home-link').exists()).toBe(false);
      expect(wrapper.find('.version-only .version').exists()).toBe(true);
    });

    // The corner badge is the house stamp's version half (0.5rem over a banner
    // photo has no room for a timestamp); the full "v… · built …" line is in
    // the footer. Assert the text, not just that the element exists — an empty
    // .version would satisfy the two tests above.
    it('renders the version with the house "v" prefix, in both placements', () => {
      setBuildInfo({ version: '1.96.4' });

      expect(factory().find('.home-link .version').text()).toBe('v1.96.4');
      expect(factory({ hideHeaderLogo: true }).find('.version-only .version').text()).toBe('v1.96.4');

      setBuildInfo({});
    });

    it('.version-only also navigates home on click, same as the normal title', async () => {
      const wrapper = factory({ hideHeaderLogo: true });
      await wrapper.find('.version-only').trigger('click');

      expect(wrapper.vm.$store.commit).toHaveBeenCalledWith('setGoHome', true);
      expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/');
    });
  });
});
