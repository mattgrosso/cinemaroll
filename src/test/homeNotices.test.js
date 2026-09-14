import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// The unified notification space (2026-08-21): everything the app wants to
// tell you renders as a prompt-card inside Home's .home-notices section.
// Home.vue is too entangled to mount here, so these are source-level
// assertions — the same style as the guards in other repos that read the
// template because jsdom can't see the layout. What they pin:
//
//  1. Every notification component renders INSIDE .home-notices, and only
//     once. The friend-request card had to be rescued from inside
//     `results-exist` on 2026-08-19 (a no-match search hid it); this stops
//     any card from quietly sliding back into a conditional corner.
//  2. App.vue renders no notification components — a card mounted globally
//     AND in the space would show twice.

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const home = read('../components/Home.vue');
const app = read('../App.vue');

const noticesSection = () => {
  const start = home.indexOf('<section class="home-notices">');
  const end = home.indexOf('</section>', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return home.slice(start, end);
};

describe('the unified notification space', () => {
  it('exists exactly once in Home', () => {
    expect(home.match(/class="home-notices"/g)).toHaveLength(1);
  });

  it('contains every notification, each rendered nowhere else in Home', () => {
    const section = noticesSection();

    for (const tag of ['<BugResolutionNotice', '<UpdateAvailableBanner', '<StickinessInline', '<TweakInline', '<PersonalAwardsModal']) {
      expect(section).toContain(tag);
      // Once in the section means once in the whole file.
      expect(home.split(tag)).toHaveLength(2);
    }

    expect(section).toContain('prompt-badge-friends');
  });

  // "I don't want it above the rainbow bar. It should go below the rainbow"
  // — the bar renders immediately before the section, and only once (it was
  // moved out of results-exist to sit there; a second copy left behind
  // would double every button).
  it('sits directly below the rainbow bar', () => {
    expect(home.match(/class="results-actions /g)).toHaveLength(1);
    const rainbow = home.indexOf('class="results-actions ');
    const notices = home.indexOf('<section class="home-notices">');
    expect(rainbow).toBeGreaterThan(-1);
    expect(rainbow).toBeLessThan(notices);
  });

  it('keeps notifications out of the global App shell', () => {
    expect(app).not.toContain('<UpdateAvailableBanner');
    expect(app).not.toContain('<BugResolutionNotice');
    // The whole-app state banners stay global.
    expect(app).toContain('<OfflineBanner');
    expect(app).toContain('<LibraryAccessBanner');
  });
});

// Bug report (2026-09-13): "it would be nice if when I tapped on a
// notification... took me to the home screen with the applicable
// notification already opened and ready to go." The push Lambda sends
// `?open=<chore>`; Home reads it once into `openChoreRequested` and every
// chore card takes it as `autoOpen`. Source-level, like the rest of this
// file — a card that stops receiving the flag would silently go back to
// needing a tap.
describe('opening a chore from a notification', () => {
  it('reads ?open= once and strips it from the URL', () => {
    expect(home).toContain('this.$route?.query?.open');
    expect(home).toContain("this.$router.replace({ query: { ...this.$route.query, open: undefined } })");
  });

  it('hands the request to every chore card', () => {
    const section = noticesSection();
    const stickiness = section.slice(section.indexOf('<StickinessInline'), section.indexOf('/>', section.indexOf('<StickinessInline')));
    const tweak = section.slice(section.indexOf('<TweakInline'), section.indexOf('/>', section.indexOf('<TweakInline')));
    const awards = section.slice(section.indexOf('<PersonalAwardsModal'), section.indexOf('/>', section.indexOf('<PersonalAwardsModal')));
    expect(stickiness).toContain(':autoOpen="openChoreRequested"');
    expect(tweak).toContain(':autoOpen="openChoreRequested"');
    expect(awards).toMatch(/:autoOpen="[^"]*openChoreRequested[^"]*"/);
  });
});
