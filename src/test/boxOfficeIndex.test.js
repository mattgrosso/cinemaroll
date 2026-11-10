// Every library-wide box office number from Box Office History (Matt,
// 2026-11-09: "Do all of the box office numbers in Cinema Roll now come from
// boxofficehistory.com? They really ought to"). boxOfficeIndex.js is the one
// rule; these pin it and every caller that goes through it.
import { describe, it, expect, vi } from 'vitest';
import { shallowMount, mount } from '@vue/test-utils';
import { movieMoney, archiveEntryFor, grossKind } from '@/assets/javascript/boxOfficeIndex.js';
import { getSortValue, sortResultsFast, sortResults, isSortValueUnknown } from '@/assets/javascript/searchFiltering.js';
import { boxOfficeByYear } from '@/assets/javascript/boxOfficeYears.js';
import { boxOfficeByPerson } from '@/assets/javascript/boxOfficePeople.js';
import { grossTodayByRuns } from '@/assets/javascript/boxOfficeHistory.js';
import { adjustGross } from '@/assets/javascript/inflation.js';
import { fetchArchiveIndex } from '@/utils/boxOfficeHistoryRequest.js';
import DBGridLayoutSearchResult from '@/components/DBGridLayoutSearchResult.vue';
import BoxOfficeYears from '@/components/BoxOfficeYears.vue';

// TMDB says 1,004M worldwide for The Dark Knight; the archive says 535M
// domestic, 1,004M worldwide, released four times.
const DARK_KNIGHT = { id: 155, title: 'The Dark Knight', release_date: '2008-07-18', budget: 185e6, revenue: 1_004_558_444 };
const INDEX = {
  155: { id: 'darkknight', y: 2008, d: 535362665, w: 1004934033, r: [[2008, 533345358], [2012, 1513086], [2018, 375589], [2021, 128632]], t: 74506038 },
  2: { id: 'small', y: 2010, d: 20e6 }
};
const UNKNOWN = { id: 999, title: 'Not In The Archive', release_date: '1950-01-01', budget: 2e6, revenue: 30e6 };
const DOMESTIC_ONLY = { id: 2, title: 'Small', release_date: '2010-05-01', budget: 10e6, revenue: 60e6 };
const entry = (movie, n = 1) => ({ dbKey: `k${movie.id}`, movie: { cast: [], crew: [{ name: `Director ${n}`, job: 'Director' }], ...movie }, ratings: [] });
const getRating = () => ({ calculatedTotal: 5 });

describe('movieMoney', () => {
  it('reads the archive: domestic for box office, worldwide for profit, TMDB for the budget', () => {
    expect(movieMoney(DARK_KNIGHT, INDEX)).toEqual({ budget: 185e6, boxOffice: 535362665, worldwide: 1004934033 });
  });

  it('restates domestic release by release, as the movie page does', () => {
    const adjusted = movieMoney(DARK_KNIGHT, INDEX, { adjusted: true });
    const runs = INDEX[155].r.map(([year, gross]) => ({ year, gross }));
    expect(adjusted.boxOffice).toBeCloseTo(grossTodayByRuns(535362665, 2008, runs, 74506038));
    expect(adjusted.worldwide).toBeCloseTo(adjustGross(1004934033, 2008));
  });

  it('gives a film the archive doesn\'t know no box office, rather than TMDB\'s number', () => {
    expect(movieMoney(UNKNOWN, INDEX)).toEqual({ budget: 2e6, boxOffice: 0, worldwide: 0 });
  });

  it('reads TMDB until the index has loaded, so nothing goes blank meanwhile', () => {
    expect(movieMoney(DARK_KNIGHT, null)).toEqual({ budget: 185e6, boxOffice: 1_004_558_444, worldwide: 1_004_558_444 });
    expect(grossKind(null)).toBe('worldwide');
    expect(grossKind(INDEX)).toBe('domestic');
    expect(archiveEntryFor(INDEX, { id: '155' })).toBe(INDEX[155]);
  });
});

describe('Home\'s money sorts read the archive', () => {
  it('sorts box office on the archive\'s domestic, profit and return on its worldwide', () => {
    const film = entry(DARK_KNIGHT);
    expect(getSortValue(film, 'boxOffice', getRating, { boxOfficeIndex: INDEX })).toBe(535362665);
    expect(getSortValue(film, 'profit', getRating, { boxOfficeIndex: INDEX })).toBe(1004934033 - 185e6);
    expect(getSortValue(film, 'returnPct', getRating, { boxOfficeIndex: INDEX })).toBeCloseTo((1004934033 / 185e6) * 100);
  });

  it('sinks a film the archive doesn\'t know, and one without a worldwide figure for profit', () => {
    expect(isSortValueUnknown(entry(UNKNOWN), 'boxOffice', { boxOfficeIndex: INDEX })).toBe(true);
    expect(isSortValueUnknown(entry(DOMESTIC_ONLY), 'boxOffice', { boxOfficeIndex: INDEX })).toBe(false);
    expect(isSortValueUnknown(entry(DOMESTIC_ONLY), 'profit', { boxOfficeIndex: INDEX })).toBe(true);
    const order = sortResultsFast([entry(UNKNOWN), entry(DOMESTIC_ONLY), entry(DARK_KNIGHT)], { sortValue: 'boxOffice', sortOrder: 'bestOrNewestOnTop', getRating, boxOfficeIndex: INDEX })
      .map((e) => e.movie.title);
    expect(order).toEqual(['The Dark Knight', 'Small', 'Not In The Archive']);
    const oracle = [entry(UNKNOWN), entry(DOMESTIC_ONLY), entry(DARK_KNIGHT)]
      .sort((a, b) => sortResults(a, b, { sortValue: 'boxOffice', sortOrder: 'bestOrNewestOnTop', getRating, boxOfficeIndex: INDEX }))
      .map((e) => e.movie.title);
    expect(oracle).toEqual(order);
  });
});

