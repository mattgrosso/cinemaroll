import { describe, it, expect } from 'vitest'
import { filmFacetsFrom, friendLibraryRows, filterFriendLibrary, filmsWithUnknownFacts, facetOptions } from '@/assets/javascript/friendLibrary.js'
import { buildSocialProfile } from '@/assets/javascript/social.js'
import { fromInterchange, fromMovieLog } from '@/assets/javascript/interchange.js'

// Matt, 2026-11-13: look through a friend's whole library and search it by
// year, genre or whatever category.

const HEAT = { id: 949, title: 'Heat', release_date: '1995-12-15', runtime: 170, genres: [{ id: 80, name: 'Crime' }, { id: 18, name: 'Drama' }], crew: [{ job: 'Director', name: 'Michael Mann' }, { job: 'Writer', name: 'Michael Mann' }] }
const SHORT = { id: 5, title: 'Tiny', release_date: '2010-01-01', runtime: 12, genres: [{ id: 16, name: 'Animation' }], crew: [] }

const at = (y, m = 5) => Date.UTC(y, m, 1)

describe('filmFacetsFrom', () => {
  it('carries year, genre ids, directors (job, not position) and a short flag', () => {
    expect(filmFacetsFrom(HEAT)).toEqual({ y: 1995, g: [80, 18], d: ['Michael Mann'] })
    expect(filmFacetsFrom(SHORT)).toEqual({ y: 2010, g: [16], sh: 1 })
    expect(filmFacetsFrom({ title: 'Placeholder' })).toEqual({})
  })
})

describe('the publisher sends them in the ratings map', () => {
  it('adds y/g/d to every shared film', () => {
    const entry = { dbKey: 'k', movie: { ...HEAT, poster_path: '/h.jpg' }, ratings: [{ date: at(2020), calculatedTotal: 9 }] }
    const profile = buildSocialProfile([entry], () => ({ calculatedTotal: 9 }), { name: 'Matt', shareRatings: true })
    expect(profile.ratings[949]).toMatchObject({ y: 1995, g: [80, 18], d: ['Michael Mann'] })
    expect(profile.recent[0].g).toBeUndefined()
  })
})

describe('friendLibraryRows', () => {
  const profile = {
    ratings: {
      949: { r: 9.1, t: 'Heat', p: '/h.jpg', at: at(2024), y: 1995, g: [80, 18], d: ['Michael Mann'], v: [{ at: at(2024) }, { at: at(2019) }] },
      603: { r: 8, t: 'The Matrix', at: at(2023) },
      5: { r: 6, t: 'Tiny', at: at(2023), y: 2010, g: [16], sh: 1 }
    }
  }
  const myLibrary = [{ movie: { id: 603, release_date: '1999-03-31', genres: [{ id: 878 }], crew: [{ job: 'Director', name: 'Lana Wachowski' }, { job: 'Director', name: 'Lilly Wachowski' }] } }]

  it("names genres, and fills an old copy's gaps from my own library", () => {
    const rows = friendLibraryRows(profile, myLibrary)
    const matrix = rows.find((row) => row.id === 603)
    expect(matrix).toMatchObject({ year: 1999, decade: 1990, genres: ['Science Fiction'], directors: ['Lana Wachowski', 'Lilly Wachowski'] })
    expect(rows.find((row) => row.id === 949)).toMatchObject({ genres: ['Crime', 'Drama'], watchedYears: [2024, 2019] })
  })

  it('without my copy, a film just has no facts rather than wrong ones', () => {
    const matrix = friendLibraryRows(profile, []).find((row) => row.id === 603)
    expect(matrix).toMatchObject({ year: null, decade: null, genres: [], directors: [] })
  })

  it('is empty for a friend who shares no ratings map', () => {
    expect(friendLibraryRows({ topShelf: [] }, myLibrary)).toEqual([])
  })

  const rows = friendLibraryRows(profile, myLibrary)

  it('hides shorts unless they are included', () => {
    expect(filterFriendLibrary(rows).map((row) => row.id)).toEqual([949, 603])
    expect(filterFriendLibrary(rows, { includeShorts: true })).toHaveLength(3)
  })

  it('every chip must match; watched-in uses any viewing', () => {
    expect(filterFriendLibrary(rows, { chips: [{ facet: 'decade', value: 1990 }] }).map((r) => r.id)).toEqual([949, 603])
    expect(filterFriendLibrary(rows, { chips: [{ facet: 'decade', value: 1990 }, { facet: 'genre', value: 'Crime' }] }).map((r) => r.id)).toEqual([949])
    expect(filterFriendLibrary(rows, { chips: [{ facet: 'watched', value: 2019 }] }).map((r) => r.id)).toEqual([949])
  })

  it('searches title, year, genre and director, accent- and case-blind', () => {
    expect(filterFriendLibrary(rows, { query: 'mann' }).map((r) => r.id)).toEqual([949])
    expect(filterFriendLibrary(rows, { query: '1999' }).map((r) => r.id)).toEqual([603])
    expect(filterFriendLibrary(rows, { query: 'science fiction' }).map((r) => r.id)).toEqual([603])
  })

  it('sorts by score, recency, release year or title without touching the input', () => {
    const before = rows.map((r) => r.id)
    expect(filterFriendLibrary(rows, { sort: 'released' }).map((r) => r.id)).toEqual([603, 949])
    expect(filterFriendLibrary(rows, { sort: 'title', includeShorts: true }).map((r) => r.title)).toEqual(['Heat', 'The Matrix', 'Tiny'])
    expect(filterFriendLibrary(rows, { sort: 'watched' }).map((r) => r.id)).toEqual([949, 603])
    expect(rows.map((r) => r.id)).toEqual(before)
  })

  it('offers facet values with counts; years newest first, directors only with two films', () => {
    expect(facetOptions(rows, 'year').map((o) => o.value)).toEqual([2010, 1999, 1995])
    expect(facetOptions(rows, 'decade')[0]).toMatchObject({ value: 2010, label: '2010s' })
    expect(facetOptions(rows, 'genre')[0].count).toBe(1)
    expect(facetOptions(rows, 'director')).toEqual([])
  })
})

