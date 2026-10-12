import { describe, it, expect } from 'vitest'
import {
  buildWatchNumbers,
  watchNumberOf,
  viewingNumbered,
  parseWatchNumberQuery,
  ordinalSuffix,
  viewingTime
} from '@/assets/javascript/watchNumbers.js'
import { applyFilter } from '@/assets/javascript/searchFiltering.js'
import Home from '@/components/Home.vue'

const day = (iso) => new Date(`${iso}T20:00:00`).getTime()

const entry = (dbKey, dates, extra = {}) => ({
  dbKey,
  movie: { id: dbKey, title: dbKey, runtime: 100, ...extra },
  ratings: dates.map((date) => ({ date }))
})

describe('buildWatchNumbers', () => {
  const library = [
    entry('heat', [day('2024-03-01'), day('2025-01-10')]), // a rewatch
    entry('alien', [day('2023-05-05')]),
    entry('short', [day('2024-06-01')], { runtime: 12 }), // a short still counts
    entry('undated', [undefined]),
    entry('mixed', [null, String(day('2024-02-01'))]) // undated + a string date
  ]
  const index = buildWatchNumbers(library)

  it('numbers every dated viewing oldest first, rewatches included', () => {
    expect(index.ordered.map((v) => `${v.dbKey}:${v.index}`)).toEqual([
      'alien:0', 'mixed:1', 'heat:0', 'short:0', 'heat:1'
    ])
    expect(index.ordered.map((v) => v.number)).toEqual([1, 2, 3, 4, 5])
  })

  it('labels each rating by its row in the entry', () => {
    expect(watchNumberOf(index, 'heat', 0)).toBe(3)
    expect(watchNumberOf(index, 'heat', 1)).toBe(5)
    expect(watchNumberOf(index, 'short', 0)).toBe(4)
  })

  it('gives undated viewings no number', () => {
    expect(watchNumberOf(index, 'undated', 0)).toBeNull()
    expect(watchNumberOf(index, 'mixed', 0)).toBeNull()
  })

  it('looks a viewing up by number, and nothing past the last one', () => {
    expect(viewingNumbered(index, 1).dbKey).toBe('alien')
    expect(viewingNumbered(index, 5).dbKey).toBe('heat')
    expect(viewingNumbered(index, 6)).toBeNull()
    expect(viewingNumbered(index, 0)).toBeNull()
  })

  it('keeps logged order for viewings on the same instant', () => {
    const at = day('2024-01-01')
    const tie = buildWatchNumbers([entry('b', [at]), entry('a', [at])])
    expect(tie.ordered.map((v) => v.dbKey)).toEqual(['b', 'a'])
  })

  it('reads number, numeric-string and date-string dates', () => {
    expect(viewingTime({ date: 5 })).toBe(5)
    expect(viewingTime({ date: '1700000000000' })).toBe(1700000000000)
    expect(viewingTime({ date: '2024-03-01' })).toBe(Date.parse('2024-03-01'))
    expect(viewingTime({ date: 'nonsense' })).toBeNull()
    expect(viewingTime({})).toBeNull()
  })
})

describe('parseWatchNumberQuery', () => {
  it.each([
    ['#812', 812], ['# 812', 812], ['812th', 812], ['812TH watch', 812],
    ['1st', 1], ['22nd', 22], ['3rd viewing', 3], ['watch 812', 812],
    ['Watch #812', 812], ['watch number 9', 9], ['#1999', 1999]
  ])('%s is watch %i', (text, number) => {
    expect(parseWatchNumberQuery(text)).toBe(number)
  })

  it.each(['1999', '812', 'heat', '8 1/2', '21st century', '#0', '', null])(
    '%s is not a watch number', (text) => {
      expect(parseWatchNumberQuery(text)).toBeNull()
    })
})

describe('ordinalSuffix', () => {
  it('handles the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 112, 812].map(ordinalSuffix))
      .toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '112th', '812th'])
  })
})

describe('the watchNumber filter', () => {
  const heat = entry('heat', [day('2024-03-01')])
  const alien = entry('alien', [day('2023-05-05')])

  it('matches only the film it was resolved to', () => {
    const filter = { type: 'watchNumber', value: 2, dbKey: 'heat' }
    expect(applyFilter(heat, filter)).toBe(true)
    expect(applyFilter(alien, filter)).toBe(false)
  })

  it('matches nothing when the number is past your last watch', () => {
    expect(applyFilter(heat, { type: 'watchNumber', value: 99, dbKey: null })).toBe(false)
  })
})

describe('Home typed search', () => {
  const detect = (text) => Home.methods.detectFilterType.call(
    { detectYearTypes: Home.methods.detectYearTypes }, text)

  it('reads "#812" and "812th" as a watch number', () => {
    expect(detect('#812')).toEqual({ type: 'watchNumber', value: 812, display: '812th watch' })
    expect(detect('812th')).toMatchObject({ type: 'watchNumber', value: 812 })
    expect(detect('watch 812')).toMatchObject({ type: 'watchNumber', value: 812 })
  })

  it('keeps a bare year a year', () => {
    expect(detect('1999')).toMatchObject({ type: 'year', value: '1999' })
  })

  it('resolves a typed watch number to its film', () => {
    const library = [entry('heat', [day('2024-03-01')]), entry('alien', [day('2023-05-05')])]
    const context = {
      searchValue: '#2',
      activeFilters: [],
      watchNumberIndex: buildWatchNumbers(library)
    }
    const filters = Home.computed.allActiveFilters.call(context)
    expect(filters).toHaveLength(1)
    expect(filters[0]).toMatchObject({ type: 'watchNumber', value: 2, dbKey: 'heat' })
  })
})
