/**
 * 工人 + 马车系统视觉验证：
 *  ① 盖一座"招不到工人"的纺织厂 → 琥珀色缺工人标记（对比伐木场的正常运转）
 *  ② 等伐木场攒满一车 → 马车动画在路上 → 截图
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '物流验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '物流岛', flat: true });
await api('/api/market/buy', 'POST', { playerId: p.id, good: 'TIMBER', quantity: 12 });  // 纺织厂要 10 木板，开局只带 4
for (let x = 5; x <= 15; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 5, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: 5, z: 6 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TEXTILE_MILL', x: 11, z: 5 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: 8, z: 6 });  // 2+5+2=9 > 8 人 → 它缺工人

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
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 8000));

  // ① 缺工人标记：后建的伐木厂上空琥珀八面体。机位凑近
  await page.evaluate(() => {
    const views = window.__annoBuildingViews() || [];
    const t = views.find(b => b.type === 'LUMBERJACK' && b.noWorkers);
    if (t) window.__annoCam(t.gridX + 2, t.gridZ + 4, 12, 1.05, 3.8);
  });
  await new Promise(r => setTimeout(r, 2500));
  const millInfo = await page.evaluate(() => {
    const views = window.__annoBuildingViews() || [];
    return views.filter(b => b.type === 'LUMBERJACK' || b.type === 'TEXTILE_MILL')
      .map(b => ({ t: b.type, noWorkers: b.noWorkers, stalled: b.stalled, pending: b.pendingQty }));
  });
  console.log('buildings:', JSON.stringify(millInfo));
  await page.screenshot({ path: 'target/worker-badge.png' });
  console.log('shot: worker-badge.png');

  // ② 等马车出发（伐木场 5s/轮 × 6 = 约 30s 攒满一车），轮询钩子
  await page.evaluate(() => {
    const views = window.__annoBuildingViews() || [];
    const l = views.find(b => b.type === 'LUMBERJACK' && !b.noWorkers);
    if (l) window.__annoCam(l.gridX + 3, l.gridZ + 3, 10, 1.1, 3.9);
  });
  let cartShot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    await new Promise(r => setTimeout(r, 600));
    const n = await page.evaluate(() => window.__annoCarts());
    if (n > 0) {
      await new Promise(r => setTimeout(r, 700));   // 让车走到路中间
      await page.screenshot({ path: 'target/cart-on-road.png' });
      cartShot = true;
      console.log('shot: cart-on-road.png (carts=' + n + ')');
      await new Promise(r => setTimeout(r, 1500));
      await page.screenshot({ path: 'target/cart-on-road-2.png' });
      break;
    }
  }
  console.log(cartShot ? 'cart captured' : 'no cart in 120s!');
  console.log('errs:', errs.length ? errs : '无');
  console.log('DONE');
} finally { await browser.close(); }