describe('friends on other apps', () => {
  it('Movie Log records bring their year, genres and directors', () => {
    const profile = fromMovieLog([{ movieId: 949, movie: { title: 'Heat', year: 1995, tmdb: { id: 949, genres: [{ id: 80 }], crew: [{ job: 'Director', name: 'Michael Mann' }] }, viewings: [{ date: '2024-01-01', rating: 9 }] } }])
    expect(profile.ratings[949]).toMatchObject({ y: 1995, g: [80], d: ['Michael Mann'] })
  })

  it('an interchange feed brings its year', () => {
    const profile = fromInterchange({ format: 'film-club/1', name: 'B', movies: [{ tmdbId: 949, title: 'Heat', year: 1995, rating: 9 }] })
    expect(profile.ratings[949].y).toBe(1995)
  })
})

// Size guard (Matt, 2026-11-13: "really careful … that we're not pulling down
// too much data"). Every friend downloads this profile whole after each change
// to the library, so the facts per film are a budget. Measured on his 1,513
// films the same day: 593 KB profile, +72 KB for y/g/d/sh (about 48 bytes a film).
describe('what the library facts cost a profile', () => {
  const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length

  it('stays small for even a heavy film: two directors at most', () => {
    const heavy = {
      release_date: '2010-07-16',
      runtime: 30,
      genres: [878, 28, 12, 53, 9648].map((id) => ({ id })),
      crew: ['Christopher Edward Nolan-Longname', 'Second Very Long Director Name', 'A Third Co-Director'].map((name) => ({ job: 'Director', name }))
    }
    const facets = filmFacetsFrom(heavy)
    expect(facets.d).toHaveLength(2)
    expect(bytes(facets)).toBeLessThanOrEqual(140)
  })

  it('adds no more than about 60 bytes a film across an ordinary library', () => {
    const library = Array.from({ length: 1500 }, (_, i) => ({
      dbKey: `k${i}`,
      movie: { id: 10000 + i, title: `Film number ${i}`, poster_path: '/abcdefghijklmnopqrstuvwxyz1.jpg', release_date: '1995-06-15', runtime: 110, genres: [{ id: 18 }, { id: 80 }], crew: [{ job: 'Director', name: 'Michael Mann' }] },
      ratings: [{ date: Date.UTC(2024, 5, 15), love: 8 }]
    }))
    const rating = () => ({ calculatedTotal: 8, normalized: 0.8 })
    const profile = buildSocialProfile(library, rating, { name: 'M', shareRatings: true })
    const bare = (row) => { const copy = { ...row }; ['y', 'g', 'd', 'sh'].forEach((key) => delete copy[key]); return copy }
    const without = { ...profile, ratings: Object.fromEntries(Object.entries(profile.ratings).map(([id, row]) => [id, bare(row)])) }
    const perFilm = (bytes(profile) - bytes(without)) / library.length
    expect(perFilm).toBeGreaterThan(0)
    expect(perFilm).toBeLessThanOrEqual(60)
  })
})

// Report, 2026-11-13: "I'm only seeing movies on Matt's list that I have also
// seen." Matt's profile predated the facts, so only films in the READER's
// library had a year or genre, and every chip kept just those.
describe('films a chip could not place', () => {
  const profile = {
    ratings: {
      1: { r: 9, t: 'Seen By Both', at: at(2024) },
      2: { r: 8, t: 'Only Theirs', at: at(2024) },
      3: { r: 7, t: 'Only Theirs Too', at: at(2023) },
      4: { r: 6, t: 'Theirs With Facts', at: at(2023), y: 1975, g: [18] }
    }
  }
  const mine = [{ movie: { id: 1, release_date: '1994-06-15', genres: [{ id: 18 }] } }]
  const rows = friendLibraryRows(profile, mine)

  it('are counted, not silently dropped', () => {
    const chips = [{ facet: 'genre', value: 'Drama' }]
    expect(filterFriendLibrary(rows, { chips }).map((r) => r.id).sort()).toEqual([1, 4])
    expect(filmsWithUnknownFacts(rows, { chips })).toBe(2)
  })

  it('leave out films whose known facts rule them out, and need a chip at all', () => {
    expect(filmsWithUnknownFacts(rows, { chips: [{ facet: 'decade', value: 1990 }, { facet: 'genre', value: 'Comedy' }] })).toBe(2)
    expect(filmsWithUnknownFacts(rows, { chips: [{ facet: 'decade', value: 1970 }, { facet: 'genre', value: 'Comedy' }] })).toBe(2)
    expect(filmsWithUnknownFacts(rows, { chips: [{ facet: 'decade', value: 1970 }, { facet: 'genre', value: 'Drama' }] })).toBe(2)
    expect(filmsWithUnknownFacts(rows, { chips: [] })).toBe(0)
    expect(filmsWithUnknownFacts(rows, { chips: [{ facet: 'genre', value: 'Drama' }], query: 'too' })).toBe(1)
  })
})
