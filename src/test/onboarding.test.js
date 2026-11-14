import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  setupItems, setupNoticeSignature, tourDue, shouldStartOnboarding, TOUR_CARDS, RAINBOW_CHIPS
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
