/**
 * 伐木场真砍树 + 就近仓库 + 仓库容量 + 装卸耗时 验证
 * 覆盖：
 *   A. 服务端树集 ↔ 客户端渲染树 全等对拍（平岛无建筑：两边必须一模一样）
 *   B. 伐木场产木必砍树（TREE_CHOPPED 事件 / 砍伐记录 / 客户端树真的减少）+ WOOD 马车入库
 *   C. 就近仓库：小仓库更近时 CART_DISPATCHED 的 destId 是仓库，不再无脑去贸易站
 *   D. 装卸耗时：DISPATCHED → ARRIVED ≥ 行程 + 卸货 8s（payload 带 unloadMs）
 *   E. 满仓滞留：总囤货顶满容量 → WAREHOUSE_FULL + 车滞留不入库；卖货腾空间 → 自动续卸
 *   F. 林区砍光硬停产（TREE_STARVED + stalled）
 * 运行：node tools/lumber-check.mjs（需要服务已启动，timeScale=1）
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { spawn } from 'child_process';

const BASE = 'http://127.0.0.1:8080';
const WS = BASE.replace(/^http/, 'ws') + '/ws';
const CELL = 1.7;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const NAME = '伐木验证' + Date.now();
let pass = 0, fail = 0, skip = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const skipIt = (name, why) => { console.log('  - ' + name + ' —— 跳过：' + why); skip++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const key = (x, z) => x + ',' + z;

/** Edge 154 起：桌面 Edge 已有实例在跑时，新进程会把活儿移交出去后立刻退出（exit 0），
    puppeteer 把"启动进程退出"误判成启动失败。兜底：自管无头进程 + 调试端口连接。 */
const DBG_PORT = 9223;
async function launchBrowser() {
  try {
    return { browser: await puppeteer.launch({
      executablePath: EDGE,
      headless: 'new',
      args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
    }) };
  } catch (e) {
    const prof = `C:/Users/92112/AppData/Local/Temp/pptr-anno-${Date.now()}`;
    const child = spawn(EDGE, ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--no-sandbox', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${prof}`, `--remote-debugging-port=${DBG_PORT}`, '--window-size=1280,800', 'about:blank'],
      { stdio: 'ignore' });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      try {
        const res = await fetch(`http://127.0.0.1:${DBG_PORT}/json/version`);
        if (res.ok) return { browser: await puppeteer.connect({ browserURL: `http://127.0.0.1:${DBG_PORT}` }), child };
      } catch { /* 还没起好，继续等 */ }
    }
    throw new Error('Edge 无头实例 20s 内没起来');
  }
}

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!j.ok) throw new Error(path + ' -> ' + j.code + ' ' + j.message);
  return j.data;
};

/** 轮询直到 cond 为真（间隔 1s，超时抛错） */
async function poll(what, cond, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await cond();
    if (v) return v;
    await sleep(1000);
  }
  throw new Error('轮询超时：' + what);
}

/* ---------------- WS 事件收集 ---------------- */
const events = [];
let ws;
function attachWs(playerId) {
  return new Promise((resolve) => {
    ws = new WebSocket(WS);
    const timer = setTimeout(() => resolve(false), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', playerId }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'authed') { clearTimeout(timer); resolve(true); }
      if (m.type === 'event') events.push({ t: Date.now(), data: m.data });
    };
    ws.onerror = () => { clearTimeout(timer); resolve(false); };
  });
}
const of = type => events.filter(e => e.data.type === type);
const last = type => of(type).at(-1);

