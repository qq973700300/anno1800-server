// 装饰岛验证：全景（主岛+卫星岛间距）+ 特写一座装饰岛（石峰 / 树 / 岸线）
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '装饰岛' + stamp;

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
await api('/api/islands', 'POST', { playerId: p.id, name: '装饰岛主岛' });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });
  await page.evaluate(() => window.__annoWeather('clear'));
  await new Promise(r => setTimeout(r, 8000));

  // 全景：拉远看主岛 + 四座装饰岛的整体布局
  await page.evaluate(() => window.__annoCam(59.5, 59.5, 620, 0.85, 0.85));
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/decor-archipelago.png' });
  console.log('  shot: decor-archipelago.png');

  // 特写：装饰岛（世界 -260,280 → 格坐标约 (59.5 + -260/1.7, 59.5 + 280/1.7) ≈ (-93.5, 224)）
  await page.evaluate(() => window.__annoCam(-93.5, 224.2, 46, 0.95, 2.2));
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/decor-isle-close.png' });
  console.log('  shot: decor-isle-close.png');

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
} finally {
  await browser.close();
}
