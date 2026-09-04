// Headless check of "playable for you": seeded progress → library badges and order, panel readiness and the bridge song.
//   npx vite --port 5179 &  then  node scripts/smoke-fit.mjs <screenshot dir>
import puppeteer from 'puppeteer-core';
const SP = process.argv[2] ?? '.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (['error'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.removeItem('psg.progress.v1'));
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio'); await wait(500);
const report = {};
process.on('unhandledRejection', (e) => { console.log(JSON.stringify({ report, logs, error: String(e) }, null, 1)); process.exit(1); });
// 1. No profile: panel says what to do, library sorts easiest first.
report.panelNoProfile = await page.$eval('#progress', (e) => e.innerText.split('\n').filter((l) => l.startsWith('For you')));
await page.click('#btn-catalog'); await wait(800);
report.libraryNoProfile = await page.evaluate(() => ({
  head: document.querySelector('#results .res-head span')?.textContent,
  first: [...document.querySelectorAll('#results .res-item')].slice(0, 3).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
}));
await page.evaluate(() => { document.querySelector('#results').hidden = true; }); await wait(200);
// 2. Seed a learner who played Twinkle's stage 4 clean at full tempo in Perform mode.
await page.evaluate(() => {
  const app = window.__app;
  const fp = app.stageFingerprint(4);
  const stage = { attempts: [], bars: {}, causes: {}, cleanRuns: 2, cleanReps: 2, bestCleanTempo: 1, earned: true, fragments: {}, fingerprint: fp };
  localStorage.setItem('psg.progress.v1', JSON.stringify({ v: 1, songs: { seed: { key: 'seed', title: 'Twinkle', stages: { 4: stage }, updatedAt: new Date().toISOString(), journal: [] } } }));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio'); await wait(800);
await page.click('#btn-catalog'); await wait(800);
report.library = await page.evaluate(() => ({
  head: document.querySelector('#results .res-head span')?.textContent,
  first: [...document.querySelectorAll('#results .res-item')].slice(0, 4).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
  badges: [...document.querySelectorAll('#results .res-item .badge')].map((b) => b.textContent).reduce((m, t) => ({ ...m, [t]: (m[t] ?? 0) + 1 }), {}),
}));
await page.screenshot({ path: `${SP}/f1-library.png` });
await page.evaluate(() => { document.querySelector('#results').hidden = true; }); await wait(200);
// 3. Load a hard piece: the panel names the gap and offers a bridge.
await page.type('#search-input', 'fantaisie impromptu'); await page.keyboard.press('Enter'); await wait(5000);
await page.click('#results .res-item'); await wait(6000);
report.hard = {
  title: await page.$eval('#song-title', (e) => e.textContent),
  panel: await page.$eval('#progress', (e) => e.innerText.split('\n').filter((l) => /^(For you|Bridge)/.test(l))),
};
await page.screenshot({ path: `${SP}/f2-panel.png` });
const open = await page.$('#progress .pg-bridge button');
if (open) { await open.click(); await wait(6000); report.bridgeOpened = await page.$eval('#song-title', (e) => e.textContent); report.bridgePanel = await page.$eval('#progress', (e) => e.innerText.split('\n').filter((l) => /^For you/.test(l))); }
report.logs = logs;
console.log(JSON.stringify(report, null, 1));
await browser.close();
