/**
 * 街头生活（NPC）专项验证。
 *
 * 用法：先起服务，然后 node npc-check.mjs
 *      BASE=http://localhost:8080 node npc-check.mjs
 *
 * 分两段：
 *   A 段（接口）：在**平岛**上搭一座"能住人的小镇"—— 环形路网、港口、3 座农夫小屋、
 *                面包房、伐木场，然后把口粮备足，**等人口真的涨起来**。
 *                （用平岛是为了坐标确定：随机岛的海岸线每次都不一样，脚本没法固定布局。）
 *                NPC 数量是人口的可视化，所以"人口 > 0"是这一整套的前提。
 *   B 段（浏览器）：用无头 Edge 打开 game.html，断言：
 *                 · 街上人数 === 岛上人口（老实按人口，不凭空捏人）
 *                 · 居民真的在沿马路移动、状态机能覆盖到多个状态（含 CHAT 与 SLEEP）
 *                 · 三级 LOD 生效（完整动画 / 收手臂 / 人群剪影 / 不画）
 *                 · 14 种原型与 6 个换装轴真的抽出了多样组合
 *                 · 演示模式（?npc=N）能把人群层压出几百人
 *
 * 时长：A 段等人口，默认时间倍率下约 1~3 分钟；B 段约 40 秒。
 */
import { writeFileSync } from 'node:fs';

const B = process.env.BASE || 'http://localhost:8080';
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PUPPETEER = process.env.PUPPETEER
  || 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  \u2713', name); }
  else { fail++; console.log('  \u2717', name, extra ? '  << ' + extra : ''); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (u, o) => {
  const r = await fetch(B + u, o);
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};
const get = (u) => j(u);
const post = (u, b) => j(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const data = (r) => (r && r.d ? r.d.data : undefined);

async function pollUntil(fn, cond, budgetMs = 300000, intervalMs = 3000) {
  const t0 = Date.now();
  let v = await fn();
  while (!cond(v) && Date.now() - t0 < budgetMs) { await sleep(intervalMs); v = await fn(); }
  return v;
}

console.log('===== 街头生活：NPC 原型 / 换装 / 状态机 / LOD =====\n');

/* ============================================================
   A 段：搭一座能住人的小镇
   ============================================================ */
console.log('--- A. 搭场景（人口是 NPC 数量的唯一来源）---');

let up = false;
for (let i = 0; i < 30; i++) {
  try { if ((await get('/api/players')).s === 200) { up = true; break; } } catch { /* 还没起来 */ }
  await sleep(1000);
}
if (!up) { console.log('服务未就绪，退出'); process.exit(1); }

const name = '街头验证' + (Date.now() % 100000);
const p = data(await post('/api/players/register', { name }));
ok('注册玩家', !!(p && p.id));
const pid = p.id;

const isl = data(await post('/api/islands', { playerId: pid, name: '街头测试岛', flat: true }));
ok('创建平岛（坐标确定，脚本才能固定布局）', !!(isl && isl.id), JSON.stringify(isl));
const iid = isl.id;

/* 建房要材料（纪元1800式）：面包房要 7 木板，开局只带 4 —— 找市场补一点 */
await post('/api/market/buy', { playerId: pid, good: 'TIMBER', quantity: 10 });

/* 路网：一圈环路 + 中间一条竖街 —— NPC 才会走出"拐弯 / 十字 / 不同路线"。
   只有一条直路的话所有人都是同一条线的往返，看不出街区感。 */
const roads = [];
for (let x = 3; x <= 17; x++) { roads.push([x, 8]); roads.push([x, 16]); }
for (let z = 9; z <= 15; z++) { roads.push([3, z]); roads.push([10, z]); roads.push([17, z]); }
let roadOk = 0;
for (const [x, z] of roads) {
  const r = await post('/api/roads', { playerId: pid, islandId: iid, x, z });
  if (r.s === 200) roadOk++;
}
ok(`修好环形路网（${roads.length} 格）`, roadOk === roads.length, `成功 ${roadOk}/${roads.length}`);

/* 港口：平岛的最外一圈就是海岸带，所以锚点必须压到 x=0 那一圈上 */
const tp = data(await post('/api/buildings', { playerId: pid, islandId: iid, type: 'TRADING_POST', x: 0, z: 10 }));
ok('海岸带上建港口（贸易站）', !!(tp && tp.id), '贸易站只能建在海边');

/* 住宅：围着环路摆三座 */
const houses = [];
for (const [x, z] of [[5, 9], [11, 9], [5, 14]]) {
  const b = data(await post('/api/buildings', { playerId: pid, islandId: iid, type: 'FARMER_HOUSE', x, z }));
  if (b && b.id) houses.push(b);
}
ok('盖起 3 座农夫小屋（居民住哪）', houses.length === 3, `成功 ${houses.length}`);

/* 工作地与商店：居民白天要有地方可去 */
const lum = data(await post('/api/buildings', { playerId: pid, islandId: iid, type: 'LUMBERJACK', x: 11, z: 13 }));
ok('盖起伐木场（居民去哪上班）', !!(lum && lum.id));
const bak = data(await post('/api/buildings', { playerId: pid, islandId: iid, type: 'BAKERY', x: 13, z: 9 }));
ok('盖起面包房（居民去哪买东西）', !!(bak && bak.id));

/* 备粮：土豆 + 烈酒备足，人口才会一路涨上去 */
await post('/api/market/buy', { playerId: pid, good: 'POTATO', quantity: 60 });
await post('/api/market/buy', { playerId: pid, good: 'SCHNAPPS', quantity: 20 });

process.stdout.write('  等人口涨起来（最多 5 分钟，涨到 1 人就继续）…');
const pop0 = await pollUntil(
  async () => data(await get(`/api/islands/${iid}/population`)),
  (v) => v && v.totalPopulation > 0, 300000, 3000);
console.log('');
ok('岛上人口 > 0', !!(pop0 && pop0.totalPopulation > 0),
  `totalPopulation=${pop0 && pop0.totalPopulation}`);
console.log(`  人口 ${pop0.totalPopulation} / 容量 ${pop0.totalCapacity}`);

/* ============================================================
   B 段：无头浏览器
   ============================================================ */
console.log('\n--- B. 无头浏览器：街上真的有人在走吗 ---');

const mod = await import(PUPPETEER);
const puppeteer = mod.default || mod;
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
         '--window-size=1600,900', '--disable-dev-shm-usage'],
});

