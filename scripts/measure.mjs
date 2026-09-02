import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
await page.goto('http://localhost:5179/', { waitUntil: 'networkidle0' });
await page.click('#btn-enable-audio');
const measure = () => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.width), Math.round(b.height)]; };
  const app = window.__app; const p = app.piano;
  return { piano: r('#piano'), canvas: r('#piano canvas'), controls: r('.controls'), sheetB: r('#sheet-beginner'), sheetA: r('#sheet-advanced'),
    canvasAttr: [document.querySelector('#piano canvas').width, document.querySelector('#piano canvas').height],
    cam: p.camera ? { pos: p.camera.position.toArray().map((v) => +v.toFixed(1)), target: p.controls.target.toArray().map((v) => +v.toFixed(1)), aspect: +p.camera.aspect.toFixed(2), focus: p.focus } : null };
});
console.log('initial', JSON.stringify(await measure()));
await page.click('#level-picker [data-level="2"]');
await new Promise((r) => setTimeout(r, 500));
console.log('after L2', JSON.stringify(await measure()));
await browser.close();
