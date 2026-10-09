// 批量建造验证：
// A. API 直测 —— /api/roads/batch 一次铺 30 格、部分成功语义、plant-batch 一片
// B. 无头拖拽 —— 真实模拟"拿马路→拖一条线→松手"，确认走新链路且不出错
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '批量验证' + stamp;

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

let fails = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + msg);
  if (!cond) fails++;
};

/* ---- A. API 直测（平岛：坐标可写死） ---- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '批量岛', flat: true });

const cells = Array.from({ length: 30 }, (_, i) => ({ x: 5 + i, z: 10 }));
const t0 = Date.now();
const rb = await api('/api/roads/batch', 'POST', { playerId: p.id, islandId: isl.id, cells });
const dtRoad = Date.now() - t0;
console.log(` roads/batch: ${rb.count} 格, stop=${rb.stop}, 耗时 ${dtRoad}ms`);
assert(rb.count === 30, '一次铺 30 格全部成功');
assert(!rb.stop, '无中途障碍（stop 为空）');
assert(rb.built && rb.built.length === 30 && rb.built[0].cellX === 5, '响应带每格 RoadView');

// 部分成功语义：第 3 格撞已有马路 → 前 2 格生效，stop 有原因
const rb2 = await api('/api/roads/batch', 'POST', { playerId: p.id, islandId: isl.id,
  cells: [{ x: 5, z: 13 }, { x: 5, z: 14 }, { x: 5, z: 10 }, { x: 5, z: 15 }] });
assert(rb2.count === 2, `撞已有路截断：只铺 2 格（实际 ${rb2.count}）`);
assert(rb2.stop && rb2.stop.includes('马路'), `stop 带原因（${rb2.stop}）`);

// 纪元式拉田：田是农场的 —— 先建一座马铃薯农场（3×3 @ (8,7)，底边贴 z=10 的路）
const farm = await api('/api/buildings', 'POST',
  { playerId: p.id, islandId: isl.id, type: 'POTATO_FARM', x: 8, z: 7 });
console.log(` 农场：${farm.label} @ (${farm.gridX},${farm.gridZ}) ${farm.sizeW}x${farm.sizeH}`);

// 批量拉田：农场周围 3 格内的 20 格（z=6 行 9 + z=5 行 9 + z=4 行 2，全在 FIELD_RANGE 内）
const pc = [
  ...Array.from({ length: 9 }, (_, i) => ({ x: 5 + i, z: 6 })),
  ...Array.from({ length: 9 }, (_, i) => ({ x: 5 + i, z: 5 })),
  { x: 5, z: 4 }, { x: 6, z: 4 },
];
const t1 = Date.now();
const pb = await api('/api/farm/plant-batch', 'POST',
  { playerId: p.id, islandId: isl.id, cells: pc, crop: 'POTATO', buildingId: farm.id });
console.log(` plant-batch: ${pb.count} 株, stop=${pb.stop}, 耗时 ${Date.now() - t1}ms`);
assert(pb.count === 20, '一次拉 20 株全部成功');

/* ---- B. 无头拖拽实测（先给 p2 备好一座平岛，坐标可预期） ---- */
const p2 = await api('/api/players/register', 'POST', { name: NAME + 'p2' });
const isl2 = await api('/api/islands', 'POST', { playerId: p2.id, name: '平岛', flat: true });

/* ---- B. 无头拖拽实测 ---- */
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
  await page.type('#nameIn', NAME + 'p2');
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  // 拿马路：按住左键从画面中心往右拖 240px，松手
  const before = await page.evaluate(() => window.__annoBuildStats());
  await page.evaluate(() => window.__annoBeginPlace('road'));
  await new Promise(r => setTimeout(r, 300));
  const cx = 700, cy = 450;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {       // 分步移动，模拟真实拖拽
    await page.mouse.move(cx + i * 20, cy);
    await new Promise(r => setTimeout(r, 30));
  }
  const t2 = Date.now();
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 1500));
  const dtDrag = Date.now() - t2;
  const after = await page.evaluate(() => window.__annoBuildStats());
  console.log(` drag road: ${before.roads} -> ${after.roads} 格, 金库 ${before.treasury} -> ${after.treasury}`);
  assert(after.roads - before.roads >= 5, `拖拽铺路走批量链路（铺了 ${after.roads - before.roads} 格）`);

  // 拖一片田（纪元式拉田）：p2 岛先造好路 + 农场，镜头对准农场右下外一格，
  // 从画面中心向右下拖一个小矩形 —— 大部分格子落在农场周围 3 格内
  await api('/api/roads/batch', 'POST', { playerId: p2.id, islandId: isl2.id,
    cells: [20, 21, 22, 23, 24].map(x => ({ x, z: 20 })) });
  const farm2 = await api('/api/buildings', 'POST',
    { playerId: p2.id, islandId: isl2.id, type: 'POTATO_FARM', x: 21, z: 17 });
  await page.evaluate(() => window.__annoLookAt(23, 21, 26));
  await new Promise(r => setTimeout(r, 4500));   // 等页面轮询把农场收进 S.buildings 快照
  await page.evaluate((id) => window.__annoPullField(id), farm2.id);
  await new Promise(r => setTimeout(r, 300));
  const place = await page.evaluate(() => window.__annoPlace && window.__annoPlace());
  assert(place && place.kind === 'plant' && place.farmId === farm2.id,
    `拉田模式已挂上农场（${JSON.stringify(place)}）`);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) {          // 拖 300×225px：矩形要罩住若干"格子中心"才算数
    await page.mouse.move(cx + i * 20, cy + i * 15);
    await new Promise(r => setTimeout(r, 25));
  }
  const hint = await page.evaluate(() => {
    const h = document.getElementById('buildHint');
    return h ? h.textContent : '(无提示)';
  });
  console.log('  drag hint:', hint);
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 1500));
  const after2 = await page.evaluate(() => window.__annoBuildStats());
  console.log(` drag plant: plots ${before.plots} -> ${after2.plots}`);
  assert(after2.plots - before.plots >= 2, `拖矩形拉田（种了 ${after2.plots - before.plots} 株，农场 3 格限制下能中几株算几株）`);

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  assert(pageErrors.length === 0, '无页面 JS 错误');
  console.log(fails === 0 ? 'ALL_PASS' : `FAILED ${fails}`);
} finally {
  await browser.close();
}
