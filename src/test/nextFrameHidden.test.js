import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// nextFrame gates every route change (router.beforeEach). A hidden document
// never paints, so without a fallback a background tab or a put-away PWA
// hangs its navigation until it is looked at again (2026-09-28). Under
// Vitest nextFrame short-circuits, so this pins the source instead.
describe('nextFrame in a hidden document', () => {
  it('falls back to a timer when document.hidden', () => {
    const src = readFileSync(join(process.cwd(), 'src/utils/nextFrame.js'), 'utf8');
    expect(src).toMatch(/document\.hidden\)\s*setTimeout\(done/);
    expect(src).toContain('requestAnimationFrame(() => requestAnimationFrame(done))');
  });
});
