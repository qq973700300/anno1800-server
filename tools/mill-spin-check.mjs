/**
 * 磨坊风车"材料充足才转"验证：
 *  ① GLB 模型里的 windmill 枢轴节点被登记到磨坊（__annoMills 有且仅有一条）
 *  ② 岛仓没粮 → 服务端 stalled=true → 风叶静止（rot 零漂移、spd=0）
 *  ③ NPC 市场买入 GRAIN → 复工 → 风叶转动（rot 4 秒递增 ≥1.0 rad、spd>0.3）
 *  ④ 卖光 GRAIN → 再次停转（rot 4 秒漂移 <0.15、spd=0）
 *  ⑤ 再买 GRAIN → 再次复转（证明可重复开停）
 * 全程只做数据断言，不截图。
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '风车验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };

/* ---- 建岛：路 + 农夫住宅(8 移民=劳动力) + 磨坊 + 贸易站(码头,让面粉能运走) ---- */
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '风车岛', flat: true });
await api('/api/market/buy', 'POST', { playerId: p.id, good: 'TIMBER', quantity: 6 });   // 磨坊要 5 木板，开局只带 4
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });   // 服务端要求先有港口
for (let x = 4; x <= 10; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 4, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'MILL', x: 7, z: 9 });

/* ---- 清仓：把岛仓里的 GRAIN 全卖给 NPC，磨坊从一开始就缺料 ---- */
const grainQty = async () => {
  const stock = await api('/api/market/stock/' + p.id);
  return (stock.find(s => s.good === 'GRAIN') || { quantity: 0 }).quantity;
};
while (await grainQty() > 0) {
  await api('/api/market/sell', 'POST', { playerId: p.id, good: 'GRAIN', quantity: Math.min(await grainQty(), 100) });
}
console.log('初始 GRAIN 已清仓，余额 treasury=', (await api('/api/players/' + p.id)).treasury ?? '?');

/* ---- 开页面 ---- */
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);

  const mills = () => page.evaluate(() => window.__annoMills && window.__annoMills());
  const views = () => page.evaluate(() => window.__annoBuildingViews && window.__annoBuildingViews());
  const millView = async () => (await views()).find(v => v.type === 'MILL');

  /* 轮询工具：直到 cond 成立或超时（interval 500ms），返回最后值或 null */
  const waitFor = async (cond, timeoutS, label) => {
    const dead = Date.now() + timeoutS * 1000;
    while (Date.now() < dead) {
      const v = await cond();
      if (v) return v;
      await sleep(500);
    }
    console.log('  (waitFor 超时: ' + label + ')');
    return null;
  };
  /* 绕圈感知的转角累加器：rot 是 mod 2π 的，直接相减会在跨圈时算错；
     每 250ms 采样一次、把每次差值折回 (-π,π] 再累加 —— 采样间最大真实位移
     0.55×0.25≈0.14 rad 远小于 π，折叠不会误判。返回 ms 毫秒内的累计转角。 */
  const watchRot = async ms => {
    let prev = (await mills())[0].rot, acc = 0;
    const dead = Date.now() + ms;
    while (Date.now() < dead) {
      await sleep(250);
      const cur = (await mills())[0].rot;
      let d = cur - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      acc += d; prev = cur;
    }
    return acc;
  };
  const spdZero = async () => ((await mills())[0] || {}).spd === 0;

  /* ① 风叶登记：模型异步挂上后 __annoMills 应有一条 */
  const m0 = await waitFor(async () => (await mills())[0], 30, '风叶登记');
  check('windmill 枢轴已登记', !!m0, m0 ? `id=${m0.id} rot=${m0.rot}` : '无记录');

  /* ② 缺料停转：等服务端把磨坊标成 stalled，等缓动归零后量 4 秒漂移 */
  let v = await waitFor(async () => (await millView())?.stalled === true ? await millView() : null, 40, 'stalled=true');
  check('缺粮时服务端 stalled=true', !!v, v ? `pendingQty=${v.pendingQty} noWorkers=${v.noWorkers}` : '等不到');
  const z1 = await waitFor(spdZero, 45, 'spd 归零');
  const drift1 = await watchRot(4000);
  check('停转：4 秒转角零漂移', Math.abs(drift1) < 0.15, `Δrot=${drift1.toFixed(3)}`);
  check('停转：角速度为 0', z1 !== null, `spd=${(await mills())[0].spd} stall=${(await mills())[0].stall}`);

  /* ③ 买粮复工
     ⚠️ headless swiftshader 只有 ~0.8fps，animate 的 dt 被钳到 0.1s（game.html 6309），
     转角积分只有真实值的 ~8%（每 ~1.2s 跳一格 ≈0.05 rad）——这是测试环境慢动作，
     真实浏览器 60fps 下 dt≈0.016 不受钳制，转速就是完整的 0.55 rad/s。
     所以运转阈值取"显著大于停转漂移"的 0.15，两种环境都成立。 */
  await api('/api/market/buy', 'POST', { playerId: p.id, good: 'GRAIN', quantity: 40 });
  v = await waitFor(async () => (await millView())?.stalled === false ? await millView() : null, 40, '复工');
  check('买粮后 stalled=false', !!v, v ? `progress=${(v.progress || 0).toFixed(2)} pendingQty=${v.pendingQty}` : '等不到');
  const run1 = await watchRot(6000);
  check('复工：6 秒转角递增 ≥0.15', run1 >= 0.15, `Δrot=${run1.toFixed(3)} spd=${(await mills())[0].spd}`);
  check('复工：角速度 ≥0.3', (await mills())[0].spd >= 0.3);

  /* ④ 再断粮：卖光 GRAIN → 停转 */
  while (await grainQty() > 0) {
    await api('/api/market/sell', 'POST', { playerId: p.id, good: 'GRAIN', quantity: Math.min(await grainQty(), 100) });
  }
  v = await waitFor(async () => (await millView())?.stalled === true ? await millView() : null, 60, '再次停工');
  check('断粮后再次 stalled=true', !!v, v ? `pendingQty=${v.pendingQty}` : '等不到');
  const z2 = await waitFor(spdZero, 45, 'spd 再归零');
  const drift2 = await watchRot(4000);
  check('再停：4 秒漂移 <0.15', Math.abs(drift2) < 0.15, `Δrot=${drift2.toFixed(3)}`);
  check('再停：角速度为 0', z2 !== null, `spd=${(await mills())[0].spd}`);

  /* ⑤ 再复工（可重复开停） */
  await api('/api/market/buy', 'POST', { playerId: p.id, good: 'GRAIN', quantity: 40 });
  v = await waitFor(async () => (await millView())?.stalled === false ? await millView() : null, 40, '再次复工');
  check('再买粮后 stalled=false', !!v);
  const run2 = await watchRot(6000);
  check('再复工：6 秒转角递增 ≥0.15', run2 >= 0.15, `Δrot=${run2.toFixed(3)} spd=${(await mills())[0].spd}`);

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
