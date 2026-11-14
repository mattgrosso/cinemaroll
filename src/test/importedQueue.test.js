import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  importedViewings, nextImportedViewing, importRemindersOn, importedNoticeSignature, importedNoticeText
} from '@/assets/javascript/importedQueue.js'
import { CHORE_NOTICES, NOTICE_ORDER } from '@/assets/javascript/homeNotices.js'
import { queueImportedRating } from '@/utils/rateImported.js'

// Rate properly (2026-11-14): Home serves the films a Letterboxd import scored
// at their stars, one at a time. Matt: "there should be a way that if somebody
// doesn't wanna deal with it, they don't have to be bothered, so definitely
// don't make it a badge icon".

const imported = (stars, date, extra = {}) => ({
  overall: stars * 2, date, importedFrom: 'letterboxd',
  ...(stars == null ? { letterboxdUnrated: true } : { letterboxdStars: stars }), ...extra
})
const real = (date) => ({ overall: 8, date })

const library = () => ({
  a: { movie: { id: 1, title: 'A' }, ratings: [imported(3, 100)] },
  b: { movie: { id: 2, title: 'B' }, ratings: [imported(4.5, 50)] },
  c: { movie: { id: 3, title: 'C' }, ratings: [imported(4.5, 300)] },
  d: { movie: { id: 4, title: 'D' }, ratings: [imported(null, 900)] },
  e: { movie: { id: 5, title: 'E' }, ratings: [real(10)] },
  // Rated properly once, then a later imported viewing: still waiting.
  f: { movie: { id: 6, title: 'F' }, ratings: [real(10), imported(2, 20)] }
})

describe('the imported queue', () => {
  it('serves best-loved first, then most recent, unrated last', () => {
    expect(importedViewings(library()).map((row) => row.dbKey)).toEqual(['c', 'b', 'a', 'f', 'd'])
  })

  it('points at the viewing still marked, one row per film', () => {
    const rows = importedViewings(library())
    expect(rows.find((row) => row.dbKey === 'f').index).toBe(1)
    expect(rows.filter((row) => row.dbKey === 'f')).toHaveLength(1)
  })

  it('leaves out films rated properly', () => {
    expect(importedViewings(library()).some((row) => row.dbKey === 'e')).toBe(false)
    expect(nextImportedViewing({ e: library().e })).toBeNull()
  })

  it('is on unless switched off', () => {
    expect(importRemindersOn({})).toBe(true)
    expect(importRemindersOn(undefined)).toBe(true)
    expect(importRemindersOn({ importedReminders: false })).toBe(false)
  })

  it('is due only with films left and reminders on', () => {
    expect(importedNoticeSignature(5, {})).toBe(5)
    expect(importedNoticeSignature(0, {})).toBeNull()
    expect(importedNoticeSignature(5, { importedReminders: false })).toBeNull()
  })

  it('words the count', () => {
    expect(importedNoticeText(1)).toBe('1 film still carries only its Letterboxd stars.')
    expect(importedNoticeText(1312)).toBe('1,312 films still carry only their Letterboxd stars.')
  })
})

describe('never a badge or a push', () => {
  it('is a notice but not a chore, so the badge and the push digest never count it', () => {
    expect(NOTICE_ORDER).toContain('importedRatings')
    expect(CHORE_NOTICES).not.toContain('importedRatings')
    for (const file of ['src/assets/javascript/appBadge.js', 'src/assets/javascript/pushDigest.js', 'aws-lambda/pushCadence.js']) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/importedFrom|importedQueue|importedRatings/)
    }
  })
})

describe('opening the next one', () => {
  it('marks the edit as from the queue', () => {
    const commit = vi.fn()
    const store = { state: { movieLog: library() }, commit }
    expect(queueImportedRating(store, { dbKey: 'c', index: 0 })).toBe(true)
    expect(commit).toHaveBeenCalledWith('setMovieToRate', expect.objectContaining({ id: 3, title: 'C' }))
    expect(commit).toHaveBeenLastCalledWith('setRatingToEdit', { dbKey: 'c', index: 0, fromQueue: true })
  })

  it('does nothing for a film that has gone', () => {
    const commit = vi.fn()
    expect(queueImportedRating({ state: { movieLog: {} }, commit }, { dbKey: 'x', index: 0 })).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('Home and Settings wiring', () => {
  const home = readFileSync('src/components/Home.vue', 'utf8')
  it('has the card with Stop asking, and the Settings switch', () => {
    expect(home).toMatch(/currentNotice === 'importedRatings'/)
    expect(home).toMatch(/@click\.stop="stopImportedReminders"/)
    expect(home).toMatch(/Remind me about imported films/)
  })
})
