import { describe, it, expect } from 'vitest'
import {
  STANDARD_BUCKETS,
  bucketFor,
  ratedAt,
  ratingEvents,
  bucketsFor,
  playbackFrames
} from '@/assets/javascript/ratingCurvePlayback.js'

// Report -P1mlsyZlwk2RTeYxOit (2026-09-18): "I want to hit play and see an
// animation of all of my ratings in the order I rated them being added to the
// graph, eventually arriving at my current curve."
//
// The load-bearing claim is the last clause: the final frame must equal the
// static chart exactly. These tests are mostly about that.

const rating = (date, total) => ({ date, calculatedTotal: total })
const allRatingsFor = (entry) => entry.ratings

describe('bucketFor', () => {
  it('rounds to the half point, like the static chart', () => {
    expect(bucketFor(7.26)).toBe(7.5)
    expect(bucketFor(7.24)).toBe(7)
    expect(bucketFor('8.75')).toBe(9)
  })

  it('answers 0 for a score that isn\'t one', () => {
    expect(bucketFor(undefined)).toBe(0)
    expect(bucketFor('nope')).toBe(0)
  })
})

describe('ratedAt', () => {
  it('reads a date', () => {
    expect(ratedAt({ date: '2020-03-01' })).toBe(new Date('2020-03-01').getTime())
  })

  it('sorts an undated rating to the very beginning, rather than dropping it', () => {
    // Dropping it would make the last frame disagree with the chart it lands on.
    expect(ratedAt({})).toBe(-Infinity)
    expect(ratedAt({ date: 'sometime' })).toBe(-Infinity)
    // `new Date(null)` is the epoch, which would quietly date it 1970.
    expect(ratedAt({ date: null })).toBe(-Infinity)
    expect(ratedAt({ date: '' })).toBe(-Infinity)
  })
})

describe('ratingEvents', () => {
  it('returns every rating, oldest first', () => {
    const entries = [
      { ratings: [rating('2021-01-01', 7), rating('2019-01-01', 4)] },
      { ratings: [rating('2020-01-01', 9)] }
    ]
    expect(ratingEvents(entries, allRatingsFor).map((e) => e.bucket)).toEqual([4, 9, 7])
  })

  it('tags each event with the film it belongs to, so a re-rating can move it', () => {
    const entries = [{ ratings: [rating('2019-01-01', 4), rating('2021-01-01', 7)] }]
    const events = ratingEvents(entries, allRatingsFor)
    expect(events[0].filmId).toBe(events[1].filmId)
  })

  it('skips ratings with no score, exactly as the static chart does', () => {
    const entries = [{ ratings: [{ date: '2020-01-01' }, rating('2020-02-01', 6)] }]
    expect(ratingEvents(entries, allRatingsFor)).toHaveLength(1)
  })

  it('survives an entry with no ratings at all', () => {
    expect(ratingEvents([{ ratings: null }, {}], allRatingsFor)).toEqual([])
    expect(ratingEvents(null, allRatingsFor)).toEqual([])
  })
})

describe('bucketsFor', () => {
  it('always spans the standard axis so the chart does not reshape mid-play', () => {
    expect(bucketsFor([])).toEqual(STANDARD_BUCKETS)
  })

  it('makes room for a score outside it', () => {
    expect(bucketsFor([{ bucket: 0.5 }])[0]).toBe(0.5)
  })
})

describe('playbackFrames', () => {
  it('ends on the current curve: each film counted once, at its latest rating', () => {
    // The whole point. Film A was rated 4 and later re-rated 7; the last
    // frame must show one film at 7 and nothing at 4 — not one at each.
    const entries = [
      { ratings: [rating('2019-01-01', 4), rating('2021-01-01', 7)] },
      { ratings: [rating('2020-01-01', 9)] }
    ]
    const { buckets, frames } = playbackFrames(ratingEvents(entries, allRatingsFor))
    const last = frames[frames.length - 1]

    const countAt = (score) => last.counts[buckets.indexOf(score)]
    expect(countAt(4)).toBe(0)
    expect(countAt(7)).toBe(1)
    expect(countAt(9)).toBe(1)
    expect(last.counts.reduce((sum, n) => sum + n, 0)).toBe(2)
    expect(last.films).toBe(2)
  })

  it('shows the film at its FIRST score partway through', () => {
    const entries = [{ ratings: [rating('2019-01-01', 4), rating('2021-01-01', 7)] }]
    const { buckets, frames } = playbackFrames(ratingEvents(entries, allRatingsFor), { frameCount: 2 })
    expect(frames[0].counts[buckets.indexOf(4)]).toBe(1)
    expect(frames[0].counts[buckets.indexOf(7)]).toBe(0)
  })

  it('never counts a film twice, however often it was re-rated', () => {
    const entries = [{
      ratings: [rating('2018-01-01', 3), rating('2019-01-01', 5), rating('2020-01-01', 8), rating('2021-01-01', 6)]
    }]
    const { frames } = playbackFrames(ratingEvents(entries, allRatingsFor), { frameCount: 4 })
    frames.forEach((frame) => {
      expect(frame.counts.reduce((sum, n) => sum + n, 0)).toBe(1)
    })
  })

  it('never exceeds the frame budget, and never asks for more frames than events', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ ratings: [rating(`2020-01-01`, (i % 10) + 1)] }))
    expect(playbackFrames(ratingEvents(many, allRatingsFor), { frameCount: 60 }).frames).toHaveLength(60)

    const three = Array.from({ length: 3 }, () => ({ ratings: [rating('2020-01-01', 7)] }))
    expect(playbackFrames(ratingEvents(three, allRatingsFor), { frameCount: 60 }).frames).toHaveLength(3)
  })

  it('slices by count of ratings, not by elapsed time', () => {
    // Forty films over one holiday and then a year of nothing must not spend
    // most of the replay watching a finished chart.
    const burst = Array.from({ length: 40 }, () => ({ ratings: [rating('2020-12-25', 8)] }))
    const straggler = { ratings: [rating('2021-12-25', 3)] }
    const { frames } = playbackFrames(ratingEvents([...burst, straggler], allRatingsFor), { frameCount: 4 })
    expect(frames.map((f) => f.ratings)).toEqual([10, 21, 31, 41])
  })

  it('carries the date it has reached, and null while nothing is dated', () => {
    const entries = [{ ratings: [rating(null, 5)] }, { ratings: [rating('2020-06-01', 8)] }]
    const { frames } = playbackFrames(ratingEvents(entries, allRatingsFor), { frameCount: 2 })
    expect(frames[0].at).toBe(null)
    expect(frames[1].at).toBe(new Date('2020-06-01').getTime())
  })

  it('returns one empty frame for an empty library rather than nothing', () => {
    const { frames } = playbackFrames([])
    expect(frames).toHaveLength(1)
    expect(frames[0].films).toBe(0)
  })
})
