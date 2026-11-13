import { describe, it, expect } from 'vitest';
import { setValueAtPath } from '@/utils/statePath.js';

describe('setValueAtPath', () => {
  it('sets a top-level key on an empty object', () => {
    expect(setValueAtPath({}, ['lastTweak'], 123)).toEqual({ lastTweak: 123 });
  });

  it('sets a nested key, creating intermediate objects as needed', () => {
    expect(setValueAtPath({}, ['personalAwards', '2024'], { completed: true }))
      .toEqual({ personalAwards: { 2024: { completed: true } } });
  });

  it('preserves sibling keys at every level along the path', () => {
    const source = { personalAwards: { 2023: { completed: true } }, otherKey: 'untouched' };
    const result = setValueAtPath(source, ['personalAwards', '2024'], { completed: false });

    expect(result.personalAwards[2024]).toEqual({ completed: false });
    expect(result.personalAwards[2023]).toEqual({ completed: true });
    expect(result.otherKey).toBe('untouched');
  });

  it('overwrites an existing value at the given path', () => {
    const result = setValueAtPath({ lastTweak: 1 }, ['lastTweak'], 2);
    expect(result.lastTweak).toBe(2);
  });

  it('does not mutate the original object (or its nested objects)', () => {
    const original = { personalAwards: { 2023: { completed: true } } };
    const frozenNested = original.personalAwards;
    setValueAtPath(original, ['personalAwards', '2024'], { completed: false });

    expect(original.personalAwards).toBe(frozenNested);
    expect(original.personalAwards[2024]).toBeUndefined();
  });

  it('treats a null/non-object base as empty rather than throwing', () => {
    expect(setValueAtPath(null, ['a'], 1)).toEqual({ a: 1 });
    expect(setValueAtPath(undefined, ['a', 'b'], 1)).toEqual({ a: { b: 1 } });
  });

  it('returns the value directly when segments is empty', () => {
    expect(setValueAtPath({ existing: true }, [], 'replacement')).toBe('replacement');
  });

  // Sentry 2026-11-13: deleting a film's only viewing wrote null at
  // movieLog/<key>; the local copy kept the key holding null, and
  // allMediaAsArray crashed setting dbKey on it. Firebase treats a null
  // write as a delete, so the local copy must too.
  it('removes the key when the value is null, as Firebase does', () => {
    const result = setValueAtPath({ a: 1, b: 2 }, ['a'], null);
    expect(result).toEqual({ b: 2 });
    expect('a' in result).toBe(false);
  });

  it('removes a nested key when the value is null or undefined', () => {
    const source = { log: { x: { ratings: [1] }, y: { ratings: [2] } } };
    expect(setValueAtPath(source, ['log', 'x'], null)).toEqual({ log: { y: { ratings: [2] } } });
    expect(setValueAtPath(source, ['log', 'y'], undefined)).toEqual({ log: { x: { ratings: [1] } } });
  });
});
