import { describe, it, expect, vi } from 'vitest'
import { memoByIdentity } from '@/utils/memoByIdentity.js'
import { countDirectors, countGenres } from '@/assets/javascript/entityCounts.js'
import { countryForPoint } from '@/assets/javascript/countryLookup.js'
import { warmCountryLookup, countryCoverage } from '@/assets/javascript/places.js'

// Speed sweep, 2026-09-23: the library-derived tables are pure in their
// (cached getter) inputs, so "same objects in" must mean "no work".
describe('memoByIdentity', () => {
  it('recomputes only when an argument changes identity', () => {
    const fn = vi.fn((a, b) => ({ a, b }))
    const memo = memoByIdentity(fn)
    const a = [1]; const b = { x: 1 }
    const first = memo(a, b)
    expect(memo(a, b)).toBe(first)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(memo([1], b)).not.toBe(first) // equal by value, different object
    expect(fn).toHaveBeenCalledTimes(2)
    expect(memo(a, b, true)).not.toBe(first) // arity change
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('entityCounts caching', () => {
  const entries = [
    { movie: { runtime: 100, genres: [{ name: 'Drama' }], crew: [{ job: 'Director', name: 'Ann Lee' }] } },
    { movie: { runtime: 30, genres: [{ name: 'Short' }], crew: [{ job: 'Director', name: 'Bo Kim' }] } }
  ]
  it('hands back the same table for the same library and flag', () => {
    expect(countDirectors(entries, true)).toBe(countDirectors(entries, true))
    expect(countGenres(entries, false)).toBe(countGenres(entries, false))
  })
  it('still answers differently for a different flag or library', () => {
    expect(countDirectors(entries, true)).not.toBe(countDirectors(entries, false))
    expect(Object.keys(countDirectors(entries, false))).toEqual(['Ann Lee'])
    expect(countDirectors([...entries], true)).toEqual(countDirectors(entries, true))
  })
})

// A 100x100 world with one square country and one point cache per world.
const world = { width: 100, height: 100, countries: [{ iso: 'SQ', name: 'Square', rings: [[10, 10, 40, 10, 40, 40, 10, 40]] }] }

describe('country lookup cache + warm-up', () => {
  it('resolves each point once per page and reuses it', () => {
    const w = { ...world }
    const a = countryForPoint(45, -90, w) // x=25,y=25 -> inside the square
    expect(a?.iso).toBe('SQ')
    expect(countryForPoint(45, -90, w)).toBe(a)
    expect(countryForPoint(-80, 170, w)).toBeNull()
  })

  it('warmCountryLookup resolves the library\'s places in slices and the coverage then finds them cached', () => {
    const w = { ...world }
    const entries = Array.from({ length: 5 }, (_, i) => ({
      dbKey: `k${i}`,
      movie: { id: i + 1, runtime: 100, locations: [{ name: `P${i}`, type: 'filming', lat: 45, lon: -90 + i * 0.5 }] }
    }))
    const queue = []
    const cancel = warmCountryLookup(entries, w, { sliceMs: 1000, schedule: (fn) => queue.push(fn) })
    expect(queue.length).toBe(1)
    queue.shift()()
    expect(queue.length).toBe(0) // one generous slice did all five
    cancel()
    const coverage = countryCoverage(entries, w, { type: 'all', includeShorts: true })
    expect(coverage.counts.SQ).toBe(5)
    // Same inputs, same object - the Places tab re-render costs nothing.
    expect(countryCoverage(entries, w, { type: 'all', includeShorts: true })).toBe(coverage)
  })
})
