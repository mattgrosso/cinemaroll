import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import MovieDetail from '@/components/MovieDetail.vue';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(() => Promise.resolve({ data: {} })) } }));
const ratings = vi.hoisted(() => ({ list: [] }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5, normalizedRating: 5 })),
  getAllRatings: vi.fn(() => ratings.list)
}));
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }));
vi.mock('@/utils/letterboxdData.js', () => ({ myLetterboxdReviews: vi.fn(async () => []), letterboxdFilm: vi.fn(async () => null) }));
vi.mock('@/utils/cinemaScoreRequest.js', () => ({ fetchCinemaScore: vi.fn(async () => null) }));
vi.mock('@/utils/criticReviewsRequest.js', async () => {
  const actual = await vi.importActual('@/utils/criticReviewsRequest.js');
  return { ...actual, fetchCriticReviews: vi.fn(async () => ({ status: 'ready', reviews: [] })) };
});

const archive = vi.hoisted(() => ({ fetchArchiveFilm: vi.fn(async () => null), fetchArchiveCalendar: vi.fn(async () => null) }));
vi.mock('@/utils/boxOfficeArchiveRequest.js', () => archive);

const film = {
  id: 'darkknight',
  title: 'The Dark Knight',
  year: 2008,
  domestic: 535234033,
  worldwide: 1004934033,
  opening: { gross: 158411483, theaters: 4366, rank: 1, average: 36283 },
  widest: 4366,
  inRelease: { days: 231 },
  weekends: [
    { start: '2008-07-18', end: '2008-07-20', days: 3, rank: 1, gross: 158411483, week: 1 },
    { start: '2008-07-25', end: '2008-07-27', days: 3, rank: 1, gross: 75166466, week: 2 },
    { start: '2008-08-01', end: '2008-08-03', days: 3, rank: 2, gross: 42664219, week: 3 }
  ]
};
const calendar2015 = { year: 2015, weekends: [{ k: '2015-27', s: '2015-07-03', e: '2015-07-05', top: 'Inside Out', id: 'pixar2014', g: 29771224 }] };

const movie = (id, title) => ({ id, title, release_date: '2008-07-18', genres: [], crew: [], budget: 185000000, revenue: 1004934033 });

// Matt, 2026-10-14: "get some interesting things into Cinema Roll" from Box
// Office Archive. The Box office tile reads the domestic run from the
// archive; each viewing says what was #1 that weekend.
describe('MovieDetail — Box Office History', () => {
  let wrapper;

  const mountFor = async (m, viewings = []) => {
    ratings.list = viewings;
    wrapper = shallowMount(MovieDetail, {
      global: {
        mocks: {
          $store: {
            state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {}, isOnline: true },
            getters: { allMoviesAsArray: [], allMediaAsArray: [], databaseTopKey: 'tester' },
            commit: vi.fn(),
            dispatch: vi.fn()
          },
          $route: { params: { tmdbId: String(m.id) }, query: {} },
          $router: { push: vi.fn() }
        },
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { props: ['summary', 'label'], template: '<section class="detail-section-stub" :data-label="label" :data-summary="summary"><slot name="actions"/><slot/></section>' } }
      }
    });
    await wrapper.setData({ result: { dbKey: 'k', movie: m, ratings: viewings }, movie: m, previousEntry: viewings.length ? { dbKey: 'k', movie: m, ratings: viewings } : null });
    await flushPromises();
  };

  beforeEach(() => {
    archive.fetchArchiveFilm.mockReset();
    archive.fetchArchiveCalendar.mockReset();
    archive.fetchArchiveFilm.mockResolvedValue(null);
    archive.fetchArchiveCalendar.mockResolvedValue(null);
  });

  it('asks the archive for the film by TMDB id and shows the domestic run in the tile', async () => {
    archive.fetchArchiveFilm.mockResolvedValue(film);
    await mountFor(movie(155, 'The Dark Knight'));
    expect(archive.fetchArchiveFilm).toHaveBeenCalledWith(155);
    const tile = wrapper.find('#boxoffice');
    expect(tile.attributes('data-summary')).toBe('$535M domestic · opened #1, $158M · 2 weekends at #1 · $185M budget');
    const facts = tile.find('.box-office-archive').text();
    expect(facts).toContain('$535,234,033');
    expect(facts).toContain('4,366 theaters');
    expect(facts).toContain('2 at #1');
    expect(facts).toContain('231 days in release');
    expect(tile.find('.box-office-link').attributes('href')).toContain('/movie/darkknight');
  });

  it('falls back to TMDB budget and revenue for a film the archive does not know', async () => {
    await mountFor(movie(999, 'Unknown'));
    const tile = wrapper.find('#boxoffice');
    expect(tile.attributes('data-summary')).toBe('$185M budget · $1B box office');
    expect(tile.find('.box-office-archive').exists()).toBe(false);
    expect(tile.find('.box-office-link').exists()).toBe(false);
  });

  it('says what was #1 the weekend of each viewing, linked to the chart', async () => {
    archive.fetchArchiveCalendar.mockImplementation(async (year) => (year === 2015 ? calendar2015 : null));
    await mountFor(movie(155, 'The Dark Knight'), [{ date: '2015-07-04T20:00:00', calculatedTotal: 8.1 }]);
    await flushPromises();
    expect(archive.fetchArchiveCalendar).toHaveBeenCalledWith(2015);
    const line = wrapper.find('.viewing-weekend');
    expect(line.exists()).toBe(true);
    expect(line.text()).toBe('#1 that weekend: Inside Out ($30M)');
    expect(line.attributes('href')).toContain('/weekend/2015-27');
  });

  it('shows no weekend line when the archive has no chart for that year', async () => {
    await mountFor(movie(155, 'The Dark Knight'), [{ date: '1969-07-04T20:00:00', calculatedTotal: 8.1 }]);
    expect(wrapper.find('.viewing-weekend').exists()).toBe(false);
  });
});
