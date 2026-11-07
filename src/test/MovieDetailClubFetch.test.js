import { describe, it, expect, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { reactive } from 'vue'
import MovieDetail from '@/components/MovieDetail.vue'
import { FRIEND_PROFILE_MAX_AGE_MS } from '@/components/FriendsWhoSaw.vue'

// Report 2026-11-07: a friend-log push opened the film, and the friend's
// score only appeared after leaving the page and coming back. The Club panel
// (FriendsWhoSaw, which used to do the fetching) only mounts once a friend's
// rating is already in memory, so with a copy that predates the new log
// nothing asked for a fresh one. The page itself must ask.

vi.mock('axios', () => ({
  default: {
    get: vi.fn(() => Promise.resolve({ data: {} })),
    post: vi.fn(() => Promise.resolve({ data: {} }))
  }
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn(), warn: vi.fn(), setSignedInCheck: vi.fn() } }))
vi.mock('@/utils/letterboxdData.js', () => ({
  myLetterboxdReviews: vi.fn(async () => []),
  letterboxdFilm: vi.fn(async () => null)
}))

function mountPage ({ friends, route }) {
  const store = {
    state: reactive({ movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {}, isOnline: true }),
    getters: reactive({
      allMoviesAsArray: [],
      allMediaAsArray: [],
      databaseTopKey: 'tester',
      socialUserKey: 'me',
      socialFriendKeys: ['seth'],
      filmClubFriends: friends
    }),
    commit: vi.fn(),
    dispatch: vi.fn()
  }
  const wrapper = shallowMount(MovieDetail, {
    global: {
      mocks: { $store: store, $route: route, $router: { push: vi.fn() } },
      stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section><slot name="actions"/><slot/></section>' } }
    }
  })
  return { wrapper, store }
}

const clubCalls = (store) => store.dispatch.mock.calls.filter(([action]) => action === 'ensureClubData')

describe('MovieDetail asks for fresh club data itself', () => {
  it('asks on open even when no friend rating is in memory yet (the panel is hidden)', () => {
    // Seth's profile in hand predates his log of film 42.
    const { wrapper, store } = mountPage({
      friends: [{ key: 'seth', name: 'Seth', profile: { ratings: {} } }],
      route: reactive({ params: { tmdbId: '42' }, query: {} })
    })
    expect(wrapper.find('.club-panel').exists()).toBe(false)
    expect(clubCalls(store)).toEqual([['ensureClubData', { maxAgeMs: FRIEND_PROFILE_MAX_AGE_MS }]])
  })

  it('asks again when the page moves to another film', async () => {
    const route = reactive({ params: { tmdbId: '42' }, query: {} })
    const { store } = mountPage({ friends: [], route })
    route.params.tmdbId = '43'
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clubCalls(store).length).toBe(2)
  })

  it('asks again once the account key resolves after mount (cold start from a push)', async () => {
    const { store } = mountPage({ friends: [], route: reactive({ params: { tmdbId: '42' }, query: {} }) })
    store.getters.socialUserKey = 'me-later'
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(clubCalls(store).length).toBe(2)
  })
})
