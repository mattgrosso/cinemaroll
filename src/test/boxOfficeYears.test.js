import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import BoxOfficeYears from '@/components/BoxOfficeYears.vue';
import { BASE_YEAR } from '@/assets/javascript/inflation.js';

const film = (id, title, year, revenue) => ({
  dbKey: `k${id}`,
  movie: { id, title, release_date: `${year}-06-15`, revenue }
});

const factory = (entries) => mount(BoxOfficeYears, { props: { resultsWithRatings: entries } });

describe('BoxOfficeYears', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('lists years biggest first, naming each year\'s top film', () => {
    const wrapper = factory([film(1, 'Big One', BASE_YEAR, 900e6), film(2, 'Small', BASE_YEAR, 50e6), film(3, 'Older', BASE_YEAR - 1, 100e6)]);
    const rows = wrapper.findAll('.year-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('.year-name').text()).toBe(String(BASE_YEAR));
    expect(rows[0].find('.year-top').text()).toContain('Big One');
    expect(rows[0].find('.year-numbers').text()).toContain('$950M');
    expect(rows[0].find('.year-count').text()).toContain('2 films');
  });

  it('opens in today\'s dollars, and the toggle switches to as-released and remembers it', async () => {
    const wrapper = factory([film(1, 'Old Hit', 1975, 470e6), film(2, 'New Hit', BASE_YEAR, 600e6)]);
    expect(wrapper.findAll('.year-row')[0].find('.year-name').text()).toBe('1975');

    await wrapper.findAll('.dollar-option')[1].trigger('click');
    expect(wrapper.findAll('.year-row')[0].find('.year-name').text()).toBe(String(BASE_YEAR));
    expect(window.localStorage.getItem('cinemaRoll.insights.boxOfficeDollars')).toBe('released');

    const again = factory([film(1, 'Old Hit', 1975, 470e6), film(2, 'New Hit', BASE_YEAR, 600e6)]);
    expect(again.findAll('.year-row')[0].find('.year-name').text()).toBe(String(BASE_YEAR));
  });

  it('tapping a year searches for it, the way the best-years list does', async () => {
    const wrapper = factory([film(1, 'Hit', 1999, 300e6)]);
    await wrapper.find('.year-row').trigger('click');
    expect(wrapper.emitted('updateSearchValue')).toEqual([['1999']]);
  });

  it('says so when no film has a figure yet', () => {
    const wrapper = factory([film(1, 'Unknown', 1999, 0)]);
    expect(wrapper.find('.box-office-empty').exists()).toBe(true);
    expect(wrapper.findAll('.year-row')).toHaveLength(0);
  });
});
