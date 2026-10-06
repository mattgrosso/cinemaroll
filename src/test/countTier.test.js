import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { countTier } from '@/assets/javascript/countTier.js';
import CountMark from '@/components/CountMark.vue';

// Matt, 2026-10-06: "like a little exponent ... with a color coding, so you
// can quickly glance to see if it's a certain color that it means there's
// more of them."
describe('countTier', () => {
  it('hides a 1 (this film alone) and anything that is not a count', () => {
    for (const n of [0, 1, null, undefined, NaN, '', 'x']) expect(countTier(n)).toBeNull();
  });

  it('gets warmer as the number climbs', () => {
    expect(countTier(2)).toBe('few');
    expect(countTier(3)).toBe('few');
    expect(countTier(4)).toBe('some');
    expect(countTier(7)).toBe('some');
    expect(countTier(8)).toBe('many');
    expect(countTier(14)).toBe('many');
    expect(countTier(15)).toBe('lots');
    expect(countTier('40')).toBe('lots');
  });
});

describe('CountMark', () => {
  it('renders a superscript in its tier, and nothing for a 1', () => {
    const six = mount(CountMark, { props: { count: 6 } });
    expect(six.element.tagName).toBe('SUP');
    expect(six.text()).toBe('6');
    expect(six.classes()).toContain('count-mark--some');
    expect(mount(CountMark, { props: { count: 1 } }).find('sup').exists()).toBe(false);
  });
});
