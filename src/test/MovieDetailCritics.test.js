import { describe, it, expect, vi, beforeEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import MovieDetail from '@/components/MovieDetail.vue';

vi.mock('axios', () => ({ default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(() => Promise.resolve({ data: {} })) } }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5, normalizedRating: 5 })),
  getAllRatings: vi.fn(() => [])
}));
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }));
vi.mock('@/utils/letterboxdData.js', () => ({ myLetterboxdReviews: vi.fn(async () => []), letterboxdFilm: vi.fn(async () => null) }));

const request = vi.hoisted(() => ({ fetchCriticReviews: vi.fn(), fetchCinemaScore: vi.fn(async () => null) }));
vi.mock('@/utils/cinemaScoreRequest.js', () => ({ fetchCinemaScore: request.fetchCinemaScore }));
vi.mock('@/utils/criticReviewsRequest.js', async () => {
  const actual = await vi.importActual('@/utils/criticReviewsRequest.js');
  return { ...actual, fetchCriticReviews: request.fetchCriticReviews };
});

const movie = (id, title) => ({
  id,
  title,
  release_date: '1990-12-25',
  genres: [],
  crew: [{ name: 'Francis Ford Coppola', job: 'Director' }, { name: 'Assistant', job: 'Assistant Director' }]
});

const ebert = {
  role: 'release',
  critic: 'Roger Ebert',
  outlet: 'rogerebert.com',
  year: 1990,
  verdict: '3.5 stars',
  summary: 'A sense of wasted greatness.',
  url: 'https://www.rogerebert.com/reviews/the-godfather-part-iii-1990',
  paywalled: false
};

// Report 2026-10-06: critics' reviews on the movie page, "a brief summary and
// then a link to the full article".
describe('MovieDetail — Critics row', () => {
  let wrapper;

  beforeEach(async () => {
    request.fetchCriticReviews.mockReset();
    request.fetchCinemaScore.mockReset();
    request.fetchCinemaScore.mockResolvedValue(null);
    wrapper = shallowMount(MovieDetail, {
      global: {
        mocks: {
          $store: {
            state: { movieLog: {}, settings: { tags: { 'viewing-tags': {} } }, academyAwardWinners: {}, isOnline: true },
            getters: { allMoviesAsArray: [], allMediaAsArray: [], databaseTopKey: 'tester' },
            commit: vi.fn(),
            dispatch: vi.fn()
          },
          $route: { params: { tmdbId: '10144' }, query: {} },
          $router: { push: vi.fn() }
        },
        stubs: { ToggleableRating: true, Modal: true, DetailSection: { template: '<section class="detail-section-stub"><slot name="actions"/><slot/></section>' } }
      }
    });
    const m = movie(10144, 'The Godfather Part III');
    await wrapper.setData({ result: { dbKey: 'k', movie: m, ratings: [] }, movie: m });
  });

  it('looks nothing up until the row is opened, then shows each review with its link', async () => {
    expect(wrapper.find('#critics').exists()).toBe(true);
    expect(request.fetchCriticReviews).not.toHaveBeenCalled();

    request.fetchCriticReviews.mockResolvedValue({ status: 'ready', reviews: [ebert] });
    wrapper.vm.onCriticsToggle(true);
    await flushPromises();

    expect(request.fetchCriticReviews).toHaveBeenCalledWith({
      tmdbId: 10144, title: 'The Godfather Part III', year: 1990, director: 'Francis Ford Coppola'
    });
    const review = wrapper.find('.critic-review');
    expect(review.find('.critic-role').text()).toContain('When it came out');
    expect(review.find('.critic-byline').text()).toBe('Roger Ebert, rogerebert.com, 1990');
    expect(review.find('.critic-link').attributes('href')).toBe(ebert.url);
    expect(wrapper.vm.criticsRowSummary).toBe('Roger Ebert');

    // Closing and opening again does not look again.
    wrapper.vm.onCriticsToggle(true);
    expect(request.fetchCriticReviews).toHaveBeenCalledTimes(1);
  });

  // MovieDetail is reused film to film: a slow answer for the last film must
  // not land on the next one.
  it('drops an answer that arrives after the page has moved to another film', async () => {
    let finish;
    request.fetchCriticReviews.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    wrapper.vm.onCriticsToggle(true);
    const next = movie(238, 'The Godfather');
    await wrapper.setData({ movie: next, result: { dbKey: 'j', movie: next, ratings: [] }, critics: { tmdbId: null, state: 'idle', reviews: [], message: '' } });
    finish({ status: 'ready', reviews: [ebert] });
    await flushPromises();
    expect(wrapper.vm.critics.state).toBe('idle');
    expect(wrapper.find('.critic-review').exists()).toBe(false);
  });

  // Matt, 2026-10-06: CinemaScore "on the movie details screen as a review,
  // essentially, not as a guide for what I might want to go watch".
  it('shows the CinemaScore as one more review when the film has one, and nothing when it does not', async () => {
    request.fetchCriticReviews.mockResolvedValue({ status: 'ready', reviews: [ebert] });
    request.fetchCinemaScore.mockResolvedValue({ title: 'THE GODFATHER PART III', grade: 'B+', year: 1990 });
    wrapper.vm.onCriticsToggle(true);
    await flushPromises();

    expect(request.fetchCinemaScore).toHaveBeenCalledWith({ tmdbId: 10144, title: 'The Godfather Part III', year: 1990 });
    const card = wrapper.find('.cinemascore');
    expect(card.find('.critic-role').text()).toContain('Opening night');
    expect(card.find('.critic-verdict').text()).toBe('CinemaScore B+');
    expect(card.find('.critic-byline').text()).toBe('Audience exit poll, 1990');
    expect(card.find('.critic-summary').text()).toBe('Liked, not loved, by the crowd that chose to be there.');
    // The folded row's summary stays about the critics: the grade is a
    // review, not a headline.
    expect(wrapper.vm.criticsRowSummary).toBe('Roger Ebert');
    // Opening again does not look again.
    wrapper.vm.onCriticsToggle(true);
    expect(request.fetchCinemaScore).toHaveBeenCalledTimes(1);

    // A film with no grade shows no card, and the critics are untouched.
    const next = movie(238, 'The Godfather');
    await wrapper.setData({ movie: next, result: { dbKey: 'j', movie: next, ratings: [] } });
    request.fetchCinemaScore.mockResolvedValue(null);
    wrapper.vm.onCriticsToggle(true);
    await flushPromises();
    expect(wrapper.find('.cinemascore').exists()).toBe(false);
    expect(wrapper.find('.critic-review').exists()).toBe(true);
  });

  it('says so, with a retry, when the lookup fails', async () => {
    request.fetchCriticReviews.mockRejectedValue(new Error('Network Error'));
    wrapper.vm.onCriticsToggle(true);
    await flushPromises();
    expect(wrapper.find('.critics').text()).toContain("Couldn't reach the reviews just now.");
    expect(wrapper.find('.critics-retry').exists()).toBe(true);
  });
});
