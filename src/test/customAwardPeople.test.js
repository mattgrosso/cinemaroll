import { describe, it, expect } from 'vitest'
import { customAwardPool, visibleCustomAwardGroups, foldForSearch, CUSTOM_AWARD_CAST_DEPTH } from '@/assets/javascript/customAwardPeople.js'

// Report 2026-10-31: a person-type custom award offered only each film's top
// ten billed actors, so voice parts like Finding Nemo's Crush (12th) and
// Bruce (16th) could never be nominated.
const nemo = {
  movie: {
    id: 12,
    title: 'Finding Nemo',
    cast: [
      'Albert Brooks', 'Ellen DeGeneres', 'Alexander Gould', 'Willem Dafoe', 'Geoffrey Rush',
      'Brad Garrett', 'Allison Janney', 'Austin Pendleton', 'Stephen Root', 'Vicki Lewis',
      'Joe Ranft', 'Andrew Stanton', 'Elizabeth Perkins', 'Nicholas Bird', 'Bob Peterson', 'Barry Humphries'
    ].map((name, i) => ({ id: i + 1, name, character: i === 11 ? 'Crush (voice)' : `Part ${i}` })),
    crew: [{ id: 99, name: 'Thomas Newman', job: 'Original Music Composer' }]
  }
}
const elf = {
  movie: { id: 10719, title: 'Elf', cast: [{ id: 7, name: 'Zoë Deschanel', character: 'Jovie' }], crew: [] }
}

describe('customAwardPool', () => {
  it('holds every billed actor, with their billing position, and the crew', () => {
    const pool = customAwardPool([nemo])
    expect(pool).toHaveLength(17)
    expect(pool.find((p) => p.name === 'Barry Humphries').castIndex).toBe(15)
    expect(pool.find((p) => p.name === 'Thomas Newman').castIndex).toBeNull()
  })
})

describe('visibleCustomAwardGroups', () => {
  const pool = customAwardPool([nemo, elf])

  it('starts each film at ten billed actors and says there is more', () => {
    const [nemoGroup] = visibleCustomAwardGroups(pool)
    const names = nemoGroup.people.map((p) => p.name)
    expect(CUSTOM_AWARD_CAST_DEPTH).toBe(10)
    expect(names).toContain('Vicki Lewis')
    expect(names).not.toContain('Joe Ranft')
    expect(names).toContain('Thomas Newman')
    expect(nemoGroup.hasMore).toBe(true)
  })

  it('reveals more per film', () => {
    const [nemoGroup, elfGroup] = visibleCustomAwardGroups(pool, { depths: { 12: 20 } })
    expect(nemoGroup.people.map((p) => p.name)).toContain('Barry Humphries')
    expect(nemoGroup.hasMore).toBe(false)
    expect(elfGroup.people).toHaveLength(1)
  })

  it('searches the whole cast by name or character, ignoring case, accents and punctuation', () => {
    expect(visibleCustomAwardGroups(pool, { query: 'humphries' })[0].people.map((p) => p.name)).toEqual(['Barry Humphries'])
    expect(visibleCustomAwardGroups(pool, { query: 'crush' })[0].people.map((p) => p.name)).toEqual(['Andrew Stanton'])
    expect(visibleCustomAwardGroups(pool, { query: 'zoe' }).map((g) => g.movie.title)).toEqual(['Elf'])
    expect(visibleCustomAwardGroups(pool, { query: 'nobody here' })).toEqual([])
  })

  it('keeps a deep-billed nominee on screen after the search is cleared', () => {
    const isNominee = (p) => p.name === 'Barry Humphries'
    const [nemoGroup] = visibleCustomAwardGroups(pool, { isNominee })
    expect(nemoGroup.people.map((p) => p.name)).toContain('Barry Humphries')
  })

  it('folds text for search', () => {
    expect(foldForSearch("O'Neill")).toBe('oneill')
  })
})
