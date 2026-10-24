import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ReleaseYearShelf from '@/components/ReleaseYearShelf.vue'

// The Eras tab's shelf (report, 2026-10-24). Counting and shading are in
// releaseYearShelfCounts.test.js; this is the drawing and the taps.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((result) => ({ calculatedTotal: result.ratings[0].calculatedTotal }))
}))

const film = (rating, date, title = 'Film') => ({ movie: { title, release_date: date }, ratings: [{ calculatedTotal: rating }] })

function factory (resultsWithRatings) {
  return mount(ReleaseYearShelf, { props: { resultsWithRatings } })
}

describe('ReleaseYearShelf', () => {
  it('draws a column per year to this year, empty years included', () => {
    const thisYear = new Date().getFullYear()
    const wrapper = factory([film(9, '2000-06-01', 'Gladiator'), film(5, '2000-07-01')])
    expect(wrapper.findAll('.year-shelf-hit')).toHaveLength(thisYear - 2000 + 1)
    // Two films, two blocks (plus one hit rect per column).
    expect(wrapper.findAll('.year-shelf-column rect:not(.year-shelf-hit)')).toHaveLength(2)
  })

  it('tapping a column names the year, its count and best film, and searches it', async () => {
    const wrapper = factory([film(9, '1939-06-01', 'The Wizard of Oz'), film(5, '1939-07-01'), film(7, '1941-01-01')])
    await wrapper.find('.year-shelf-hit[data-year="1939"]').trigger('click')
    expect(wrapper.find('.year-shelf-detail').text()).toContain('1939 · 2 films')
    expect(wrapper.find('.year-shelf-detail').text()).toContain('The Wizard of Oz')
    await wrapper.find('.year-shelf-search').trigger('click')
    expect(wrapper.emitted('updateSearchValue')[0]).toEqual(['1939'])
  })

  it('steps to an empty year without offering a search', async () => {
    const wrapper = factory([film(9, '1939-06-01'), film(7, '1941-01-01')])
    await wrapper.find('.year-shelf-hit[data-year="1939"]').trigger('click')
    await wrapper.find('[aria-label="Next year"]').trigger('click')
    expect(wrapper.find('.year-shelf-detail').text()).toContain('1940 · 0 films')
    expect(wrapper.find('.year-shelf-search').exists()).toBe(false)
  })

  it('says so when there is nothing rated', () => {
    expect(factory([]).find('.year-shelf-empty').exists()).toBe(true)
  })
})
