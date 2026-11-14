// The Letterboxd import panel (2026-11-14), driven through the DOM: every
// thing it can do — pick a file, watch progress, resume, and each of the
// "Find the match" answers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import LetterboxdImport from '@/components/LetterboxdImport.vue';
import { importState } from '@/utils/letterboxdImportState.js';

const runner = vi.hoisted(() => ({
  loadSavedImport: vi.fn(),
  startLetterboxdImport: vi.fn(),
  resumeLetterboxdImport: vi.fn(),
  searchTmdbMovies: vi.fn(async () => [{ id: 501, title: 'The Right One', release_date: '1999-05-05', poster_path: null }]),
  matchDoubtfulFilm: vi.fn(async () => {}),
  skipDoubtfulFilm: vi.fn(),
  clearLetterboxdImport: vi.fn()
}));
vi.mock('@/utils/letterboxdImportRun.js', () => runner);
vi.mock('@/utils/usage.js', () => ({ trackEvent: vi.fn() }));

const reset = (overrides = {}) => Object.assign(importState, {
  loaded: true, running: false, phase: '', total: 0, processed: 0, imported: 0, viewingsAdded: 0,
  doubtful: [], pending: 0, failedWrites: 0, reviewsImported: 0, message: '', error: false, ...overrides
});

const mountPanel = (variant = 'settings', isOnline = true) => mount(LetterboxdImport, {
  props: { variant },
  global: { mocks: { $store: { state: { isOnline } } }, stubs: { MediaResultGrid: { props: ['mediaList'], template: '<ul class="grid"><li v-for="m in mediaList" :key="m.id" class="pick" @click="$emit(\'select\', m)">{{ m.title }}</li></ul>' } } }
});

const doubtfulFilm = {
  key: 'wohucanglong|2000', title: 'Wo hu cang long', year: 2000,
  viewings: [{ day: '2024-02-01', stars: 4 }],
  suggestion: { id: 146, title: 'Crouching Tiger, Hidden Dragon', release_date: '2000-07-06', poster_path: '/p.jpg' }
};

beforeEach(() => {
  reset();
  Object.values(runner).forEach((fn) => fn.mockClear());
});

describe('LetterboxdImport', () => {
  it('starts an import with the picked export', async () => {
    const wrapper = mountPanel('welcome');
    expect(wrapper.text()).toContain('Coming from Letterboxd?');
    const input = wrapper.find('input[type="file"]');
    const file = new File(['x'], 'letterboxd.zip');
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    await flushPromises();
    expect(runner.startLetterboxdImport).toHaveBeenCalledWith(file);
  });

  it('cannot start offline, and says why', () => {
    const wrapper = mountPanel('settings', false);
    expect(wrapper.find('input[type="file"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Needs a connection');
  });

  it('shows progress while it runs', () => {
    reset({ running: true, phase: 'matching', total: 200, processed: 50 });
    const wrapper = mountPanel('notice');
    expect(wrapper.text()).toContain('50 of 200');
    expect(wrapper.find('.lb-progress-fill').attributes('style')).toContain('width: 25%');
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });

  it('offers to pick up a run that stopped', async () => {
    reset({ phase: 'paused', total: 10, processed: 4, pending: 6, imported: 4 });
    const wrapper = mountPanel();
    const resume = wrapper.findAll('button').find((button) => button.text() === 'Pick up where it stopped');
    await resume.trigger('click');
    await flushPromises();
    expect(runner.resumeLetterboxdImport).toHaveBeenCalled();
  });

  it('takes the suggested match', async () => {
    reset({ phase: 'done', total: 5, processed: 5, imported: 4, viewingsAdded: 6, doubtful: [doubtfulFilm] });
    const wrapper = mountPanel();
    expect(wrapper.text()).toContain('4 films added (6 viewings)');
    expect(wrapper.text()).toContain('Is it Crouching Tiger, Hidden Dragon (2000)?');
    await wrapper.findAll('button').find((button) => button.text() === 'Yes, that one').trigger('click');
    await flushPromises();
    expect(runner.matchDoubtfulFilm).toHaveBeenCalledWith('wohucanglong|2000', 146);
  });

  it('searches for another match and takes the one tapped', async () => {
    reset({ phase: 'done', total: 5, processed: 5, doubtful: [doubtfulFilm] });
    const wrapper = mountPanel();
    await wrapper.findAll('button').find((button) => button.text() === 'Search').trigger('click');
    await flushPromises();
    expect(runner.searchTmdbMovies).toHaveBeenCalledWith('Wo hu cang long');
    await wrapper.find('.pick').trigger('click');
    await flushPromises();
    expect(runner.matchDoubtfulFilm).toHaveBeenCalledWith('wohucanglong|2000', 501);
  });

  it('skips one', async () => {
    reset({ phase: 'done', total: 5, processed: 5, doubtful: [doubtfulFilm] });
    const wrapper = mountPanel();
    await wrapper.findAll('button').find((button) => button.text() === 'Skip').trigger('click');
    await flushPromises();
    expect(runner.skipDoubtfulFilm).toHaveBeenCalledWith('wohucanglong|2000');
  });

  it('puts a finished import away', async () => {
    reset({ phase: 'done', total: 5, processed: 5, imported: 5 });
    const wrapper = mountPanel();
    await wrapper.findAll('button').find((button) => button.text() === 'Done').trigger('click');
    await flushPromises();
    expect(runner.clearLetterboxdImport).toHaveBeenCalled();
  });

  it('loads a saved import when it first appears', async () => {
    reset({ loaded: false });
    mountPanel();
    await flushPromises();
    expect(runner.loadSavedImport).toHaveBeenCalled();
  });
});
