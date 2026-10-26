// Every push has to fit Matt's Apple Watch (2026-10-26): title <= 24, body <= 60.
// aws-lambda/pushFit.js is the backstop both senders' buildPayload run through.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { clip, fitNotification, TITLE_MAX, BODY_MAX } from '../../aws-lambda/pushFit.js';
import { composeDayMessage, composeGamesMessage, friendRequestMessage } from '../../aws-lambda/pushCadence.js';

describe('clip', () => {
  it('leaves short text alone, apart from whitespace', () => {
    expect(clip('  Time for   Trivia ', 24)).toBe('Time for Trivia');
    expect(clip('x'.repeat(24), 24)).toBe('x'.repeat(24));
  });

  it('cuts at a word, drops trailing punctuation and adds an ellipsis', () => {
    const out = clip('Stickiness: Once Upon a Time in Hollywood', 24);
    expect(out).toBe('Stickiness: Once Upon…');
    expect(out.length).toBeLessThanOrEqual(24);
    expect(clip('Jaws, Heat, Alien, Tenet, Arrival, Sicario, Prisoners and 3 more.', 60))
      .toBe('Jaws, Heat, Alien, Tenet, Arrival, Sicario, Prisoners and…');
    expect(clip('Jaws, Heat, Alien, Tenet', 12)).toBe('Jaws, Heat…');
    expect(clip('Final showing Fri, Oct 24 — at Alamo', 28)).toBe('Final showing Fri, Oct 24…');
  });

  it('cuts mid-word when the only space is too early', () => {
    expect(clip('A Supercalifragilisticexpialidocious night', 24)).toBe('A Supercalifragilistice…');
  });

  it('copes with nothing', () => {
    expect(clip(undefined, 24)).toBe('');
  });
});

describe('fitNotification', () => {
  it('holds every title and body to the watch', () => {
    const fit = fitNotification({ title: 'Seth Hopper logged a very long film title indeed', body: 'y '.repeat(80) });
    expect(fit.title.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(fit.body.length).toBeLessThanOrEqual(BODY_MAX);
  });

  it('is applied in both senders\' buildPayload', () => {
    for (const file of ['push-notify.js', 'newsletter.js']) {
      const src = readFileSync(resolve(__dirname, '../../aws-lambda', file), 'utf8');
      const build = src.slice(src.indexOf('const buildPayload'), src.indexOf('const buildPayload') + 600);
      expect(build).toContain('fitNotification({ title, body })');
    }
  });
});

describe('the usual wording fits without a cut', () => {
  it('friend logs, games and friend requests', () => {
    const messages = [
      composeDayMessage('Seth Hopper', [{ t: 'Tenet', id: 1 }]),
      composeDayMessage('Seth Hopper', [{ t: 'Tenet' }, { t: 'Heat' }, { t: 'Alien' }]),
      composeGamesMessage([{ key: 'hl', name: 'Higher or Lower' }], 8),
      composeGamesMessage([{ name: 'Trivia' }, { name: 'Tag' }], 8),
      friendRequestMessage({ kind: 'request', myKey: 'a', toKey: 'b', edges: { a: { b: true } }, request: {}, name: 'Seth Hopper' })
    ];
    for (const m of messages) {
      expect(m.title.length).toBeLessThanOrEqual(TITLE_MAX);
      expect(m.body.length).toBeLessThanOrEqual(BODY_MAX);
    }
  });
});
