import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setupItems, setupNoticeSignature, tourDue, shouldStartOnboarding, TOUR_CARDS, RAINBOW_CHIPS,
  tourCards, phonePlatform
} from '@/assets/javascript/onboarding.js';
import AppTour from '@/components/AppTour.vue';
import SettingsSection from '@/components/SettingsSection.vue';

// Matt, 2026-11-14: "do we have any kind of onboarding, like introduction or
// tutorial that shows people settings they can do and what the app can do?"
// Then: "don't put a question mark in the header ... maybe a new pane to the
// settings, which says replay tutorial".

describe('who gets the first look', () => {
  it('starts only for a brand-new account with settings in and no record yet', () => {
    expect(shouldStartOnboarding({ settingsLoaded: true, brandNew: true, onboarding: null })).toBe(true);
    expect(shouldStartOnboarding({ settingsLoaded: false, brandNew: true, onboarding: null })).toBe(false);
    expect(shouldStartOnboarding({ settingsLoaded: true, brandNew: false, onboarding: null })).toBe(false);
    expect(shouldStartOnboarding({ settingsLoaded: true, brandNew: true, onboarding: { startedAt: 1 } })).toBe(false);
  });

  it('opens the tour once, for an account that started here', () => {
    expect(tourDue(null)).toBe(false);
    expect(tourDue({ startedAt: 1 })).toBe(true);
    expect(tourDue({ startedAt: 1, tourSeenAt: 2 })).toBe(false);
  });
});

describe('the setup list', () => {
  const fresh = { ratedCount: 0, pushAvailable: true };

  it('lists what is worth a minute, in order', () => {
    expect(setupItems(fresh).map((item) => item.id)).toEqual(['rate', 'letterboxd', 'notifications', 'club', 'theaters', 'awards']);
    expect(setupItems(fresh).every((item) => !item.done)).toBe(true);
  });

  it('leaves notifications out where this device cannot have them', () => {
    expect(setupItems({ pushAvailable: false }).map((item) => item.id)).not.toContain('notifications');
  });

  it('ticks items off from the facts', () => {
    const items = setupItems({ ratedCount: 3, letterboxdLinked: true, pushAvailable: true, pushOn: true, clubProfile: true, theatersChosen: true, awardsNamed: true });
    expect(items.every((item) => item.done)).toBe(true);
  });

  it('is a notice only for an account that started here, until done or put away', () => {
    const items = setupItems(fresh);
    expect(setupNoticeSignature(null, items)).toBeNull();
    expect(setupNoticeSignature({ startedAt: 1 }, items)).toBe('rate,letterboxd,notifications,club,theaters,awards');
    expect(setupNoticeSignature({ startedAt: 1, setupDismissedAt: 2 }, items)).toBeNull();
    const allDone = setupItems({ ratedCount: 1, letterboxdLinked: true, clubProfile: true, theatersChosen: true, awardsNamed: true });
    expect(setupNoticeSignature({ startedAt: 1 }, allDone)).toBeNull();
  });
});

