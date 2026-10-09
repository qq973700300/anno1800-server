/**
 * 路面种类（土路/石板路/砖路/林荫大道）验证：
 *
 *   A. 服务端
 *     1. 没解锁的路面拒铺（石板路要等农夫满 120 —— 工人阶层解锁）
 *     2. 认不出的路面名报错
 *     3. 缺省铺出来是土路，视图带 kind/kindLabel
 *     4. 用农夫住宅堆到 120 农夫解锁石板路 → 直接铺 / 旧路改铺（收差价 15）
 *     5. 重复改铺同一格不重复收费；还没解锁的砖路改铺被拒
 *     6. 拆石板路按石板价退一半
 *   B. 客户端（无头）
 *     7. 拿起马路出现路面选择片（4 片，当前片高亮，没解锁的灰）
 *     8. 点片换路面 → 放置条写明新路面与价格
 *     9. 四档路面渲染：surf 色号各不相同；人行道只在林荫大道；路牙只在开口边（3×3 路网中心没有）
 *    10. 灯型跟路面走：土路木杆 / 石板砖路铸铁 / 大道双头
 *    11. 点旧路 = 改铺（走 restyle 接口）
 *    12. 页面零报错
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '路面验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const apiRaw = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, j: await r.json() };
};
const api = async (path, method, body) => (await apiRaw(path, method, body)).j.data;

/* ============ A. 服务端 ============ */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '路面岛', flat: true });
const road = (x, z, kind) => apiRaw('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z, kind });
const restyle = (kind, cells) => apiRaw('/api/roads/restyle', 'POST', { playerId: p.id, islandId: isl.id, kind, cells });

/* 1~2. 锁与坏名字 */
{
  const r = await road(20, 10, 'STONE');
  check('没解锁的石板路拒铺（要等农夫满 120）',
    r.status === 400 && /还没解锁/.test(r.j.message || ''), (r.j.message || '').slice(0, 60));
  const bad = await road(20, 10, 'GRAVEL');
  check('认不出的路面名报错', bad.status === 400 && /没有这种路面/.test(bad.j.message || ''), (bad.j.message || '').slice(0, 40));
}

/* 修路 + 贸易站 + 15 座农夫住宅（8 人/座 = 120 农夫，正好解锁石板路） */
for (let x = 2; x <= 20; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 10 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 20 });
for (const [hx, hz] of [[2,8],[4,8],[6,8],[8,8],[10,8],[12,8],[14,8],[16,8],
                        [2,11],[4,11],[6,11],[8,11],[10,11],[12,11],[14,11]]) {
  await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: hx, z: hz });
}
const pop = await api(`/api/islands/${isl.id}/population`);
const farmerPop = (pop.tiers.find(t => t.tier === 'FARMER') || {}).population || 0;
check('15 座农夫住宅 → 农夫满 120', farmerPop >= 120, `农夫 ${farmerPop}`);

/* 3~4. 缺省土路 / 解锁后直接铺石板 */
{
  const dirt = await road(23, 10);
  check('缺省铺出来是土路，视图带 kind/kindLabel',
    dirt.j.data && dirt.j.data.kind === 'DIRT' && dirt.j.data.kindLabel === '土路',
    dirt.j.data ? `kind=${dirt.j.data.kind} label=${dirt.j.data.kindLabel}` : (dirt.j.message || ''));
  await apiRaw('/api/roads', 'DELETE', { playerId: p.id, islandId: isl.id, x: 23, z: 10 });
}
const stone = await road(21, 10, 'STONE');
check('农夫满 120 后石板路能铺', stone.status === 200 && stone.j.data.kind === 'STONE',
  stone.status === 200 ? 'kind=STONE' : (stone.j.message || ''));

/* 5. 旧路改铺收差价 */
{
  await road(22, 10, 'DIRT');
  const r1 = await restyle('STONE', [{ x: 22, z: 10 }]);
  check('土路改铺石板路收差价 15 金', r1.j.data && r1.j.data.restyled === 1 && r1.j.data.spent === 15,
    r1.j.data ? `restyled=${r1.j.data.restyled} spent=${r1.j.data.spent}` : (r1.j.message || ''));
  const roads = await api(`/api/roads?islandId=${isl.id}`);
  const c22 = roads.find(r => r.cellX === 22 && r.cellZ === 10);
  check('改铺后路格 kind 变成 STONE', c22 && c22.kind === 'STONE' && c22.kindLabel === '石板路');
  const r2 = await restyle('STONE', [{ x: 22, z: 10 }]);
  check('再改铺同一路面：跳过不收费', r2.j.data && r2.j.data.restyled === 0 && r2.j.data.spent === 0);
  const r3 = await restyle('BRICK', [{ x: 22, z: 10 }]);
  check('没解锁的砖路改铺被拒', r3.status === 400 && /还没解锁/.test(r3.j.message || ''),
    (r3.j.message || '').slice(0, 50));
}

/* 6. 拆石板路按石板价退款 */
{
  const before = (await api(`/api/players/${p.id}`)).treasury;
  await api(`/api/roads?playerId=${p.id}`, 'DELETE', { playerId: p.id, islandId: isl.id, x: 21, z: 10 });
  const after = (await api(`/api/players/${p.id}`)).treasury;
  const back = after - before;
  check('拆石板路返还一半石板价（22.5 金，土路只退 15）', back > 20 && back < 25, `退了 ${back} 金`);
}

