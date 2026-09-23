// Speed tour: times every screen open, Insights tab, Home control, search
// keystroke and a grid scroll at phone speed (4x CPU throttle), signed in as
// the tester with Matt's library cloned. The 2026-09-23 speed sweep's ruler.
//
//   python3 -m http.server 8089 --directory dist        # serve a build
//   yarn mint-test-token --seed-from mattgrosso-gmail-com | grep -o 'testToken=[^ ]*' | cut -d= -f2 > cr-token.txt
//   node scripts/perf-tour.mjs                          # reads ./cr-token.txt
//
// Playwright is imported from meal-hat's node_modules (the one install in
// ~/code); "ready" is when the screen's root appears, "idle" when no long
// task has ended for 400ms, "busy" the long-task total since the tap. The
// relaunch row's numbers are meaningless (performance.now resets on reload);
// see the boot-phases approach in docs/history/ui-and-layout.md for that.
import { chromium } from '/Users/mjg/code/meal-hat/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const TOKEN = readFileSync('cr-token.txt', 'utf8').trim(); const BASE = 'http://localhost:8089';
const CPU = Number(process.env.CPU || 4);
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 402, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await context.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ s: e.startTime, d: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
const rows = [];
const now = () => page.evaluate(() => performance.now());
const idle = async (since) => { // wait until no long task has ended in the last 400ms
  const t = Date.now();
  while (Date.now() - t < 20000) {
    const last = await page.evaluate((s) => { const l = window.__lt.filter((x) => x.s + x.d > s); return l.length ? Math.max(...l.map((x) => x.s + x.d)) : 0; }, since);
    const n = await now();
    if (n - Math.max(last, since) > 400) return;
    await page.waitForTimeout(100);
  }
};
const measure = async (name, action, ready) => {
  const t0 = await now();
  await action();
  const t = Date.now(); let ok = false;
  while (Date.now() - t < 20000) { if (await page.evaluate(ready)) { ok = true; break; } await page.waitForTimeout(50); }
  const tReady = (await now()) - t0;
  await idle(t0);
  const tIdle = (await now()) - t0;
  const busy = await page.evaluate((s) => window.__lt.filter((x) => x.s >= s).reduce((a, x) => a + x.d, 0), t0);
  rows.push({ name, ready: ok ? Math.round(tReady) : 'TIMEOUT', idle: Math.round(tIdle), busy: Math.round(busy) });
  console.log(`${String(rows.at(-1).ready).padStart(7)}ms ready ${String(rows.at(-1).idle).padStart(6)}ms idle ${String(rows.at(-1).busy).padStart(6)}ms busy  ${name}`);
};
const homeUp = () => !!document.querySelector('.search-bar');
const hashIs = (h) => new Function(`return location.hash.startsWith('#${h}')`);
const back = async (label = 'back to Home') => { await measure(label, () => page.evaluate(() => history.back()), homeUp); };

await page.goto(`${BASE}/#/login?testToken=${TOKEN}`, { waitUntil: 'commit' });
await page.waitForSelector('.search-bar', { timeout: 120000 });
await page.waitForFunction(() => navigator.serviceWorker?.controller || false, null, { timeout: 60000 });
await page.waitForTimeout(4000);
await measure('warm relaunch (reload)', () => page.reload({ waitUntil: 'commit' }), homeUp);
await page.waitForTimeout(1500);

await measure('Home -> Insights', () => page.click('button[aria-label="Go to insights"]'), () => !!document.querySelector('.insights-tabs'));
for (const tab of ['Ratings', 'Activity', 'People', 'Places', 'Overview']) {
  await measure(`Insights tab: ${tab}`, () => page.click(`.insights-tab:has-text("${tab}")`), () => true);
}
await back();
await measure('Home -> Games hub', () => page.click('button[aria-label="Go to games"]'), () => !!document.querySelector('.games-hub'));
await back();
await measure('Home -> Watchlist', () => page.click('button[aria-label="Go to watchlist"]'), () => !document.querySelector('.search-bar'));
await back();
await measure('Home -> Film Club', () => page.click('button[aria-label="Go to the Film Club"]'), () => !document.querySelector('.search-bar'));
await back();
await measure('Home -> poster tap (detail)', () => page.locator('.results img').first().click(), () => !!document.querySelector('.movie-detail-page, .modal.show'));
await back();
for (const route of ['/stats', '/trophy-case', '/year-in-review', '/awards', '/newsletter', '/club-charts', '/library-poster', '/games/wordle', '/games/stats', '/games/higher-lower']) {
  await measure(`route ${route}`, () => page.evaluate((r) => { location.hash = r; }, route), hashIs(route));
  await back();
}
await measure('open Settings panel', () => page.click('button[aria-label="Open settings"]'), () => true);
await measure('close Settings panel', () => page.click('button[aria-label="Open settings"]'), () => true);
await measure('Sort results (cycle)', () => page.click('button[aria-label="Sort results"]'), () => true);
await measure('Sort results (cycle again)', () => page.click('button[aria-label="Sort results"]'), () => true);
await measure('Toggle quick filters', () => page.click('button[aria-label="Toggle quick filters"]'), () => true);
await measure('Toggle quick filters (close)', () => page.click('button[aria-label="Toggle quick filters"]'), () => true);
await measure('Toggle count/average/views', () => page.click('button[aria-label="Toggle between result count, average rating, and view count"]'), () => true);
await page.click('.search-bar input');
for (const ch of ['t', 'h', 'e', ' ', 'g']) await measure(`type "${ch}" (search keystroke)`, () => page.keyboard.type(ch), () => true);
await measure('clear search', () => page.fill('.search-bar input', ''), () => true);
await page.keyboard.press('Escape').catch(() => {});
// scroll: 12 steps of 500px, count frames
const scroll = await page.evaluate(async () => {
  window.scrollTo(0, 0); await new Promise((resolve) => setTimeout(resolve, 300));
  const t0 = performance.now(); const lt0 = window.__lt.length;
  let frames = 0; let stop = false; const tick = () => { frames++; if (!stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  for (let i = 0; i < 12; i++) { window.scrollBy(0, 500); await new Promise((resolve) => setTimeout(resolve, 150)); }
  stop = true; const dt = performance.now() - t0;
  const busy = window.__lt.slice(lt0).reduce((a, x) => a + x.d, 0);
  return { fps: Math.round(frames / (dt / 1000)), busy: Math.round(busy), dt: Math.round(dt) };
});
console.log(`scroll Home grid 6000px: ${scroll.fps} fps, ${scroll.busy}ms in long tasks over ${scroll.dt}ms`);
await measure('More... (load more results)', () => page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^More/.test(b.textContent.trim()))?.click()), () => true);
console.log('\n=== slowest by ready time ==='); rows.filter((r) => typeof r.ready === 'number').sort((a, b) => b.ready - a.ready).slice(0, 12).forEach((r) => console.log(`${String(r.ready).padStart(6)}ms  ${r.name}`));
console.log('\n=== most main-thread busy ==='); rows.sort((a, b) => b.busy - a.busy).slice(0, 12).forEach((r) => console.log(`${String(r.busy).padStart(6)}ms  ${r.name}`));
await browser.close();
