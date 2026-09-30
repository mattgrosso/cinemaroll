import { describe, it, expect, beforeEach } from 'vitest';

// jsdom never lays anything out, so v-show is read from the style attribute.
const hidden = (wrapper) => (wrapper.find('.detail-section-body').attributes('style') || '').includes('display: none');
import { mount } from '@vue/test-utils';
import DetailSection from '@/components/DetailSection.vue';

// The movie page's folding rows (2026-09-30 redesign).
const factory = (props = {}) => mount(DetailSection, {
  props: { id: 'cast', label: 'Cast', summary: 'A, B, C +35', ...props },
  slots: { default: '<p class="body">the whole list</p>', actions: '<button class="extra">web</button>' }
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

  it('honours defaultOpen and remembers a choice per section across mounts', async () => {
    const open = factory({ defaultOpen: true });
    expect(hidden(open)).toBe(false);
    await open.find('.detail-section-header').trigger('click'); // fold it
    expect(window.localStorage.getItem('cinemaRoll.movieDetail.open.cast')).toBe('0');
    const again = factory({ defaultOpen: true });
    expect(hidden(again)).toBe(true);
    const other = factory({ id: 'genres', defaultOpen: true });
    expect(hidden(other)).toBe(false);
  });

  it('a header action does not toggle the section', async () => {
    const wrapper = factory();
    await wrapper.find('.extra').trigger('click');
    expect(hidden(wrapper)).toBe(true);
  });
});
