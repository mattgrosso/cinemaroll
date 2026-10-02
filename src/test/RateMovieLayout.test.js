import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'
import { getAllRatings } from '@/assets/javascript/GetRating.js'

// The 2026-09-30 restyle in the film page's language: a top row of watch
// date / Medium / More context, the score card at the bottom of the form
// (2026-10-02), folded rows for the math and earlier viewings, and pill tags.

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
    // The real getRating also returns normalizedRating — a field with no
    // weight, which is what broke "The math" (bug report 2026-10-01).
    return { ...r, calculatedTotal, normalizedRating: 7 }
  }),
  getAllRatings: vi.fn(() => null)
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const entry = (id, title, calculatedTotal, releaseDate = '2020-06-15') => ({
  movie: { id, title, release_date: releaseDate, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg` },
  ratings: [{ calculatedTotal, date: Date.now() }],
  dbKey: `key-${id}`
})

const ALL_WEIGHTS = [
  { name: 'love', weight: 2.8 }, { name: 'overall', weight: 2 },
  { name: 'story', weight: 1.25 }, { name: 'direction', weight: 1.1 },
  { name: 'imagery', weight: 0.9 }, { name: 'stickiness', weight: 1.9 },
  { name: 'performance', weight: 0.7 }, { name: 'soundtrack', weight: 0.3 }
]

function mountWith (movieToRate, library = [], weights = [{ name: 'overall', weight: 2 }]) {
  localStorage.clear()
  const $store = {
    state: {
      movieLog: {},
      movieToRate,
      settings: { tags: { 'viewing-tags': { t1: { title: 'date-night' } } } },
      weights,
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

describe('RateMovie score card', () => {
  // Bug report 2026-10-02: "The place where I wanna see the rating is when
  // I get to the bottom of the form, not at the top."
  it('the score comes after the rating questions, not in the top row', () => {
    const w = mountWith(film)
    const html = w.html()
    expect(w.find('.rate-actions').text()).not.toMatch(/\d\.\d\d/)
    expect(html.indexOf('score-card')).toBeGreaterThan(html.lastIndexOf('rating-card'))
    expect(html.indexOf('score-card')).toBeLessThan(html.indexOf('breakdown-table'))
  })

  it('the top row is date, medium and more context', () => {
    const w = mountWith(film)
    const row = w.find('.rate-actions')
    expect(row.element.children).toHaveLength(3)
    expect(row.find('.fact-date').exists()).toBe(true)
    expect(row.find('.action-medium').exists()).toBe(true)
    expect(row.text()).toContain('More context')
  })

  it('shows the live score with its place in the whole library', async () => {
    const w = mountWith(film, [entry(1, 'Nine', 9), entry(2, 'Three', 3)])
    await w.setData({ overall: '7' })
    const card = w.find('.score-card')
    expect(card.find('.score-card-value').text()).toBe('7.00')
    expect(card.find('.score-rank-overall .score-rank-value').text()).toBe('#2')
    expect(card.find('.score-rank-overall .score-rank-label').text()).toBe('of 3 overall')
  })

  it('ranks it among films of its release year only', async () => {
    const w = mountWith(film, [entry(1, 'Nine', 9, '1999-06-15'), entry(2, 'Eight', 8), entry(3, 'Three', 3)])
    await w.setData({ overall: '7' })
    const tile = w.find('.score-rank-year')
    expect(tile.find('.score-rank-value').text()).toBe('#2')
    expect(tile.find('.score-rank-label').text()).toBe('in 2020')
  })

  // new Date(null) is 1970: an offline placeholder must not be ranked
  // "in 1970".
  it('does not invent a year for a film with no release date', () => {
    const w = mountWith({ ...film, id: 'offline-x', release_date: null }, [entry(1, 'Old', 9, '1970-05-01')])
    const tile = w.find('.score-rank-year')
    expect(tile.text()).not.toContain('1970')
    expect(tile.find('.score-rank-value').text()).toBe('–')
  })

  it('folds in the best-since line', async () => {
    const w = mountWith(film, [entry(1, 'Nine', 9)])
    await w.setData({ overall: '7' })
    expect(w.find('.score-card-since').text()).toContain('The best movie you\'ve watched since')
    expect(w.find('.score-card-since').text()).toContain('Nine')
  })

  it('says how a re-rating moved from last time', async () => {
    const w = mountWith(film, [{ ...entry(555, 'Under Test', 6), movie: film }])
    await w.setData({ overall: '7' })
    const change = w.find('.score-card-change')
    expect(change.text()).toBe('1.00 higher than last time')
    expect(change.classes()).toContain('up')
  })

  it('shows no change line for a first rating', () => {
    const w = mountWith(film)
    expect(w.find('.score-card-change').exists()).toBe(false)
  })
})

describe('RateMovie top row', () => {
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
    expect(w.find('.action-medium').classes()).not.toContain('needs-choice')
  })

  // Bug report 2026-10-01: the Medium tile "doesn't look like a button I
  // need to click on" — empty, it has to read as a field to fill in.
  it('an empty medium tile asks to be chosen', () => {
    const w = mountWith(film)
    const tile = w.find('.action-medium')
    expect(tile.classes()).toContain('needs-choice')
    expect(tile.text()).toContain('Choose')
    expect(tile.text()).toContain('Medium')
    expect(tile.find('.bi-chevron-down').exists()).toBe(true)
  })
})

describe('RateMovie folded rows', () => {
  // Bug report 2026-10-01: the summary read "— weighted, rating 4.71".
  // getRating also returns normalizedRating, which has no weight, so summing
  // every field made the total NaN (and the open table got a junk row).
  it('the math totals only the eight weighted criteria', async () => {
    const w = mountWith(film, [], ALL_WEIGHTS)
    await w.setData({ overall: '7' })
    // criteria default to 5, overall 7, and an unset stickiness counts as 1
    // exactly as the score counts it (the follow-up report: "45.25 doesn't
    // make any sense" — the table had it as 0):
    // 5 × (2.8 + 1.25 + 1.1 + 0.9 + 0.7 + 0.3) + 7 × 2 + 1 × 1.9 = 51.15
    expect(w.vm.weightedTotal).toBeCloseTo(51.15)
    const breakdown = w.find('.breakdown-table')
    expect(breakdown.findAll('tbody tr')).toHaveLength(8)
    expect(breakdown.text()).not.toContain('normalizedRating')
    // Closed, the row says nothing: the score card already shows the
    // score, and the division was "not helpful" (2026-10-02).
    const header = w.findAll('.detail-section-header').find((h) => h.text().includes("How it's scored"))
    expect(header.text()).toBe("How it's scored")
  })

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