describe('the caption under each poster agrees with the sort', () => {
  const caption = (sortValue, movie) => {
    const result = { dbKey: 'k', movie: { genres: [], cast: [], crew: [], ...movie }, ratings: [{ date: Date.now(), love: 8, overall: 8 }] };
    return shallowMount(DBGridLayoutSearchResult, {
      props: { result, index: 0, keywordCounts: {}, allCounts: [], sortValue },
      global: {
        mocks: { $store: { state: { settings: {}, allAcademyAwards: [], moneyInTodaysDollars: false, boxOfficeIndex: INDEX }, getters: { allMediaSortedByRating: [result], allMediaAsArray: [result], overallRankByDbKey: new Map() }, commit: vi.fn(), dispatch: vi.fn() } },
        directives: { lazy: () => {} }
      }
    }).vm.sortDetail;
  };

  it('shows the archive\'s domestic, its worldwide profit, and a dash for an unknown film', () => {
    expect(caption('boxOffice', DARK_KNIGHT)).toBe('$535M');
    expect(caption('profit', DARK_KNIGHT)).toBe('+$820M');
    expect(caption('boxOffice', UNKNOWN)).toBe('—');
    expect(caption('budget', UNKNOWN)).toBe('$2M');
  });
});

describe('Insights\' box office lists read the archive', () => {
  it('ranks years and people by the archive\'s domestic, leaving unknown films out', () => {
    const films = [entry(DARK_KNIGHT, 1), entry(UNKNOWN, 2), entry(DOMESTIC_ONLY, 3)];
    const years = boxOfficeByYear(films, { boxOfficeIndex: INDEX });
    expect(years.map((y) => [y.year, y.total])).toEqual([[2008, 535362665], [2010, 20e6]]);
    const people = boxOfficeByPerson(films, { role: 'director', boxOfficeIndex: INDEX });
    expect(people.map((p) => p.name)).toEqual(['Director 1', 'Director 3']);
  });

  it('says domestic and names Box Office History once the index is in', () => {
    window.localStorage.clear();
    const dispatch = vi.fn();
    const wrapper = mount(BoxOfficeYears, {
      props: { resultsWithRatings: [entry(DARK_KNIGHT)] },
      global: { mocks: { $store: { state: { boxOfficeIndex: INDEX }, dispatch } } }
    });
    expect(dispatch).toHaveBeenCalledWith('ensureBoxOfficeIndex');
    expect(wrapper.find('.box-office-caption').text()).toContain('domestic gross');
    expect(wrapper.find('.box-office-caption').text()).toContain('Box Office History');
  });
});

describe('fetchArchiveIndex', () => {
  const NOW = Date.UTC(2026, 10, 9);
  const DAY = 24 * 60 * 60 * 1000;

  it('uses a copy on the device under a month old without asking the archive', async () => {
    const download = vi.fn();
    const index = await fetchArchiveIndex({ now: NOW, load: async () => ({ at: NOW - 10 * DAY, index: INDEX }), save: vi.fn(), download });
    expect(index).toBe(INDEX);
    expect(download).not.toHaveBeenCalled();
  });

  it('fetches and stores a fresh copy when the device\'s is a month old', async () => {
    const fresh = { 155: INDEX[155] };
    const save = vi.fn();
    const index = await fetchArchiveIndex({ now: NOW, load: async () => ({ at: NOW - 40 * DAY, index: INDEX }), save, download: async () => fresh });
    expect(index).toBe(fresh);
    expect(save).toHaveBeenCalledWith('boxOfficeHistory', 'tmdbIndex', { at: NOW, index: fresh });
  });

  it('keeps an old copy when the archive can\'t be reached, and null when there is none', async () => {
    expect(await fetchArchiveIndex({ now: NOW, load: async () => ({ at: NOW - 40 * DAY, index: INDEX }), save: vi.fn(), download: async () => null })).toBe(INDEX);
    expect(await fetchArchiveIndex({ now: NOW, load: async () => null, save: vi.fn(), download: async () => null })).toBeNull();
  });
});
