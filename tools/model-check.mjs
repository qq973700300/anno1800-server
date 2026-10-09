/**
 * 模型接入验证：**10 座 Blender 新建筑真的被游戏探测、加载、渲染**。
 *   1. 服务端 /api/assets/models 含 10 个新类型
 *   2. 页面 __annoModelHave() 含 10 个新类型（probeModels 同步完成）
 *   3. 岛上放 6 座新建筑 → 页面 __annoModelCache() 真的拉到了 GLB（loadModel 生效）
 *   4. 页面零报错
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '模型验证' + Date.now();
const NEW10 = ['LUMBERJACK', 'POTATO_FARM', 'BRICKWORKS', 'SMALL_WAREHOUSE', 'MARKETPLACE',
               'PUB', 'SCHOOL', 'CHURCH', 'TOWN_HALL', 'PIER'];
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

/* ---- ① 服务端模型清单 ---- */
const serverList = (await api('/api/assets/models')).map ? await api('/api/assets/models') : (await api('/api/assets/models'));
const serverModels = Array.isArray(serverList) ? serverList : (serverList.models || []);
check('服务端模型清单含 10 新类型', NEW10.every(t => serverModels.includes(t)), `共 ${serverModels.length} 个`);

/* ---- 建岛 + 铺路 + 放 6 座新建筑 ---- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '模型岛', flat: true });
for (let x = 4; x <= 12; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 10 });
const placements = [
  ['LUMBERJACK',    5,  8],
  ['POTATO_FARM',   5, 11],
  ['PUB',           8,  7],
  ['CHURCH',        9,  6],   // gate：需 120 农夫，初始放不了 → 记 skip
  ['TOWN_HALL',    10,  5],   // gate：需 300 工匠 → 记 skip
  ['BRICKWORKS',    9, 11],
];
const placed = [], gated = [];
for (const [type, x, z] of placements) {
  try {
    await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type, x, z, rotation: 0 });
    placed.push(type);
  } catch (e) {
    const msg = String(e.message);
    if (msg.includes('需要岛上先住够')) { gated.push(type); console.log(`     （${type} 有解锁门槛，跳过：${msg.slice(msg.indexOf('"message"') + 12, msg.indexOf('"message"') + 42)}…）`); }
    else console.log(`     （${type} 放置失败：${msg.slice(0, 90)}）`);
  }
}
check('无门槛新建筑放置成功', placed.length >= 4, placed.join(', '));

/* ---- ② 页面探测 + ③ GLB 真进缓存 ---- */
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
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(7000);

  const have = await page.evaluate(() => window.__annoModelHave());
  check('页面 __annoModelHave 含 10 新类型', NEW10.every(t => have.includes(t)), `共 ${have.length} 个`);

  /* 轮询等 loadModel 把岛上建筑的 GLB 拉进缓存（新模型都是 <60KB 小文件，很快） */
  let cached = [];
  for (let t = 0; t < 30; t++) {
    cached = await page.evaluate(() => window.__annoModelCache());
    if (placed.every(x => cached.includes(x))) break;
    await sleep(1000);
  }
  check('岛上建筑的 GLB 进缓存', placed.every(x => cached.includes(x)),
        `cached=${cached.filter(x => NEW10.includes(x)).join(',') || '（无）'}`);
  check('页面零报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
