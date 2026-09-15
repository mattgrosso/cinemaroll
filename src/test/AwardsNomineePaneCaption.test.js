import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'

// Report -P1_WpzyTRahOiZTWLK2 (2026-09-15, from /#/awards?year=1980): "In the
// nominees pane we don't need the name of the movie below the poster."
//
// The Current Nominees gallery captioned every poster with its own title,
// truncated at nine characters plus an ellipsis — so "The Empire Strikes Back"
// read "The Empir...". For a movie category the poster already says the name,
// and says it better.
//
// The caption stays for ACTING categories, where it is the person's name over
// a headshot plus the roles they were nominated for — nothing the image says.
// That distinction is the whole fix, so both halves are asserted here.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const ACTOR = {
  id: 'cast-1',
  name: 'Dolly Parton',
  character: 'Doralee Rhodes',
  order: 0
}

const ENTRY = {
  movie: {
    id: 19494,
    // Long enough that the old caption truncated it — the ugly half of the
    // complaint, and proof the assertion is about the caption and not the
    // `title` attribute (which carries the full name and stays).
    title: 'Nine to Five and Then Some',
    release_date: '1980-12-18',
    poster_path: '/ninetofive.jpg',
    crew: [{ name: 'Colin Higgins', job: 'Director' }],
    cast: [ACTOR]
  },
  ratings: [{ calculatedTotal: 7 }]
}

function mountModal () {
  const mockStore = {
    state: {
      settings: { personalAwards: {} },
      databaseTopKey: 'mattgrosso-gmail-com',
      weights: []
    },
    dispatch: vi.fn(),
    commit: vi.fn()
  }

  const wrapper = mount(PersonalAwardsModal, {
    props: { allEntriesWithFlatKeywordsAdded: [ENTRY] },
    global: {
      mocks: { $store: mockStore },
      stubs: {
        // A real stub, not `true`: the whole screen lives in Modal's slots,
        // and `true` renders none of them — the pane under test would simply
        // not exist and every assertion would pass or fail for the wrong
        // reason.
        Modal: { template: '<div><slot name="header"/><slot name="body"/><slot name="footer"/></div>' }
      }
    }
  })
  wrapper.vm.currentYear = 1980
  return wrapper
}

describe('the Current Nominees pane caption', () => {
  let wrapper

  beforeEach(() => {
    wrapper = mountModal()
  })

  it('shows no caption under a movie poster', async () => {
    wrapper.vm.selectedCategory = 'bestPicture'
    const nominee = { movieId: ENTRY.movie.id, movie: ENTRY.movie }
    wrapper.vm.awardsData = {
      bestPicture: { nominees: [nominee], winner: null, noNominees: false }
    }
    await wrapper.vm.$nextTick()

    // The poster is there...
    expect(wrapper.find('.current-nominee-poster').exists()).toBe(true)
    // ...and nothing is written under it.
    expect(wrapper.find('.current-nominee-poster .nominee-poster-name').exists()).toBe(false)
    expect(wrapper.find('.current-nominees-gallery').text()).not.toContain('Nine to Fi')
  })

  it('keeps the caption under an acting headshot — that name is not in the image', async () => {
    wrapper.vm.selectedCategory = 'bestActress'
    const nominee = {
      ...ACTOR,
      movie: ENTRY.movie,
      movieId: ENTRY.movie.id,
      details: { profile_path: '/dolly.jpg' }
    }
    wrapper.vm.awardsData = {
      bestActress: { nominees: [nominee], winner: null, noNominees: false }
    }
    await wrapper.vm.$nextTick()

    const caption = wrapper.find('.current-nominee-poster .nominee-poster-name')
    expect(caption.exists()).toBe(true)
    expect(caption.text().length).toBeGreaterThan(0)
  })

  it('still carries the full title as the tile\'s tooltip', async () => {
    wrapper.vm.selectedCategory = 'bestPicture'
    wrapper.vm.awardsData = {
      bestPicture: {
        nominees: [{ movieId: ENTRY.movie.id, movie: ENTRY.movie }],
        winner: null,
        noNominees: false
      }
    }
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.current-nominee-poster').attributes('title')).toContain('Nine to Five')
  })
})
