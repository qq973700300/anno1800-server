import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { PNG } from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/pngjs/lib/png.js';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('http://127.0.0.1:8080/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', '扫描' + Date.now());
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
    window.__annoNpcWorld.clock.hour = 7.5; window.__annoNpcWorld.clock.day = 1;
    window.__annoCloudLayer(true);   // 藏云排除遮挡
  });
  await new Promise(r => setTimeout(r, 800));
  for (let k = 0; k < 8; k++) {
    const az = k * Math.PI / 4;
    await page.evaluate(a => window.__annoCam(60, 60, 90, 1.57, a), az);
    await new Promise(r => setTimeout(r, 900));
    const shot = await page.screenshot();
    const png = PNG.sync.read(shot);
    let best = { l: -1, x: 0, y: 0 };
    for (let y = 0; y < 350; y += 2) for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * 4;
      const l = png.data[i] + png.data[i + 1] + png.data[i + 2];
      if (l > best.l) best = { l, x, y };
    }
    console.log('az=' + az.toFixed(2) + ' best=(' + best.x + ',' + best.y + ') l=' + best.l);
  }
  console.log('errs:', errs.length ? errs : '无');
  console.log('DONE');
} finally { await browser.close(); }
