import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import TiesSection from '@/components/stats/TiesSection.vue'

// Bug report 2026-09-06: "Would be cool if I could see how many ties there
// are in the whole database." Driven through the DOM: the strip, the
// next-up group, the biggest-ties rows, and what a tap does.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((entry) => ({ calculatedTotal: entry.ratings?.[0]?.calculatedTotal }))
}))
vi.mock('@/utils/personLookup.js', () => ({ lookupPerson: vi.fn(async () => null) }))

function film (id, rating) {
  return {
    dbKey: `k${id}`,
    movie: { id, title: `Film ${id}`, release_date: '1994-06-15', poster_path: `/p${id}.jpg`, cast: [], crew: [], genres: [], production_companies: [] },
    ratings: [{ date: '2024-01-01', calculatedTotal: rating }]
  }
}

function mountWith (library) {
  const pushSpy = vi.fn()
  const wrapper = mount(TiesSection, {
    global: {
      mocks: {
        $store: { state: { settings: {}, isOnline: true }, getters: { allMoviesAsArray: library } },
        $router: { push: pushSpy }
      }
    }
  })
  return { wrapper, pushSpy }
}

describe('Ties (Ratings tab)', () => {
  // Three at 7.1234 (biggest), two at 9 (highest, so next up), one alone.
  const tied = [film(1, 9), film(2, 9), film(3, 7.1234), film(4, 7.1234), film(5, 7.1234), film(6, 5)]

  it('counts the ties in the whole library', () => {
    const { wrapper } = mountWith(tied)
    const section = wrapper.find('.ds-section.ties')
    expect(section.exists()).toBe(true)
    const strip = section.findAll('.ds-strip-value').map((v) => v.text())
    expect(strip).toEqual(['5', '2', '3', '83%'])
  })

  it('names the highest tie as next up and lists the rest by size, with tap-through', async () => {
    const { wrapper, pushSpy } = mountWith(tied)
    const labels = wrapper.findAll('.ties .pantheon-label').map((l) => l.text().replace(/\s+/g, ' '))
    expect(labels[0]).toBe('Next up for the tournament 2 at 9.00')
    expect(labels).toContain('3 films at 7.12')
    // The next-up group is not repeated under "Biggest ties".
    expect(labels.filter((l) => l.includes('at 9.00'))).toHaveLength(1)

    await wrapper.find('.ties .ds-poster-card').trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/movie/1')
  })

  it('stays off the page when nothing is tied', () => {
    const { wrapper } = mountWith([film(1, 9), film(2, 8), film(3, 7.5)])
    expect(wrapper.find('.ds-section.ties').exists()).toBe(false)
  })
})
