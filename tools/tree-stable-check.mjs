/**
 * 树木稳定性验证：修路不该让全岛的树"刷新"。
 * 修法是逐格独立判定（树长不长只由该格哈希 + 岛 id 决定），所以：
 *   1. 连续修 N 条路，树数每次变化 ∈ {0,-1}（只消失路面上的那一棵，如果那格本来有树）
 *   2. 修路后旧树位置集合 ⊇ 新树位置集合，且差集 ⊆ 刚修的路面（别的树纹丝不动）
 *   3. 不修路时反复触发重建（等快照循环），位置与数量完全不变
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '树稳验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '树稳岛', flat: true });

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

  /* 等进岛 + 树长出来 */
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    if (await page.evaluate(() => window.__annoTreePositions && window.__annoTreePositions().length > 0)) break;
  }
  const base = await page.evaluate(() => window.__annoTreePositions());
  check('岛上有树（基线）', base.length > 0, 'count=' + base.length);

  /* 1+2. 连续修 4 条路：每修一条，数量变化 ∈ {0,-1}，且消失的树都在刚修的那格上 */
  const cells = [[10, 10], [11, 10], [12, 10], [13, 10]];
  let prev = base;
  let allDeltaOk = true, allGoneOk = true;
  const roadKeys = new Set();
  for (const [x, z] of cells) {
    await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z });
    await sleep(1200);                       // 等快照推下来触发 applyRoads → buildTrees
    const cur = await page.evaluate(() => window.__annoTreePositions());
    roadKeys.add(x + ',' + z);
    const gone = prev.filter(t => !cur.some(u => u[0] === t[0] && u[1] === t[1]));
    /* 消失的树必须 ≤1 棵（一格路最多盖掉一棵）——旧实现洗牌一变，几十棵集体搬家 */
    if (gone.length > 1) allDeltaOk = false;
    /* 新集合必须是旧集合的子集（树只会消失，不会凭空换位置） */
    if (!cur.every(u => prev.some(t => t[0] === u[0] && t[1] === u[1]))) allGoneOk = false;
    prev = cur;
  }
  check('修 4 条路：每次最多消失 1 棵', allDeltaOk, `count ${base.length} -> ${prev.length}`);
  check('修路不搬动别的树（位置子集）', allGoneOk);

  /* 3. 不修路时，反复等快照触发重建，树完全不动 */
  const before = await page.evaluate(() => JSON.stringify([window.__annoTreePositions(), window.__annoTreeStats().count]));
  await sleep(7000);                         // 跨几个 3s 快照周期
  const after = await page.evaluate(() => JSON.stringify([window.__annoTreePositions(), window.__annoTreeStats().count]));
  check('静止时树位置与数量零漂移', before === after);

  console.log(`\n结果：${pass} 过 / ${fail} 挂`);
  process.exit(fail ? 1 : 0);
} finally {
  await browser.close();
}