const errors = [], badHttp = [];
async function newPage(url) {
  const pg = await browser.newPage();
  await pg.setViewport({ width: 1600, height: 900 });
  pg.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  pg.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  pg.on('response', (r) => {
    if (r.status() >= 400 && !/favicon/.test(r.url())) badHttp.push(r.status() + ' ' + r.url());
  });
  await pg.evaluateOnNewDocument((n, id) => {
    /* 预置 localStorage：enter() 直接走"老玩家回来"那条路，不会先打一次注册拿 400 ——
       否则"零 4xx"这条断言会被这个正常流程污染。 */
    localStorage.setItem('anno1800_players', JSON.stringify({ [n]: id }));
  }, name, pid);
  await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.evaluate((n) => { document.getElementById('nameIn').value = n; }, name);
  await pg.click('#enterBtn');
  await pg.waitForFunction(() => window.__annoNpcWorld, { timeout: 60000, polling: 300 }).catch(() => {});
  await pg.waitForFunction(() => window.__annoNpcWorld && window.__annoNpcWorld.npcs.length > 0,
    { timeout: 30000, polling: 300 }).catch(() => {});
  return pg;
}

const read = (pg) => pg.evaluate(() => {
  const w = window.__annoNpcWorld;
  const s = w.stats;
  return {
    total: s.total, detail: s.detail, crowd: s.crowd, hidden: s.hidden,
    byState: { ...s.byState }, byArch: { ...s.byArch },
    clock: w.clockText, hour: w.clock.hour, crowdInst: w.crowdBody.count,
    variants: new Set(w.npcs.map((n) => `${n.look.hat}|${n.look.clothes}|${n.look.hair}|${n.look.accessory}|${n.look.skin}`)).size,
    pos: w.npcs.map((n) => [n.id, Math.round(n.px * 100) / 100, Math.round(n.pz * 100) / 100]),
    pathProgress: w.npcs.reduce((s, n) => s + (n.state === 'WALK' ? n.pathIdx : 0), 0),
    onRoadY: w.npcs.filter((n) => n.state === 'WALK' && n.body.group.position.y > 0.74).length,
    /* 走路的人离他"上一次踩到的那个路格"有多远。沿马路走最多一格多一点（车道偏移），
       可一旦路径缓存把**反向**的路线原样返回，人会朝对面那一头直线插过去横穿空地，
       这个距离会拉到好几格 —— 这一项就是那个 bug 的探针。 */
    strayWalkers: w.npcs.filter((n) => {
      if (n.state !== 'WALK' || !n.atCell) return false;
      const [cx, cz] = w.deps.cellToWorld(n.atCell[0], n.atCell[1]);
      return Math.hypot(n.px - cx, n.pz - cz) > 3.0;
    }).length,
    tiers: [...new Set(w.npcs.map((n) => n.tier))],
  };
});

