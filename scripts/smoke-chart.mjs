// Headless check of chord charts: a pasted chart becomes a play-along; the same chart constrains a loaded song's chords.
//   npx vite --port 5179 &  then  node scripts/smoke-chart.mjs
import puppeteer from 'puppeteer-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CHART = `title: Dil Dil Pakistan\nartist: Vital Signs\nkey: D minor\ntempo: 87\ntime: 4/4\n\n[Intro]\nDm | Am | Dm | Am   x2\nBb | C\n[Verse]\nDm | C | Am | Dm\nDm | C | Bb | %\n[Chorus]\nDm | Bb | C | Am Bb C`;
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GL Driver')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio'); await wait(400);
const report = { logs };
// 1. Constrain Twinkle (loaded by default, C major) to the chart's chords: every chord must be Dm, Am, Bb or C.
await page.click('#btn-chords'); await wait(300);
await page.evaluate((t) => { document.querySelector('#chart-text').value = t; }, CHART);
await page.click('#btn-chart-apply'); await wait(800);
report.constrained = await page.evaluate(() => ({ title: document.querySelector('#song-title').textContent, chords: [...new Set(window.__app.arr.chords.map((c) => c.name))], toast: document.querySelector('#toast').textContent }));
// 2. Build the play-along from the chart.
await page.click('#btn-chords'); await wait(300);
await page.evaluate((t) => { document.querySelector('#chart-text').value = t; }, CHART);
await page.click('#dlg-chords button[value="play"]'); await wait(1500);
report.playAlong = await page.evaluate(() => ({
  title: document.querySelector('#song-title').textContent, info: document.querySelector('#song-info').textContent,
  chords: window.__app.arr.chords.slice(0, 6).map((c) => c.name), bars: window.__app.arr.totalBars,
  stage1: window.__app.arr.levels[1].notes.slice(0, 4).map((n) => n.letter + n.octave), stage4Lh: window.__app.arr.levels[4].notes.filter((n) => n.hand === 'lh').length,
  steps: [...document.querySelectorAll('#steps li h3')].slice(0, 3).map((e) => e.textContent),
}));
// 3. A bad chart is refused with the offending token.
await page.click('#btn-chords'); await wait(300);
await page.evaluate(() => { document.querySelector('#chart-text').value = 'Dm | Aisi zameen | Am'; });
await page.click('#dlg-chords button[value="play"]'); await wait(500);
report.badChart = await page.evaluate(() => document.querySelector('#toast').textContent);
console.log(JSON.stringify(report, null, 1));
await browser.close();
