/**
 * 时钟 B 方案（服务端持久化游戏时刻，进游戏下发续走）验证 —— 分三段跑：
 *
 *   node tools/clock-sync-check.mjs http
 *     ① 岛视图携带 clockHour / clockDaySeconds=600
 *     ② 3.5 秒后前进 ≈0.14h（真实 1s = 24/600 游戏时）—— 期间无 WS，纯服务端 tick 推进
 *     末尾把 H1/t1/玩家名落盘 tools/.clock-sync-state.json
 *     （注：simClock 锚在 Unix 纪元，新岛开局时刻=世界当前相位，不是固定 7 点）
 *
 *   （→ shell 打 kill 时间戳 → 重启服务 → 探活成功时打 up 时间戳 ←）
 *      date +%s%3N > tools/.clock-t-kill ; taskkill //F //IM java.exe
 *      … 起服务 … 探活 200 时: date +%s%3N > tools/.clock-t-up
 *
 *   node tools/clock-sync-check.mjs restart
 *     ③ 续走符合**冻结口径**：懒结算下离线玩家没有 tick，水位线停在 HTTP 末次推进点
 *        （t_lg）；重启后第一次 GET 会把「t_lg 之后的全部时长」折进 frozenMs、只放行
 *        5s 宽限 → 期望 Δ(H2-H1) = ((t_lg-t1)+5s)×0.04h ≈ 0.35h，容差 ±0.15h。
 *        若离线没被折（旧 bug），Δ = (t4-t1)×0.04（离线全算），差 ≥4h，一票区分。
 *     ④ 重启后速率正常：5 秒前进 ≈0.2h
 *
 *   node tools/clock-sync-check.mjs browser
 *     ⑤ 空跑 45s 把岛钟拉开与客户端未对表值（7.0）的可测差距
 *     ⑥ 登录后 npcWorld 时钟 ≈ 服务端下发时刻 —— 换岛对表生效；没对表会停在 7.0
 *     ⑦ 跨一份 3s 快照：本地时钟仍按本地速率前进、不被快照回拨/冲到服务端值
 *
 * 全程只做数据断言，不截图。
 */
import fs from 'node:fs';
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const STATE = 'tools/.clock-sync-state.json';
const RATE = 24 / 600;                          // 每真实秒前进的游戏小时（600 真实秒 = 1 游戏日）
const fold = d => ((d % 24) + 36) % 24 - 12;    // 时刻差折回 (-12,12]，跨午夜不误判
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };
const islandOf = async st => (await api('/api/islands?playerId=' + st.playerId)).find(i => i.id === st.islandId);
const phase = process.argv[2] || 'http';

if (phase === 'http') {
  const NAME = '时钟验证' + Date.now();
  const p = await api('/api/players/register', 'POST', { name: NAME });
  const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '时钟岛', flat: true });
  const st = { playerId: p.id, name: NAME, islandId: isl.id };
  const iv = await islandOf(st);
  check('① 岛视图携带 clockHour', Number.isFinite(iv?.clockHour), `clockHour=${iv?.clockHour}`);
  check('① clockDaySeconds=600', iv?.clockDaySeconds === 600, `=${iv?.clockDaySeconds}`);
  st.h1 = iv.clockHour;
  st.t1 = Date.now();
  await sleep(3500);
  const h2 = (await islandOf(st)).clockHour;
  const d = fold(h2 - st.h1);
  check('② 3.5 秒前进 ≈0.14h（无 WS 纯服务端推进）', d > 0.05 && d < 0.3, `Δ=${d.toFixed(3)}h（期望≈${(3.5 * RATE).toFixed(2)}）`);
  st.tLg = Date.now();                           // 本次 GET 即末次推进点（advance 会把 lastSimAt 推到这里）
  fs.writeFileSync(STATE, JSON.stringify(st));
  console.log(`状态已落盘 H1=${st.h1.toFixed(3)} → 现在打时间戳并重启服务，然后跑 restart`);
} else if (phase === 'restart') {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const t2 = Number(fs.readFileSync('tools/.clock-t-kill', 'utf8').trim());   // taskkill 前一刻
  const t3 = Number(fs.readFileSync('tools/.clock-t-up', 'utf8').trim());     // 探活 200 那一刻
  check('离线窗口 ≥12s（保判别力）', t3 - t2 >= 12000, `offline=${((t3 - t2) / 1000).toFixed(1)}s`);
  await sleep(10000);                            // 首次 GET 自带 advance 折叠；睡 10s 让离线窗口更扎实
  const t4 = Date.now();
  const h2 = (await islandOf(st)).clockHour;
  const d1 = fold(h2 - st.h1);
  const expFrozen = ((st.tLg - st.t1) + 5000) * RATE / 1000;   // 冻结口径：t_lg 之后只放行 5s 宽限
  const expNoFreeze = (t4 - st.t1) * RATE / 1000;              // 假想离线照走的口径（旧 bug）
  check('③ 续走符合冻结口径（只补 5s 宽限）', Math.abs(d1 - expFrozen) <= 0.15,
    `Δ=${d1.toFixed(2)}h 冻结期望=${expFrozen.toFixed(2)} 不冻期望=${expNoFreeze.toFixed(2)}（两者差=${(expNoFreeze - expFrozen).toFixed(2)}）`);
  await sleep(5000);
  const h3 = (await islandOf(st)).clockHour;
  const d2 = fold(h3 - h2);
  check('④ 重启后速率正常', d2 > 0.1 && d2 < 0.35, `Δ=${d2.toFixed(3)}h（期望≈${(5 * RATE).toFixed(2)}）`);
} else if (phase === 'browser') {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  console.log('空跑 45s 把岛钟从 7 点拉到 ~9 点（与未对表客户端拉开可测差距）…');
  await sleep(45000);
  const h_s0 = (await islandOf(st)).clockHour;   // 登录前采一份：对表目标 ≈ 它 + 页面加载延迟×速率
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
    await page.type('#nameIn', st.name);
    await page.click('#enterBtn');
    await sleep(8000);
    const hasWorld = await page.evaluate(() => !!window.__annoNpcWorld);
    check('⑤ npcWorld 钩子可用', hasWorld);
    const h_c = await page.evaluate(() => window.__annoNpcWorld?.clock?.hour);
    const dc = fold(h_c - h_s0);
    check('⑥ 客户端已按服务端时刻对表（换岛对表一次）', dc > -0.4 && dc < 1.1,
      `client=${h_c?.toFixed?.(2)} server@load=${h_s0.toFixed(2)} Δ=${dc?.toFixed?.(2)}h（没对表会停在 7.0，Δ≈-2.5）`);
    await sleep(4000);                           // 跨一份 3s 快照
    const h_c2 = await page.evaluate(() => window.__annoNpcWorld?.clock?.hour);
    const dd = fold(h_c2 - h_c);
    check('⑦ 跨快照本地推进不被回拨', dd >= 0 && dd < 0.3,
      `Δ=${dd?.toFixed?.(3)}h（headless 慢动作只走一点点 ≈0.01；被快照冲会跳 ~1h）`);
    console.log('errs:', errs.length ? errs : '无');
    console.log(fails === 0 && errs.length === 0 ? 'ALL PASS' : fails + ' FAILED / errs=' + errs.length);
    process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
  } finally { await browser.close(); }
} else {
  console.log('用法：node tools/clock-sync-check.mjs http | restart | browser');
  process.exitCode = 2;
}
if (phase !== 'browser') process.exitCode = fails === 0 ? 0 : 1;
