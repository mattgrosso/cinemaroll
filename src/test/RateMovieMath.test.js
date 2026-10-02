import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'
import { ratingBreakdown, criterionValue } from '@/assets/javascript/ratingMath.js'

// Bug report 2026-10-01: "The math" read 45.25 next to a rating of 4.71 —
// numbers that can't come from each other. The table summed the page's raw
// values (an unset Stickiness as 0, where the score counts it as 1) and never
// showed the ÷ 10. Here the REAL GetRating runs, so the table is checked
// against the actual score rather than a mock of it.

const WEIGHTS = { love: 2.8, overall: 2, story: 1.25, direction: 1.1, imagery: 0.9, stickiness: 1.9, performance: 0.7, soundtrack: 0.3 }

const mockStore = vi.hoisted(() => ({
  getters: { weight: (name) => ({ love: 2.8, overall: 2, story: 1.25, direction: 1.1, imagery: 0.9, stickiness: 1.9, performance: 0.7, soundtrack: 0.3 })[name], allMediaRatingsArray: [3, 9] },
  state: { settings: {}, movieLog: {} }
}))
vi.mock('@/store/index', () => ({ default: mockStore }))
vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))
vi.mock('@/assets/javascript/AddRating.js', () => ({ default: vi.fn() }))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const film = { id: 555, title: 'Under Test', release_date: '2020-06-01', poster_path: '/u.jpg', backdrop_path: '/b.jpg' }

function mountPage () {
  localStorage.clear()
  const $store = {
    state: {
      movieLog: {},
      movieToRate: film,
      settings: { tags: {} },
      weights: Object.entries(WEIGHTS).map(([name, weight]) => ({ name, weight })),
      databaseTopKey: 'test-user'
    },
    getters: { allMoviesAsArray: [] },
    commit: vi.fn(),
    dispatch: vi.fn()
  }
  return mount(RateMovie, {
    global: { mocks: { $store, $route: { query: {} }, $router: { push: vi.fn() } } }
  })
}

describe('The math on the Rate page', () => {
  it('adds up to the real score, with Stickiness unset counted as 1', async () => {
    const w = mountPage()
    await w.setData({ love: '6', story: '6', overall: '7' })
    // 5 × (1.1 + 0.9 + 0.7 + 0.3) + 6 × 2.8 + 6 × 1.25 + 7 × 2 + 1 × 1.9 = 55.2
    const table = w.find('.breakdown-table')
    const rows = table.findAll('tbody tr')
    expect(rows).toHaveLength(8)
    const stick = rows.find((r) => r.find('.breakdown-name').text() === 'stickiness')
    expect(stick.text()).toContain('1.90')
    expect(table.find('tfoot').text()).toContain('55.20')
    expect(w.vm.rating.calculatedTotal).toBe(5.52)
    expect(table.find('tfoot').text()).toContain('5.52')
    expect(w.find('.score-card-value').text()).toBe('5.52')
  })

  it('the table total ÷ 10 is the score for every Stickiness choice', async () => {
    const w = mountPage()
    await w.setData({ direction: '8', imagery: '3', performance: '9', soundtrack: '2', love: '-2', overall: '6', story: '7' })
    for (const stickiness of [null, '0', '1', '3', '5']) {
      await w.setData({ stickiness })
      expect(parseFloat((w.vm.breakdown.sum / 10).toFixed(4))).toBe(w.vm.rating.calculatedTotal)
    }
  })
})

describe('ratingBreakdown', () => {
  const weightOf = (name) => WEIGHTS[name]

  it('folds a tiebreak tweak into Overall, as the score does', () => {
    const r = { direction: 5, imagery: 5, story: 5, performance: 5, soundtrack: 5, love: 5, overall: 5, stickiness: 3, tweakValue: 0.5 }
    expect(criterionValue(r, 'overall')).toBe(5.5)
    expect(ratingBreakdown(r, weightOf).sum).toBeCloseTo(5 * 7.05 + 5.5 * 2 + 3 * 1.9, 10)
  })

  it('Stickiness: unset or over 5 falls back to impression, else 1; 0 stays 0', () => {
    expect(criterionValue({}, 'stickiness')).toBe(1)
    expect(criterionValue({ stickiness: 0 }, 'stickiness')).toBe(0)
    expect(criterionValue({ stickiness: 7, impression: 4 }, 'stickiness')).toBe(4)
    expect(criterionValue({ stickiness: 3 }, 'stickiness')).toBe(3)
  })
})
