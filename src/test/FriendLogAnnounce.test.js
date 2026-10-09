import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'
import RateMovie from '@/components/RateMovie.vue'

// 2026-08-30. Seth rated Tenet at 5:21pm and put his phone away. Matt's phone
// buzzed — "Seth Hopper logged Tenet" — and his Film Club showed no such film.
//
// The two halves travel completely different roads. The push leaves the rater's
// browser the instant the save lands. The Film Club renders a friend's
// PUBLISHED PROFILE SNAPSHOT, which was on a 20-second debounce, and a
// backgrounded PWA does not run setTimeout. Seth's snapshot was last written 49
// seconds BEFORE the rating and stayed that way for hours.
//
// So the assertion that matters is a pairing one: if the submit announces, the
// same submit must publish. Anything that announces without publishing is a
// notification pointing at nothing.

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ data: { keywords: [] } })),
    get: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))

const addRatingMock = vi.fn(() => Promise.resolve({ path: 'test-user/movieLog/new-key' }))
vi.mock('@/assets/javascript/AddRating.js', () => ({
  default: (...args) => addRatingMock(...args)
}))

const announceMock = vi.fn()
vi.mock('@/utils/push.js', () => ({
  announceLoggedMovie: (...args) => announceMock(...args)
}))

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5.13 })),
  getAllRatings: vi.fn(() => [])
}))

