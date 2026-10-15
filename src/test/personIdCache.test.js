import { describe, it, expect, beforeEach } from 'vitest';
import { rememberedPerson, rememberPerson, forgetPeople } from '@/utils/personIdCache.js';

describe('personIdCache', () => {
  beforeEach(() => forgetPeople());

  it('remembers a name as its id and gender', () => {
    rememberPerson('Tom Hanks', { id: 31, gender: 2, popularity: 99 });
    expect(rememberedPerson('Tom Hanks')).toEqual({ id: 31, gender: 2, profile_path: null });
  });

  it('keeps the photo, for the awards picker', () => {
    rememberPerson('Tom Hanks', { id: 31, gender: 2, profile_path: '/hanks.jpg' });
    expect(rememberedPerson('Tom Hanks').profile_path).toBe('/hanks.jpg');
  });

  it('reports no photo at all for an entry written before photos were kept', () => {
    localStorage.setItem('cinemaRoll.people.ids', JSON.stringify({ 'Tom Hanks': { id: 31, gender: 2, at: Date.now() } }));
    expect(rememberedPerson('Tom Hanks')).toEqual({ id: 31, gender: 2 });
    expect('profile_path' in rememberedPerson('Tom Hanks')).toBe(false);
  });

  it('survives in localStorage for the next visit', () => {
    rememberPerson('Tom Hanks', { id: 31, gender: 2 });
    expect(JSON.parse(localStorage.getItem('cinemaRoll.people.ids'))['Tom Hanks'].id).toBe(31);
  });

  it('does not keep a miss, so an unknown name is retried', () => {
    rememberPerson('Nobody', undefined);
    rememberPerson('Nobody', { id: null });
    expect(rememberedPerson('Nobody')).toBeNull();
  });

  it('forgets a name after ninety days', () => {
    const then = Date.parse('2026-01-01T00:00:00Z');
    rememberPerson('Tom Hanks', { id: 31, gender: 2 }, then);
    expect(rememberedPerson('Tom Hanks', then + 89 * 24 * 3600 * 1000)).toMatchObject({ id: 31, gender: 2 });
    expect(rememberedPerson('Tom Hanks', then + 91 * 24 * 3600 * 1000)).toBeNull();
  });

  it('drops the oldest names past the cap', () => {
    for (let i = 0; i < 2001; i += 1) rememberPerson(`Person ${i}`, { id: i, gender: 1 }, 1000 + i);
    expect(rememberedPerson('Person 0', 5000)).toBeNull();
    expect(rememberedPerson('Person 1', 5000)).toMatchObject({ id: 1, gender: 1 });
    expect(rememberedPerson('Person 2000', 5000)).toMatchObject({ id: 2000, gender: 1 });
  });
});
