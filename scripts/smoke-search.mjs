// Headless check of Phase C: did-you-mean redirect, Mutopia catalog hits and the missing-index fallback.
//   npx vite --port 5179 &  then  node scripts/smoke-search.mjs <screenshot dir>
import puppeteer from 'puppeteer-core';
const SP = process.argv[2] ?? '.';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = [];

async function newPage(blockIndex = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const logs = [];
  page.on('console', (m) => { if (['error', 'warning', 'warn'].includes(m.type()) && !m.text().includes('GL Driver')) logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  if (blockIndex) {
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().endsWith('/catalog/mutopia.json') ? r.respond({ status: 404, body: 'nope' }) : r.continue()));
  }
  await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
  await wait(800);
  await page.click('#btn-enable-audio');
  await wait(500);
  return { page, logs };
}

async function search(page, q) {
  await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
  await page.type('#search-input', q);
  await page.keyboard.press('Enter');
}

async function resultsText(page) {
  return page.evaluate(() => ({
    head: document.querySelector('#results .res-head span')?.textContent ?? '',
    cards: [...document.querySelectorAll('#results .res-item')].slice(0, 6).map((c) => c.textContent.replace(/\s+/g, ' ').trim()),
    chips: [...document.querySelectorAll('#results .res-sugg')].map((s) => s.textContent.replace(/\s+/g, ' ').trim()),
    empty: document.querySelector('#results .res-empty')?.textContent ?? '',
  }));
}

// 1. Misspelled title with no bitmidi hits: expect one hop to the iTunes candidate.
{
  const { page, logs } = await newPage();
  await search(page, 'yesturday beetles');
  await wait(15000);
  const r = await resultsText(page);
  await page.screenshot({ path: `${SP}/c1-yesturday.png` });
  report.push({ check: 'did-you-mean redirect', head: r.head, chips: r.chips, firstCards: r.cards.slice(0, 3), logs });
  // The "as typed" chip searches the original text once more, without another lookup.
  const chip = (await page.$$('#results .res-sugg button')).at(-1);
  await chip.click();
  await wait(8000);
  const back = await resultsText(page);
  report.push({ check: 'as-typed chip', head: back.head, chips: back.chips, empty: back.empty, logs });
  await page.close();
}
// 2. A catalog search that lands on Mutopia, then load it.
{
  const { page, logs } = await newPage();
  await search(page, 'gymnopedie');
  await wait(6000);
  const r = await resultsText(page);
  await page.screenshot({ path: `${SP}/c2-moonlight.png` });
  const mutopiaCard = await page.$('#results .res-item .tag.catalog');
  const tag = mutopiaCard ? await page.evaluate((e) => e.textContent, mutopiaCard) : null;
  await page.click('#results .res-item');
  await wait(6000);
  const toast = await page.evaluate(() => document.querySelector('#toast')?.textContent);
  const title = await page.evaluate(() => document.querySelector('#song-title')?.textContent ?? document.title);
  const bars = await page.evaluate(() => document.querySelectorAll('.bs-bar').length);
  await page.screenshot({ path: `${SP}/c3-loaded.png` });
  report.push({ check: 'mutopia catalog hit and load', head: r.head, firstCards: r.cards.slice(0, 3), tag, toast, loadedTitle: title, bars, logs });
  await page.close();
}
// 3. Prose query without a key: expect iTunes chips under weak results.
{
  const { page, logs } = await newPage();
  await search(page, 'that sad piano song from interstellar');
  await wait(9000);
  const r = await resultsText(page);
  await page.screenshot({ path: `${SP}/c4-prose.png` });
  report.push({ check: 'prose query, iTunes chips', head: r.head, chips: r.chips, logs });
  await page.close();
}
// 3b. "moonlight sonata": bitmidi uploads lead, half-matching catalog sonatas stay out.
{
  const { page, logs } = await newPage();
  await search(page, 'moonlight sonata');
  await wait(7000);
  const r = await resultsText(page);
  report.push({ check: 'moonlight sonata leads with bitmidi', head: r.head, firstCards: r.cards.slice(0, 3), logs });
  await page.close();
}
// 4. Index missing: eight built-ins, a console warning, no error.
{
  const { page, logs } = await newPage(true);
  await page.click('#btn-catalog');
  await wait(500);
  const n = await page.evaluate(() => document.querySelectorAll('#results .res-item').length);
  report.push({ check: 'missing index fallback', builtIns: n, logs });
  await page.close();
}
console.log(JSON.stringify(report, null, 1));
await browser.close();
