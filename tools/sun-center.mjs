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
  await page.goto('http://127.0.0.1:8080/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', '居中' + Date.now());
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
    window.__annoCloudLayer(true);
  });
  await new Promise(r => setTimeout(r, 800));
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
  // 上午 9:52（用户截图时刻），太阳仰角约 29° → polar = 1.57 + 0.51
  for (const az of [3.4, 3.7, 4.0, 4.3, 4.6]) {
    const b = await probe(9.87, 2.08, az);
    console.log('9.87 polar2.08 az=' + az + ' best=(' + b.x + ',' + b.y + ') l=' + b.l);
  }
  console.log('DONE');
} finally { await browser.close(); }
