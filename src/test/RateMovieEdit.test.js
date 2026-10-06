import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'
import storeModule from '@/store/index.js'

// Bug report 2026-08-25 (Natalie): "It's happened to me a few times now where
// I rate a movie and then I don't feel like it's right so I go to rewrite it
// so I delete the rating, but then I forget to. It would be nice if you could
// both delete the rating and edit the rating."
//
// Delete-and-retype was the only way to change a rating, and the gap between
// the two steps is where the rating went missing. These tests cover the edit
// path and — more importantly — the two ways it could destroy data: writing
// over the wrong viewing, and inheriting a stale edit target on what the user
// thinks is a brand-new rating.

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))

const addRatingMock = vi.fn(() => Promise.resolve({ path: 'test-user/movieLog/key-555' }))
vi.mock('@/assets/javascript/AddRating.js', () => ({
  default: (...args) => addRatingMock(...args)
}))

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const r = (media?.ratings && media.ratings[0]) || {}
    return { ...r, calculatedTotal: r.overall != null ? Number(r.overall) : 5 }
  }),
  getAllRatings: vi.fn(() => [])
}))

vi.mock('@/services/ErrorLogService.js', () => ({
  default: { error: vi.fn() }
}))

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

const MOVIE = {
  id: 555,
  title: 'Movie Under Test',
  release_date: '2021-07-15',
  poster_path: '/p.jpg',
  backdrop_path: '/b.jpg'
}

// A local-time epoch, so the datetime-local round trip is asserted in the
// timezone the app actually runs in rather than UTC.
const WATCHED_AT = new Date(2026, 2, 14, 20, 30).getTime()

const firstViewing = () => ({
  date: new Date(2024, 0, 2, 19, 0).getTime(),
  medium: 'Theater',
  direction: 3, imagery: 3, story: 3, performance: 3,
  soundtrack: 3, stickiness: 3, love: 3, overall: 3,
  id: 555, title: 'Movie Under Test', year: 2021
})

const secondViewing = () => ({
  date: WATCHED_AT,
  medium: 'Blu-ray',
  direction: 8, imagery: 9, story: 7, performance: 6,
  soundtrack: 5, stickiness: 4, love: 10, overall: 9,
  tags: [{ title: 'date-night' }],
  chatGPTKeywords: ['heist', 'betrayal'],
  id: 555, title: 'Movie Under Test', year: 2021,
  // A field this form does not collect. It must survive an edit.
  someFutureField: 'keep me'
})

function mountEditing ({ ratingToEdit = null, ratings = null } = {}) {
  const entryRatings = ratings || [firstViewing(), secondViewing()]
  const entry = { movie: MOVIE, ratings: entryRatings, dbKey: 'key-555' }
  const mockStore = {
    state: {
      movieLog: { 'key-555': entry },
      movieToRate: MOVIE,
      ratingToEdit,
      settings: { tags: { 'viewing-tags': { t1: { title: 'date-night' }, t2: { title: 'rewatch' } } } },
      weights: WEIGHTS,
      databaseTopKey: 'test-user'
    },
    getters: { allMoviesAsArray: [entry] },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  const wrapper = shallowMount(RateMovie, {
    global: {
      mocks: { $store: mockStore, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: { Modal: true, ToggleableRating: true, StickinessInline: true }
    }
  })

  return { wrapper, mockStore, entryRatings }
}

beforeEach(() => {
  addRatingMock.mockReset().mockImplementation(() => Promise.resolve({ path: 'test-user/movieLog/key-555' }))
})

describe('editing an existing rating', () => {
  it('opens on the rating being edited, not on the defaults', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isEditing).toBe(true)
    expect(wrapper.vm.love).toBe(10)
    expect(wrapper.vm.overall).toBe(9)
    expect(wrapper.vm.direction).toBe(8)
    expect(wrapper.vm.stickiness).toBe(4)
    expect(wrapper.vm.medium).toBe('Blu-ray')
    expect(wrapper.vm.selectedViewingTags).toEqual([{ title: 'date-night' }])
  })

  it('opens on the FIRST viewing when that is the one picked', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 0 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.love).toBe(3)
    expect(wrapper.vm.medium).toBe('Theater')
  })

  // Local time, not UTC — toISOString would show an evening viewing on the
  // previous day, the same trap already documented for Letterboxd deep links.
  it('shows the viewing date in local time', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.date).toBe('2026-03-14T20:30')
  })

  it('keeps the keywords already on the viewing rather than refetching', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.chatGPTKeywords).toEqual(['heist', 'betrayal'])
  })

  it('says it is editing, so the screen is not mistaken for a new rating', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('h1').text()).toContain('Edit')
    expect(wrapper.find('.submit-button').text()).toContain('Save Changes')
  })
})

// Bug report 2026-10-02: "I would like the title to be more prominently
// displayed". The header now carries the kicker, the title and the year as
// separate pieces; the kicker is what tells an edit from a new rating.
describe('the header', () => {
  it('labels a new rating "Rate", with the title and year', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rate-kicker').text()).toBe('Rate')
    expect(wrapper.find('.rate-title-text').text()).toBe('Movie Under Test')
    expect(wrapper.find('.rate-title-year').text()).toBe('2021')
  })

  it('labels an edit "Edit rating"', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.rate-kicker').text()).toBe('Edit rating')
    expect(wrapper.find('.rate-title-text').text()).toBe('Movie Under Test')
  })

  it('shows no year when the film has no release date, but keeps a spot to tap', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.setData({ year: '' })
    expect(wrapper.find('.rate-title-year').text()).toBe('')
    expect(wrapper.find('.rate-title-year').classes()).toContain('rate-title-year-empty')
  })
})

