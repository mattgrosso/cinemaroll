import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'
import { forgetPeople } from '@/utils/personIdCache.js'

// Sentry "N+1 API Call" on PersonalAwardsScreen (2026-10-15): the acting
// categories ask TMDB /search/person for every cast member to read their
// gender, and the answers were kept 24 hours per name PER AWARDS YEAR — so
// every year switch and every next-day open re-asked for the whole cast at
// once. They now live in the device's people cache (personIdCache.js).

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const PEOPLE = {
  'Lead Actor': { id: 1, gender: 2, profile_path: '/lead.jpg' },
  'Lead Actress': { id: 2, gender: 1, profile_path: '/actress.jpg' },
  'Support Actor': { id: 3, gender: 2, profile_path: null }
}

function cast (year) {
  return Object.keys(PEOPLE).map((name, i) => ({
    id: name, name, movieId: `${year}-0`, castPosition: i, isActress: false, needsGenderCheck: true
  }))
}

function open (selectedYear) {
  const store = reactive({
    state: { settings: { personalAwards: {} }, settingsLoaded: true, databaseTopKey: 'tester', weights: [] },
    dispatch: vi.fn(),
    commit: vi.fn()
  })
  return mount(PersonalAwardsModal, {
    props: { allEntriesWithFlatKeywordsAdded: [], autoOpen: true, pageMode: true, selectedYear },
    global: { mocks: { $store: store }, stubs: { Modal: true, Teleport: true } }
  })
}

const searches = () => global.fetch.mock.calls.filter(([url]) => url.includes('/search/person'))

describe('PersonalAwardsModal — actor lookups are kept on the device', () => {
  beforeEach(() => {
    localStorage.clear()
    forgetPeople()
    global.fetch = vi.fn((url) => {
      const name = decodeURIComponent(url.split('query=')[1])
      const person = PEOPLE[name]
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: person ? [{ ...person, name }] : [] }) })
    })
  })
  afterEach(() => { delete global.fetch })

  it('asks TMDB once per actor, not again on a later open or another year', async () => {
    const first = open(1997)
    const eligible = await first.vm.filterCastMembersByGender(cast(1997))
    expect(searches()).toHaveLength(3)
    expect(eligible.map((person) => person.name)).toEqual(['Lead Actor', 'Support Actor'])
    first.unmount()

    const later = open(2001)
    const again = await later.vm.filterCastMembersByGender(cast(2001))
    expect(searches()).toHaveLength(3)
    expect(again.map((person) => person.name)).toEqual(['Lead Actor', 'Support Actor'])
    // The photo comes back from the device too, so the tiles keep their faces.
    expect(again[0].details.profile_path).toBe('/lead.jpg')
  })

  it('looks up again a name the Watchlist kept before photos were kept', async () => {
    localStorage.setItem('cinemaRoll.people.ids', JSON.stringify({ 'Lead Actor': { id: 1, gender: 2, at: Date.now() } }))
    const wrapper = open(1997)
    await wrapper.vm.getDetailsForCastMember('Lead Actor')
    expect(searches()).toHaveLength(1)
  })

  it('clears the retired per-year person entries when it opens', () => {
    localStorage.setItem('person_Lead Actor_1997', JSON.stringify({ data: null, timestamp: Date.now() }))
    open(1997)
    expect(localStorage.getItem('person_Lead Actor_1997')).toBeNull()
  })
})
