import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mount } from '@vue/test-utils';
import AppHeader from '@/components/Header.vue';
import {
  isHeaderTap, recordHeaderTouch, getHeaderTouches, clearHeaderTouches, trackTripHome, STALL_MS
} from '@/utils/headerTap.js';

// Bug report 2026-10-07 (Matt, every screen): "I see the button press like I
// can see that reacting to my tap, but then nothing happens and I have to
// tap it a second time."

function factory ({ push = vi.fn(() => Promise.resolve()), ...state } = {}) {
  return mount(AppHeader, {
    global: {
      mocks: {
        $store: {
          state: { showHeader: true, hideHeaderLogo: false, bannerUrl: 'https://example.com/b.png', ...state },
          getters: { allMediaAsArray: [], devMode: false },
          commit: vi.fn()
        },
        $router: { push },
        $route: { fullPath: '/awards?year=2025' }
      }
    }
  });
}

const at = (x, y) => [{ clientX: x, clientY: y }];

async function touch (el, from, to = from, moves = []) {
  await el.trigger('touchstart', { touches: at(...from) });
  for (const move of moves) await el.trigger('touchmove', { touches: at(...move) });
  await el.trigger('touchend', { changedTouches: at(...to) });
}

beforeEach(() => clearHeaderTouches());

describe('isHeaderTap', () => {
  const base = { startX: 100, startY: 40, startAt: 0 };
  it('a finger that lifts where it landed, promptly, is a tap', () => {
    expect(isHeaderTap({ ...base, endX: 104, endY: 43, endAt: 150 })).toBe(true);
  });
  it('a finger that travelled is a drag', () => {
    expect(isHeaderTap({ ...base, endX: 130, endY: 40, endAt: 150 })).toBe(false);
  });
  it('a long press is not a tap', () => {
    expect(isHeaderTap({ ...base, endX: 100, endY: 40, endAt: 1500 })).toBe(false);
  });
  it('no coordinates, no tap', () => {
    expect(isHeaderTap({ ...base, endX: undefined, endY: undefined, endAt: 100 })).toBe(false);
  });
});

describe('the header goes home when the finger lifts', () => {
  for (const selector of ['.home-link', '.random-banner']) {
    it(`${selector}: a tap goes home without waiting for iOS's click`, async () => {
      const wrapper = factory();
      await touch(wrapper.find(selector), [100, 40], [102, 41]);
      expect(wrapper.vm.$store.commit).toHaveBeenCalledWith('setGoHome', true);
      expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/');
    });
  }

  it('the version-only corner (a game banner) does the same', async () => {
    const wrapper = factory({ hideHeaderLogo: true });
    await touch(wrapper.find('.version-only'), [100, 40]);
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/');
  });

  it('iOS\'s click that follows the same touch does not go home twice', async () => {
    const wrapper = factory();
    const title = wrapper.find('.home-link');
    await touch(title, [100, 40]);
    await title.trigger('click');
    expect(wrapper.vm.$router.push).toHaveBeenCalledTimes(1);
  });

  it('a drag across the header does not go home', async () => {
    const wrapper = factory();
    await touch(wrapper.find('.random-banner'), [100, 40], [180, 40], [[140, 40], [180, 40]]);
    expect(wrapper.vm.$router.push).not.toHaveBeenCalled();
  });

  it('a finger that wanders off and back was dragging, not tapping', async () => {
    const wrapper = factory();
    await touch(wrapper.find('.random-banner'), [100, 40], [100, 40], [[160, 40], [100, 40]]);
    expect(wrapper.vm.$router.push).not.toHaveBeenCalled();
  });

  it('a click with no touch (mouse, keyboard) still goes home', async () => {
    const wrapper = factory();
    await wrapper.find('.home-link').trigger('click');
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/');
  });
});

describe('the title presses without moving', () => {
  const source = readFileSync(resolve(__dirname, '../components/Header.vue'), 'utf8');
  it('does not wear the app-wide .tap-feedback (which shrinks 2%)', () => {
    const wrapper = factory();
    expect(wrapper.find('.home-link').classes()).not.toContain('tap-feedback');
  });
  it('dims on :active and never transforms', () => {
    const homeLink = source.slice(source.indexOf('.home-link {'), source.indexOf('.version-only {'));
    expect(homeLink).toMatch(/&:active\s*{\s*opacity:/);
    expect(homeLink).not.toMatch(/transform/);
  });
});

describe('header touches are recorded for bug reports', () => {
  it('a tap that arrives home', async () => {
    const wrapper = factory();
    const title = wrapper.find('.home-link');
    await touch(title, [100, 40]);
    await title.trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getHeaderTouches()).toEqual([expect.objectContaining({
      route: '/awards?year=2025', landed: true, lifted: 'tap', movedPx: 0, click: true, homeStarted: 'touch', outcome: 'arrived'
    })]);
  });

  it('a drag, and a touch iOS cancelled', async () => {
    const wrapper = factory();
    const banner = wrapper.find('.random-banner');
    await touch(banner, [100, 40], [160, 40], [[160, 40]]);
    await banner.trigger('touchstart', { touches: at(100, 40) });
    await banner.trigger('touchcancel');
    const [drag, cancelled] = getHeaderTouches();
    expect(drag).toMatchObject({ lifted: 'drag', movedPx: 60, homeStarted: null });
    expect(cancelled).toMatchObject({ lifted: 'cancelled by iOS', homeStarted: null });
  });

  it('keeps only the last five', () => {
    for (let i = 0; i < 8; i++) recordHeaderTouch({ route: `/${i}` });
    expect(getHeaderTouches().map((t) => t.route)).toEqual(['/3', '/4', '/5', '/6', '/7']);
  });
});

describe('trackTripHome', () => {
  afterEach(() => vi.useRealTimers());

  it('names a router failure', async () => {
    const entry = recordHeaderTouch();
    await trackTripHome(entry, Promise.resolve({ type: 8 }), { via: 'touch' });
    expect(entry.outcome).toBe('cancelled');
  });

  it('records an error', async () => {
    const entry = recordHeaderTouch();
    await trackTripHome(entry, Promise.reject(new Error('chunk')), { via: 'touch' });
    expect(entry.outcome).toBe('error: chunk');
  });

  it('marks a slow trip stalled, then what it became', async () => {
    vi.useFakeTimers();
    let finish;
    const entry = recordHeaderTouch();
    const done = trackTripHome(entry, new Promise((resolve) => { finish = resolve; }), { via: 'touch' });
    vi.advanceTimersByTime(STALL_MS + 1);
    expect(entry.outcome).toBe('stalled');
    finish();
    await done;
    expect(entry.outcome).toBe('arrived');
  });
});
