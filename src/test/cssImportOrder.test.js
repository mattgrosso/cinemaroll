import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Bug report -P1Wmwd5Ch4yvscoP5Xq (2026-09-14): "Did the font change for some
// reason on our notifications and while really notification but on our like
// alert banner looks different."
//
// It changed everywhere, not just on the banner — that was only where he
// noticed it. Vite (moved to the same day) emits stylesheets in MODULE-GRAPH
// ORDER, and `main.js` imported App.vue before Bootstrap. So Bootstrap's
//     body { font-family: var(--bs-body-font-family) }
// landed AFTER App.vue's
//     body { font-family: "Roboto Condensed", sans-serif }
// in the one app.css, same specificity, later wins — and the whole app fell
// back to the system font stack. Vue CLI extracted vendor CSS to its own
// file and loaded it first, so the order had never had to be stated.
//
// This is a source-ORDER bug, so a source-order assertion is the real guard,
// not a proxy for one: put the vendor CSS back below App.vue and this fails.
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const main = read('../main.js');
const app = read('../App.vue');

describe('stylesheet import order', () => {
  it('imports vendor CSS before any app code that overrides it', () => {
    const bootstrapCss = main.indexOf('bootstrap/dist/css/bootstrap.min.css');
    const bootstrapIcons = main.indexOf('bootstrap-icons/font/bootstrap-icons.css');
    const appComponent = main.indexOf('./App.vue');

    expect(bootstrapCss).toBeGreaterThan(-1);
    expect(bootstrapIcons).toBeGreaterThan(-1);
    expect(appComponent).toBeGreaterThan(-1);

    expect(bootstrapCss).toBeLessThan(appComponent);
    expect(bootstrapIcons).toBeLessThan(appComponent);
  });

  it('still has the app font rule the order exists to protect', () => {
    // If this ever moves out of App.vue, the ordering rule above needs to
    // follow it rather than quietly guarding nothing.
    expect(app).toMatch(/body\s*{[^}]*font-family:\s*"Roboto Condensed"/);
  });
});
