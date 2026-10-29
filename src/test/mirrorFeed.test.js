import { describe, it, expect } from 'vitest'
import { buildMirrorFeed } from '@/assets/javascript/mirrorFeed.js'

const NOW = Date.UTC(2026, 7, 16, 12)
const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000

function entry (id, title, rating, watchedDaysAgo) {
  return {
    dbKey: `k${id}`,
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: '2000-06-15' },
    ratings: [{ calculatedTotal: rating, date: daysAgo(watchedDaysAgo) }]
  }
}
const ratingOf = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal })

describe('buildMirrorFeed', () => {
  const library = [
    entry(1, 'Watched Today', 6, 0),
    entry(2, 'Best This Month', 9.5, 5),
    entry(3, 'Good This Month', 8, 20),
    entry(4, 'Great But Old', 10, 200)
  ]

  it('lists recent watches newest-first in the shape the mirror renders', () => {
    const feed = buildMirrorFeed(library, ratingOf, { now: NOW })
    expect(feed.recent[0].movie.title).toBe('Watched Today')
    // The mirror reads entry.movie.poster_path directly.
    expect(feed.recent[0].movie.poster_path).toBe('/1.jpg')
    expect(feed.recent[0].rating).toBe(6)
  })

  it('top-of-month is best-rated within 30 days, excluding older favourites', () => {
    const feed = buildMirrorFeed(library, ratingOf, { now: NOW })
    const titles = feed.topThisMonth.map((row) => row.movie.title)
    expect(titles[0]).toBe('Best This Month')
    expect(titles).toContain('Good This Month')
    expect(titles).not.toContain('Great But Old')  // 200 days ago
  })

  it('publishes every rated TMDB id so the Movie Hat check needs no extra read', () => {
    const feed = buildMirrorFeed(library, ratingOf, { now: NOW })
    expect(feed.ratedIds).toEqual([1, 2, 3, 4])
  })

  it('stays small: no ratings arrays, no cast, no crew, no keywords', () => {
    const fat = [{
      dbKey: 'k9',
      movie: {
        id: 9, title: 'Fat', poster_path: '/9.jpg',
        cast: new Array(50).fill({ name: 'Someone' }),
        crew: new Array(50).fill({ name: 'Someone' }),
        keywords: new Array(30).fill({ name: 'kw' })
      },
      ratings: [{ calculatedTotal: 7, date: daysAgo(1), love: 8, story: 7 }]
    }]
    const serialized = JSON.stringify(buildMirrorFeed(fat, ratingOf, { now: NOW }))
    expect(serialized).not.toContain('cast')
    expect(serialized).not.toContain('crew')
    expect(serialized).not.toContain('keywords')
    expect(serialized).not.toContain('love')   // no criterion breakdown
  })

  it('survives entries with no usable rating date', () => {
    const feed = buildMirrorFeed(
      [{ dbKey: 'k1', movie: { id: 1, title: 'Undated' }, ratings: [{ calculatedTotal: 5 }] }],
      ratingOf,
      { now: NOW }
    )
    expect(feed.recent).toEqual([])
    expect(feed.topThisMonth).toEqual([])
    expect(feed.ratedIds).toEqual([1])   // still counts as rated
  })

  it('an empty library yields an empty but well-formed feed', () => {
    const feed = buildMirrorFeed([], ratingOf, { now: NOW })
    expect(feed).toEqual({ updatedAt: NOW, recent: [], topThisMonth: [], ratedIds: [], board: { count: 0, ratedThisYear: 0, streakDays: 0, films: [] } })
  })
})

describe('the board summary for the Vestaboard', () => {
  it('carries every rated film as title and score, the counts, and the streak', () => {
    const library = [
      entry(1, 'Watched Today', 6, 0),
      entry(2, 'Watched Yesterday', 9.5, 1),
      entry(3, 'Watched Last Month', 8, 40),
      { dbKey: 'k4', movie: { id: 4, title: 'Unrated', poster_path: null }, ratings: [] }
    ]
    const feed = buildMirrorFeed(library, (e) => ({ calculatedTotal: e.ratings[0]?.calculatedTotal }), { now: NOW })
    expect(feed.board.count).toBe(4)
    expect(feed.board.films).toEqual([['Watched Today', 6], ['Watched Yesterday', 9.5], ['Watched Last Month', 8]])
    expect(feed.board.ratedThisYear).toBe(3)
    expect(feed.board.streakDays).toBe(2)
  })
})
