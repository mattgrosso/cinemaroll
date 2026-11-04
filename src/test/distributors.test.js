import { describe, it, expect } from 'vitest'
import { isJanusFilm, distributorsFor, studioNamesFor, titleKey, JANUS_FILMS } from '@/assets/javascript/distributors.js'
import { buildSearchFields, applyFilter } from '@/assets/javascript/searchFiltering.js'
import { countStudios } from '@/assets/javascript/entityCounts.js'
import { buildCatalog } from '@/assets/javascript/catalog.js'

// Who released a film, from Janus Films' own catalogue (report 2026-11-03:
// searching "Janus" found none of the Janus films; TMDB names makers only).
// These use the REAL bundled list, so a refresh that broke parsing fails here.

const film = (overrides = {}) => ({
  id: 1,
  title: 'Seven Samurai',
  release_date: '1954-04-26',
  crew: [{ name: 'Akira Kurosawa', job: 'Director' }],
  production_companies: [{ id: 882, name: 'Toho' }],
  ...overrides
})

const entry = (movie) => ({ movie, ratings: [{ calculatedTotal: 8 }], dbKey: `k${movie.id}` })

describe('isJanusFilm', () => {
  it('knows the films Janus releases, by title and year', () => {
    expect(isJanusFilm(film())).toBe(true)
    expect(isJanusFilm(film({ title: 'The Seventh Seal', release_date: '1957-02-16', crew: [] }))).toBe(true)
  })

  it('forgives a year either way (festival vs release)', () => {
    expect(isJanusFilm(film({ release_date: '1955-01-15', crew: [] }))).toBe(true)
  })

  it('falls back to the director when the year is off (a re-release date)', () => {
    expect(isJanusFilm(film({ release_date: '1990-06-15' }))).toBe(true)
  })

  it('rejects a same-titled film from another decade by someone else', () => {
    expect(isJanusFilm(film({ release_date: '2004-06-15', crew: [{ name: 'Someone Else', job: 'Director' }] }))).toBe(false)
  })

  it('rejects films Janus never released', () => {
    expect(isJanusFilm(film({ title: 'Jurassic Park', release_date: '1993-06-11', crew: [{ name: 'Steven Spielberg', job: 'Director' }] }))).toBe(false)
  })

  it('reads the original title too', () => {
    expect(isJanusFilm(film({ title: 'The Seven Samurai Remastered', original_title: 'Seven Samurai' }))).toBe(true)
  })

  it('ignores a leading article and punctuation', () => {
    expect(titleKey('The Seventh Seal')).toBe(titleKey('Seventh Seal'))
    expect(titleKey('Paris, Texas')).toBe('paristexas')
  })

  it('survives a film with no title', () => {
    expect(isJanusFilm({})).toBe(false)
    expect(distributorsFor(null)).toEqual([])
  })
})

describe('distributorsFor / studioNamesFor', () => {
  it('adds Janus after the makers', () => {
    expect(distributorsFor(film())).toEqual([JANUS_FILMS])
    expect(studioNamesFor(film())).toEqual(['Toho', JANUS_FILMS])
  })

  it('never lists Janus twice when TMDB already names it', () => {
    const named = film({ production_companies: [{ name: 'Janus Films' }] })
    expect(distributorsFor(named)).toEqual([])
    expect(studioNamesFor(named)).toEqual(['Janus Films'])
  })
})

describe('the shared search matchers see releasers as studios', () => {
  const samurai = entry(film())
  const jaws = entry(film({ id: 2, title: 'Jaws', release_date: '1975-06-20', crew: [{ name: 'Steven Spielberg', job: 'Director' }], production_companies: [{ name: 'Universal Pictures' }] }))

  it('buildSearchFields puts Janus in companies', () => {
    expect(buildSearchFields(samurai.movie, samurai.ratings).companies).toEqual(['toho', 'janus films'])
  })

  it('a plain search for "janus" matches, a studio chip for Janus Films matches', () => {
    expect(applyFilter(samurai, { type: 'general', value: 'janus' })).toBe(true)
    expect(applyFilter(samurai, { type: 'company', value: 'Janus Films' })).toBe(true)
    expect(applyFilter(jaws, { type: 'general', value: 'janus' })).toBe(false)
    expect(applyFilter(jaws, { type: 'company', value: 'Janus Films' })).toBe(false)
  })

  it('counts and the typeahead catalog know Janus Films', () => {
    expect(countStudios([samurai, jaws], true)['Janus Films']).toBe(1)
    const row = buildCatalog([samurai, jaws], true).entries.find((e) => e.kind === 'company' && e.name === 'Janus Films')
    expect(row?.count).toBe(1)
  })
})
