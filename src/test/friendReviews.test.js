import { describe, it, expect } from 'vitest'
import { normalizeLetterboxdUsername, friendReviewsFor, clubLinesFor, friendLetterboxdStatus } from '@/assets/javascript/friendReviews.js'
import { normalizeLetterboxdUsername as lambdaNormalize } from '../../aws-lambda/letterboxdSync.js'

// Friends' written Letterboxd reviews (2026-11-17).

describe('normalizeLetterboxdUsername', () => {
  const cases = [
    ['benfilms', 'benfilms'],
    ['  BenFilms ', 'benfilms'],
    ['@ben_films', 'ben_films'],
    ['https://letterboxd.com/BenFilms/', 'benfilms'],
    ['letterboxd.com/benfilms/film/heat/', 'benfilms'],
    ['ben films', null],
    ['', null],
    [null, null]
  ]
  it('takes a name, an @name or a profile link', () => {
    for (const [input, out] of cases) expect(normalizeLetterboxdUsername(input)).toBe(out)
  })
  it('agrees with the Lambda copy', () => {
    for (const [input] of cases) expect(lambdaNormalize(input)).toBe(normalizeLetterboxdUsername(input))
  })
})

const node = {
  ben: {
    username: 'benfilms',
    source: 'account',
    reviews: {
      42: {
        a: { review: 'First time.', watchedDate: '2024-01-02' },
        b: { review: 'Better again.', watchedDate: '2026-05-06', rewatch: true },
        c: { review: '   ' }
      },
      7: { d: { review: 'Other film.' } }
    }
  }
}

describe('friendReviewsFor', () => {
  it('returns the reviews with words for one film, newest first, with a string or number id', () => {
    expect(friendReviewsFor(node, 'ben', 42).map((r) => r.id)).toEqual(['b', 'a'])
    expect(friendReviewsFor(node, 'ben', '42')[0]).toMatchObject({ review: 'Better again.', rewatch: true, spoilers: false })
    expect(friendReviewsFor(node, 'ada', 42)).toEqual([])
    expect(friendReviewsFor(null, 'ben', 42)).toEqual([])
  })
})

describe('clubLinesFor', () => {
  const friends = [
    { key: 'ben', name: 'Ben', profile: { ratings: {} } },
    { key: 'ada', name: 'Ada', profile: { ratings: { 42: { r: 8, s: 4 } } } },
    { key: 'cy', name: 'Cy', profile: { ratings: {} } }
  ]
  it('rated friends first with their reviews, then reviewers with no rating; nobody else', () => {
    const lines = clubLinesFor(friends, node, 42)
    expect(lines.map((l) => l.key)).toEqual(['ada', 'ben'])
    expect(lines[0]).toMatchObject({ stars: 4, reviews: [] })
    expect(lines[1]).toMatchObject({ score: null, stars: null })
    expect(lines[1].reviews).toHaveLength(2)
  })
  it('is just the rated friends when there are no reviews loaded', () => {
    expect(clubLinesFor(friends, null, 42).map((l) => l.key)).toEqual(['ada'])
  })
})

describe('friendLetterboxdStatus', () => {
  it('counts the reviews and says where the name came from', () => {
    expect(friendLetterboxdStatus(node, 'ben')).toMatchObject({ username: 'benfilms', source: 'account', count: 4, error: null })
    expect(friendLetterboxdStatus(node, 'ada')).toBe(null)
  })
})
