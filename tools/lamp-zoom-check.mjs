/**
 * 路灯"拉远视角就关灯"问题诊断（纯数据断言，不截图 —— 画面效果由用户看）：
 *   1. 平岛铺十字路网 → 页面收集到灯位（lamps > 0）
 *   2. 强制深夜 22 点 → skyNight > 0.5，灯池全亮（近景 d=24）
 *   3. 拉远视距 d=280 → 灯池【仍然全亮】→ 证明没有"拉远关灯"的逻辑开关
 *   4. 几何归因：远视距下灯头屏占 < 2.5px（亚像素，看不见 = "灯珠消失"）
 *   5. 雾数据：远视距时相机→灯距离进入雾带（自发光被洗淡，次要因素）
 *   6. 全程零页面报错
 * 跑法：服务先起好，node tools/lamp-zoom-check.mjs
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '灯zoom' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + (j.message || ''));
  return j.data;
};

/* ---- ① 平岛 + 十字路网（默认土路 = 木杆油灯） ---- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '灯岛', flat: true });
for (let x = 10; x <= 30; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 20 });
for (let z = 10; z <= 30; z++) if (z !== 20) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x: 20, z });
console.log('路网铺好（十字 41 格）');

/* ---- ② 开页面进游戏 ---- */
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (m.text().includes('status of 400')) return;   // 同名注册 400 转登录，正常流程
    errors.push(m.text());
  });
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await page.waitForFunction(() => window.__annoLampLights && __annoLampLights().lamps > 0, { timeout: 60000 });
  const lamps0 = await page.evaluate(() => __annoLampLights());
  check('灯位收集（lamps>0）', lamps0.lamps > 0, JSON.stringify(lamps0));

  /* ---- ③ 强制深夜 22 点 ---- */
  await page.evaluate(() => { __annoNpcWorld.clock.hour = 22; });
  await sleep(2200);
  const night = await page.evaluate(() => ({ sky: __annoSkyNight(), ...__annoLampLights() }));
  check('深夜生效（skyNight>0.5）', night.sky > 0.5, 'skyNight=' + (night.sky ?? NaN).toFixed(2));
  const wantLit = Math.min(8, night.lamps);
  check('近景灯池全亮', night.lit === wantLit, `lit=${night.lit}/${wantLit}（pool=${night.pool}）`);

  /* ---- ④ 近景 d=24：灯头应该清晰可见 ---- */
  await page.evaluate(() => __annoLookAt(20, 20, 24));
  await sleep(500);
  const near = await page.evaluate(() => {
    const px = q => (Array.isArray(q) ? { x: q[0], y: q[1] } : q);   // __annoProject 返回 [x,y] 数组
    const a = px(__annoProject(20, 20)), b = px(__annoProject(21, 20));
    const pxPerGrid = Math.hypot(b.x - a.x, b.y - a.y);
    const f = __annoScene.fog;
    return { lit: __annoLampLights().lit, pxPerGrid, headPx: 0.22 * pxPerGrid, fogNear: f.near, fogFar: f.far };
  });
  check('近景灯池仍全亮', near.lit === wantLit, `lit=${near.lit}`);
  check('近景灯头屏占 > 5px（看得见）', near.headPx > 5, `灯头≈${near.headPx.toFixed(1)}px`);
  console.log(`  近景：pxPerGrid=${near.pxPerGrid.toFixed(1)}  fog ${near.fogNear.toFixed(0)}~${near.fogFar.toFixed(0)}（机位 24，未进雾带）`);

  /* ---- ⑤ 远景 d=280：灯池仍亮 = 无逻辑关灯；灯头亚像素 = 视觉消失 ---- */
  await page.evaluate(() => __annoLookAt(20, 20, 280));
  await sleep(500);
  const far = await page.evaluate(() => {
    const px = q => (Array.isArray(q) ? { x: q[0], y: q[1] } : q);
    const a = px(__annoProject(20, 20)), b = px(__annoProject(21, 20));
    const pxPerGrid = Math.hypot(b.x - a.x, b.y - a.y);
    const f = __annoScene.fog;
    const fogF = Math.max(0, Math.min(1, (280 - f.near) / Math.max(1, f.far - f.near)));
    return { lit: __annoLampLights().lit, pxPerGrid, headPx: 0.22 * pxPerGrid, fogNear: f.near, fogFar: f.far, fogF };
  });
  check('★ 拉远灯池仍全亮（没有"拉远关灯"的开关）', far.lit === wantLit, `lit=${far.lit}/${wantLit}`);
  check('★ 远景灯头亚像素 < 2.5px（这就是"看不见"的原因）', far.headPx < 2.5, `灯头≈${far.headPx.toFixed(2)}px`);
  console.log(`  远景：pxPerGrid=${far.pxPerGrid.toFixed(2)}  fog ${far.fogNear.toFixed(0)}~${far.fogFar.toFixed(0)}，相机→灯≈280 在雾带内 fogF=${(far.fogF * 100).toFixed(0)}%（自发光被雾洗淡比例）`);
  console.log(`  结论要素：真光源仅 ${8} 盏×4.6 格半径，覆盖 ${wantLit} 小圈；视野却已是百余格宽。`);

  /* ---- ⑥ 零报错 ---- */
  check('零页面报错', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
