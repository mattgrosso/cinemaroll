import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// The launch splash (2026-10-20): opening the home-screen app used to show a
// plain white page for seconds. index.html now paints dark from the first
// byte, shows the icon and name inside #app until Vue's mount replaces them,
// and hands iOS a launch image for every current iPhone screen.
const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.json'), 'utf8'));

// PNG width/height live at fixed offsets in the IHDR chunk.
const pngSize = (file) => {
  const buf = readFileSync(file);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
};

describe('launch splash', () => {
  it('paints the page dark before any bundled CSS loads', () => {
    const inlineStyle = html.match(/<style>([\s\S]*?)<\/style>/)[1];
    expect(inlineStyle).toMatch(/html, body \{ background-color: #212529; \}/);
  });

  it('puts the splash inside #app, so mounting the app is what removes it', () => {
    const app = html.match(/<div id="app">([\s\S]*?)<\/div>\s*<script/)[1];
    expect(app).toContain('class="launch-splash"');
    expect(app).toContain('src="/img/splash-icon.png"');
    expect(app).toContain('Cinema Roll');
    expect(existsSync(resolve(root, 'public/img/splash-icon.png'))).toBe(true);
  });

  it('gives the installed app a dark background, not white', () => {
    expect(manifest.background_color).toBe('#212529');
  });

  it('has a launch image for each listed iPhone screen, at that screen\'s real pixel size', () => {
    const links = [...html.matchAll(/<link rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/g)];
    expect(links.length).toBeGreaterThanOrEqual(10);
    for (const [, href, w, h, dpr] of links) {
      const file = resolve(root, 'public' + href);
      expect(existsSync(file), href).toBe(true);
      expect(pngSize(file), href).toEqual([w * dpr, h * dpr]);
    }
    // The current Pro size (the reporting phone) is covered.
    expect(links.some(([, , w, h, dpr]) => w === '402' && h === '874' && dpr === '3')).toBe(true);
  });
});
