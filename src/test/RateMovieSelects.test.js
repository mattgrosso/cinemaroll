import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'

// Characterization test for the 8 rating <select>s. Asserts at the DOM level
// (label text, exact option value/label lists, and v-model binding) so it holds
// identically whether the selects are inline in RateMovie or rendered by an
// extracted child component. WRITTEN BEFORE the RatingSelect extraction and must
// stay green across it — this is the safety net for that refactor.

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))
vi.mock('@/assets/javascript/AddRating.js', () => ({
  default: vi.fn(() => Promise.resolve({ path: 'test-user/movieLog/new-key' }))
}))
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const r = (media?.ratings && media.ratings[0]) || {}
    const calculatedTotal = r.calculatedTotal != null
      ? r.calculatedTotal
      : (r.overall != null ? Number(r.overall) : 5)
    return { ...r, calculatedTotal }
  }),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }))

const WEIGHTS = [
  { name: 'love', weight: 2.8 },
  { name: 'overall', weight: 2 },
  { name: 'story', weight: 1.25 },
  { name: 'direction', weight: 1.1 },
  { name: 'imagery', weight: 0.9 },
  { name: 'stickiness', weight: 1.9 },
  { name: 'performance', weight: 0.7 },
  { name: 'soundtrack', weight: 0.3 }
]

// Expected option label text, in order, by scale shape.
const STANDARD_LABELS = [
  '0 - Worst in class',
  '1 - Among the worst in class',
  '2 - Terrible',
  '3 - Really Bad',
  '4 - Bad',
  '5 - Average',
  '6 - Good',
  '7 - Great',
  '8 - Incredible',
  '9 - Among the best in class',
  '10 - Best in class'
]
const LOVE_LABELS = [
  '-5 - The worst ever',
  '-4 - One of the worst ever',
  '-3 - I hated it',
  "-2 - I really didn't like it",
  "-1 - I didn't like it",
  '0 - No love',
  '1 - I liked it',
  '2 - I really liked it',
  '3 - A genre favorite',
  '4 - An overall favorite',
  '5 - My favorite'
]
const STICKINESS_LABELS = [
  '0 - If I think of it at all it will be to warn others away',
  "1 - I doubt I'll think of it or recommend it to anyone",
  "2 - I think I'll mention it to some people",
  "3 - I'm going to think about it often and will look for chances to bring it up",
  '4 - This is going to stay with me all the time and I will quote it often',
  '5 - This movie will change the way I think and has expanded what I think movies can be'
]

const FIELDS = [
  { id: 'direction', label: 'Direction', labels: STANDARD_LABELS, max: 10 },
  { id: 'imagery', label: 'Imagery', labels: STANDARD_LABELS, max: 10 },
  { id: 'story', label: 'Story', labels: STANDARD_LABELS, max: 10 },
  { id: 'performance', label: 'Performance', labels: STANDARD_LABELS, max: 10 },
  { id: 'soundtrack', label: 'Soundtrack', labels: STANDARD_LABELS, max: 10 },
  { id: 'stickiness', label: 'Stickiness', labels: STICKINESS_LABELS, max: 5 },
  { id: 'love', label: 'Love', labels: LOVE_LABELS, max: 10 },
  { id: 'overall', label: 'Overall', labels: STANDARD_LABELS, max: 10 }
]

describe('RateMovie rating selects (characterization)', () => {
  let wrapper

  beforeEach(async () => {
    const mockStore = {
      state: {
        movieLog: {},
        movieToRate: {
          id: 555,
          title: 'Movie Under Test',
          release_date: '2021-07-15',
          poster_path: '/under-test.jpg',
          backdrop_path: '/under-test-backdrop.jpg'
        },
        settings: { tags: { 'viewing-tags': {} } },
        weights: WEIGHTS,
        databaseTopKey: 'test-user'
      },
      getters: { allMoviesAsArray: [] },
      commit: vi.fn(),
      dispatch: vi.fn()
    }

    wrapper = mount(RateMovie, {
      global: {
        mocks: {
          $store: mockStore,
          $route: { query: {} },
          $router: { push: vi.fn() }
        },
        stubs: { Modal: true, ToggleableRating: true, StickinessInline: true }
      }
    })
    await wrapper.vm.$nextTick()
  })

  it('renders exactly the 8 rating selects, each with its label', () => {
    for (const field of FIELDS) {
      const select = wrapper.find(`select#${field.id}`)
      expect(select.exists(), `select#${field.id} should exist`).toBe(true)
      const label = wrapper.find(`label[for="${field.id}"]`)
      expect(label.exists(), `label for ${field.id} should exist`).toBe(true)
      expect(label.text()).toBe(field.label)
    }
  })

  it('renders each select with a leading empty option then the exact value/label list', () => {
    for (const field of FIELDS) {
      const options = wrapper.find(`select#${field.id}`).findAll('option')
      const expectedValues = ['', ...field.labels.map((_, i) => String(i))]
      const expectedTexts = ['', ...field.labels]

      expect(options.map((o) => o.element.value)).toEqual(expectedValues)
      expect(options.map((o) => o.text())).toEqual(expectedTexts)
      // value range sanity: last option value matches the scale max
      expect(options[options.length - 1].element.value).toBe(String(field.max))
    }
  })

  it('binds each select to its data prop via v-model (string value)', async () => {
    for (const field of FIELDS) {
      await wrapper.find(`select#${field.id}`).setValue('3')
      expect(wrapper.vm[field.id]).toBe('3')
    }
  })

  it('a selected value flows through into the rating/weightedTotal computeds', async () => {
    await wrapper.find('select#overall').setValue('7')
    // getRating mock derives calculatedTotal from overall when not explicit.
    expect(wrapper.vm.rating.overall).toBe(7)
    // weightedTotal is a number and reflects the set criterion.
    expect(typeof wrapper.vm.weightedTotal).toBe('number')
    expect(wrapper.vm.weightedTotal).toBeGreaterThan(0)
  })
})
