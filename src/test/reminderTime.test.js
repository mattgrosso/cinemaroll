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

  it('three hours before when already inside a day, and nothing once that has passed', () => {
    const now = local(2026, 10, 2, 9);
    expect(reminderTimeFor('2026-10-02T19:00:00', now)).toEqual({ remindAt: local(2026, 10, 2, 16), label: 'three hours before' });
    expect(reminderTimeFor('2026-10-02T19:00:00', local(2026, 10, 2, 17))).toBeNull();
  });

  it('a bare date means noon that day; no date means no reminder', () => {
    expect(showingEpoch('2026-10-26')).toBe(local(2026, 10, 26, 12));
    expect(reminderTimeFor('2026-10-26', local(2026, 10, 1))).toEqual({ remindAt: local(2026, 10, 19, 12), label: 'a week before' });
    expect(reminderTimeFor(null, local(2026, 10, 1))).toBeNull();
    expect(showingEpoch('soon')).toBeNull();
  });

  it('an exact-boundary showing steps down a rung rather than firing now', () => {
    const now = local(2026, 10, 24, 19);
    expect(reminderTimeFor('2026-10-31T19:00:00', now).label).toBe('the day before');
    expect(reminderTimeFor('2026-10-31T19:00:00', now - HOUR).label).toBe('a week before');
  });
});
