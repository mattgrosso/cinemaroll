import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';

// Small deploys stay small downloads (bug report, Matt, 2026-10-02: the
// automatic update sat for 5+ seconds). vite.config.mjs's coreChunk puts
// everything the app loads up front in js/core.<hash>.js, except main.js and
// router/index.js, which stay in js/app.<hash>.js. Every screen imports core,
// so core must come out byte-identical from builds that didn't touch shared
// code - otherwise every screen's file name changes and a phone re-downloads
// most of the app for a one-screen tweak (51 files, 2.6 MB, measured).
//
// Two things broke that, and these pin both. A real build is too slow for a
// unit test, so they read the source - the same style as homeNotices.test.js.

const src = join(process.cwd(), 'src');

const sourceFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(full);
  return /\.(js|vue)$/.test(entry.name) ? [full] : [];
});

const files = sourceFiles(src).map((full) => ({
  path: relative(src, full),
  text: readFileSync(full, 'utf8')
}));

describe('the shared core chunk never depends on the entry chunk', () => {
  it('only main.js imports the router (it names every screen file)', () => {
    // '@/router', '../router', './router', with or without /index.js - but
    // not router/appRouter.js or router/scrollBehavior.js, which are core.
    const importsRouterIndex = /from\s+['"](?:@|\.{1,2})\/(?:\.\.\/)*router(?:\/index(?:\.js)?)?['"]|from\s+['"]\.\/router['"]/;
    const offenders = files
      .filter(({ path, text }) => path !== 'main.js' && importsRouterIndex.test(text))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('only main.js reads the per-build version and build time', () => {
    // version.js is the deploy-time Node script, never bundled.
    const offenders = files
      .filter(({ path }) => path !== 'main.js' && path !== join('assets', 'javascript', 'version.js'))
      .filter(({ text }) => /process\.env\.VUE_APP_(VERSION|BUILD_TIME)/.test(text.replace(/^\s*\/\/.*$/gm, '')))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it('the build keeps main.js and the router out of core', () => {
    const config = readFileSync(join(process.cwd(), 'vite.config.mjs'), 'utf8');
    expect(config).toMatch(/manualChunks:\s*coreChunk\(\)/);
    expect(config).toContain('/\\/src\\/main\\.js$/');
    expect(config).toContain('/\\/src\\/router\\/index\\.js$/');
  });
});
