import { describe, it, expect, beforeEach } from 'vitest';

// jsdom never lays anything out, so v-show is read from the style attribute.
const hidden = (wrapper) => (wrapper.find('.detail-section-body').attributes('style') || '').includes('display: none');
import { mount } from '@vue/test-utils';
import { reactive, nextTick } from 'vue';
import DetailSection from '@/components/DetailSection.vue';

// The movie page's folding rows (2026-09-30 redesign).
const factory = (props = {}, global = {}) => mount(DetailSection, {
  props: { id: 'cast', label: 'Cast', summary: 'A, B, C +35', ...props },
  slots: { default: '<p class="body">the whole list</p>', actions: '<button class="extra">web</button>' },
  global
});

describe('DetailSection', () => {
  beforeEach(() => window.localStorage.clear());

  it('starts folded with the summary, keeps the body in the DOM but hidden, and opens on tap', async () => {
    const wrapper = factory();
    expect(wrapper.find('.detail-section-summary').text()).toBe('A, B, C +35');
    expect(wrapper.find('.body').exists()).toBe(true);
    expect(hidden(wrapper)).toBe(true);
    await wrapper.find('.detail-section-header').trigger('click');
    expect(hidden(wrapper)).toBe(false);
    expect(wrapper.find('.detail-section-summary').exists()).toBe(false);
  });

  // Report 2026-10-01: a row opened on one film came up open on every film
  // after it, because the choice was remembered across films.
  it('starts closed on every film: an opened row is not remembered', async () => {
    const first = factory();
    await first.find('.detail-section-header').trigger('click');
    expect(hidden(first)).toBe(false);
    first.unmount();
    expect(hidden(factory())).toBe(true);
  });

  it('folds again when the page moves to another film', async () => {
    const $route = reactive({ params: { tmdbId: '466272' } });
    const wrapper = factory({}, { mocks: { $route } });
    await wrapper.find('.detail-section-header').trigger('click');
    expect(hidden(wrapper)).toBe(false);
    $route.params.tmdbId = '603';
    await nextTick();
    expect(hidden(wrapper)).toBe(true);
  });

  it('a header action does not toggle the section', async () => {
    const wrapper = factory();
    await wrapper.find('.extra').trigger('click');
    expect(hidden(wrapper)).toBe(true);
  });
});
