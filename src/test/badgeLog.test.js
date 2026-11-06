import { describe, it, expect } from 'vitest';
import { deviceLabel, appendLog, mergeLogs, worthLogging, BADGE_LOG_KEEP } from '../assets/javascript/badgeLog.js';

// Every number put on the icon is written down with its parts (2026-11-06:
// three days of 52s that no arithmetic in the code could reproduce).
describe('the badge log', () => {
  it('names the device: platform, version, and whether it runs as the installed app', () => {
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', standalone: true }, {})).toBe('iPhone 18.7 app');
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X)', standalone: false }, { matchMedia: () => ({ matches: false }) })).toBe('iPhone 18.7 browser');
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605 Version/18.1 Safari/605' }, { matchMedia: () => ({ matches: true }) })).toBe('Mac 18.1 app');
    expect(deviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh) Chrome/142.0' }, {})).toBe('Mac 142 browser');
  });

  it('appends newest last and keeps only the last forty, whether the log arrived as a list or a map', () => {
    const list = Array.from({ length: BADGE_LOG_KEEP }, (_, i) => ({ at: i + 1, count: 0 }));
    const next = appendLog(list, { at: 99, count: 1 });
    expect(next).toHaveLength(BADGE_LOG_KEEP);
    expect(next[0].at).toBe(2);
    expect(next[next.length - 1]).toEqual({ at: 99, count: 1 });
    const map = { 5: { at: 5 }, 3: { at: 3 } };
    expect(appendLog(map, { at: 4 }).map((e) => e.at)).toEqual([3, 4, 5]);
  });

  it('merges the worker\'s received pushes in by time, never twice', () => {
    const log = [{ at: 1, by: 'app' }, { at: 3, by: 'sw' }];
    const merged = mergeLogs(log, [{ at: 3, by: 'sw' }, { at: 2, by: 'sw' }]);
    expect(merged.map((e) => e.at)).toEqual([1, 2, 3]);
  });

  it('writes when the number changes, or half an hour has passed, and not otherwise', () => {
    const t = 1_000_000;
    expect(worthLogging(null, { count: 0 }, t)).toBe(true);
    expect(worthLogging({ at: t, count: 2 }, { count: 3 }, t + 1000)).toBe(true);
    expect(worthLogging({ at: t, count: 2 }, { count: 2 }, t + 1000)).toBe(false);
    expect(worthLogging({ at: t, count: 2 }, { count: 2 }, t + 31 * 60 * 1000)).toBe(true);
  });
});
