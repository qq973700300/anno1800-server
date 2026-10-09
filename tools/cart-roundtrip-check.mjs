/**
 * 马车回程动画验证（确定性，不等真实攒货）：
 *  伪造 CART_DISPATCHED 派一辆车（去程 8s）→ 到港停车等 ARRIVED → 手动触发回程 →
 *  卸货停留 1.4s → 空车原路返回 → 到厂收车（carts 归 0）。
 *  ⚠️ 时序余量：swiftshader 一次 page.screenshot 能吃 ~4s（探针实测车在 7.5s=
 *  2.5×dur 兜底线准时被收，dur=3000 时一次截图+两次往返就能吃穿），所以：
 *  ① durMs=8000（兜底线 20s）；② **不截图**（用户定规：视觉验证请用户看，脚本只做数据断言）；
 *  ③ 时钟 B 后世界相位随真实时间走，登录后强制上午 10 点，亮度/渲染耗时确定化。
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '回程验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '回程岛', flat: true });
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
let fails = 0;
const check = (name, ok) => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name); if (!ok) fails++; };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  /* 时钟 B 后进游戏落在世界相位（可能是夜里）：夜景+路灯渲染更重、时序更抖，
     强制上午 10 点。登录早期调一次、8 秒后兜底再调一次（幂等）。 */
  await page.evaluate(() => window.__annoNpcWorld?.setServerClock(10, 600));
  await sleep(8000);
  await page.evaluate(() => window.__annoNpcWorld?.setServerClock(10, 600));

  // ① 伪造派车：去程 8s，路径 3 格点
  await page.evaluate(id => window.__annoCartSpawn({
    buildingId: id, islandId: window.__annoBuildingViews()[0]?.islandId,
    path: [[5, 8], [10, 8], [14, 8]], durMs: 8000,
  }), lj.id);
  await sleep(1200);
  const outbound = await page.evaluate(() => window.__annoCarts());
  check('去程车在路上 (carts=1)', outbound === 1);

  // ② 去程走完（8s）→ 到港停车，不能自收（此刻 t≈1.2 < 2.5 兜底线）
  await sleep(8500);
  const parked = await page.evaluate(() => window.__annoCarts());
  check('到港停车等 ARRIVED，没有被提前收掉 (carts=1)', parked === 1);

  // ③ 触发回程 → 卸货停留 1.4s 期间车还在
  await page.evaluate(id => window.__annoCartReturn(id), lj.id);
  await sleep(700);
  const dwelling = await page.evaluate(() => window.__annoCarts());
  check('卸货停留中车还在 (carts=1)', dwelling === 1);

  // ④ 回程 8s：停留结束后开始往回走，途中确认还在
  await sleep(1400);
  const returning = await page.evaluate(() => window.__annoCarts());
  check('回程途中 (carts=1)', returning === 1);

  // ⑤ 回程走完 → 收车归 0（回程全程 1.4s 停留 + 8s 路程，轮询窗口给足 15s）
  let done = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await sleep(300);
    if (await page.evaluate(() => window.__annoCarts()) === 0) { done = true; break; }
  }
  check('回程到厂收车 (carts=0)', done);

  // ⑥ 重复 returnCart（回程中再触发）应被忽略，不能报错/复活
  await page.evaluate(id => window.__annoCartSpawn({
    buildingId: id, islandId: window.__annoBuildingViews()[0]?.islandId,
    path: [[5, 8], [10, 8]], durMs: 2500,
  }), lj.id);
  await sleep(200);
  await page.evaluate(id => window.__annoCartReturn(id), lj.id);
  await page.evaluate(id => window.__annoCartReturn(id), lj.id);   // 重复触发
  await sleep(300);
  const robust = await page.evaluate(() => window.__annoCarts());
  check('重复 returnCart 被忽略 (carts=1)', robust === 1);

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
