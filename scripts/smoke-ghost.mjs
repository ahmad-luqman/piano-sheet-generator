// Headless check of the ghost hand: weak bars leave the learner's steps in Learn mode and come back on the third run.
//   npx vite --port 5179 &  then  node scripts/smoke-ghost.mjs
import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.evaluate(() => { localStorage.removeItem('psg.progress.v1'); localStorage.setItem('psg.ghost', '1'); });
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio'); await wait(500);
// Seed: Twinkle stage 1, right hand bars 1–2 missed twice.
await page.evaluate(() => {
  const app = window.__app;
  const key = app.songProgressKey();
  const weak = { notes: 4, hits: 1, wrong: 0, timed: 0, onTime: 0, pauses: 0, attempts: 2 };
  const stage = { attempts: [], bars: { '0:rh': weak, '1:rh': weak, '2:rh': { ...weak, hits: 4 } }, causes: {}, cleanRuns: 0, cleanReps: 0, bestCleanTempo: 0, earned: false, fragments: {} };
  localStorage.setItem('psg.progress.v1', JSON.stringify({ v: 1, songs: { [key]: { key, title: 'Twinkle', stages: { 1: stage }, updatedAt: new Date().toISOString(), journal: [] } } }));
});
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio'); await wait(500);
const runs = [];
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__app.runAction({ startBar: 0, endBar: 3, hands: 'rh', tempoScale: 0.6, level: 1, mode: 'learn' }));
  await wait(700);
  runs.push(await page.evaluate(() => ({ status: document.querySelector('#status').textContent, firstStepBeat: window.__app.player.steps[0]?.beat, steps: window.__app.player.steps.length })));
  await page.click('#btn-stop'); await wait(300);
}
console.log(JSON.stringify({ runs, logs }, null, 1));
await browser.close();
