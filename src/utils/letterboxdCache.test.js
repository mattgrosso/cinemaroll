import { describe, it, expect } from 'vitest'
import { letterboxdPlan, FILMS_MAX_AGE_MS } from './letterboxdCache'

const now = 1_800_000_000_000
const copy = { films: { 1: {} }, filmsAt: now - 1000, reviews: { 2: {} }, reviewsAt: now - 1000, reviewsSyncAt: 555 }

describe('letterboxdPlan', () => {
  it('downloads everything the first time', () => {
    expect(letterboxdPlan({ cached: null, syncLastAt: 555, now })).toEqual({ films: true, reviews: true })
  })
  it('downloads nothing when the copy is from today and the sync has not run since', () => {
    expect(letterboxdPlan({ cached: copy, syncLastAt: 555, now })).toEqual({ films: false, reviews: false })
  })
  it('re-reads the diary when the sync has run since', () => {
    expect(letterboxdPlan({ cached: copy, syncLastAt: 777, now })).toEqual({ films: false, reviews: true })
  })
  it('re-reads the crowd ratings once a day', () => {
    expect(letterboxdPlan({ cached: { ...copy, filmsAt: now - FILMS_MAX_AGE_MS }, syncLastAt: 555, now }).films).toBe(true)
  })
  it('re-reads the diary right after the app wrote to it (a CSV import)', () => {
    expect(letterboxdPlan({ cached: copy, syncLastAt: 555, now, reviewsChanged: true }).reviews).toBe(true)
  })
  it('with no stamp to compare, keeps a diary copy for a day', () => {
    expect(letterboxdPlan({ cached: copy, syncLastAt: null, now }).reviews).toBe(false)
    expect(letterboxdPlan({ cached: { ...copy, reviewsAt: now - FILMS_MAX_AGE_MS }, syncLastAt: null, now }).reviews).toBe(true)
  })
})
