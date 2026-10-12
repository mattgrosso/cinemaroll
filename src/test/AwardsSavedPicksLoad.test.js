import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'

// Report 2026-10-12 (Natalie, /awards?year=1999): "Yesterday I had put in my
// personal awards for 1999 and I'm back today ... it looks like none of my
// progress was saved and I have to start over." The picks WERE saved: since
// 2026-10-06 the awards load on their own, after the settings, and the page
// filled itself in when the settings arrived and never looked again when the
// awards did. Tapping Back on that empty page would then have saved the empty
// year over the real one. And picks inside a category only saved on Back.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

function movieEntry (id, title) {
  return {
    movie: { id, title, release_date: '1999-06-15', poster_path: `/${id}.jpg`, crew: [], cast: [], flatKeywords: [] },
    ratings: [{ calculatedTotal: 7, date: 1700000000000 }]
  }
}
const LIBRARY = [movieEntry(101, 'The Matrix'), movieEntry(102, 'Magnolia')]

const SAVED = {
  1999: {
    completed: false,
    categories: {
      bestPicture: { nominees: [{ type: 'movie', movieId: 101 }, { type: 'movie', movieId: 102 }], winner: { type: 'movie', movieId: 101 }, noNominees: false }
    }
  }
}

// The settings node as it lands at launch: everything except the awards.
const SETTINGS = { awardsYearThreshold: 1 }

function factory ({ pending = true, personalAwards = null } = {}) {
  const store = reactive({
    state: {
      settings: personalAwards ? { ...SETTINGS, personalAwards } : { ...SETTINGS },
      settingsLoaded: true,
      personalAwards,
      personalAwardsPending: pending,
      databaseTopKey: 'natalie-key',
      weights: []
    },
    dispatch: vi.fn(() => new Promise(() => {})),
    commit: vi.fn()
  })
  store.dispatch.mockImplementation((action) => (
    action === 'ensurePersonalAwards' ? new Promise(() => {}) : Promise.resolve()
  ))
  const wrapper = mount(PersonalAwardsModal, {
    props: { allEntriesWithFlatKeywordsAdded: LIBRARY, autoOpen: true, pageMode: true, selectedYear: 1999 },
    global: { mocks: { $store: store }, stubs: { Teleport: true } }
  })
  return { wrapper, store }
}

// What the store's setPersonalAwards does.
function awardsLand (store, data) {
  store.state.personalAwards = data
  store.state.personalAwardsPending = false
  store.state.settings = { ...store.state.settings, personalAwards: data }
}

const saves = (store) => store.dispatch.mock.calls.filter(([action]) => action === 'savePersonalAwards')

describe('PersonalAwardsModal — saved picks that arrive after the settings', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows the saved picks once the awards land after the settings', async () => {
    const { wrapper, store } = factory()
    await nextTick()
    expect(wrapper.find('.awards-loading').exists()).toBe(true)
    expect(wrapper.find('.awards-slider').exists()).toBe(false)

    awardsLand(store, SAVED)
    await nextTick()
    await nextTick()

    expect(wrapper.vm.awardsData.bestPicture?.nominees).toHaveLength(2)
    expect(wrapper.find('.awards-loading').exists()).toBe(false)
    expect(wrapper.find('.awards-slider').text()).toContain('2 nominees')
  })

  it('re-reads when the server copy lands after the device copy', async () => {
    const { wrapper, store } = factory()
    awardsLand(store, { 1999: { categories: {} } })
    await nextTick()
    expect(wrapper.vm.awardsData.bestPicture).toBeUndefined()

    awardsLand(store, SAVED)
    await nextTick()
    expect(wrapper.vm.awardsData.bestPicture.nominees).toHaveLength(2)
  })

  it('never saves the empty year while the awards are still loading', async () => {
    const { wrapper, store } = factory()
    wrapper.vm.selectedCategory = 'bestPicture'
    await wrapper.vm.backToCategories()
    await vi.runAllTimersAsync()
    await wrapper.vm.saveCurrentState()
    wrapper.vm.closeModal()

    expect(saves(store)).toHaveLength(0)
  })

  it('never overwrites edits made before a late copy lands', async () => {
    const { wrapper, store } = factory({ pending: false, personalAwards: { 1999: { categories: {} } } })
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.toggleNominee(LIBRARY[1])

    awardsLand(store, SAVED)
    await nextTick()

    expect(wrapper.vm.awardsData.bestPicture.nominees.map((n) => n.movie.id)).toEqual([102])
  })

  it('saves a pick shortly after the tap, without waiting for Back', async () => {
    const { wrapper, store } = factory({ pending: false, personalAwards: SAVED })
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.selectWinner(LIBRARY[1])
    expect(saves(store)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1000)
    expect(saves(store)).toHaveLength(1)
    const [, { path, value }] = saves(store)[0]
    expect(path).toBe('1999')
    expect(value.categories.bestPicture.winner.movieId).toBe(102)
    expect(value.categories.bestPicture.nominees).toHaveLength(2)
  })

  it('saves a waiting pick at once when the app goes to the background', async () => {
    const { wrapper, store } = factory({ pending: false, personalAwards: SAVED })
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.selectWinner(LIBRARY[1])

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    delete document.visibilityState
    await Promise.resolve()

    expect(saves(store)).toHaveLength(1)
    expect(saves(store)[0][1].value.categories.bestPicture.winner.movieId).toBe(102)
  })

  it('saves a waiting pick when the page is left', async () => {
    const { wrapper, store } = factory({ pending: false, personalAwards: SAVED })
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.selectWinner(LIBRARY[1])
    wrapper.unmount()
    await Promise.resolve()

    expect(saves(store)).toHaveLength(1)
  })

  it('a save made while another is in flight is not dropped', async () => {
    const { wrapper, store } = factory({ pending: false, personalAwards: SAVED })
    let finishFirst
    store.dispatch.mockImplementation((action) => {
      if (action !== 'savePersonalAwards') return Promise.resolve()
      if (!finishFirst) return new Promise((resolve) => { finishFirst = resolve })
      return Promise.resolve()
    })
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.saveCurrentState()
    await Promise.resolve()
    wrapper.vm.selectWinner(LIBRARY[1])
    wrapper.vm.saveCurrentState()

    finishFirst()
    await vi.runAllTimersAsync()

    expect(saves(store)).toHaveLength(2)
    expect(saves(store)[1][1].value.categories.bestPicture.winner.movieId).toBe(102)
  })
})