vi.mock('@/services/ErrorLogService.js', () => ({
  default: { error: vi.fn(), warn: vi.fn() }
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

const TENET = {
  id: 577922,
  title: 'Tenet',
  release_date: '2020-08-26',
  poster_path: '/aCIFMriQh8rvhxpN1IWGgvH0Tlg.jpg',
  backdrop_path: '/b.jpg'
}

// `editingRating` is a computed resolved from the store, not a data field, so
// an edit has to be staged the way the app stages one: an existing entry plus a
// { dbKey, index } target.
const EXISTING_VIEWING = {
  date: new Date(2026, 7, 30, 17, 20).getTime(),
  medium: 'Download',
  direction: 6, imagery: 10, story: 4, performance: 5,
  soundtrack: 7, stickiness: 1, love: 4, overall: 6,
  id: 577922, title: 'Tenet', year: 2020
}

async function mountRating ({ social = { enabled: true, shareRatings: true }, isOnline = true, movie = TENET, editing = false } = {}) {
  const mockStore = {
    state: {
      movieLog: editing
        ? { 'key-tenet': { movie, ratings: [EXISTING_VIEWING], dbKey: 'key-tenet' } }
        : {},
      movieToRate: movie,
      ratingToEdit: editing ? { dbKey: 'key-tenet', index: 0 } : null,
      isOnline,
      settings: { tags: { 'viewing-tags': {} } },
      weights: WEIGHTS,
      databaseTopKey: 'test-user'
    },
    getters: { allMoviesAsArray: [], socialSettings: social },
    commit: vi.fn(),
    dispatch: vi.fn()
  }

  const wrapper = shallowMount(RateMovie, {
    global: {
      mocks: { $store: mockStore, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: { Modal: true, ToggleableRating: true, StickinessInline: true }
    }
  })
  await wrapper.vm.$nextTick()

  return { wrapper, mockStore }
}

const publishCalls = (mockStore) =>
  mockStore.dispatch.mock.calls.filter(([action]) => action === 'publishSocialProfileNow')

beforeEach(() => {
  announceMock.mockReset()
  addRatingMock.mockReset().mockImplementation(() => Promise.resolve({ path: 'test-user/movieLog/new-key' }))
})

describe('announcing a new viewing to the film club', () => {
  it('publishes the profile on the same submit that fires the push', async () => {
    const { wrapper, mockStore } = await mountRating()

    await wrapper.vm.addRating()
    await flushPromises()

    expect(announceMock).toHaveBeenCalledTimes(1)
    expect(announceMock.mock.calls[0][0]).toMatchObject({ tmdbId: 577922, title: 'Tenet' })
    expect(publishCalls(mockStore)).toHaveLength(1)
  })

  // 2026-09-06 (report -P0sDPxbC4120byAaK5W): the push and the publish left
  // together, and the push won the race — Matt tapped "Seth Hopper logged
  // Coyote vs. Acme", the page opened, and the snapshot it reads had not
  // landed. The push is what makes someone open the page, so it goes second.
  it('sends the push only after the profile snapshot has landed', async () => {
    let landed
    const { wrapper, mockStore } = await mountRating()
    mockStore.dispatch.mockImplementation((action) => {
      if (action === 'publishSocialProfileNow') return new Promise((resolve) => { landed = resolve })
      return Promise.resolve()
    })

    await wrapper.vm.addRating()
    await flushPromises()
    expect(publishCalls(mockStore)).toHaveLength(1)
    expect(announceMock).not.toHaveBeenCalled()

    landed()
    await flushPromises()
    expect(announceMock).toHaveBeenCalledTimes(1)
  })

  it('withholds the push when the publish fails', async () => {
    const { wrapper, mockStore } = await mountRating()
    mockStore.dispatch.mockImplementation((action) => {
      if (action === 'publishSocialProfileNow') return Promise.reject(new Error('PERMISSION_DENIED'))
      return Promise.resolve()
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await wrapper.vm.addRating()
    await flushPromises()

    expect(announceMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  // The pairing, stated as the invariant rather than as two counts: the club
  // must never be told about a film it cannot then show.
  it('never announces without also publishing', async () => {
    const { wrapper, mockStore } = await mountRating()

    await wrapper.vm.addRating()

    expect(publishCalls(mockStore).length).toBeGreaterThanOrEqual(announceMock.mock.calls.length)
  })

  it('publishes before handing over to the home screen', async () => {
    const order = []
    const { wrapper, mockStore } = await mountRating()
    mockStore.dispatch.mockImplementation((action) => {
      if (action === 'publishSocialProfileNow') order.push('publish')
      return Promise.resolve()
    })
    mockStore.commit.mockImplementation((mutation) => {
      if (mutation === 'setBannerRequest') order.push('navigate')
    })

    await wrapper.vm.addRating()

    expect(order).toEqual(['publish', 'navigate'])
  })

  it('stays quiet — no push, no publish — when sharing is off', async () => {
    const { wrapper, mockStore } = await mountRating({ social: { enabled: false } })

    await wrapper.vm.addRating()

    expect(announceMock).not.toHaveBeenCalled()
    expect(publishCalls(mockStore)).toHaveLength(0)
  })

  // Offline there is nothing to announce and nothing to publish; the durable
  // queue carries the rating and the next launch republishes.
  it('stays quiet when the device is offline', async () => {
    const { wrapper, mockStore } = await mountRating({ isOnline: false })

    await wrapper.vm.addRating()

    expect(announceMock).not.toHaveBeenCalled()
    expect(publishCalls(mockStore)).toHaveLength(0)
  })

  // An edit is not a new viewing. It must not push, and the debounced publish
  // already covers the changed score.
  it('does not announce or force-publish an edit', async () => {
    const { wrapper, mockStore } = await mountRating({ editing: true })
    expect(wrapper.vm.isEditing).toBe(true)

    await wrapper.vm.addRating()

    expect(announceMock).not.toHaveBeenCalled()
    expect(publishCalls(mockStore)).toHaveLength(0)
  })

  it('does not announce a save that failed', async () => {
    addRatingMock.mockImplementation(() => Promise.reject(new Error('offline')))
    const { wrapper, mockStore } = await mountRating()

    await wrapper.vm.addRating()

    expect(announceMock).not.toHaveBeenCalled()
    expect(publishCalls(mockStore)).toHaveLength(0)
  })
})