/* ============ B. 客户端 ============ */
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

  /* 7~8. 路面选择片 */
  await page.evaluate(() => { const b = document.querySelector('button[data-road]'); if (b) b.click(); });
  await sleep(400);
  {
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('.rkChip')].map(b => ({ t: b.textContent, on: b.classList.contains('on'), locked: b.classList.contains('locked') })));
    check('放置条出现 4 个路面选择片，土路当前高亮',
      chips.length === 4 && chips[0].on && !chips[0].locked && chips[3].t === '林荫大道',
      chips.map(c => `${c.t}${c.on ? '●' : ''}${c.locked ? '(灰)' : ''}`).join(' '));
    check('砖路片灰显（工人还没满 200）', chips[2].locked, chips[2].t);
    await page.evaluate(() => { const b = document.querySelector('.rkChip[data-road-kind="STONE"]'); if (b) b.click(); });
    await sleep(300);
    const what = await page.evaluate(() => document.getElementById('placeWhat').textContent);
    check('点石板路片 → 放置条换成石板路 45 金/格', /石板路/.test(what) && /45/.test(what), what.slice(0, 70));
  }

  /* 9~10. 四档渲染（喂一组假路格重建，纯渲染断言） */
  {
    const kinds = await page.evaluate(() => window.__annoRoadKinds());
    const real = await api(`/api/roads?islandId=${isl.id}`);
    const fake = [];
    for (let x = 2; x <= 41; x++) {
      fake.push({ cellX: x, cellZ: 2, kind: 'DIRT' });
      fake.push({ cellX: x, cellZ: 4, kind: 'STONE' });
      fake.push({ cellX: x, cellZ: 13, kind: 'BOULEVARD' });
    }
    for (let x = 2; x <= 7; x++) for (let z = 6; z <= 11; z++) fake.push({ cellX: x, cellZ: z, kind: 'BRICK' });
    await page.evaluate(list => window.__annoSetRoads(list), fake);
    await sleep(400);
    const info = await page.evaluate(() => window.__annoRoads());
    const byKind = k => info.filter(r => r.kind === k);
    check('四档路面材质色号各不相同（与配置表一致）',
      byKind('DIRT').every(r => r.surf === kinds.DIRT.surf) &&
      byKind('STONE').every(r => r.surf === kinds.STONE.surf) &&
      byKind('BRICK').every(r => r.surf === kinds.BRICK.surf) &&
      byKind('BOULEVARD').every(r => r.surf === kinds.BOULEVARD.surf),
      `土${kinds.DIRT.surf} 石${kinds.STONE.surf} 砖${kinds.BRICK.surf} 道${kinds.BOULEVARD.surf}`);
    check('人行道只出现在林荫大道', byKind('BOULEVARD').every(r => r.walk) &&
      ['DIRT', 'STONE', 'BRICK'].every(k => byKind(k).every(r => !r.walk)));
    const center = info.find(r => r.x === 4 && r.z === 8);
    check('3×3 路网正中（四邻全是路）没有路牙', center && !center.curb, center ? `curb=${center.curb}` : '缺格');
    check('开口边有路牙', info.some(r => r.curb && r.kind === 'DIRT') && info.some(r => r.curb && r.kind === 'STONE'));
    const lampWant = { DIRT: 'wood', STONE: 'iron', BRICK: 'iron', BOULEVARD: 'double' };
    const lampOk = Object.entries(lampWant).every(([k, want]) => {
      const lamp = byKind(k).find(r => r.lamp);
      return lamp && lamp.lamp === want;
    });
    check('灯型跟路面走（土=木杆 / 石板砖=铸铁 / 大道=双头）', lampOk,
      Object.keys(lampWant).map(k => {
        const l = byKind(k).find(r => r.lamp);
        return `${k}:${l ? l.lamp : '无灯'}`;
      }).join(' '));
    await page.evaluate(list => window.__annoSetRoads(list), real);   // 还原真路网
  }

  /* 11. 点旧路 = 改铺 */
  {
    await page.evaluate(() => { const b = document.querySelector('button[data-road]'); if (b) b.click(); });
    await sleep(300);
    await page.evaluate(() => { const b = document.querySelector('.rkChip[data-road-kind="STONE"]'); if (b) b.click(); });
    await sleep(300);
    const px = await page.evaluate(() => window.__annoProject(20, 10));   // 一格土路
    await page.mouse.click(px[0], px[1]);
    let got = null;
    for (let t = 0; t < 10 && !got; t++) {
      await sleep(1000);
      const roads = await api(`/api/roads?islandId=${isl.id}`);
      got = roads.find(r => r.cellX === 20 && r.cellZ === 10 && r.kind === 'STONE');
    }
    check('拿着石板路点土路 → 旧路被改铺成石板路', !!got, got ? 'kind=STONE' : '没改到');
  }

  check('页面零报错', errors.length === 0, errors.join(' | ') || '无');
} finally {
  await browser.close();
}
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
