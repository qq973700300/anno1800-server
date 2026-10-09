// 夜景验证：平岛上搭一座小镇（贸易站 + 路 + 住宅 + 工厂），拨到深夜截图
const BASE = 'http://127.0.0.1:8080';
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method||'GET', headers: {'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status)); return j.data;
};

const tag = Date.now().toString().slice(-6);
const p = await api('/api/players/register', 'POST', { name: '夜景小镇' + tag });
const island = await api('/api/islands', 'POST', { playerId: p.id, name: '灯火山', flat: true });

const built = [];
const tryBuild = async (type, x, z) => {
  try { await api('/api/buildings', 'POST', { playerId: p.id, islandId: island.id, type, x, z }); built.push(type + '@' + x + ',' + z); }
  catch (e) { console.log('BUILD FAIL', type, x, z, e.message); }
};
await tryBuild('TRADING_POST', 0, 8);            // 贴地图边缘 = 临海（平岛规则）
for (const [x, z] of [[3,8],[4,8],[5,8],[6,8],[7,8],[8,8],[9,8],[10,8],[6,9],[6,10],[7,10]]) {
  await api('/api/roads', 'POST', { playerId: p.id, islandId: island.id, x, z });
}
await tryBuild('FARMER_HOUSE', 4, 9);
await tryBuild('FARMER_HOUSE', 8, 9);
await tryBuild('LUMBERJACK', 10, 9);
await tryBuild('SAWMILL', 7, 11);
console.log('built:', built.join(' '));

import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
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
  await page.type('#nameIn', p.name);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });

  const shoot = async (hour, file, dist, polar) => {
    await page.evaluate((h) => { window.__annoNpcWorld.clock.hour = h; window.__annoNpcWorld.clock.day = 1; }, hour);
    await page.evaluate(([gx, gz, d, po]) => window.__annoCam(gx, gz, d, po, 0.85), [8, 9, dist, polar]);
    await new Promise(r => setTimeout(r, 1600));
    await page.screenshot({ path: 'target/' + file });
  };

  await shoot(23, 'town-night.png', 16, 1.0);
  await shoot(23, 'town-night-wide.png', 34, 0.95);
  await shoot(12, 'town-day.png', 16, 1.0);
  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
