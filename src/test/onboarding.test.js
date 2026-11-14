import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setupItems, setupNoticeSignature, tourDue, shouldStartOnboarding, TOUR_CARDS, RAINBOW_CHIPS,
  tourCards, installGuide
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
// add the app to your home screen", then "Apple does make this sort of a
// moving target ... make sure that the info we share is correct for that
// person's system". Real user agents; each expectation is the vendor's own
// wording for that system (sources in onboarding.js).
const UA = {
  iphone27: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
  iphone26: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphone18: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  ipad27: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  ipad26: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1',
  gmailWebview: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 360.0.0.0',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15',
  android150: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36',
  android140: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921U) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  androidWebview: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.0.0 Mobile Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15'
};
const said = (guide) => guide.lines.join(' ');

describe('the Home Screen card, per system', () => {
  it('iPhone on iOS 27: the Page Menu button, then Share', () => {
    const guide = installGuide(UA.iphone27, 5);
    expect(guide.kind).toBe('iphone-27');
    expect(said(guide)).toMatch(/menu button \(three lines\).*then Share, then Add to Home Screen/);
    expect(said(guide)).toMatch(/Open as Web App/);
  });

  it('iPhone on iOS 26: the More button, then Share', () => {
    const guide = installGuide(UA.iphone26, 5);
    expect(guide.kind).toBe('iphone-26');
    expect(said(guide)).toMatch(/More button \(three dots\).*then Share/);
    expect(said(guide)).toMatch(/bottom or top of the screen, tap it directly/);
  });

  it('reads Safari 26+ from Version/, not the frozen OS 18_x', () => {
    expect(installGuide(UA.iphone26, 5).kind).toBe('iphone-26');
    expect(installGuide(UA.iphone18, 5).kind).toBe('iphone-18');
  });

  it('iPhone on iOS 18: Share, no web-app switch', () => {
    const guide = installGuide(UA.iphone18, 5);
    expect(said(guide)).toMatch(/Tap Share.*Add to Home Screen, then Add/);
    expect(said(guide)).not.toMatch(/Open as Web App/);
  });

  it('iPad on 27 and 26 (which call themselves Macs)', () => {
    expect(said(installGuide(UA.ipad27, 5))).toMatch(/Tap Share, then View More, then Add to Home Screen/);
    expect(said(installGuide(UA.ipad26, 5))).toMatch(/Tap Share, then the More button \(three dots\), then Add to Home Screen/);
  });

  it('Chrome on iPhone: Share beside the address', () => {
    expect(said(installGuide(UA.chromeIos, 5))).toMatch(/Share, to the right of the address bar, then Add to Home Screen/);
  });

  it('sends app browsers and other iPhone browsers to Safari', () => {
    expect(installGuide(UA.gmailWebview, 5).kind).toBe('ios-open-safari');
    expect(said(installGuide(UA.instagram, 5))).toMatch(/built-in browser.*Safari/);
    expect(said(installGuide(UA.firefoxIos, 5))).toMatch(/easiest from Safari/);
  });

  it('Android Chrome: the 150 name, with the old one mentioned, and the old name before 150', () => {
    expect(said(installGuide(UA.android150, 5))).toMatch(/Install and create shortcut, then Install.*still called Add to Home screen/);
    expect(said(installGuide(UA.android140, 5))).toMatch(/Add to Home screen, then Install/);
    expect(installGuide(UA.android150, 5).oneTap).toBe(true);
  });

  it('sends other Android browsers and app web views to Chrome', () => {
    expect(installGuide(UA.samsung, 5).kind).toBe('android-open-chrome');
    expect(installGuide(UA.androidWebview, 5).kind).toBe('android-open-chrome');
  });

  it('has nothing to say on a computer', () => {
    expect(installGuide(UA.mac, 0)).toBeNull();
    expect(tourCards({ guide: null })).toEqual(TOUR_CARDS);
  });

  it('comes first in the tour, and not once installed', () => {
    const guide = installGuide(UA.iphone26, 5);
    expect(tourCards({ guide })[0].key).toBe('install');
    expect(tourCards({ guide })[0].steps.map((s) => s.label)).toEqual(['More', 'Share', 'Add to Home Screen']);
    expect(tourCards({ guide, standalone: true })).toEqual(TOUR_CARDS);
  });

  it('is on the setup list on a phone, ticked when running from the Home Screen', () => {
    expect(setupItems({ phone: true }).map((item) => item.id)[1]).toBe('install');
    expect(setupItems({ phone: true, standalone: true }).find((item) => item.id === 'install').done).toBe(true);
    expect(setupItems({ phone: false }).map((item) => item.id)).not.toContain('install');
  });

  it('opens straight at the card the setup row asks for, drawing its steps', () => {
    const cards = tourCards({ guide: installGuide(UA.iphone27, 5) });
    const wrapper = mount(AppTour, { props: { cards, startKey: 'install' }, global: { stubs: { Teleport: true } } });
    expect(wrapper.find('.tour-title').text()).toBe('Put it on your Home Screen');
    expect(wrapper.findAll('.pic-install-step').map((w) => w.text())).toEqual(['Menu', 'Share', 'Add to Home Screen']);
    wrapper.unmount();
  });
});

// "Is there anything we can do to streamline the process of adding the home
// screen?" Chrome (Android) can raise its own install sheet from a button.
describe('one-tap install', () => {
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

  it('shows the Install button on the card only while Chrome allows it', async () => {
    const { installState } = await import('@/utils/installPrompt.js');
    installState.available = true;
    installState.installed = false;
    const wrapper = mount(AppTour, { props: { cards: tourCards({ guide: installGuide(UA.android150, 5) }) }, global: { stubs: { Teleport: true } } });
    expect(wrapper.find('.tour-install').exists()).toBe(true);
    installState.available = false;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.tour-install').exists()).toBe(false);
    wrapper.unmount();
  });

  it('never offers it on an iPhone, where Safari has no such sheet', () => {
    expect(installGuide(UA.iphone27, 5).oneTap).toBeFalsy();
  });
});