/* ---------------- 主流程 ---------------- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '伐木岛', flat: true });
const GRID = isl.gridSize;

// 服务端静态树集（纯地形推导，此刻岛上无建筑无路无田 → 应与客户端渲染树完全一致）
const treeInfo0 = await api(`/api/islands/${isl.id}/trees`);
const serverSet = new Set(treeInfo0.staticTrees.map(t => key(t[0], t[1])));
console.log(`岛#${isl.id}：服务端静态树 ${treeInfo0.staticCount} 棵（平岛陆地 ${GRID * GRID} 格）`);

/* 挑伐木场落点：2×2 footprint 无树、数半径 8 内的树，取最多 / 最少（≥1 且 ≤3）两档 */
const trees = treeInfo0.staticTrees;
const inRadius = (ax, az, r) => {
  const cx = ax + 1, cz = az + 1;      // 2×2 中心
  let n = 0;
  for (const [tx, tz] of trees) {
    const dx = tx + 0.5 - cx, dz = tz + 0.5 - cz;
    if (dx * dx + dz * dz <= r * r) n++;
  }
  return n;
};
const cellFree = new Set(trees.map(t => key(t[0], t[1])));
let best = null, sparse = null;
for (let az = 3; az + 3 < GRID - 3; az++) {
  for (let ax = 8; ax + 8 < GRID - 3; ax++) {
    let occ = false;                                   // footprint + 配套路格有树则弃
    for (const [x, z] of [[ax, az], [ax + 1, az], [ax, az + 1], [ax + 1, az + 1],
      [ax - 1, az], [ax - 2, az], [ax - 1, az - 1], [ax, az - 1], [ax + 1, az - 1], [ax + 2, az - 1]]) {
      if (cellFree.has(key(x, z))) { occ = true; break; }
    }
    if (occ) continue;
    const n = inRadius(ax, az, 8);
    if (!best || n > best.n) best = { ax, az, n };
    if (n >= 1 && n <= 3 && (!sparse || n < sparse.n)) sparse = { ax, az, n };
  }
}
if (!best) { console.log('  ✗ 整岛找不到 2×2 无树落点，退出'); process.exit(1); }
console.log(`伐木场 1 落点 (${best.ax},${best.az}) 半径 8 内 ${best.n} 棵树；稀疏候选 ${sparse ? `(${sparse.ax},${sparse.az}) ${sparse.n} 棵` : '无'}`);

