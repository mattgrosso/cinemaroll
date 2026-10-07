import { describe, it, expect } from 'vitest';
import { isInternationalFilm, entriesEligibleFor, disabledReasonFor, countriesLabel, countriesKnown } from '@/assets/javascript/awardEligibility.js';
import { PERSONAL_AWARD_CATEGORIES } from '@/assets/javascript/personalAwardsCategories.js';
import { categoryMatchKey } from '@/assets/javascript/awardsShare.js';

// Matt, 2026-10-07: "it would be nice to try to see more films not produced
// in the United States. And so awarding those feels like a worthy task."
const film = (title, codes, genres = []) => ({ dbKey: title, movie: { title, production_countries: codes && codes.map((iso) => ({ iso_3166_1: iso, name: iso })), genres: genres.map((name) => ({ name })) } });

describe('Best International Feature', () => {
  it('is a standard movie category', () => {
    expect(PERSONAL_AWARD_CATEGORIES.find((c) => c.key === 'bestInternationalFeature')).toEqual({ key: 'bestInternationalFeature', name: 'Best International Feature', type: 'movie' });
    // Lines up with Movie Log's and the Academy's names in the club view.
    expect(categoryMatchKey('Best International Feature')).toBe(categoryMatchKey('Best Foreign Film'));
    expect(categoryMatchKey('Best International Feature')).toBe(categoryMatchKey('Best International Feature Film'));
  });

  it('takes films made anywhere but the US, co-productions with the US excluded', () => {
    expect(isInternationalFilm(film('Sentimental Value', ['NO', 'FR', 'DK']).movie)).toBe(true);
    expect(isInternationalFilm(film('The Ballad of Wallis Island', ['GB']).movie)).toBe(true);
    expect(isInternationalFilm(film('Dune', ['US', 'CA']).movie)).toBe(false);
    expect(isInternationalFilm(film('Sinners', ['US']).movie)).toBe(false);
    expect(isInternationalFilm(film('Unknown', []).movie)).toBe(false);
    expect(isInternationalFilm(film('Legacy', null).movie)).toBe(false);
    expect(countriesKnown(film('Legacy', null).movie)).toBe(false);
    expect(countriesKnown(film('Unknown', []).movie)).toBe(true);
  });

  it('gates the year\'s films per category', () => {
    const year = [film('Sentimental Value', ['NO']), film('Sinners', ['US']), film('KPop Demon Hunters', ['US'], ['Animation']), film('Mr Nobody Against Putin', ['DK', 'CZ'], ['Documentary'])];
    expect(entriesEligibleFor('bestInternationalFeature', year).map((e) => e.movie.title)).toEqual(['Sentimental Value', 'Mr Nobody Against Putin']);
    expect(entriesEligibleFor('bestAnimatedFeature', year).map((e) => e.movie.title)).toEqual(['KPop Demon Hunters']);
    expect(entriesEligibleFor('bestDocumentaryFeature', year).map((e) => e.movie.title)).toEqual(['Mr Nobody Against Putin']);
    expect(entriesEligibleFor('bestPicture', year)).toHaveLength(4);
    expect(entriesEligibleFor('bestPicture', null)).toEqual([]);
    expect(disabledReasonFor('bestInternationalFeature')).toBe('No films made outside the US rated this year');
    expect(disabledReasonFor('bestPicture')).toBeNull();
  });

  it('captions where a film was made', () => {
    expect(countriesLabel({ production_countries: [{ name: 'France' }, { name: 'Germany' }] })).toBe('France · Germany');
    expect(countriesLabel({ production_countries: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }] })).toBe('A · B · C +1');
    expect(countriesLabel({})).toBe('');
  });
});
