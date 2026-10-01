import { describe, it, expect, vi, beforeEach } from 'vitest';
import { set, push, ref } from 'firebase/database';
import { submitBugReport } from '@/utils/bugReports';

vi.mock('firebase/database', () => ({
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn(() => 'ref'),
  push: vi.fn(() => 'pushedRef'),
  set: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'server-timestamp'),
}));

describe('bugReports', () => {
  let store;
  let route;

  beforeEach(() => {
    vi.clearAllMocks();
    store = {
      state: {
        userEmail: 'matt@example.com',
        movieLog: { a: {}, b: {} },
        dbLoaded: true,
        DBSortValue: 'rating',
        DBSortOrder: 'bestOrNewestOnTop',
        homePageSearchValue: 'spielberg',
        homePageSearchChips: [{ type: 'director', value: 'Steven Spielberg' }],
        homePageNumberOfResults: 25,
      },
    };
    route = { fullPath: '/movie/123' };
  });

  it('throws when the transcript is empty', async () => {
    await expect(submitBugReport(store, '   ', route)).rejects.toThrow('Describe what happened');
    expect(set).not.toHaveBeenCalled();
  });

  it('writes a report with transcript, reporter, and a stringified app-state summary', async () => {
    await submitBugReport(store, '  Posters stopped loading  ', route);

    expect(ref).toHaveBeenCalledWith(expect.anything(), 'bugReports');
    expect(push).toHaveBeenCalled();
    expect(set).toHaveBeenCalledTimes(1);

    const [, report] = set.mock.calls[0];
    expect(report.transcript).toBe('Posters stopped loading');
    expect(report.reporterEmail).toBe('matt@example.com');
    expect(report.createdAt).toBe('server-timestamp');
    expect(typeof report.screenSize).toBe('string');

    const appState = JSON.parse(report.appState);
    expect(appState.route).toBe('/movie/123');
    expect(appState.movieCount).toBe(2);
    expect(appState.searchValue).toBe('spielberg');
    expect(appState.sortValue).toBe('rating');
  });

  it('falls back to null reporterEmail when logged out', async () => {
    store.state.userEmail = null;
    await submitBugReport(store, 'Something broke', route);

    const [, report] = set.mock.calls[0];
    expect(report.reporterEmail).toBeNull();
  });

  // Report 2026-10-01, "Cannot sign into Movie Hat", carried nothing about
  // Movie Hat at all.
  it("carries Movie Hat's connection state and last failure", async () => {
    store.state.movieHatEmail = 'hat@example.com';
    store.state.availableMovieHats = [];
    store.state.movieHatAccessError = { reason: 'denied' };
    store.state.movieHatLastFailure = { where: 'sign-in', code: 'auth/popup-blocked' };
    store.getters = { linkedMovieHats: [{ title: 'Just Matt' }] };

    await submitBugReport(store, 'hat trouble', route);
    const report = set.mock.calls[0][1];
    expect(JSON.parse(report.appState).movieHat).toEqual({
      connectedAs: 'hat@example.com',
      linkedHats: 1,
      foundHats: 0,
      accessError: 'denied',
      lastFailure: { where: 'sign-in', code: 'auth/popup-blocked' }
    });
  });
});
