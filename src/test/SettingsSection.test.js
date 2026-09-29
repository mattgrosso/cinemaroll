import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { vi } from 'vitest';
import { nextTick } from 'vue';
import SettingsSection from '@/components/SettingsSection.vue';

function factory (props = {}) {
  return mount(SettingsSection, {
    props: { title: 'Library', ...props },
    slots: { default: '<p class="inside">contents</p>' }
  });
}

describe('SettingsSection', () => {
  it('renders the hint beside the title so a collapsed group says what is inside', () => {
    const wrapper = factory({ hint: 'Short films, your rating curve, and personal awards' });

    expect(wrapper.find('.settings-section-hint').text())
      .toBe('Short films, your rating curve, and personal awards');
  });

  it('omits the hint element entirely when none is given', () => {
    expect(factory().find('.settings-section-hint').exists()).toBe(false);
  });

  // v-show is what hides the body, so assert on the inline display it
  // writes. isVisible() proved unreliable on these detached mounts.
  const bodyDisplay = (wrapper) => wrapper.find('.settings-section-body').element.style.display;

  it('keeps a collapsible section closed when startOpen is false', () => {
    expect(bodyDisplay(factory({ collapsible: true, startOpen: false }))).toBe('none');
  });

  it('opens and closes on header taps', async () => {
    const wrapper = factory({ collapsible: true, startOpen: false });
    const tapHeader = async () => {
      await wrapper.find('.settings-section-header').trigger('click');
      await nextTick();
    };

    await tapHeader();
    expect(bodyDisplay(wrapper)).toBe('');

    await tapHeader();
    expect(bodyDisplay(wrapper)).toBe('none');
  });

  it('renders a non-collapsible section open with no chevron', () => {
    const wrapper = factory();

    expect(bodyDisplay(wrapper)).toBe('');
    expect(wrapper.find('.settings-section-chevron').exists()).toBe(false);
  });
});

// A group that is a way somewhere rather than a set of controls — the
// Newsletter, moved here from the Insights directory on 2026-09-29.
describe('SettingsSection as a link', () => {
  it('navigates on a header tap, with a sideways chevron and no body', async () => {
    const push = vi.fn();
    const wrapper = mount(SettingsSection, {
      props: { title: 'Newsletter', hint: "This week's issue", to: '/newsletter' },
      global: { mocks: { $router: { push } } }
    });
    expect(wrapper.find('.settings-section-body').exists()).toBe(false);
    expect(wrapper.find('.bi-chevron-right').exists()).toBe(true);
    expect(wrapper.find('.bi-chevron-down').exists()).toBe(false);
    await wrapper.find('button.settings-section-header').trigger('click');
    expect(push).toHaveBeenCalledWith('/newsletter');
  });
});
