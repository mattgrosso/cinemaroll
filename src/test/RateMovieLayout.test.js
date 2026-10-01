import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'
import { getAllRatings } from '@/assets/javascript/GetRating.js'

// The 2026-09-30 restyle in the film page's language: a facts strip of
// score / rank in its year / watch date, a Medium tile over a real select,
// folded rows for the math and earlier viewings, and pill tags.

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))
vi.mock('@/assets/javascript/AddRating.js', () => ({ default: vi.fn() }))
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const r = (media?.ratings && media.ratings[0]) || {}
    const calculatedTotal = r.calculatedTotal != null
      ? r.calculatedTotal
      : (r.overall != null ? Number(r.overall) : 5)
    return { ...r, calculatedTotal }
  }),
  getAllRatings: vi.fn(() => null)
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const entry = (id, title, calculatedTotal, releaseDate = '2020-06-15') => ({
  movie: { id, title, release_date: releaseDate, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg` },
  ratings: [{ calculatedTotal, date: Date.now() }],
  dbKey: `key-${id}`
})

function mountWith (movieToRate, library = []) {
  localStorage.clear()
  const $store = {
    state: {
      movieLog: {},
      movieToRate,
      settings: { tags: { 'viewing-tags': { t1: { title: 'date-night' } } } },
      weights: [{ name: 'overall', weight: 2 }],
      databaseTopKey: 'test-user'
    },
    getters: { allMoviesAsArray: library },
    commit: vi.fn(),
    dispatch: vi.fn()
  }
  return mount(RateMovie, {
    global: { mocks: { $store, $route: { query: {} }, $router: { push: vi.fn() } } }
  })
}

const film = { id: 555, title: 'Under Test', release_date: '2020-06-01', poster_path: '/u.jpg', backdrop_path: '/b.jpg' }

describe('RateMovie facts strip', () => {
  it('shows the live score with its place in the whole library', async () => {
    const w = mountWith(film, [entry(1, 'Nine', 9), entry(2, 'Three', 3)])
    await w.setData({ overall: '7' })
    const tile = w.find('.fact-score')
    expect(tile.find('.fact-value').text()).toBe('7.00')
    expect(tile.find('.fact-label').text()).toBe('#2 of 3')
  })

  it('ranks it among films of its release year only', async () => {
    const w = mountWith(film, [entry(1, 'Nine', 9, '1999-06-15'), entry(2, 'Eight', 8), entry(3, 'Three', 3)])
    await w.setData({ overall: '7' })
    const tile = w.find('.fact-year-rank')
    expect(tile.find('.fact-value').text()).toBe('#2')
    expect(tile.find('.fact-label').text()).toBe('in 2020')
  })

  // new Date(null) is 1970: an offline placeholder must not be ranked
  // "in 1970".
  it('does not invent a year for a film with no release date', () => {
    const w = mountWith({ ...film, id: 'offline-x', release_date: null }, [entry(1, 'Old', 9, '1970-05-01')])
    const tile = w.find('.fact-year-rank')
    expect(tile.text()).not.toContain('1970')
    expect(tile.find('.fact-value').text()).toBe('–')
  })

  it('the date tile is the real date input, showing the chosen day', async () => {
    const w = mountWith(film)
    await w.setData({ date: '2024-03-14T20:30' })
    const tile = w.find('.fact-date')
    expect(tile.find('input#date').exists()).toBe(true)
    expect(tile.find('.fact-value').text()).toBe('Mar 14')
    expect(tile.find('.fact-label').text()).toBe('watched 2024')
  })

  it('the medium tile names the chosen medium', async () => {
    const w = mountWith(film)
    await w.find('select#medium').setValue('Theater')
    expect(w.find('.action-medium').text()).toContain('Theater')
  })
})

describe('RateMovie folded rows', () => {
  it('lists earlier viewings with their eight criteria', async () => {
    getAllRatings.mockReturnValueOnce([{ date: new Date(2024, 0, 2).getTime(), calculatedTotal: 8.1234, direction: 7, love: 4 }])
    const w = mountWith(film, [{ ...entry(555, 'Under Test', 8), movie: film }])
    expect(w.find('.previous-ratings').text()).toContain('1 logged')
    const viewing = w.find('.previous-viewing')
    expect(viewing.text()).toContain('Jan 2, 2024')
    expect(viewing.text()).toContain('8.12')
    expect(viewing.findAll('.previous-cell')).toHaveLength(8)
  })

  it('shows no viewings row for a first rating', () => {
    const w = mountWith(film)
    expect(w.find('.previous-ratings').exists()).toBe(false)
  })
})

describe('RateMovie tags', () => {
  it('a tag is a pill that toggles on tap, and says so', async () => {
    const w = mountWith(film)
    const pill = w.find('.tag-pill')
    expect(pill.attributes('aria-pressed')).toBe('false')
    await pill.trigger('click')
    expect(w.find('.tag-pill').classes()).toContain('selected')
    expect(w.find('.tag-pill').attributes('aria-pressed')).toBe('true')
  })

  it('the delete button asks first and does not toggle the tag', async () => {
    const w = mountWith(film)
    await w.find('.tag-delete').trigger('click')
    expect(w.vm.showDeleteModal).toBe(true)
    expect(w.vm.selectedViewingTags).toEqual([])
  })
})
