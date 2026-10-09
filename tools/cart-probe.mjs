/**
 * 马车消失探针：伪造派车（durMs=3000）后每 400ms 采样 carts Map 内部状态，
 * 定位车是什么时候、以什么方式被收掉的（dur 对不对 / returning 有没有被误触发 /
 * 是不是 2.5×dur 兜底线提前到）。
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '车探针' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '探针岛', flat: true });
for (let x = 4; x <= 14; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
const lj = await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: 5, z: 6 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);

  const spawnOk = await page.evaluate(id => {
    window.__annoCartSpawn({
      buildingId: id, islandId: window.__annoBuildingViews()[0]?.islandId,
      path: [[5, 8], [10, 8], [14, 8]], durMs: 3000,
    });
    return window.__annoCarts();
  }, lj.id);
  console.log('spawn 后 carts =', spawnOk);

  const t0 = Date.now();
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    const s = await page.evaluate(() => window.__annoCarts());
    console.log(((Date.now() - t0) + 'ms').padStart(7), 'carts=' + s);
    if (s === 0 && i > 4) break;
  }
  console.log('errs:', errs.length ? errs : '无');
} finally { await browser.close(); }