describe('the tour', () => {
  it('draws the rainbow bar in the colours Home gives it', () => {
    const home = readFileSync(resolve(__dirname, '../components/Home.vue'), 'utf8');
    for (const chip of RAINBOW_CHIPS) {
      const rule = home.match(new RegExp(`&\\.chip-${chip.key} \\{\\s*background-color: (#[0-9A-Fa-f]{6})`));
      expect(rule?.[1]?.toLowerCase(), chip.key).toBe(chip.colour.toLowerCase());
    }
  });

  it('pages through its cards and closes from Skip or the last card', async () => {
    const wrapper = mount(AppTour, { attachTo: document.body, global: { stubs: { Teleport: true } } });
    expect(wrapper.find('.tour-title').text()).toBe(TOUR_CARDS[0].title);
    for (let i = 1; i < TOUR_CARDS.length; i++) await wrapper.find('.tour-next').trigger('click');
    expect(wrapper.find('.tour-title').text()).toBe(TOUR_CARDS[TOUR_CARDS.length - 1].title);
    await wrapper.find('.tour-next').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
    await wrapper.find('.tour-skip').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(2);
    wrapper.unmount();
  });

  it('has no emoji (the house rule)', () => {
    const text = JSON.stringify(TOUR_CARDS);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('replays from Settings, never from the header', () => {
    const home = readFileSync(resolve(__dirname, '../components/Home.vue'), 'utf8');
    expect(home).toMatch(/<SettingsSection title="Tutorial"[^>]*action @tap="openTour"/);
    const header = readFileSync(resolve(__dirname, '../components/Header.vue'), 'utf8');
    expect(header).not.toMatch(/openTour|AppTour/);
  });
});

describe('a Settings row that is one action', () => {
  it('emits tap and has no body', async () => {
    const wrapper = mount(SettingsSection, { props: { title: 'Tutorial', action: true } });
    await wrapper.find('.settings-section-header').trigger('click');
    expect(wrapper.emitted('tap')).toHaveLength(1);
    expect(wrapper.find('.settings-section-body').exists()).toBe(false);
  });
});

describe('where Home mounts the tour', () => {
  // v1.134.0: the tag landed inside the movie-info modal's v-if, so Tutorial
  // did nothing unless that modal happened to be open.
  it('sits at the top level of the template, not inside a modal', () => {
    const home = readFileSync(resolve(__dirname, '../components/Home.vue'), 'utf8');
    const template = home.slice(0, home.indexOf('\n</template>'));
    const tag = template.lastIndexOf('<AppTour');
    expect(tag).toBeGreaterThan(-1);
    expect(template.slice(tag)).not.toMatch(/<\/div>/);
    expect(template.slice(template.lastIndexOf('\n', tag) + 1, tag)).toBe('  ');
  });
});

// Matt, 2026-11-14: "make sure that the tour at the beginning includes how to
// add the app to your home screen".
describe('the Home Screen card', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

  it('knows the phone', () => {
    expect(phonePlatform(IPHONE, 5)).toBe('ios');
    expect(phonePlatform(IPAD, 5)).toBe('ios');
    expect(phonePlatform(IPAD, 0)).toBe('other');
    expect(phonePlatform(ANDROID, 5)).toBe('android');
  });

  it('opens the tour on a phone that has not installed it, with that phone\'s steps', () => {
    const ios = tourCards({ platform: 'ios', standalone: false });
    expect(ios[0].key).toBe('install');
    expect(ios[0].lines.join(' ')).toMatch(/Share.*Add to Home Screen/);
    expect(tourCards({ platform: 'android' })[0].lines.join(' ')).toMatch(/Chrome.*Add to Home screen/);
    expect(ios.slice(1)).toEqual(TOUR_CARDS);
  });

  it('is left out once installed, and on a computer', () => {
    expect(tourCards({ platform: 'ios', standalone: true })).toEqual(TOUR_CARDS);
    expect(tourCards({ platform: 'other' })).toEqual(TOUR_CARDS);
  });

  it('is on the setup list on a phone, ticked when running from the Home Screen', () => {
    expect(setupItems({ phone: true }).map((item) => item.id)[1]).toBe('install');
    expect(setupItems({ phone: true, standalone: true }).find((item) => item.id === 'install').done).toBe(true);
    expect(setupItems({ phone: false }).map((item) => item.id)).not.toContain('install');
  });

  it('opens straight at the card the setup row asks for', () => {
    const cards = tourCards({ platform: 'ios' });
    const wrapper = mount(AppTour, { props: { cards, startKey: 'install' }, global: { stubs: { Teleport: true } } });
    expect(wrapper.find('.tour-title').text()).toBe('Put it on your Home Screen');
    expect(wrapper.find('.pic-install').exists()).toBe(true);
    wrapper.unmount();
  });
});

// Matt, 2026-11-14: "Is there anything we can do to streamline the process of
// adding the home screen?" Android Chrome: one tap. iPhone: no shortcut
// exists, but an app's built-in browser (Gmail, Instagram…) can't add to the
// Home Screen at all, so the card says to open Safari first.
describe('streamlining the install', () => {
  const GMAIL_WEBVIEW = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0';
  const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1';

  it('tells an app\'s built-in browser to open Safari first', () => {
    expect(phonePlatform(GMAIL_WEBVIEW, 5)).toBe('ios-inapp');
    expect(phonePlatform(INSTAGRAM, 5)).toBe('ios-inapp');
    expect(phonePlatform(CHROME_IOS, 5)).toBe('ios');
    expect(tourCards({ platform: 'ios-inapp' })[0].lines[0]).toMatch(/Open cinemaroll\.org in Safari/);
  });

  it('offers one tap on Android only', () => {
    expect(tourCards({ platform: 'android' })[0].oneTap).toBe(true);
    expect(tourCards({ platform: 'ios' })[0].oneTap).toBe(false);
  });

  it('raises Chrome\'s own install sheet from the held event', async () => {
    const { startInstallPrompt, promptInstall, installState } = await import('@/utils/installPrompt.js');
    const target = new EventTarget();
    startInstallPrompt(target);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(installState.available).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(installState).toMatchObject({ available: false, installed: true });
    expect(await promptInstall()).toBe('unavailable');
  });

  it('shows the Install button on the card when Chrome allows it', async () => {
    const { installState } = await import('@/utils/installPrompt.js');
    installState.available = true;
    installState.installed = false;
    const wrapper = mount(AppTour, { props: { cards: tourCards({ platform: 'android' }) }, global: { stubs: { Teleport: true } } });
    expect(wrapper.find('.tour-install').exists()).toBe(true);
    installState.available = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.tour-install').exists()).toBe(false);
    wrapper.unmount();
  });
});
