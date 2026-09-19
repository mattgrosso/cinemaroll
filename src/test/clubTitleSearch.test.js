import { describe, it, expect } from 'vitest'
import {
  sharesWholeLibrary,
  clubTitleIndex,
  searchClubTitles,
  clubSeenBreakdown
} from '@/assets/javascript/clubTitleSearch.js'

// Report -P1lQnAdARMxUpPScybv (2026-09-17): "It would be cool to be able to
// search my film club to see if anybody has watched a specific movie... have
// it filter to show me who's seen it and who hasn't."

const sharer = (key, name, ratings, extra = {}) => ({
  key,
  name,
  profile: { ratings, recent: [], topShelf: [], ...extra }
})
const shelfOnly = (key, name, extra = {}) => ({
  key,
  name,
  profile: { recent: [], topShelf: [], ...extra }
})

describe('sharesWholeLibrary', () => {
  it('is true only for a profile carrying a ratings map', () => {
    expect(sharesWholeLibrary({ ratings: {} })).toBe(true)
    expect(sharesWholeLibrary({ recent: [{ id: 1 }] })).toBe(false)
    expect(sharesWholeLibrary(null)).toBe(false)
  })
})

describe('clubTitleIndex', () => {
  const mine = [{ movie: { id: 1, title: 'Heat', poster_path: '/heat.jpg' } }]

  it('pools my library with everything any friend has published', () => {
    const friends = [
      sharer('a', 'Ann', { 2: { t: 'The Thing', p: '/t.jpg', r: 9 } }),
      shelfOnly('b', 'Bo', { topShelf: [{ id: 3, t: 'Arrival', p: '/a.jpg' }] })
    ]
    expect(clubTitleIndex(mine, friends).map((i) => i.title)).toEqual(['Arrival', 'Heat', 'The Thing'])
  })

  it('counts a film once however many people have it', () => {
    const friends = [
      sharer('a', 'Ann', { 1: { t: 'Heat', r: 8 } }),
      sharer('b', 'Bo', { 1: { t: 'Heat', r: 7 } })
    ]
    expect(clubTitleIndex(mine, friends)).toHaveLength(1)
  })

  it('borrows a poster from a friend when mine has none', () => {
    const friends = [sharer('a', 'Ann', { 9: { t: 'Solaris', p: '/s.jpg', r: 8 } })]
    const index = clubTitleIndex([{ movie: { id: 9, title: 'Solaris' } }], friends)
    expect(index[0].poster).toBe('/s.jpg')
  })

  it('drops anything with no title to show', () => {
    expect(clubTitleIndex([{ movie: { id: 5 } }], [])).toEqual([])
    expect(clubTitleIndex(null, null)).toEqual([])
  })
})

describe('searchClubTitles', () => {
  const index = [
    { id: '1', title: 'Another Round' },
    { id: '2', title: 'The Thing' },
    { id: '3', title: 'Theorem' }
  ]

  it('puts a title that starts with what you typed first', () => {
    // Both prefix matches come before the substring one; between them,
    // localeCompare decides (it ignores the space at primary strength).
    expect(searchClubTitles(index, 'the').map((i) => i.title))
      .toEqual(['The Thing', 'Theorem', 'Another Round'])
  })

  it('waits for two characters rather than listing the whole library', () => {
    expect(searchClubTitles(index, 't')).toEqual([])
    expect(searchClubTitles(index, '  ')).toEqual([])
  })

  it('ignores case and surrounding space', () => {
    expect(searchClubTitles(index, '  THING ').map((i) => i.title)).toEqual(['The Thing'])
  })

  it('caps how many it hands back', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: String(i), title: `Rocky ${i}` }))
    expect(searchClubTitles(many, 'rocky', { limit: 5 })).toHaveLength(5)
  })
})

describe('clubSeenBreakdown', () => {
  it('puts a friend who rated it under seen, loudest first', () => {
    const friends = [
      sharer('a', 'Ann', { 7: { r: 6.2, s: 3 } }),
      sharer('b', 'Bo', { 7: { r: 9.1, s: 4.5 } })
    ]
    const { seen } = clubSeenBreakdown(friends, 7)
    expect(seen.map((f) => f.name)).toEqual(['Bo', 'Ann'])
    expect(seen[0].stars).toBe(4.5)
  })

  it('puts a full sharer without it under "hasn\'t seen"', () => {
    const { notSeen } = clubSeenBreakdown([sharer('a', 'Ann', { 1: { r: 8 } })], 7)
    expect(notSeen.map((f) => f.name)).toEqual(['Ann'])
  })

  it('NEVER claims a shelf-only sharer hasn\'t seen something', () => {
    // The whole trap. Absence from a shelf-only profile means "they don't
    // tell us", not "they haven't seen it" — they may have rated it five
    // stars last week.
    const { notSeen, unknown } = clubSeenBreakdown([shelfOnly('a', 'Ann')], 7)
    expect(notSeen).toEqual([])
    expect(unknown.map((f) => f.name)).toEqual(['Ann'])
    expect(unknown[0].why).toContain('share')
  })

  it('takes a shelf-only sharer\'s own shelf as proof they HAVE seen it', () => {
    const friends = [shelfOnly('a', 'Ann', { topShelf: [{ id: 7, t: 'Heat' }] })]
    const { seen, unknown } = clubSeenBreakdown(friends, 7)
    expect(seen.map((f) => f.name)).toEqual(['Ann'])
    expect(seen[0].score).toBe(null)
    expect(unknown).toEqual([])
  })

  it('separates a friend whose profile simply hasn\'t downloaded yet', () => {
    const { unknown } = clubSeenBreakdown([{ key: 'a', name: 'Ann', profile: null }], 7)
    expect(unknown[0].why).toContain('loaded')
  })

  it('matches a string id against a numeric one', () => {
    // Firebase keys are strings; a movie id arrives as a number.
    expect(clubSeenBreakdown([sharer('a', 'Ann', { 7: { r: 8 } })], '7').seen).toHaveLength(1)
    expect(clubSeenBreakdown([sharer('a', 'Ann', { 7: { r: 8 } })], 7).seen).toHaveLength(1)
  })

  it('says whether you have seen it yourself', () => {
    const mine = new Set(['7'])
    expect(clubSeenBreakdown([], 7, { myRatedIds: mine }).youveSeen).toBe(true)
    expect(clubSeenBreakdown([], 8, { myRatedIds: mine }).youveSeen).toBe(false)
    expect(clubSeenBreakdown([], 7).youveSeen).toBe(false)
  })

  it('answers emptily for no film rather than throwing', () => {
    expect(clubSeenBreakdown([sharer('a', 'Ann', { 7: { r: 8 } })], null))
      .toEqual({ seen: [], notSeen: [], unknown: [], youveSeen: false })
  })
})
