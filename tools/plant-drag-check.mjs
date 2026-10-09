// 划区域批量种植验证（纪元式拉田版）：API 建号 + 平岛 → 造景（路+农场）→ 无头 Edge 登录 →
// 点作物卡（自动绑到对应农场）→ 拖矩形 → API 对账耕地数与归属。
// 平岛（flat:true）全场平原；农场 (21,17) 3×3 底边贴 z=20 的路，镜头对准 (23,21) 拖矩形。
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '划田验证' + stamp;

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

/* 1. 建号 + 平岛 + 造景（纪元式拉田：田是农场的） */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '田岛', flat: true });
console.log(`player=${p.id} island=${isl.id} gridSize=${isl.gridSize}`);
for (const x of [20, 21, 22, 23, 24]) {
  await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 20 });
}
const farm = await api('/api/buildings', 'POST',
  { playerId: p.id, islandId: isl.id, type: 'POTATO_FARM', x: 21, z: 17 });
console.log(`农场：${farm.label} @ (${farm.gridX},${farm.gridZ}) ${farm.sizeW}x${farm.sizeH}`);

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
  await new Promise(r => setTimeout(r, 6000));   // 等登录 + 地形网格构建

  /* 2. 镜头对准农场右下外一格（画面中心 = (23,21)，农场周围 3 格内） */
  await page.evaluate(() => window.__annoLookAt(23, 21, 26));
  await new Promise(r => setTimeout(r, 4500));   // 等页面轮询把农场收进快照

  /* 3. 点工具栏"土豆"：新语义 = 找一座马铃薯农场直接开拉 */
  await page.click('[data-plant="POTATO"]');
  await new Promise(r => setTimeout(r, 400));
  const place = await page.evaluate(() => window.__annoPlace && window.__annoPlace());
  check('点作物卡进入拉田模式并绑到农场',
    place && place.kind === 'plant' && place.type === 'POTATO' && place.farmId === farm.id,
    JSON.stringify(place));

  /* 4. 单击一株（画面中心 = (23,21)，离农场 2 格） */
  await page.mouse.move(750, 475);
  await page.mouse.down();
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 800));
  let plots = await api(`/api/islands/${isl.id}/plots`);
  check('单击中心格种上 1 株', plots.length === 1,
    `plots=${plots.length}${plots.length ? ' buildingId=' + plots[0].buildingId : ''}`);

  /* 5. 从画面中心往右下拖一个矩形（跨过农场右侧与下侧的合法区）。
        框要罩住若干"格子中心"才统计得到 —— 拖 300×225px。 */
  await page.mouse.move(750, 475);
  await page.mouse.down();
  await page.mouse.move(750, 475);
  await page.mouse.move(1050, 700, { steps: 15 });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'target/plant-drag-ghost.png' });   // 拖动中的预览
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 500));
  const toastText = await page.evaluate(() => document.body.innerText.match(/一口气种下[^\n"]*/) || []);
  console.log('   toast:', JSON.stringify(toastText[0] || '(未捕获)'));

  /* 6. API 对账：轮询到数量稳定再断言 */
  const waitStable = async () => {
    let last = -1, same = 0;
    for (let i = 0; i < 40; i++) {
      const n = (await api(`/api/islands/${isl.id}/plots`)).length;
      if (n === last && n > 0) { same++; if (same >= 3) return n; } else same = 0;
      last = n;
      await new Promise(r => setTimeout(r, 500));
    }
    return last;
  };
  const n1 = await waitStable();
  plots = await api(`/api/islands/${isl.id}/plots`);
  check('拖一片区域批量拉田生效', n1 >= 10, `种下 ${n1} 株土豆`);
  const xs = plots.map(q => q.cellX), zs = plots.map(q => q.cellZ);
  const spanX = Math.max(...xs) - Math.min(...xs), spanZ = Math.max(...zs) - Math.min(...zs);
  check('种下的格子铺开成一片田（两个方向都有跨度）', spanX >= 3 && spanZ >= 3,
    `x 跨度 ${spanX}，z 跨度 ${spanZ}`);
  check('所有田都归属这座农场（buildingId 落库）',
    plots.every(q => q.buildingId === farm.id),
    `owned=${plots.filter(q => q.buildingId === farm.id).length}/${plots.length}`);

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log(failed ? `FAILED ${failed}` : 'ALL_PASS');
} finally {
  await browser.close();
}
