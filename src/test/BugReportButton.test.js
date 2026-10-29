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

  // Matt's call (2026-10-27): the trigger lives in the bottom-RIGHT corner.
  // Since 2026-10-29 it's a slim tab flat against that edge, no wider than
  // the 1rem margin most screens keep, so it sits in that margin instead of over the
  // buttons that scroll past ("some of the things that we need to avoid
  // aren't actually pinned"). jsdom loads no scoped CSS, so this reads the
  // rule from the source.
  it('is a slim tab flat against the right edge', () => {
    const rule = triggerRule();
    expect(rule).toMatch(/^\s*right:\s*0;/m);
    expect(rule).not.toMatch(/^\s*left:/m);
    expect(rule).toMatch(/^\s*border-right:\s*none;/m);
    const width = Number(rule.match(/^\s*width:\s*([\d.]+)rem;/m)[1]);
    const height = Number(rule.match(/^\s*height:\s*([\d.]+)rem;/m)[1]);
    expect(width).toBeLessThanOrEqual(1);
    expect(height).toBeGreaterThanOrEqual(2.5);
  });

  // Report 2026-10-28, "the bug button is coming unhinged on scroll": iOS
  // Safari changes env(safe-area-inset-bottom) while its toolbar collapses
  // mid-scroll, so a bottom tied to it moved. A fixed distance can't. The
  // only thing that moves it is a screen's own pinned strip, via the lift.
  it('sits a fixed distance from the bottom, raised only by the lift variable', () => {
    const rule = triggerRule();
    expect(rule).toMatch(/^\s*bottom:\s*max\(3\.125rem,\s*var\(--bug-tab-lift,\s*0px\)\);/m);
    expect(rule).not.toMatch(/env\(/);
  });
});

function triggerRule () {
  const src = readFileSync(resolve(process.cwd(), 'src/components/BugReportButton.vue'), 'utf8');
  const styles = src.slice(src.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
  return styles.match(/\.bug-report-trigger\s*\{([^}]*)\}/)[1];
}
