import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:8080/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', '两方位' + Date.now());
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
    window.__annoNpcWorld.clock.hour = 7.5; window.__annoNpcWorld.clock.day = 1;
    window.__annoCloudLayer(true);
  });
  await new Promise(r => setTimeout(r, 800));
  await page.evaluate(() => window.__annoCam(60, 60, 90, 1.57, 3.93));
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'target/sun-az393.png' });
  await page.evaluate(() => window.__annoCam(60, 60, 90, 1.57, 1.26));
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'target/sun-az126.png' });
  console.log('DONE');
} finally { await browser.close(); }