// Bug report 2026-10-06: "the title is already in the header, so I don't need
// it to also be below" the tiles, with the year at the right of the title's
// line — and (Matt, in reply) the header's title and year secretly editable.
describe('the header title and year', () => {
  it('drops the old Title box under the tiles', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('#title').exists()).toBe(false)
    expect(wrapper.find('#year').exists()).toBe(false)
    expect(wrapper.find('[id="rate.titleYear"]').exists()).toBe(false)
  })

  it('puts the year on the same row as the title', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    const row = wrapper.find('.rate-title-row')
    expect(row.find('.rate-title-text').exists()).toBe(true)
    expect(row.find('.rate-title-year').text()).toBe('2021')
  })

  it('tapping the title opens an editor, and the edit is what gets saved', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    await wrapper.find('.rate-title-text').trigger('click')
    const input = wrapper.find('.rate-title-text-input')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toBe('Movie Under Test')
    await input.setValue('Renamed Movie')
    await input.trigger('blur')
    expect(wrapper.find('.rate-title-text-input').exists()).toBe(false)
    expect(wrapper.find('.rate-title-text').text()).toBe('Renamed Movie')
    await wrapper.setData({ love: 7 })
    await wrapper.vm.addRating()
    const written = addRatingMock.mock.calls[0][0]
    expect(written[written.length - 1].title).toBe('Renamed Movie')
  })

  it('tapping the year opens a numeric editor, and Return keeps the edit', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    await wrapper.find('.rate-title-year').trigger('click')
    const input = wrapper.find('.rate-title-year-input')
    expect(input.attributes('inputmode')).toBe('numeric')
    await input.setValue('1999')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')
    expect(wrapper.vm.year).toBe('1999')
    expect(wrapper.find('.rate-title-year').text()).toBe('1999')
  })

  it('a blank title goes back to the one it had', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    await wrapper.find('.rate-title-text').trigger('click')
    const input = wrapper.find('.rate-title-text-input')
    await input.setValue('   ')
    await input.trigger('blur')
    expect(wrapper.find('.rate-title-text').text()).toBe('Movie Under Test')
  })
})

describe('saving an edit', () => {
  // THE data-safety assertion: an edit must not add a viewing.
  it('replaces the viewing in place instead of appending another', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    await wrapper.setData({ love: 6, overall: 6 })
    await wrapper.vm.addRating()

    const written = addRatingMock.mock.calls[0][0]
    expect(written).toHaveLength(2)
    expect(written[1].love).toBe(6)
    expect(written[1].overall).toBe(6)
  })

  it('leaves the other viewings untouched', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    await wrapper.setData({ love: 6 })
    await wrapper.vm.addRating()

    const written = addRatingMock.mock.calls[0][0]
    expect(written[0].love).toBe(3)
    expect(written[0].medium).toBe('Theater')
  })

  // Merge, not overwrite: this form doesn't collect every field a rating can
  // carry, and an edit that dropped the rest would be a quiet data loss.
  it('carries across fields the form does not collect', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: { dbKey: 'key-555', index: 1 } })
    await wrapper.vm.$nextTick()
    await wrapper.vm.addRating()

    expect(addRatingMock.mock.calls[0][0][1].someFutureField).toBe('keep me')
  })

  it('still appends when nothing is being edited', async () => {
    const { wrapper } = mountEditing({ ratingToEdit: null })
    await wrapper.vm.$nextTick()
    await wrapper.setData({ love: 7, overall: 7 })
    await wrapper.vm.addRating()

    const written = addRatingMock.mock.calls[0][0]
    expect(written).toHaveLength(3)
    expect(written[2].love).toBe(7)
  })

  // A target that no longer resolves — the viewing was deleted on another
  // device between opening the form and saving. Appending is the safe
  // outcome; writing to a stale index would overwrite whatever moved into it.
  it('appends rather than guessing when the target has vanished', async () => {
    const { wrapper } = mountEditing({
      ratingToEdit: { dbKey: 'key-555', index: 7 },
      ratings: [firstViewing()]
    })
    await wrapper.vm.$nextTick()

    expect(wrapper.vm.isEditing).toBe(false)
    await wrapper.vm.addRating()
    expect(addRatingMock.mock.calls[0][0]).toHaveLength(2)
  })
})

describe('the store guards against a stale edit target', () => {
  // The one that would hurt: start an edit, back out, then tap "Add New
  // Rating" on another film and have it silently overwrite a viewing. The
  // reset lives inside setMovieToRate — which EVERY route into RateMovie
  // commits — precisely so no call site can forget it.
  it('clears ratingToEdit whenever a movie is set to rate', () => {
    const store = storeModule
    store.commit('setMovieToRate', MOVIE)
    store.commit('setRatingToEdit', { dbKey: 'key-555', index: 1 })
    expect(store.state.ratingToEdit).toEqual({ dbKey: 'key-555', index: 1 })

    store.commit('setMovieToRate', { id: 999, title: 'A Different Film' })
    expect(store.state.ratingToEdit).toBeNull()
  })
})
