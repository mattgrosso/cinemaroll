import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'

// Regression guard for the accidental-completion bug (Matt, 2026-08-15):
// "I didn't actually hit the complete the year button... nothing should
// complete the year except for me clicking complete the year."
// saveCurrentState used to derive completed from all-categories-decided on
// EVERY save — and saves fire on every back-slide out of a category — so
// visiting a fully-decided year silently re-completed it and refreshed
// availableMovieIds, destroying the new-movies-since-completion prompt.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

function movieEntry (id, title, year) {
  return {
    movie: {
      id,
      title,
      release_date: `${year}-06-15`,
      poster_path: `/${id}.jpg`,
      crew: [],
      cast: [],
      flatKeywords: []
    },
    ratings: [{ calculatedTotal: 7, date: 1700000000000 }]
  }
}

function factory (personalAwards = {}) {
  const store = reactive({
    state: {
      settings: { personalAwards },
      settingsLoaded: true,
      databaseTopKey: 'mattgrosso-gmail-com',
      weights: []
    },
    dispatch: vi.fn().mockResolvedValue(),
    commit: vi.fn()
  })

  const wrapper = mount(PersonalAwardsModal, {
    props: {
      allEntriesWithFlatKeywordsAdded: [movieEntry(101, 'Sicario', 2015), movieEntry(102, 'Arrival', 2015)],
      autoOpen: true,
      pageMode: true,
      selectedYear: 2015
    },
    global: {
      mocks: { $store: store },
      stubs: { Modal: true, Teleport: true }
    }
  })
  return { wrapper, store }
}

const savedEntry = (store) => {
  const call = store.dispatch.mock.calls.filter(
    (c) => c[0] === 'savePersonalAwards' && c[1]?.path === '2015'
  ).pop()
  return call && call[1].value
}

describe('year completion is explicit-only', () => {
  it('an ordinary save NEVER marks the year completed, even with every category decided', async () => {
    const { wrapper, store } = factory({})

    // Every category decided — the exact state that used to auto-complete.
    const winner = movieEntry(101, 'Sicario', 2015)
    const decided = {}
    wrapper.vm.categories.forEach((category) => {
      decided[category.key] = { nominees: [winner], winner, noNominees: false }
    })
    wrapper.vm.awardsData = decided

    await wrapper.vm.saveCurrentState()

    const saved = savedEntry(store)
    expect(saved).toBeTruthy()
    expect(saved.completed).toBe(false)
    // No completion happened, so no completion snapshot is written either.
    expect(saved.availableMovieIds).toBeUndefined()
  })

  it('an ordinary save on an already-completed year preserves the old completion snapshot', async () => {
    const { wrapper, store } = factory({
      2015: { completed: true, lastUpdated: 1, availableMovieIds: [101], categories: {} }
    })

    // Library now also has Arrival (102) — the prompt-worthy "new movie".
    await wrapper.vm.saveCurrentState()

    const saved = savedEntry(store)
    expect(saved.completed).toBe(true) // stays completed
    expect(saved.availableMovieIds).toEqual([101]) // snapshot NOT refreshed — 102 stays "new"
  })

  it('the explicit Complete action marks completed and takes a fresh snapshot', async () => {
    const { wrapper, store } = factory({
      2015: { completed: true, lastUpdated: 1, availableMovieIds: [101], categories: {} }
    })

    await wrapper.vm.saveCurrentState(true)

    const saved = savedEntry(store)
    expect(saved.completed).toBe(true)
    expect(saved.availableMovieIds).toEqual([101, 102]) // refreshed on explicit completion
  })
})
