import { describe, it, expect, vi } from 'vitest';
import { handledErrorFilter, normalizeMessage, isConsoleCapture, CONSOLE_BUDGET_PER_LOAD } from '@/utils/sentryHandled.js';

// House module (2026-10-08): console.error reaches Sentry, but budgeted and
// grouped so it cannot spend the shared error quota.
describe('normalizeMessage', () => {
  it('files one message shape under one key whatever the particulars', () => {
    expect(normalizeMessage('Watchlist lookup failed for Tom Hanks')).toBe(normalizeMessage('Watchlist lookup failed for Brad Pitt'));
    expect(normalizeMessage('[film-club] could not sync external friend Brian feed responded 404'))
      .toBe(normalizeMessage('[film-club] could not sync external friend Knox feed responded 500'));
    expect(normalizeMessage('TMDB search/person returned 429')).toBe('TMDB search/person returned #');
    expect(normalizeMessage('GET https://x.y/z?auth=abc failed')).toBe('GET URL failed');
    expect(normalizeMessage('row "The Thing" missing')).toBe('row "…" missing');
  });
});

describe('handledErrorFilter', () => {
  const console1 = () => ({ logger: 'console', message: 'Lookup failed for Tom Hanks', tags: { a: '1' } });
  const crash = () => ({ exception: { values: [{ type: 'TypeError', value: 'x is not a function' }] } });

  it('tags and fingerprints a console capture, then hands it to the scrubber', () => {
    const scrub = vi.fn((e) => e);
    const filter = handledErrorFilter(scrub);
    const sent = filter(console1(), {});
    expect(sent.tags).toEqual({ a: '1', handled: 'console' });
    expect(sent.fingerprint).toEqual(['console', 'Lookup failed for …']);
    expect(scrub).toHaveBeenCalledTimes(1);
  });

  it('sends one event per message shape per page load', () => {
    const filter = handledErrorFilter();
    expect(filter(console1(), {})).not.toBeNull();
    expect(filter({ logger: 'console', message: 'Lookup failed for Brad Pitt' }, {})).toBeNull();
    expect(filter({ logger: 'console', message: 'Something else broke' }, {})).not.toBeNull();
  });

  it('stops after the budget, but never drops a crash', () => {
    const filter = handledErrorFilter(undefined, { budget: 2 });
    expect(filter({ logger: 'console', message: 'one' }, {})).not.toBeNull();
    expect(filter({ logger: 'console', message: 'two' }, {})).not.toBeNull();
    expect(filter({ logger: 'console', message: 'three' }, {})).toBeNull();
    expect(filter(crash(), {})).not.toBeNull();
    expect(CONSOLE_BUDGET_PER_LOAD).toBeGreaterThan(2);
  });

  it('recognises a console capture by its mechanism too (an Error passed to console.error)', () => {
    const event = { exception: { values: [{ type: 'Error', value: 'feed responded 404', mechanism: { type: 'console', handled: false } }] } };
    expect(isConsoleCapture(event)).toBe(true);
    const sent = handledErrorFilter()(event, { originalException: new Error('feed responded 404') });
    expect(sent.fingerprint).toEqual(['console', 'feed responded #']);
  });

  it('leaves an ordinary crash untouched', () => {
    const event = crash();
    const sent = handledErrorFilter()(event, {});
    expect(sent).toBe(event);
    expect(sent.fingerprint).toBeUndefined();
    expect(sent.tags).toBeUndefined();
  });
});