/* 无头进岛（树集对拍 + 客户端砍树演出） */
const { browser, child } = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    if (await page.evaluate(() => window.__annoTreePositions && window.__annoTreePositions().length > 0)) break;
  }
  const clientTrees = await page.evaluate(() => window.__annoTreePositions());
  const idxOk = await page.evaluate(() => { const s = window.__annoTreeIndex(); return s.indexed === s.shown; });

  // 世界坐标 → 格坐标（树抖动 ±0.25 CELL 不会跨格）
  const clientSet = new Set(clientTrees.map(([wx, wz]) =>
    key(Math.round(wx / CELL + (GRID - 1) / 2), Math.round(wz / CELL + (GRID - 1) / 2))));
  let mismatch = 0;
  for (const k of serverSet) if (!clientSet.has(k)) mismatch++;
  for (const k of clientSet) if (!serverSet.has(k)) mismatch++;
  check('A1 服务端树集 ↔ 客户端渲染树 全等', mismatch === 0,
    `服务端 ${serverSet.size} / 客户端 ${clientSet.size} / 差异 ${mismatch}`);
  check('A2 树实例索引一致（indexed == shown）', idxOk, '');

  /* 布置：贸易站（前置）→ 住宅（移民=工人）→ 伐木场 1；路 6 格连通全套 */
  await api('/api/roads/batch', 'POST', { playerId: p.id, islandId: isl.id,
    cells: [{ x: best.ax - 1, z: best.az }, { x: best.ax - 2, z: best.az }, { x: best.ax - 1, z: best.az - 1 },
      { x: best.ax, z: best.az - 1 }, { x: best.ax + 1, z: best.az - 1 }, { x: best.ax + 2, z: best.az - 1 }] });
  const tp = await api('/api/buildings', 'POST',
    { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
  const house = await api('/api/buildings', 'POST',
    { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: best.ax - 4, z: best.az - 1 });
  const mill = await api('/api/buildings', 'POST',
    { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: best.ax, z: best.az });
  check('B1 布置落位（贸易站+住宅+伐木场）', !!tp.id && !!house.id && !!mill.id,
    `贸易站#${tp.id} 房#${house.id} 伐木场#${mill.id} @ (${best.ax},${best.az})`);

  check('B2 挂上 WS（懒结算要在线）', await attachWs(p.id), '');

  /* 等 WOOD 入库（6 木一车：30s 生产 + 行程 + 8s 卸货） */
  const woodOf = async () => {
    const s = (await api(`/api/market/stock/${p.id}`)).find?.(x => x.good === 'WOOD');
    return s ? (s.quantity ?? 0) : 0;
  };
  const woodBase = await woodOf();
  await poll('WOOD 入库', async () => (await woodOf()) > woodBase, 120000);
  const chops = (await api(`/api/islands/${isl.id}/trees`)).chopped;
  check('B3 伐木场产木经马车入库', true, `WOOD ${woodBase} -> +${'?'}（首批已到）`);
  check('B4 砍树有记录（≥3 棵 = 6 木 ÷ 2）', chops.length >= 3, `tree_chop ${chops.length} 行`);
  check('B5 被砍的格都在静态树集里', chops.every(c => serverSet.has(key(c[0], c[1]))), '');

  /* 客户端收到 TREE_CHOPPED：树真的从画面上消失 */
  const choppedEvents = of('TREE_CHOPPED');
  check('B6 TREE_CHOPPED 事件广播', choppedEvents.length >= 3, `收到 ${choppedEvents.length} 条`);
  await poll('客户端树数下降', async () =>
    (await page.evaluate(() => window.__annoTreePositions().length)) < clientTrees.length, 15000);
  check('B7 客户端树被移除（倒下动画后 instanced count 下降）',
    (await page.evaluate(() => window.__annoTreePositions().length)) < clientTrees.length,
    `${clientTrees.length} -> ${await page.evaluate(() => window.__annoTreePositions().length)}`);

  /* D. 装卸耗时：取第一对配对的 DISPATCHED/ARRIVED（首车入库后可能秒派第二班，last() 会错位） */
  const arr1 = of('CART_ARRIVED')[0];
  const disp1 = arr1 ? of('CART_DISPATCHED').filter(d => d.t < arr1.t).at(-1) : null;
  if (disp1 && arr1) {
    check('C1 首班车目的地是贸易站', disp1.data.payload.destId === tp.id, `destId=${disp1.data.payload.destId}`);
    const gap = arr1.t - disp1.t;
    const durMs = disp1.data.payload.durMs || 0;
    const unloadMs = disp1.data.payload.unloadMs || 0;
    check('C2 payload 带 unloadMs=8000', unloadMs === 8000, `unloadMs=${unloadMs}`);
    check('C3 到站耗时 ≥ 行程 + 卸货（-2s tick 容差）', gap >= durMs + unloadMs - 2000,
      `gap=${gap}ms ≥ ${durMs}+${unloadMs}-2000`);
  } else skipIt('C1-C3 装卸耗时', '事件流里没凑齐 DISPATCHED/ARRIVED 对');

  /* E. 就近仓库：小仓库建在伐木场脚边（600 格路 vs 贸易站远在天边） */
  const wh = await api('/api/buildings', 'POST',
    { playerId: p.id, islandId: isl.id, type: 'SMALL_WAREHOUSE', x: best.ax + 3, z: best.az - 1 });
  check('D1 小仓库落位（容量 40）', !!wh.id, `#${wh.id} @ (${best.ax + 3},${best.az - 1})`);
  /* 先等在途的第二班到站（去贸易站的退化直线行程可达 65s，一厂一车不重叠），
     到站后待运已攒够，新车秒派 —— 这次就会选脚边的仓库 */
  await poll('第二班到站', () => of('CART_ARRIVED').length >= 2, 200000);
  const n0 = of('CART_DISPATCHED').length;
  await poll('下一班车（仓库就位后）', () => of('CART_DISPATCHED').length > n0, 90000);
  const disp2 = last('CART_DISPATCHED');
  check('D2 新班车目的地是小仓库（就近原则）', disp2.data.payload.destId === wh.id,
    `destId=${disp2.data.payload.destId} 仓库#${wh.id} 贸易站#${tp.id}`);

  /* F. 满仓滞留：总囤货顶满 120（贸易站 80 + 仓库 40） */
  const stock = async () => (await api(`/api/market/stock/${p.id}`)).reduce((a, s) => a + s.quantity, 0);
  const used0 = await stock();
  const need = Math.max(0, 120 - used0 + 6);          // 顶满再留一车余量
  if (need > 0) await api('/api/market/buy', 'POST', { playerId: p.id, good: 'POTATO', quantity: need });
  check('E1 囤货顶满容量', (await stock()) >= 120, `total=${await stock()} / cap=120`);
  const nArr0 = of('CART_ARRIVED').length;
  const fullBefore = of('WAREHOUSE_FULL').length;
  await poll('WAREHOUSE_FULL', () => of('WAREHOUSE_FULL').length > fullBefore, 120000);
  const full = last('WAREHOUSE_FULL');
  check('E2 满仓广播 WAREHOUSE_FULL（带 cap/used）', !!full && full.data.payload.capacity === 120,
    `cap=${full?.data?.payload?.capacity} used=${full?.data?.payload?.used}`);
  await sleep(15000);
  check('E3 滞留期间不入库（无新 ARRIVED）', of('CART_ARRIVED').length === nArr0, '15s 零到货');

  // 卖的时候按**现量**卖（居民口粮一直在吃土豆，买 109 个后现量可能已是 108）
  const potatoNow = async () => (await api(`/api/market/stock/${p.id}`)).find(s => s.good === 'POTATO')?.quantity ?? 0;
  await api('/api/market/sell', 'POST', { playerId: p.id, good: 'POTATO', quantity: Math.min(need, await potatoNow()) });
  const woodPre = await woodOf();
  await poll('腾空间后滞留车卸货', async () => (await woodOf()) > woodPre, 60000);
  check('E4 卖货腾空间后滞留车自动续卸', of('CART_ARRIVED').length > nArr0, `WOOD ${woodPre} -> 上涨`);

  /* G. 砍光硬停产：树最稀的窗口再放一座伐木场，砍完 2~3 棵就该 TREE_STARVED */
  if (sparse) {
    await api('/api/roads/batch', 'POST', { playerId: p.id, islandId: isl.id, cells: [{ x: sparse.ax - 1, z: sparse.az }] });
    const mill2 = await api('/api/buildings', 'POST',
      { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: sparse.ax, z: sparse.az });
    const starved0 = of('TREE_STARVED').length;
    await poll('TREE_STARVED', () => of('TREE_STARVED').length > starved0, 180000);
    const b2 = (await api(`/api/islands/${isl.id}/buildings`)).find(b => b.id === mill2.id);
    check('F1 林区砍光广播 TREE_STARVED', of('TREE_STARVED').length > starved0, `半径 8 内原有 ${sparse.n} 棵`);
    check('F2 伐木场停摆（stalled=true）', b2 && b2.stalled === true, `stalled=${b2 && b2.stalled}`);
  } else skipIt('F1-F2 砍光停产', '平岛上找不到半径 8 内 ≤3 棵树的窗口');
} finally {
  await browser.close().catch(() => {});
  try { child && child.kill(); } catch { /* 进程可能已随 close 退出 */ }
}

console.log(`\n结果：${pass} 过 / ${fail} 挂${skip ? ' / ' + skip + ' 跳过' : ''}`);
process.exit(fail ? 1 : 0);
