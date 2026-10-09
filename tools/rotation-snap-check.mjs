/**
 * 朝向吸附验证：**预览里看到的门朝哪边，落下去就得朝哪边**。
 *
 * 背景：以前客户端算自动朝向时拿"鼠标那一格"当占地左上角去数路，
 * 而服务端收的是真锚点；两边错一格 → 吸到的是另一条边 →
 * 玩家眼里就是"预览朝南、一点下去拐成朝东"。现在：
 *   ① 客户端逐朝向先算锚点再打分（与服务端 autoRotation 同构）；
 *   ② 落子时朝向**显式下发**（不再让服务端再吸一次）。
 *
 * 本脚本逐条验证：
 *   1. 门真的吸向马路：路北→朝南、路南→朝北、路西→朝东、路东→朝西
 *   2. 客户端吸到的朝向 = 服务端自己吸的朝向（发给服务端不含 rotation）
 *   3. 点下去那一下：幽灵朝向 = 预览朝向 = 落库 rotation（所见即所得）
 *   4. 按 R 手动改朝向：预览跟着改，落库也跟着改
 *   5. 港口（骑岸线）吸的是海不是路：门朝外海
 *   6. 放置条写明"自动朝路 / 自动面海 / 手动"
 *   7. 页面零报错
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '朝向验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROT = { 0:'南', 90:'东', 180:'北', 270:'西' };

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '朝向岛', flat: true });
/* 一条十字路：横的 z=60（x 50~70），竖的 x=60（z 50~70） */
for (let x = 50; x <= 70; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 60 });
for (let z = 50; z <= 70; z++) {
  if (z === 60) continue;                     // 十字路口那一格上面已经铺过了
  await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x: 60, z });
}

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

  /* 1~2. 四个方位：客户端吸到的朝向 vs 服务端自己吸的朝向 */
  const cases = [
    { cx:55, cz:59, want:0,   where:'路北' },
    { cx:55, cz:62, want:180, where:'路南' },
    { cx:59, cz:55, want:90,  where:'路西' },
    { cx:62, cz:55, want:270, where:'路东' },
  ];
  let snapOk = true, agreeOk = true;
  const lines = [];
  for (const c of cases) {
    const a = await page.evaluate((t, x, z) => window.__annoAutoRot(t, x, z), 'LUMBERJACK', c.cx, c.cz);
    if (a.rot !== c.want) snapOk = false;
    /* 发给服务端**不带 rotation**，让它自己再吸一次 —— 两边不同构就会在这里露馅 */
    let built;
    try {
      built = await api('/api/buildings', 'POST', { playerId:p.id, islandId:isl.id, type:'LUMBERJACK', x:a.anchor.x, z:a.anchor.z });
    } catch (e) { check(`${c.where}：服务端能建`, false, String(e.message).slice(0, 160)); continue; }
    const srv = built.rotation;
    if (srv !== a.rot) agreeOk = false;
    lines.push(`${c.where} 客户端${a.rot}(${ROT[a.rot]}) / 服务端${srv}(${ROT[srv]})`);
    await api(`/api/buildings/${built.id}?playerId=${p.id}`, 'DELETE');
  }
  check('门真的吸向马路（路北朝南 / 路南朝北 / 路西朝东 / 路东朝西）', snapOk, lines.join(' · '));
  check('客户端吸到的朝向 = 服务端自己吸的朝向（4/4 一致）', agreeOk, lines.join(' · '));

  /* 3. 点下去那一下：幽灵朝向 = 预览朝向 = 落库 rotation */
  {
    await page.evaluate(() => { const b = document.querySelector('button[data-build="LUMBERJACK"]'); if (b) b.click(); });
    await sleep(300);
    const px = await page.evaluate(() => window.__annoProject(55, 59));
    await page.mouse.move(px[0], px[1]);
    await sleep(500);
    const hov = await page.evaluate(() => window.__annoHover());
    const gh  = await page.evaluate(() => window.__annoGhost());
    await page.mouse.click(px[0], px[1]);
    let b = null;
    for (let t = 0; t < 15 && !b; t++) {
      await sleep(1000);
      const list = await page.evaluate(() => window.__annoBuildingViews());
      b = list.find(v => v.type === 'LUMBERJACK') || null;
    }
    const allSame = b && hov && gh && hov.rot === gh.rot && b.rotation === hov.rot;
    check('所见即所得：幽灵朝向 = 预览朝向 = 落库 rotation',
      !!allSame,
      b ? `幽灵 ${gh && gh.rot} / 预览 ${hov && hov.rot} / 落库 ${b.rotation}（${ROT[b.rotation]}）` : '没建成');
    check('落点锚点与预览一致（x/z 没被服务端挪过）',
      !!b && b.gridX === hov.cell.x - 1 && b.gridZ === hov.cell.z - 1,
      b ? `落库 (${b.gridX},${b.gridZ})，悬停格 (${hov.cell.x},${hov.cell.z})` : '没建成');
    if (b) await api(`/api/buildings/${b.id}?playerId=${p.id}`, 'DELETE');
  }

  /* 4~6. 手动改朝向：预览与落库都跟着改，放置条写明"手动" */
  {
    const px = await page.evaluate(() => window.__annoProject(55, 62));
    await page.mouse.move(px[0], px[1]);
    await sleep(400);
    const before = await page.evaluate(() => window.__annoHover());
    await page.keyboard.press('r');
    await sleep(400);
    const after = await page.evaluate(() => window.__annoHover());
    const barTxt = await page.evaluate(() => document.getElementById('placeWhat').textContent);
    await page.mouse.click(px[0], px[1]);
    let b = null;
    for (let t = 0; t < 15 && !b; t++) {
      await sleep(1000);
      const list = await page.evaluate(() => window.__annoBuildingViews());
      b = list.find(v => v.type === 'LUMBERJACK') || null;
    }
    const turned = after && before && after.rot === (before.rot + 90) % 360;
    check('按 R 手动改朝向：预览立刻跟着转 90°', !!turned && after.manual !== false,
      `${before && before.rot}(${ROT[before && before.rot]}) → ${after && after.rot}(${ROT[after && after.rot]})`);
    check('手动朝向落库一致（预览朝哪儿就建朝哪儿）',
      !!b && b.rotation === after.rot, b ? `落库 ${b.rotation}（${ROT[b.rotation]}）` : '没建成');
    check('放置条写明朝向来源（自动朝路 / 手动）', /手动/.test(barTxt || ''), (barTxt || '').slice(0, 80));
    if (b) await api(`/api/buildings/${b.id}?playerId=${p.id}`, 'DELETE');
    await page.keyboard.press('Escape');
    await sleep(300);
  }

  /* 5. 港口吸的是海不是路：平岛把建筑贴到网格西缘（出界当海） */
  {
    const a = await page.evaluate((t, x, z) => window.__annoAutoRot(t, x, z), 'TRADING_POST', 1, 30);
    let built = null, err = '';
    try {
      built = await api('/api/buildings', 'POST', { playerId:p.id, islandId:isl.id, type:'TRADING_POST', x:a.anchor.x, z:a.anchor.z });
    } catch (e) { err = String(e.message).slice(0, 160); }
    check('港口朝海不朝路（门朝外海那一侧）',
      !!built && a.rot === 270 && built.rotation === 270,
      built ? `客户端 ${a.rot}(${ROT[a.rot]}) / 服务端 ${built.rotation}(${ROT[built.rotation]})` : ('建不出来：' + err));
    if (built) await api(`/api/buildings/${built.id}?playerId=${p.id}`, 'DELETE');
  }

  /* 6. 放置条写"自动朝路" */
  {
    await page.evaluate(() => { const b = document.querySelector('button[data-build="SAWMILL"]'); if (b) b.click(); });
    await sleep(300);
    const px = await page.evaluate(() => window.__annoProject(55, 59));
    await page.mouse.move(px[0], px[1]);
    await sleep(500);
    const txt = await page.evaluate(() => document.getElementById('placeWhat').textContent);
    check('放置条写明"自动朝路"', /自动朝路/.test(txt || ''), (txt || '').slice(0, 90));
    await page.keyboard.press('Escape');
  }

  check('页面零报错', errors.length === 0, errors.join(' | ') || '无');
} finally {
  await browser.close();
}
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