/** 轮询到条件满足为止 —— 居民走到目的地是要花时间的，用固定 sleep 猜时长迟早会 flaky */
async function waitFor(pg, cond, budgetMs) {
  const t0 = Date.now();
  let v = await read(pg);
  while (!cond(v) && Date.now() - t0 < budgetMs) { await sleep(2000); v = await read(pg); }
  return v;
}

/* ---- B1：真实人口档（街头人数必须老实等于人口） ---- */
const pg = await newPage(B + '/game.html');
await sleep(2000);
const a1 = await read(pg);

ok('NPC 世界已建立、时钟在走', !!a1.clock, a1.clock);
ok('街上人数 === 岛上人口（不凭空捏人）', a1.total === pop0.totalPopulation,
  `街上 ${a1.total} vs 人口 ${pop0.totalPopulation}`);
ok('确实有人在街上', a1.total > 0, `total=${a1.total}`);

await sleep(7000);
const a2 = await read(pg);
const moved = a1.pos.filter((s) => {
  const b = a2.pos.find((t) => t[0] === s[0]);
  return b && (Math.abs(b[1] - s[1]) > 0.05 || Math.abs(b[2] - s[2]) > 0.05);
}).length;
ok('有人在沿马路移动（位置真的变了）', moved > 0, `7 秒内有 ${moved} 人换过位置`);
ok('走路的人在**推进路径**，不是卡在起点（路径索引在涨）',
  a2.pathProgress > a1.pathProgress, `pathIdx 总量 ${a1.pathProgress} → ${a2.pathProgress}`);
ok('有人处于「沿道路行走」状态', (a2.byState.WALK || 0) > 0, JSON.stringify(a2.byState));
ok('走路的人踩在路面高度上（不是陷在地砖里）', a2.onRoadY > 0, `onRoadY=${a2.onRoadY}`);
ok('走路的人贴着马路走，没有横穿空地', a2.strayWalkers === 0,
  `${a2.strayWalkers} 人离自己所在的路格超过 3 个世界单位（超过一格半）`);
ok('状态机覆盖到多个状态', Object.keys(a2.byState).length >= 2, Object.keys(a2.byState).join(','));

/* 把时钟**冻住**再拨，专测某个时刻的行为：
   一个游戏小时 = 12.5 真实秒，不冻住的话等居民走到目的地，时间早就翻天了。 */
await pg.evaluate(() => { window.__annoNpcConfig.daySeconds = 1e7; });
const atHour = (h) => pg.evaluate((hh) => { window.__annoNpcWorld.clock.hour = hh; }, h);

await atHour(9.5);
const a3 = await waitFor(pg, (r) => (r.byState.DWELL || 0) >= 3, 60000);
ok('上班时间有人停在目的地（去工作 / 去市场 / 去商店）',
  (a3.byState.DWELL || 0) >= 3, JSON.stringify(a3.byState));

await atHour(20.2);
const a4 = await waitFor(pg, (r) => (r.byState.CHAT || 0) >= 1, 90000);
ok('傍晚有人在路边聚着说话（状态机走到 CHAT）', (a4.byState.CHAT || 0) >= 1,
  `byState=${JSON.stringify(a4.byState)}`);

await atHour(23.5);
const a5 = await waitFor(pg, (r) => (r.byState.SLEEP || 0) > r.total * 0.5, 90000);
ok('深夜大部分人回家睡觉（SLEEP 占多数）',
  (a5.byState.SLEEP || 0) > a5.total * 0.5, JSON.stringify(a5.byState));
ok('夜里没人在上班或闲逛了', !(a5.byState.DWELL > 0) || a5.byState.DWELL <= 2,
  JSON.stringify(a5.byState));

/* LOD 与换装 */
await atHour(14);
await sleep(3000);
const lod = await pg.evaluate(() => {
  const w = window.__annoNpcWorld, cfg = window.__annoNpcConfig;
  const awake = w.npcs.filter((n) => n.state !== 'SLEEP');
  const near = awake.filter((n) => n.tier === 'detail');
  return {
    cfg: { detailMax: cfg.detailMax, lodNear: cfg.lodNear, lodMid: cfg.lodMid, lodFar: cfg.lodFar },
    tiers: [...new Set(awake.map((n) => n.tier))],
    nearCount: near.length,
    armsHidden: near.filter((n) => !n.body.armL.visible).length,
    legsHidden: near.filter((n) => !n.body.legL.visible).length,
    crowdInst: w.crowdBody.count, crowdStat: w.stats.crowd,
  };
});
ok('LOD 档位合法（detail / crowd / hidden）',
  lod.tiers.every((t) => ['detail', 'crowd', 'hidden'].includes(t)), JSON.stringify(lod.tiers));
