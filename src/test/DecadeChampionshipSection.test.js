import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import DecadeChampionship from '@/components/stats/DecadeChampionship.vue'
import { lookupPerson } from '@/utils/personLookup.js'

// Bug report 2026-09-02: a decade-by-decade championship in Deep Stats.
// Driven through the DOM: the pills, the podiums, the async Actor/Actress
// split, the offline fallback, and what a tap does.

// The real getRating needs the store's weights; the fixtures carry plain
// calculatedTotals, exactly as TrophyCase.test.js does.
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((entry) => ({ calculatedTotal: entry.ratings?.[0]?.calculatedTotal }))
}))

// TMDB's gender enum: 1 female, 2 male. Anyone not listed is "not found".
const PEOPLE = {
  'Tom Hanks': { gender: 2, profile_path: '/hanks.jpg' },
  'Meg Ryan': { gender: 1, profile_path: '/ryan.jpg' },
  'Tilda Swinton': { gender: 1, profile_path: '/swinton.jpg' },
  'Nora Ephron': { gender: 1, profile_path: '/ephron.jpg' },
  'Wes Anderson': { gender: 2, profile_path: null }
}
vi.mock('@/utils/personLookup.js', () => ({
  lookupPerson: vi.fn(async (name) => (PEOPLE[name] ? { id: name.length, name, ...PEOPLE[name] } : null))
}))

function film (id, { rating = 8, release = '1994-06-15', cast = [], crew = [], genres = [] } = {}) {
  return {
    dbKey: `k${id}`,
    movie: {
      id,
      title: `Film ${id}`,
      release_date: release,
      poster_path: `/p${id}.jpg`,
      cast: cast.map((name) => ({ name, character: 'Self' })),
      crew: crew.map(([job, name]) => ({ job, name })),
      genres: genres.map((name, i) => ({ id: i + 1, name })),
      production_companies: []
    },
    ratings: [{ date: '2024-01-01', calculatedTotal: rating }]
  }
}

// Five films from the 1990s and three from the 2000s, so the 1990s is the
// default and the 2000s has its own, different, director.
function library () {
  return [
    film(1, { rating: 9, cast: ['Tom Hanks', 'Meg Ryan'], crew: [['Director', 'Nora Ephron']], genres: ['Romance'] }),
    film(2, { rating: 8.5, cast: ['Tom Hanks', 'Meg Ryan'], crew: [['Director', 'Nora Ephron']], genres: ['Romance'] }),
    film(3, { rating: 8, cast: ['Tom Hanks', 'Nobody Known'], crew: [['Director', 'Nora Ephron']], genres: ['Romance'] }),
    film(4, { rating: 7, cast: ['Nobody Known'], crew: [['Director', 'One Off']] }),
    film(5, { rating: 6, cast: ['Tilda Swinton'] }),
    film(6, { rating: 9, release: '2004-01-01', crew: [['Director', 'Wes Anderson']] }),
    film(7, { rating: 8, release: '2007-01-01', crew: [['Director', 'Wes Anderson']] }),
    film(8, { rating: 7, release: '2009-01-01', cast: ['Tilda Swinton'] })
  ]
}

function mountSection ({ isOnline = true } = {}) {
  const pushSpy = vi.fn()
  const wrapper = mount(DecadeChampionship, {
    global: {
      stubs: { BackLink: true },
      mocks: {
        $store: {
          state: { settings: {}, isOnline },
          getters: { allMoviesAsArray: library() }
        },
        $router: { push: pushSpy }
      }
    }
  })
  return { wrapper, pushSpy }
}

const section = (wrapper) => wrapper.find('.decade-championship')
const card = (wrapper, key) => section(wrapper).find(`.champion[data-category="${key}"]`)
const cardKeys = (wrapper) => section(wrapper).findAll('.champion').map((c) => c.attributes('data-category'))
const winnerName = (wrapper, key) => card(wrapper, key).find('.champion-name').text()
const field = (wrapper) => section(wrapper).find('.competitors')
const fieldNames = (wrapper) => field(wrapper).findAll('.competitor-name').map((n) => n.text())

