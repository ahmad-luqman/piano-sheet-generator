// Drives a Rhythm lap and a whole-piece Perform lap on Twinkle against a dev server on :5179 and prints what was scored and saved.
import puppeteer from 'puppeteer-core';
const SP = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEY = { C3: 'Z', D3: 'X', E3: 'C', F3: 'V', G3: 'B', A3: 'N', B3: 'M', C4: 'Q', D4: 'W', E4: 'E', F4: 'R', G4: 'T', A4: 'Y', B4: 'U', C5: 'I', D5: 'O', E5: 'P' };
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (['error'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.removeItem('psg.progress.v1'));
await page.reload({ waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio');
await sleep(500);
await page.evaluate(() => window.__app.setLevel(1));
await sleep(200);
const press = async (k) => { await page.keyboard.down(`Key${k}`); await sleep(30); await page.keyboard.up(`Key${k}`); };
const notes = await page.evaluate(() => window.__app.arr.levels[1].notes.filter((n) => n.hand === 'rh').map((n) => ({ key: `${n.letter}${n.octave}`, beat: n.startBeat })));
const run = async (action, lagMs) => {
  await page.evaluate((a) => window.__app.runAction(a), action);
  const spb = 60 / (100 * action.tempoScale) * 1000;
  const t0 = Date.now();
  const offsets = [];
  for (const n of notes.filter((x) => x.beat >= action.startBar * 4 && x.beat < (action.endBar + 1) * 4)) {
    const wait = t0 + (n.beat - action.startBar * 4) * spb - lagMs - Date.now(); if (wait > 0) await sleep(wait);
    await press(KEY[n.key]);
    const beat = await page.evaluate(() => window.__app.player.beat);
    offsets.push(Math.round((beat - n.beat) * 1000) / 1000);
  }
  await sleep(600);
  const status = await page.$eval('#status', (e) => e.textContent);
  await page.click('#btn-stop');
  await sleep(300);
  const toast = await page.$eval('#toast', (e) => e.textContent);
  return { offsets, status, toast, panel: await page.$eval('#progress', (e) => e.innerText) };
};
// Lap A: rhythm, bars 1-4, uncompensated → measures the harness lag in beats
const A = await run({ startBar: 0, endBar: 3, hands: 'rh', tempoScale: 0.6, level: 1, mode: 'rhythm' }, 0);
const meanLagBeats = A.offsets.reduce((s, x) => s + x, 0) / A.offsets.length;
const lagMs = meanLagBeats * 1000; // 1000 ms per beat at 60%
await page.screenshot({ path: `${SP}/p2-rhythm.png` });
// Lap B: perform, whole piece, compensated → should be clean and start the streak
const B = await run({ startBar: 0, endBar: 11, hands: 'rh', tempoScale: 0.8, level: 1, mode: 'perform' }, lagMs * 0.8 / 0.6 * 0.6 / 0.8);
await page.screenshot({ path: `${SP}/p3-perform.png` });
const heat = await page.$$eval('#sheet-beginner .bs-num', (els) => els.slice(0, 4).map((e) => e.className.replace('bs-num', '').trim() + ':' + e.title));
const lastStep = await page.$$eval('#steps li h3', (els) => els[els.length - 1].textContent);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('psg.progress.v1')));
const stage1 = Object.values(stored.songs)[0].stages['1'];
await page.reload({ waitUntil: 'networkidle0' });
await sleep(500);
await page.evaluate(() => window.__app.setLevel(1));
await sleep(200);
const panel3 = await page.$eval('#progress', (e) => e.innerText);
const forYou = panel3.split('\n').filter((l, i, a) => /^For you/.test(l) || (i > 0 && /^For you/.test(a[i - 1]))).join(' | ');
console.log(JSON.stringify({ A: { offsets: A.offsets, status: A.status, toast: A.toast }, lagMs: Math.round(lagMs), B: { offsets: B.offsets.slice(0, 8), toast: B.toast, panel: B.panel }, heat, lastStep,
  attempts: stage1.attempts.map((a) => ({ mode: a.mode, bars: `${a.startBar}-${a.endBar}`, notes: a.noteAccuracy, timing: a.timingAccuracy, wrong: a.wrong, clean: a.clean })), cleanRuns: stage1.cleanRuns, cleanReps: stage1.cleanReps, fingerprint: stage1.fingerprint, bestCleanTempo: stage1.bestCleanTempo, forYou, panel3: panel3.split('\n').slice(0, 5), logs }, null, 1));
await browser.close();
