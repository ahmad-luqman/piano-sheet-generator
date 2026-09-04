// Headless check of Phase G: a melody synthesized in the page is transcribed back, an Urdu-script query reaches iTunes
// and offers preview cards, and a live iTunes preview transcribes and loads.
//   npx vite --port 5179 &  then  node scripts/smoke-audio.mjs <screenshot dir>
import puppeteer from 'puppeteer-core';
const SP = process.argv[2] ?? '.';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GL Driver')) logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.evaluate(() => localStorage.removeItem('psg.transcriptions.v1'));
await page.click('#btn-enable-audio'); await wait(500);
const report = { logs };
// 1. Synthesize Twinkle's first phrase (C C G G A A G, quarter notes at 120 bpm) with a plain oscillator and transcribe it.
report.synth = await page.evaluate(async () => {
  const seq = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];
  const rate = 22050, beat = 0.5, total = seq.length * beat + 0.5;
  const ctx = new OfflineAudioContext(1, Math.ceil(total * rate), rate);
  seq.forEach((midi, i) => {
    const osc = ctx.createOscillator(); osc.type = 'triangle'; osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, i * beat); g.gain.linearRampToValueAtTime(0.5, i * beat + 0.02); g.gain.setValueAtTime(0.5, (i + 1) * beat - 0.08); g.gain.linearRampToValueAtTime(0, (i + 1) * beat - 0.01);
    osc.connect(g).connect(ctx.destination); osc.start(i * beat); osc.stop((i + 1) * beat);
  });
  const buf = await ctx.startRendering();
  const t0 = performance.now();
  const notes = await window.__app.transcribeSamples(buf.getChannelData(0));
  const ms = Math.round(performance.now() - t0);
  const sorted = notes.filter((n) => n.duration > 0.1).sort((a, b) => a.start - b.start);
  const got = sorted.map((n) => n.midi);
  let matched = 0; for (let i = 0; i < Math.min(got.length, seq.length); i++) if (got[i] === seq[i]) matched++;
  return { expected: seq, got, matched, ms };
});
// 2. Urdu-script query: no catalog flood, iTunes redirect, preview cards.
await page.type('#search-input', 'دل دل پاکستان'); await page.keyboard.press('Enter'); await wait(12000);
report.urdu = await page.evaluate(() => ({
  head: document.querySelector('#results .res-head span')?.textContent,
  catalogCards: document.querySelectorAll('#results .tag.catalog').length,
  previewCards: [...document.querySelectorAll('#results .res-item .tag.preview')].map((t) => t.parentElement.querySelector('.res-title').textContent.replace(/\s+/g, ' ').trim()),
}));
await page.screenshot({ path: `${SP}/g1-urdu.png` });
// 3. Transcribe the first preview live.
const btn = await page.$('#results .res-item .tag.preview ~ button');
if (btn) {
  await btn.click();
  for (let i = 0; i < 40; i++) { await wait(1500); const t = await page.$eval('#song-title', (e) => e.textContent); if (!/Twinkle/.test(t)) break; }
  await wait(1500);
  report.transcribed = {
    title: await page.$eval('#song-title', (e) => e.textContent),
    info: await page.$eval('#song-info', (e) => e.textContent),
    toast: await page.$eval('#toast', (e) => e.textContent),
    stage1Notes: await page.evaluate(() => window.__app.arr.levels[1].notes.length),
  };
  await page.screenshot({ path: `${SP}/g2-transcribed.png` });
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
