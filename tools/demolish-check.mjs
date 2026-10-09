// 铲除工具端到端验证：API 造景（贸易站+马路+农夫小屋+土豆田）→ 无头 Edge 登录 →
// ① 单击作物 → 弹框 → 确认 → 拆 1 株
// ② 拖一片作物 → 弹框 → 取消 → 不拆；再确认 → 批量拆
// ③ 大框混着房子/马路，第一格是作物 → 只拆作物，建筑/马路毫发无伤（类型过滤）
// ④ 单击马路 → 弹框 → 取消 → 马路还在
// 平岛（flat:true）全场平原；测试钩子 __annoLookAt / __annoProject 精确定位格子。
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '铲除验证' + stamp;

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${j.message || r.status}`);
  return j.data;
};

/* 1. API 造景：贸易站贴西边缘（平岛贴边即临海）→ 马路链 → 农夫小屋 → 马铃薯农场 → 3×3 土豆田
   （纪元式拉田：田是农场的，农场 (10,7) 底边贴 z=10 的路，田 (10..12,4..6) 在它北边 1 格） */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '铲岛', flat: true });
console.log(`player=${p.id} island=${isl.id} gridSize=${isl.gridSize}`);
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 10 });
for (const x of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]) {
  await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 10 });
}
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 5, z: 8 });
const farm = await api('/api/buildings', 'POST',
  { playerId: p.id, islandId: isl.id, type: 'POTATO_FARM', x: 10, z: 7 });
const PATCH = [];                       // 土豆田 (10..12, 4..6) 3×3 = 9 株（离农场 1 格）
for (let z = 4; z <= 6; z++) for (let x = 10; x <= 12; x++) {
  await api('/api/farm/plant', 'POST',
    { playerId: p.id, islandId: isl.id, x, z, crop: 'POTATO', buildingId: farm.id });
  PATCH.push([x, z]);
}
const plots0 = (await api(`/api/islands/${isl.id}/plots`)).length;
const blds0 = await api(`/api/islands/${isl.id}/buildings`);
const roads0 = (await api(`/api/roads?islandId=${isl.id}`)).length;
console.log(`造景完成：田 ${plots0} 株，建筑 ${blds0.length} 座（${blds0.map(b => b.type).join(',')}），马路 ${roads0} 格`);

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  → ' + detail : ''}`);
  if (!ok) failed++;
};

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1500, height: 950 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 6000));

  /* 屏幕坐标工具：镜头对准哪格 + 某格投到屏幕哪里 */
  const lookAt = (gx, gz, d) => page.evaluate((a, b, c) => window.__annoLookAt(a, b, c), gx, gz, d);
  const proj = (gx, gz) => page.evaluate((a, b) => window.__annoProject(a, b), gx, gz);
  const modalTitle = () => page.evaluate(() => document.getElementById('confirmTitle').textContent);
  const modalShown = () => page.evaluate(() => document.getElementById('confirmMask').classList.contains('show'));

  /* 2. 拿起铲除工具 */
  await page.click('[data-demolish-tool]');
  await new Promise(r => setTimeout(r, 400));

  /* 3. 测试 A：单击一株土豆 → 弹框 → 确认 → 拆 1 株 */
  await lookAt(11, 5, 16);
  await new Promise(r => setTimeout(r, 600));
  const [ax, ay] = await proj(10, 5);
  await page.mouse.click(ax, ay);
  await new Promise(r => setTimeout(r, 500));
  check('A1 单击作物弹出确认框', await modalShown(), await modalTitle());
  await page.screenshot({ path: 'target/demolish-confirm.png' });
  const titleA = await modalTitle();
  await page.click('#confirmYes');
  let n = plots0;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    n = (await api(`/api/islands/${isl.id}/plots`)).length;
    if (n < plots0) break;
  }
  check('A2 确认后拆掉 1 株', n === plots0 - 1, `${titleA}，田 ${plots0} -> ${n}`);

  /* 4. 测试 B：拖一片（多株）→ 先「取消」验证不执行 */
  const [bx, by] = await proj(10, 4);
  const [bx2, by2] = await proj(12, 6);
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx2, by2, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  const titleB = await modalTitle();
  const nB = Number((titleB.match(/(\d+)/) || [])[1] || 0);
  check('B1 划片弹出批量确认框（只含作物）', await modalShown() && titleB.includes('作物'), titleB);
  await page.click('#confirmNo');
  await new Promise(r => setTimeout(r, 800));
  check('B2 点取消不拆', (await api(`/api/islands/${isl.id}/plots`)).length === n, `仍是 ${n} 株`);

  /* 5. 测试 B3：同一片再划一次，这次确认 → 批量拆 */
  await page.mouse.move(bx, by);
  await page.mouse.down();
  await page.mouse.move(bx2, by2, { steps: 8 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  await page.click('#confirmYes');
  let n2 = n;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    n2 = (await api(`/api/islands/${isl.id}/plots`)).length;
    if (n2 < n) break;
  }
  check('B3 确认后批量拆掉整片', n2 === n - nB, `弹框 ${nB} 个，田 ${n} -> ${n2}`);

  /* 6. 测试 C：大框混着农夫小屋/马路/贸易站，起点是作物 → 只拆作物（类型过滤） */
  const [cx, cy] = await proj(12, 4);    // 起点 = 土豆
  const [cx2, cy2] = await proj(5, 9);   // 终点压着农夫小屋（5..6, 8..9）和几格马路
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx2, cy2, { steps: 10 });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'target/demolish-drag.png' });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  const titleC = await modalTitle();
  const nC = Number((titleC.match(/(\d+)/) || [])[1] || 0);
  check('C1 混合区域只统计作物', await modalShown() && titleC.includes('作物') && !titleC.includes('小屋'),
    `${titleC}（田剩 ${n2}）`);
  await page.click('#confirmYes');
  let n3 = n2;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    n3 = (await api(`/api/islands/${isl.id}/plots`)).length;
    if (n3 === 0) break;
  }
  const blds1 = await api(`/api/islands/${isl.id}/buildings`);
  const roads1 = (await api(`/api/roads?islandId=${isl.id}`)).length;
  /* 透视投影下屏幕矩形两角连线并不保证罩住所有中间格，框外剩几株是正常的 ——
     断言"实际铲掉数 === 弹框统计数"即可（铲多铲少由框罩住多少决定） */
  check('C2 实际铲掉数与弹框一致', n3 === n2 - nC, `弹框 ${nC} 个，田 ${n2} -> ${n3}`);
  check('C3 房子和贸易站毫发无伤', blds1.length === blds0.length,
    `建筑 ${blds1.length}/${blds0.length}`);
  check('C4 马路毫发无伤', roads1 === roads0, `马路 ${roads1}/${roads0}`);

  /* 7. 测试 D：单击马路 → 弹框 → 取消 → 马路还在 */
  await lookAt(4, 10, 12);
  await new Promise(r => setTimeout(r, 600));
  const [dx, dy] = await proj(4, 10);
  await page.mouse.click(dx, dy);
  await new Promise(r => setTimeout(r, 500));
  const titleD = await modalTitle();
  check('D1 单击马路弹确认框', await modalShown() && titleD.includes('马路'), titleD);
  await page.click('#confirmNo');
  await new Promise(r => setTimeout(r, 600));
  check('D2 取消后马路还在', (await api(`/api/roads?islandId=${isl.id}`)).length === roads0);

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log(failed ? `FAILED ${failed}` : 'ALL_PASS');
} finally {
  await browser.close();
}
