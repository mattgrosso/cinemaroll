import { describe, it, expect } from 'vitest'
import { releaseYearShelf, shadeCuts, shadeFor, SHADE_COUNT } from '@/assets/javascript/releaseYearShelf.js'

// The Eras tab's shelf (report, 2026-10-24): one column per release year,
// one block per film, shaded by where it sits among your own ratings.

const rating = (entry) => ({ calculatedTotal: entry.score })
const film = (score, date, title = 'Film') => ({ score, movie: { title, release_date: date } })

describe('releaseYearShelf', () => {
  it('runs from the oldest film to this year, keeping empty years as gaps', () => {
    const shelf = releaseYearShelf([film(8, '1939-12-15'), film(6, '1942-01-01')], rating, { thisYear: 1945 })
    expect(shelf.years.map((y) => y.year)).toEqual([1939, 1940, 1941, 1942, 1943, 1944, 1945])
    expect(shelf.years.map((y) => y.count)).toEqual([1, 0, 0, 1, 0, 0, 0])
    expect(shelf.first).toBe(1939)
    expect(shelf.last).toBe(1945)
  })

  it('stacks each year best first, names its top film and finds the busiest year', () => {
    const shelf = releaseYearShelf([
      film(5, '1994-05-01', 'Meh'), film(9, '1994-06-01', 'Great'), film(7, '1994-07-01', 'Good'),
      film(6, '2000-01-01')
    ], rating, { thisYear: 2000 })
    const y1994 = shelf.years[0]
    expect(y1994.films.map((f) => f.rating)).toEqual([9, 7, 5])
    expect(y1994.top.movie.title).toBe('Great')
    expect(shelf.maxCount).toBe(3)
  })

  it('leaves out films with no release date or no rating', () => {
    const shelf = releaseYearShelf([film(8, '2001-01-01'), film(8, undefined), film(undefined, '1950-01-01')], rating, { thisYear: 2001 })
    expect(shelf.years.map((y) => y.year)).toEqual([2001])
  })

  it('answers an empty shelf for an empty library', () => {
    expect(releaseYearShelf([], rating)).toEqual({ years: [], first: null, last: null, maxCount: 0 })
  })

  it('shades by the library\'s own fifths, lowest to highest', () => {
    const ratings = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const cuts = shadeCuts(ratings)
    expect(cuts).toHaveLength(SHADE_COUNT - 1)
    expect(ratings.map((r) => shadeFor(r, cuts))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})
