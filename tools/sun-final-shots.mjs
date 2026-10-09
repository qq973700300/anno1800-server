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
  await page.type('#nameIn', '日辉定稿' + Date.now());
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  const probe = async (hour, polar, az) => {
    await page.evaluate(([h, p, a]) => {
      window.__annoNpcWorld.clock.hour = h; window.__annoNpcWorld.clock.day = 1;
      window.__annoCam(60, 60, 90, p, a);
    }, [hour, polar, az]);
    await new Promise(r => setTimeout(r, 700));
    const shot = await page.screenshot();
    const png = PNG.sync.read(shot);
    let best = { l: -1, x: 0, y: 0 };
    for (let y = 0; y < 500; y += 2) for (let x = 0; x < png.width; x += 2) {
      const i = (y * png.width + x) * 4;
      const l = png.data[i] + png.data[i + 1] + png.data[i + 2];
      if (l > best.l) best = { l, x, y };
    }
    return best;
  };
  const aim = async (hour, polar, az0, az1) => {
    // 两点插值找太阳居中方位
    const b0 = await probe(hour, polar, az0);
    const b1 = await probe(hour, polar, az1);
    if (b0.l < 740 || b1.l < 740) { console.log('warn: blob weak', b0.l, b1.l); }
    const t = (600 - b0.x) / (b1.x - b0.x);
    const az = az0 + t * (az1 - az0);
    await page.evaluate(([h, p, a]) => {
      window.__annoNpcWorld.clock.hour = h; window.__annoNpcWorld.clock.day = 1;
      window.__annoCam(60, 60, 90, p, a);
    }, [hour, polar, az]);
    await new Promise(r => setTimeout(r, 1500));
    return az;
  };
  let az = await aim(9.87, 2.08, 3.7, 4.0);
  await page.screenshot({ path: 'target/sun-final-952am.png' });
  console.log('9:52am az=' + az.toFixed(2));
  az = await aim(12, 2.25, 3.6, 4.1);
  await page.screenshot({ path: 'target/sun-final-noon.png' });
  console.log('noon az=' + az.toFixed(2));
  az = await aim(17.2, 1.75, 3.6, 4.4);
  await page.screenshot({ path: 'target/sun-final-dusk.png' });
  console.log('dusk az=' + az.toFixed(2));
  console.log('errs:', errs.length ? errs : '无');
  console.log('DONE');
} finally { await browser.close(); }
