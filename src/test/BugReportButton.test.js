import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import BugReportButton from '@/components/BugReportButton.vue';
import { submitBugReport } from '@/utils/bugReports';

vi.mock('@/utils/bugReports', () => ({
  submitBugReport: vi.fn(),
}));

function factory () {
  return mount(BugReportButton, {
    global: {
      mocks: {
        $store: { state: {} },
        $route: { fullPath: '/' },
      },
    },
  });
}

describe('BugReportButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the trigger and opens the panel on click', async () => {
    const wrapper = factory();
    expect(wrapper.find('.bug-report-panel').exists()).toBe(false);

    await wrapper.find('.bug-report-trigger').trigger('click');

    expect(wrapper.find('.bug-report-panel').exists()).toBe(true);
    expect(wrapper.find('.bug-report-trigger').exists()).toBe(false);
  });

  it('disables the send button until there is transcript text', async () => {
    const wrapper = factory();
    await wrapper.find('.bug-report-trigger').trigger('click');

    const sendButton = wrapper.find('.bug-report-panel__actions .btn-warning');
    expect(sendButton.attributes('disabled')).toBeDefined();

    await wrapper.find('textarea').setValue('Nothing loads on the year filter');
    expect(wrapper.find('.bug-report-panel__actions .btn-warning').attributes('disabled')).toBeUndefined();
  });

  it('sends the transcript and shows a confirmation', async () => {
    submitBugReport.mockResolvedValue();
    const wrapper = factory();
    await wrapper.find('.bug-report-trigger').trigger('click');
    await wrapper.find('textarea').setValue('Nothing loads on the year filter');
    await wrapper.find('.bug-report-panel__actions .btn-warning').trigger('click');
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(submitBugReport).toHaveBeenCalledWith(wrapper.vm.$store, 'Nothing loads on the year filter', wrapper.vm.$route);
    expect(wrapper.find('.bug-report-panel__sent').exists()).toBe(true);
  });

  it('shows an error message when the submission fails', async () => {
    submitBugReport.mockRejectedValue(new Error('Network down'));
    const wrapper = factory();
    await wrapper.find('.bug-report-trigger').trigger('click');
    await wrapper.find('textarea').setValue('Something broke');
    await wrapper.find('.bug-report-panel__actions .btn-warning').trigger('click');
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('.bug-report-panel__error').text()).toBe('Network down');
  });

  it('closes and clears the transcript on cancel', async () => {
    const wrapper = factory();
    await wrapper.find('.bug-report-trigger').trigger('click');
    await wrapper.find('textarea').setValue('Some notes');
    await wrapper.find('.bug-report-panel__actions .btn-outline-light').trigger('click');

    expect(wrapper.find('.bug-report-panel').exists()).toBe(false);
    expect(wrapper.vm.transcript).toBe('');
  });

  // Matt, 2026-11-15 (after the bottom-left button rode up the screen once
  // more on iOS's phantom keyboard): move it off the bottom. A round button
  // in the TOP-RIGHT corner, below the status bar. jsdom loads no scoped CSS,
  // so this reads the rule from the source.
  it('is a round button in the top-right corner, never pinned to the bottom', () => {
    const rule = triggerRule();
    expect(rule).toMatch(/^\s*right:\s*0\.75rem;/m);
    expect(rule).toMatch(/^\s*top:\s*calc\(0\.5rem \+ var\(--safe-top, 0px\)\);/m);
    expect(rule).not.toMatch(/^\s*left:/m);
    expect(rule).not.toMatch(/^\s*bottom:/m);
    expect(rule).toMatch(/^\s*border-radius:\s*50%;/m);
    expect(rule).toMatch(/^\s*width:\s*2\.75rem;/m);
    expect(rule).toMatch(/^\s*height:\s*2\.75rem;/m);
  });

  // Up there it shares the top of the screen with pop-ups whose close
  // buttons sit top-right (PersonModal's, a tall one starts ~6vh down). It
  // must sit under every overlay, while its own report box stays on top.
  it('sits under every pop-up, its own report box over everything', () => {
    const z = Number(triggerRule().match(/z-index:\s*(\d+)/)[1]);
    const person = readFileSync(resolve(process.cwd(), 'src/components/PersonModal.vue'), 'utf8');
    const overlayZ = Number(person.match(/\.person-modal-overlay\s*\{[^}]*z-index:\s*(\d+)/)[1]);
    expect(z).toBeLessThan(overlayZ);
    const src = readFileSync(resolve(process.cwd(), 'src/components/BugReportButton.vue'), 'utf8');
    expect(Number(src.match(/\.bug-report-backdrop\s*\{[^}]*z-index:\s*(\d+)/)[1])).toBe(1200);
  });
});

function triggerRule () {
  const src = readFileSync(resolve(process.cwd(), 'src/components/BugReportButton.vue'), 'utf8');
  const styles = src.slice(src.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
  return styles.match(/\.bug-report-trigger\s*\{([^}]*)\}/)[1];
}
