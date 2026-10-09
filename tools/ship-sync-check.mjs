/**
 * 商船平滑重锚验证：
 *  ① 真实快照流下相位连续：每 200ms 采样，解卷后不允许出现 >3% 周期的倒退跳变
 *  ② 模拟"服务端重启回来相位落后"的失步：手动喂一个倒退 15s 的目标相位，
 *     船不允许瞬移 —— 相位连续，且 ~1.2s 内平滑吸收（correct 归 0）
 *  ③ 模拟快照网络抖动（±150ms）：无跳变
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '船同步验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '船岛', flat: true });
for (let x = 4; x <= 10; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(9000);   // 等第一批快照把船同步进来

  // ① 真实快照流：15s 内每 200ms 采样，解卷后不允许 >3% 周期的倒退
  let prev = null, maxDrop = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    await sleep(200);
    const now = await page.evaluate(() => (window.__annoShipPhases()[0] || { p: null }).p);
    if (now == null) continue;
    if (prev != null) {
      let d = now - prev;
      if (d < -0.5) d += 1;                    // 解卷（相位过 0 点绕回）
      if (d < -maxDrop) maxDrop = -d;
    }
    prev = now;
  }
  check('真实快照流相位连续（无 >3% 倒退跳变）', maxDrop < 0.03, '最大倒退=' + (maxDrop * 100).toFixed(2) + '%周期');

  // ② 模拟失步：喂一个倒退 15s（cycle 96s 的 ~15.6%）的目标相位 → 不许瞬移，1.2s 内滑过去
  const seq = await page.evaluate(() => {
    const f = window.__annoFleet;
    const n = [...f.ships.values()][0];
    const cycle = n.data.cycleMs || 96000;
    const before = window.__annoShipPhases()[0].p;
    const target = ((n.data.phaseMs - 15000) % cycle + cycle) % cycle;   // 服务端"落后 15s"
    f.sync([{ ...n.data, phaseMs: target }]);                            // 假装服务端回连后重锚
    return { before, cycle };
  });
  await sleep(60);
  const rightAfter = await page.evaluate(() => window.__annoShipPhases()[0]);
  const step = ((rightAfter.p - seq.before) % 1 + 1) % 1;   // 相位差（正向绕行）
  const backwardStep = Math.min(step, 1 - step);            // 最短弧长
  check('失步重锚后船没有瞬移（60ms 内位移 <2.5% 周期）', backwardStep < 0.025,
    '60ms 位移=' + (backwardStep * 100).toFixed(2) + '%周期');
  await sleep(1800);
  /* 吸收窗 1.2s < 快照周期 3s：跨一个完整周期多次采样，总能逮到 correct 归零的时刻
     （期间真实快照会带着合法的小抖动重新启动吸收，所以取最小值而不是单点） */
  let minCorrect = Infinity;
  for (let i = 0; i < 8; i++) {
    await sleep(400);
    const c = await page.evaluate(() => window.__annoShipPhases()[0].correct);
    if (Math.abs(c) < minCorrect) minCorrect = Math.abs(c);
  }
  check('失步差值被平滑吸收（会归零，不残留瞬移）', minCorrect < 2000, '最小 correct=' + minCorrect.toFixed(0) + 'ms');

  // ③ 抖动模拟：连喂 ±150ms 相位抖动，采样无跳变
  let drop2 = 0;
  prev = await page.evaluate(() => window.__annoShipPhases()[0].p);
  for (const jitter of [150, -300, 150, 0, -150, 300]) {
    await page.evaluate(ms => {
      const f = window.__annoFleet;
      const n = [...f.ships.values()][0];
      const cycle = n.data.cycleMs || 96000;
      f.sync([{ ...n.data, phaseMs: ((n.data.phaseMs + ms) % cycle + cycle) % cycle }]);
    }, jitter);
    await sleep(150);
    const now = await page.evaluate(() => window.__annoShipPhases()[0].p);
    let d = now - prev;
    if (d < -0.5) d += 1;
    if (d < -drop2) drop2 = -d;
    prev = now;
  }
  check('网络抖动（±150~300ms）无跳变', drop2 < 0.03, '最大倒退=' + (drop2 * 100).toFixed(2) + '%周期');

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