describe('Decade Championship (Eras tab)', () => {
  beforeEach(() => {
    lookupPerson.mockClear()
    // PersonModal looks up a biography on open.
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  })

  it('offers every decade as a pill, newest first, with the biggest decade selected', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    const pills = section(wrapper).findAll('.ds-decade-pill')
    expect(pills.map((p) => p.text())).toEqual(['2000s', '1990s'])
    expect(pills[1].classes()).toContain('selected')
    expect(pills[0].classes()).not.toContain('selected')
    expect(section(wrapper).text()).toContain('5 films rated from the 1990s')
  })

  it('is one sideways row of winners: a poster for the film, a portrait for each person', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    // Writer/Cinematographer/Composer/Editor have nobody with two films here;
    // Producer, Studio and Genre were cut (2026-09-02).
    expect(cardKeys(wrapper)).toEqual(['film', 'director', 'actor', 'actress'])
    expect(section(wrapper).findAll('.champion .champion-name')).toHaveLength(4)
    expect(section(wrapper).text()).not.toContain('Romance')

    expect(winnerName(wrapper, 'film')).toBe('Film 1')
    expect(card(wrapper, 'film').find('img').attributes('src')).toContain('/p1.jpg')
    // One Off has a single film and does not qualify.
    expect(winnerName(wrapper, 'director')).toBe('Nora Ephron')
    expect(card(wrapper, 'director').find('img').attributes('src')).toContain('/ephron.jpg')
    expect(winnerName(wrapper, 'actor')).toBe('Tom Hanks')
    expect(card(wrapper, 'actor').find('img').attributes('src')).toContain('/hanks.jpg')
    expect(winnerName(wrapper, 'actress')).toBe('Meg Ryan')
    // Nobody Known has two films and would qualify, but TMDB can't find them
    // and a wrong crown is worse than a missing one.
    expect(section(wrapper).text()).not.toContain('Nobody Known')
    expect(field(wrapper).exists()).toBe(false)
  })

  it('a person TMDB knows but has no photo for gets the not-available image, never a poster', async () => {
    const { wrapper } = mountSection()
    await flushPromises()
    await section(wrapper).findAll('.ds-decade-pill')[0].trigger('click')
    await flushPromises()

    expect(winnerName(wrapper, 'director')).toBe('Wes Anderson')
    const src = card(wrapper, 'director').find('img').attributes('src')
    expect(src).toContain('Image_not_available')
    expect(src).not.toContain('/p6.jpg')
  })

  it('tapping a winner unfolds the field beneath the row; tapping again folds it', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    await card(wrapper, 'film').trigger('click')
    expect(card(wrapper, 'film').classes()).toContain('open')
    expect(card(wrapper, 'director').classes()).not.toContain('open')
    expect(fieldNames(wrapper)).toEqual(['Film 1', 'Film 2', 'Film 3', 'Film 4', 'Film 5'])
    expect(field(wrapper).text()).toContain('Film of the 1990s')

    await card(wrapper, 'director').trigger('click')
    expect(fieldNames(wrapper)).toEqual(['Nora Ephron'])
    expect(field(wrapper).text()).toContain('Nobody else qualifies')

    await card(wrapper, 'director').trigger('click')
    expect(field(wrapper).exists()).toBe(false)
  })

  it('the cast walk goes only as deep as asked: one of each for the row, further on unfold', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    // Tom Hanks fills Actor, Meg Ryan fills Actress; the walk stops there.
    const before = lookupPerson.mock.calls.map(([name]) => name)
    expect(before).toContain('Tom Hanks')
    expect(before).toContain('Meg Ryan')
    expect(before).not.toContain('Nobody Known')

    await card(wrapper, 'actor').trigger('click')
    await flushPromises()
    const after = lookupPerson.mock.calls.map(([name]) => name)
    expect(after).toContain('Nobody Known')
    expect(fieldNames(wrapper)).toEqual(['Tom Hanks'])
  })

  it('a competitor who is a person opens the shared PersonModal with their decade credits', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    await card(wrapper, 'director').trigger('click')
    await field(wrapper).find('.competitor').trigger('click')
    await flushPromises()

    const modal = wrapper.find('.person-modal')
    expect(modal.exists()).toBe(true)
    expect(modal.text()).toContain('Nora Ephron')
    expect(modal.text()).toContain('Director of the 1990s')
    expect(modal.text()).toContain('#1 of 1')
    expect(modal.findAll('.person-poster-card')).toHaveLength(3)
  })

  it('a competitor that is a film goes to the movie', async () => {
    const { wrapper, pushSpy } = mountSection()
    await flushPromises()

    await card(wrapper, 'film').trigger('click')
    await field(wrapper).findAll('.competitor')[1].trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/movie/2')
  })

  it('switching decade folds the field and re-crowns everything', async () => {
    const { wrapper } = mountSection()
    await flushPromises()
    await card(wrapper, 'film').trigger('click')

    await section(wrapper).findAll('.ds-decade-pill')[0].trigger('click')
    await flushPromises()

    expect(field(wrapper).exists()).toBe(false)
    expect(section(wrapper).text()).toContain('3 films rated from the 2000s')
    expect(winnerName(wrapper, 'director')).toBe('Wes Anderson')
    expect(winnerName(wrapper, 'film')).toBe('Film 6')
    // Tilda Swinton has one 2000s film: no Actor or Actress this decade.
    expect(card(wrapper, 'actress').exists()).toBe(false)
    expect(card(wrapper, 'actor').exists()).toBe(false)
  })

  // Bug report 2026-09-02: "when I click a year here in the decade
  // championships, it should take me back to the left edge of the scroll
  // instead, it's just leaving me scrolled horizontally wherever I happen to
  // have been." jsdom never lays anything out, so scrollLeft is stubbed as a
  // plain writable value on the row; the assertion is that the component
  // writes 0 to it when the decade changes.
  it('switching decade scrolls the winners row back to its left edge', async () => {
    const { wrapper } = mountSection()
    await flushPromises()

    const row = section(wrapper).find('.ds-poster-row.champions').element
    let scrollLeft = 240
    Object.defineProperty(row, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (value) => { scrollLeft = value }
    })

    await section(wrapper).findAll('.ds-decade-pill')[0].trigger('click')
    await flushPromises()

    expect(section(wrapper).text()).toContain('3 films rated from the 2000s')
    expect(row.scrollLeft).toBe(0)
  })

  it('offline, actors and actresses share one Performer card and nothing is looked up', async () => {
    const { wrapper } = mountSection({ isOnline: false })
    await flushPromises()

    expect(lookupPerson).not.toHaveBeenCalled()
    expect(card(wrapper, 'actor').exists()).toBe(false)
    expect(card(wrapper, 'actress').exists()).toBe(false)
    expect(winnerName(wrapper, 'performer')).toBe('Tom Hanks')
    expect(card(wrapper, 'performer').find('img').attributes('src')).toContain('Image_not_available')

    await card(wrapper, 'performer').trigger('click')
    expect(fieldNames(wrapper)).toEqual(['Tom Hanks', 'Meg Ryan', 'Nobody Known'])
    expect(field(wrapper).text()).toContain('offline')
  })
})
