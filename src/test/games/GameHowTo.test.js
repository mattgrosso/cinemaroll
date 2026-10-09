import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import GameHowTo from '@/components/games/GameHowTo.vue';
import { HOW_TO_SEEN_PREFIX } from '@/assets/javascript/games/gameList.js';

function factory (path) {
  return mount(GameHowTo, {
    attachTo: document.body,
    global: { mocks: { $route: path ? { path } : undefined } }
  });
}

const card = () => document.body.querySelector('.howto-card');

describe('GameHowTo', () => {
  let wrapper;
  beforeEach(() => window.localStorage.clear());
  afterEach(() => wrapper?.unmount());

  it('opens by itself the first time a game is played on this device', () => {
    wrapper = factory('/games/stamp');
    expect(card()).not.toBeNull();
    expect(card().textContent).toContain('Swipe right');
  });

  it('stays shut once dismissed, and says so for that game only', async () => {
    wrapper = factory('/games/stamp');
    document.body.querySelector('.howto-card .btn-game-primary').click();
    await nextTick();
    expect(card()).toBeNull();
    expect(window.localStorage.getItem(`${HOW_TO_SEEN_PREFIX}/games/stamp`)).toBe('1');
    wrapper.unmount();

    wrapper = factory('/games/stamp');
    expect(card()).toBeNull();
    wrapper.unmount();

    wrapper = factory('/games/trivia');
    expect(card()).not.toBeNull();
  });

  it('reopens from the ? button', async () => {
    window.localStorage.setItem(`${HOW_TO_SEEN_PREFIX}/games/clue-budget`, '1');
    wrapper = factory('/games/clue-budget');
    expect(card()).toBeNull();
    await wrapper.find('.howto-button').trigger('click');
    expect(card().textContent).toContain('$100');
  });

  it('closes on a tap outside the card', async () => {
    wrapper = factory('/games/connections');
    document.body.querySelector('.howto-backdrop').click();
    await nextTick();
    expect(card()).toBeNull();
  });

  it('renders nothing off a game route', () => {
    wrapper = factory('/games');
    expect(wrapper.find('.howto-button').exists()).toBe(false);
    expect(card()).toBeNull();
  });
});