ok('完整动画名额不超过 detailMax（人数多时靠人群层兜底）',
  lod.nearCount <= lod.cfg.detailMax, `${lod.nearCount} > ${lod.cfg.detailMax}`);
ok('中距离收起手臂 / 更远只留躯干（低模档生效）', lod.armsHidden > 0 || lod.legsHidden > 0,
  `收臂 ${lod.armsHidden} · 收腿 ${lod.legsHidden}`);
ok('人群层实例数与 crowd 档人数一致', lod.crowdInst === lod.crowdStat,
  `实例 ${lod.crowdInst} vs 统计 ${lod.crowdStat}`);

ok('换装轴抽出了多样组合（帽子/衣服/发型/配饰/肤色）',
  a1.variants >= Math.min(6, a1.total), `${a1.variants} 种组合 / ${a1.total} 人`);
ok('实际出现的原型种类 ≥ 4（街上不是清一色一种人）',
  Object.keys(a1.byArch).length >= 4, Object.keys(a1.byArch).join(','));

const roster = await pg.evaluate(async () => {
  const m = await import('./jsm/npc-roster.js');
  return {
    n: m.ARCHETYPES.length,
    male: m.ARCHETYPES.filter((a) => a.sex === 'M').length,
    female: m.ARCHETYPES.filter((a) => a.sex === 'F').length,
    kids: m.ARCHETYPES.filter((a) => a.sex === 'C').length,
    labels: m.ARCHETYPES.map((a) => a.label),
  };
});
ok('花名册 = 男 6 + 女 6 + 儿童 2 = 14 种原型',
  roster.n === 14 && roster.male === 6 && roster.female === 6 && roster.kids === 2,
  JSON.stringify(roster));
ok('原型名字对得上（含男孩/女孩）',
  roster.labels.includes('男村民') && roster.labels.includes('女商人')
  && roster.labels.includes('男孩') && roster.labels.includes('女孩'),
  roster.labels.join(' '));

/* 近景截图：把镜头拉到街区上方 */
await pg.evaluate(() => { window.__annoLookAt(9, 11, 26); });
await sleep(2500);
await pg.screenshot({ path: 'target/verify-npc-town.png' });
await pg.evaluate(() => { window.__annoLookAt(8, 10, 15); });
await sleep(2500);
await pg.screenshot({ path: 'target/verify-npc-closeup.png' });
await pg.close();

/* ---- B2：演示模式，压出"几百人"的人群层 ---- */
const pg2 = await newPage(B + '/game.html?npc=260');
await pg2.evaluate(() => {
  window.__annoNpcConfig.daySeconds = 1e7;      // 冻住时钟（同上）
  window.__annoNpcWorld.clock.hour = 9.5;
  window.__annoLookAt(9, 11, 34);
});
const demo = await waitFor(pg2, (r) => (r.byState.WALK || 0) > 20 && (r.detail || 0) > 0, 60000);
ok('演示模式（?npc=260）街上人数被强制到 260', demo.total === 260, `total=${demo.total}`);
ok('超出 detailMax 的人进了人群层（两个 draw call 撑起几百人）',
  demo.crowd > 0 && demo.detail <= 72, `detail=${demo.detail} crowd=${demo.crowd}`);
ok('人群档真的出现在 LOD 分档里', demo.tiers.includes('crowd'), JSON.stringify(demo.tiers));
ok('演示档里真的有人在走动', (demo.byState.WALK || 0) > 0, JSON.stringify(demo.byState));
await pg2.screenshot({ path: 'target/verify-npc-crowd.png' });
await pg2.close();

ok('全程零 JS 报错', errors.length === 0, errors.slice(0, 4).join(' | '));
ok('全程零意外 4xx/5xx', badHttp.length === 0, badHttp.slice(0, 4).join(' | '));

await browser.close();

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
console.log('截图：target/verify-npc-town.png · verify-npc-closeup.png · verify-npc-crowd.png');
writeFileSync('target/npc-check-result.txt', `${pass}/${pass + fail}\n${errors.join('\n')}\n${badHttp.join('\n')}`);
process.exit(fail ? 1 : 0);
