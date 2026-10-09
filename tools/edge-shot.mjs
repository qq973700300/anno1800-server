// 老岛边界切口验证：登录老岛主 → 镜头钉到压网格边的陆地 → 截图看裙边/海浪是否包住切口
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const OWNER = process.argv[2] || '海岸验证1790159915918';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1500, height: 950 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', OWNER);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  /* 老岛 211 的边界陆地：左列 x=0，z≈23~34。钉到 (0,28) —— 压边岸段的正上方 */
  await page.evaluate(() => window.__annoLookAt(0, 28, 14));
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/edge-fix-1.png' });

  await page.evaluate(() => window.__annoLookAt(0, 28, 26));
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/edge-fix-2.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
