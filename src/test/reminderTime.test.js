import { describe, it, expect } from 'vitest';
import { reminderTimeFor, showingEpoch } from '../utils/reminderTime.js';

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const HOUR = 60 * 60 * 1000;

describe('reminderTimeFor', () => {
  it('a week before when the showing is more than a week off', () => {
    const now = local(2026, 9, 28, 21);
    expect(reminderTimeFor('2026-10-31T19:00:00', now)).toEqual({ remindAt: local(2026, 10, 24, 19), label: 'a week before' });
  });

  it('the day before when already inside a week', () => {
    const now = local(2026, 9, 28, 21);
    expect(reminderTimeFor('2026-10-02T19:00:00', now)).toEqual({ remindAt: local(2026, 10, 1, 19), label: 'the day before' });
  });

  it('three hours before when already inside a day, and nothing once that has passed on its last day', () => {
    const now = local(2026, 10, 2, 9);
    expect(reminderTimeFor('2026-10-02T19:00:00', now)).toEqual({ remindAt: local(2026, 10, 2, 16), label: 'three hours before' });
    expect(reminderTimeFor('2026-10-02T19:00:00', local(2026, 10, 2, 17), { lastShowTime: '2026-10-02T19:00:00' })).toBeNull();
  });

  it('a bare date means noon that day; no date at all means a week\'s snooze from now', () => {
    expect(showingEpoch('2026-10-26')).toBe(local(2026, 10, 26, 12));
    expect(reminderTimeFor('2026-10-26', local(2026, 10, 1))).toEqual({ remindAt: local(2026, 10, 19, 12), label: 'a week before' });
    expect(reminderTimeFor(null, local(2026, 10, 1))).toEqual({ remindAt: local(2026, 10, 8), label: 'in a week' });
    expect(reminderTimeFor('soon', local(2026, 10, 1)).label).toBe('in a week');
    expect(showingEpoch('soon')).toBeNull();
  });

  it('an exact-boundary showing steps down a rung rather than firing now', () => {
    const now = local(2026, 10, 24, 19);
    expect(reminderTimeFor('2026-10-31T19:00:00', now).label).toBe('the day before');
    expect(reminderTimeFor('2026-10-31T19:00:00', now - HOUR).label).toBe('a week before');
  });

  // 2026-10-23 report: a film whose first showing was that day couldn't be
  // swiped at all, though it played on for days. Hold it for the last one.
  describe('last chance', () => {
    const today = local(2026, 10, 23, 10);

    it('a first showing today with later days aims two days before the last showing', () => {
      expect(reminderTimeFor('2026-10-23T19:00:00', today, { lastShowTime: '2026-10-29T21:00:00' }))
        .toEqual({ remindAt: local(2026, 10, 27, 21), label: 'two days before its last showing', lastChance: true });
    });

    it('steps to the day before when two days before has passed', () => {
      expect(reminderTimeFor('2026-10-23T19:00:00', today, { lastShowTime: '2026-10-24T21:00:00' }))
        .toEqual({ remindAt: local(2026, 10, 23, 21), label: 'the day before its last showing', lastChance: true });
    });

    it('a first showing already gone today still counts, and a bare last date means noon', () => {
      expect(reminderTimeFor('2026-10-23T09:00:00', today, { lastShowTime: '2026-10-26' }))
        .toEqual({ remindAt: local(2026, 10, 24, 12), label: 'two days before its last showing', lastChance: true });
    });

    it('falls back to the usual rungs when the last showing is today, unknown, or too close', () => {
      expect(reminderTimeFor('2026-10-23T19:00:00', today, { lastShowTime: '2026-10-23T22:00:00' }).label).toBe('three hours before');
      expect(reminderTimeFor('2026-10-23T19:00:00', today).label).toBe('three hours before');
      expect(reminderTimeFor('2026-10-23T19:00:00', local(2026, 10, 23, 17), { lastShowTime: '2026-10-24T09:00:00' })).toBeNull();
    });

    // 2026-10-23 report: Everest at the Smithsonian IMAX couldn't be swiped in
    // the evening. CinemaClock lists one day, so the run's end is unknown -
    // that is a week's snooze, not a refusal.
    it('a showing too close with no known last showing snoozes a week', () => {
      const evening = local(2026, 10, 23, 20);
      expect(reminderTimeFor('2026-10-23T11:00:00', evening))
        .toEqual({ remindAt: local(2026, 10, 30, 20), label: 'in a week', snooze: true });
    });

    it('still refuses when the known last showing is today and has passed every rung', () => {
      expect(reminderTimeFor('2026-10-23T11:00:00', local(2026, 10, 23, 20), { lastShowTime: '2026-10-23T21:00:00' })).toBeNull();
    });

    it('a first showing on a later day keeps aiming at the first showing', () => {
      expect(reminderTimeFor('2026-10-25T19:00:00', today, { lastShowTime: '2026-11-05T19:00:00' }))
        .toEqual({ remindAt: local(2026, 10, 24, 19), label: 'the day before' });
    });
  });
});
