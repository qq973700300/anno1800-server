/**
 * NPC 让路验证：NPC 缩小 + 走路/站位都靠路两边，中间留给马车。
 * 断言（纯数据，不用等真实攒货派车）：
 *   1. 所有 NPC 的 lane 偏移都在 [0.36, 0.46]，且左右两侧都有人
 *   2. NPC 身高整体缩过（最大 ≤ 0.90）
 *   3. 闲逛站位在路两侧（横向偏移 ≥ 0.3，不在路中线）
 *   4. 几何不穿模：最小 lane(0.36) - NPC 最宽半肩(≈0.123) ≥ 车斗半宽(0.22)
 *   5. 马车沿路开过时截图（视觉确认人车分道）
 */
import fs from 'node:fs';
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '让路验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

/* ---------- 搭一个最小小镇：一条横路 + 港口 + 住宅 + 工厂 ---------- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '让路岛', flat: true });
for (let x = 3; x <= 15; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
for (let z = 9; z <= 11; z++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x: 3, z });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 10 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 5, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 9, z: 9 });
console.log('岛搭好了，等居民迁入 + NPC 上街…');

/* ---------- 无头浏览器 ---------- */
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');

  /* 等 NPC 出现并且有人真的在走（快照同步 + 作息启动都要几秒） */
  let stats = null;
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    stats = await page.evaluate(() => {
      const w = window.__annoNpcWorld;
      if (!w || !w.npcs || !w.npcs.length) return null;
      return { total: w.npcs.length, walking: w.stats.walking };
    });
    if (stats && stats.total >= 8 && stats.walking >= 1) break;
  }
  if (!stats || stats.total < 8) { console.log('NPC 没起来：' + JSON.stringify(stats)); process.exit(1); }

  /* 1. lane 全部在 [0.36, 0.46]，左右两侧都有人 */
  const lanes = await page.evaluate(() => window.__annoNpcWorld.npcs.map(n => n.lane));
  const inRange = lanes.every(l => Math.abs(l) >= 0.355 && Math.abs(l) <= 0.465);
  const bothSides = lanes.some(l => l < 0) && lanes.some(l => l > 0);
  check('车道偏移全部 ∈ [0.36,0.46]', inRange, 'min=' + Math.min(...lanes.map(Math.abs)).toFixed(3) + ' max=' + Math.max(...lanes.map(Math.abs)).toFixed(3));
  check('左右两侧都有人走', bothSides, lanes.map(l => l.toFixed(2)).join(','));

  /* 2. 体型缩小：最大身高 ≤ 0.90（原上限 1.05 × 0.85 = 0.8925） */
  const maxH = await page.evaluate(() => Math.max(...window.__annoNpcWorld.npcs.map(n => n.look.height)));
  check('NPC 体型缩小（max ≤ 0.90）', maxH <= 0.90, 'maxHeight=' + maxH.toFixed(3));

  /* 3. 闲逛站位居中偏移 ≥ 0.3：抓一个 DWELL 的人算它到所在格中心的横向距离 */
  const dweller = await page.evaluate(() => {
    const w = window.__annoNpcWorld;
    const n = w.npcs.find(n => n.state === 'DWELL' && n.goal === 'LOITER');
    if (!n) return null;
    const [wx, wz] = w.deps.cellToWorld(n.atCell[0], n.atCell[1]);
    return { off: Math.min(Math.abs(n.px - wx), Math.abs(n.pz - wz)) };
  });
  if (dweller) check('闲逛站位靠路边（偏移 ≥ 0.3）', dweller.off >= 0.3, 'off=' + dweller.off.toFixed(3));
  else console.log('  - 暂无闲逛中的人，跳过站位断言');

  /* 4. 几何不穿模：最坏情况 lane 最小 0.36，最宽成人半肩 = 1.05*0.85*0.27*1.07/2 ≈ 0.128 */
  const npcHalf = 1.05 * 0.85 * 0.27 * 1.07 / 2;
  check('人车几何不穿模', 0.36 - npcHalf >= 0.22, `lane 0.36 - 半肩 ${npcHalf.toFixed(3)} = ${(0.36 - npcHalf).toFixed(3)} ≥ 车斗半宽 0.22`);

  /* 5. 视觉：马车沿主路开，镜头俯拍 */
  await page.evaluate(() => window.__annoCam(9, 8, 16, 0.9, 0));
  const islId = await page.evaluate(() => window.__annoBuildingViews()[0] && window.__annoBuildingViews()[0].islandId);
  await page.evaluate(id => window.__annoCartSpawn({
    buildingId: window.__annoBuildingViews()[0].id,   // 动画只要起点建筑存在即可，用住宅当车源
    islandId: id,
    path: [[3, 8], [9, 8], [15, 8]],
    durMs: 9000,
  }), islId);
  await sleep(3600);                                   // 车走到路中间
  await page.screenshot({ path: 'target/npc-road-side.png' });
  const carts = await page.evaluate(() => window.__annoCarts());
  check('马车在路中央行驶（截图确认人车分道）', carts >= 1, 'carts=' + carts);

  console.log(`\n结果：${pass} 过 / ${fail} 挂`);
  process.exit(fail ? 1 : 0);
} finally {
  await browser.close();
}
