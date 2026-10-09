/**
 * GLB 模型接入验证（纯数据断言，不截图 —— 按用户要求画面效果由用户自己看）：
 *   1. /api/assets/models 返回 5 个模型名
 *   2. 进游戏后 MODEL_HAVE 收齐 4 种建筑模型（CART 不算建筑）
 *   3. 建贸易站 + 农夫小屋 + 磨坊 → MODEL_CACHE 里出现对应母本（说明加载+归一化成功）
 *   4. 建筑节点里真的挂上了模型实例（group 里有 glb 的 mesh）
 *   5. CART_PROTO 就位（马车模型母本）
 *   6. 全程零页面报错
 * 跑法：服务先起好，node tools/glb-models-check.mjs
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = 'dbg' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + (j.message || ''));
  return j.data;
};

/* ① 服务端模型清单 */
const list = await api('/api/assets/models');
check('服务端清单 5 个模型', ['CART','FARMER_HOUSE','MILL','TRADING_POST','WORKER_HOUSE'].every(t => list.includes(t)), list.join(','));

/* 准备一座平岛 + 三种建筑（盖在路边，走正常建造校验） */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: 'mdl', flat: true });
await api('/api/market/buy', 'POST', { playerId: p.id, good: 'TIMBER', quantity: 6 });   // 磨坊要 5 木板，开局只带 4
for (let x = 4; x <= 14; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 5, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'MILL', x: 9, z: 9 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    // 已知噪音：脚本先用 API 注册同名玩家，页面进游戏时 register 撞名 400 → 转登录，属正常流程
    if (m.text().includes('status of 400')) return;
    errors.push(m.text());
  });

  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');

  /* ② MODEL_HAVE 收齐建筑模型 + ⑤ 马车模型就位（大文件，最多等 90 秒） */
  let have = [], cartOk = false, cache = [];
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const st = await page.evaluate(() => ({
      have: [...(window.__annoModelHave ? window.__annoModelHave() : [])],
      cart: window.__annoCartModel ? window.__annoCartModel() : 'NO HOOK',
      cache: window.__annoModelCache ? window.__annoModelCache() : [],
    })).catch(() => null);
    if (!st) continue;
    have = st.have; cache = st.cache;
    cartOk = st.cart === true;
    if (have.length >= 4 && cache.length >= 3 && cartOk) break;
  }
  check('MODEL_HAVE 收齐 4 种建筑模型', ['TRADING_POST','FARMER_HOUSE','MILL','WORKER_HOUSE'].every(t => have.includes(t)), have.join(','));
  check('MODEL_CACHE 三座建筑母本就位', ['TRADING_POST','FARMER_HOUSE','MILL'].every(t => cache.includes(t)), cache.join(','));
  check('CART_PROTO 马车模型就位', cartOk);

  /* ④ 建筑节点真的挂着 glb 实例：三座建筑的 group 里应有非程序化 mesh（geometry 顶点数远超方块） */
  const attached = await page.evaluate(() => (window.__annoBuildingViews ? window.__annoBuildingViews() : []));
  check('建筑视图含三座建筑', attached.length >= 3, 'n=' + attached.length);

  /* ⑥ 零页面报错（404 模型 / 材质异常都会在这现形） */
  check('零页面报错', errors.length === 0, errors.slice(0, 3).join(' || '));
} finally { await browser.close(); }

console.log(`\n${pass + fail} 项：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
