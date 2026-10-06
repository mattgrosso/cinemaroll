import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import NameRow from '@/components/NameRow.vue';

// Matt, 2026-10-06: "we shouldn't break a single person's name. It should
// show as many people's names as we can fit on that first row, and then it
// should say more." And: "It'd be nice if I could click those without
// having to expand it first."
const people = [
  { name: 'Al Pacino', count: 12 },
  { name: 'Robert De Niro', count: 9 },
  { name: 'Val Kilmer', count: 0 }
];

// jsdom lays nothing out, so every chip reports offsetTop 0: nothing is
// hidden. The wrapping is driven here by faking the offsets.
const layOut = (wrapper, tops) => {
  wrapper.findAll('.name-chip').forEach((chip, i) => {
    Object.defineProperty(chip.element, 'offsetTop', { value: tops[i], configurable: true });
  });
};

describe('NameRow', () => {
  it('shows every name as a tappable chip with its count as a superscript, and no "more" when all fit', () => {
    const wrapper = mount(NameRow, { props: { people } });
    const chips = wrapper.findAll('.name-chip');
    expect(chips.map((c) => c.text())).toEqual(['Al Pacino12', 'Robert De Niro9', 'Val Kilmer']);
    expect(chips[0].find('sup.count-mark').text()).toBe('12');
    expect(chips[2].find('sup').exists()).toBe(false);
    expect(wrapper.find('.name-row-more').exists()).toBe(false);
  });

  it('a tap on a chip picks that person and does not bubble to a folding header', async () => {
    const wrapper = mount(NameRow, { props: { people } });
    await wrapper.findAll('.name-chip')[1].trigger('click');
    expect(wrapper.emitted('pick')).toEqual([['Robert De Niro']]);
  });

  it('counts the names that wrapped off the first line as "+N more", whole names only', async () => {
    const wrapper = mount(NameRow, { props: { people } });
    layOut(wrapper, [0, 0, 24]);
    wrapper.vm.measure();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const more = wrapper.find('.name-row-more');
    expect(more.text()).toBe('+1 more');
    expect(wrapper.classes()).toContain('name-row--clipped');
    await more.trigger('click');
    expect(wrapper.emitted('more')).toEqual([[]]);
  });

  it('reports how many names are clipped, so a folding row can stop folding when it is 0', async () => {
    const wrapper = mount(NameRow, { props: { people } });
    expect(wrapper.emitted('overflow')).toEqual([[0]]);
    layOut(wrapper, [0, 24, 24]);
    wrapper.vm.measure();
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('overflow').at(-1)).toEqual([2]);
  });

  it('expanded, it shows everything and no "more"', async () => {
    const wrapper = mount(NameRow, { props: { people, expanded: true } });
    layOut(wrapper, [0, 24, 48]);
    wrapper.vm.measure();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.name-row-more').exists()).toBe(false);
    expect(wrapper.classes()).toContain('name-row--expanded');
  });
});
