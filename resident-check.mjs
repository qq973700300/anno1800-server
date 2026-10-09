/**
 * 居民经济端到端验证：港口 -> 住宅 -> 居民 -> 需求 -> 税收
 *
 * 用法：先起服务，然后 node resident-check.mjs
 *      BASE=http://localhost:8080 node resident-check.mjs   # 换地址
 *
 * 和 smoke-test.mjs 的分工：
 *   smoke-test.mjs     —— 全链路冒烟（57 项），居民那部分只验"接线通不通"；
 *   resident-check.mjs —— 本文件，只盯居民这一个子系统，把**完整的经济曲线**验完：
 *                         港口只能建在海边、人口涨到住宅容量上限、满足度随供料涨落、
 *                         断供后居民搬走、拆房后容量与人口立刻归零、人口门槛解锁新建筑。
 *
 * 时长：所有等待都是"轮询到条件满足就提前退出"，所以**时间倍率越高越快**。
 *   --anno.time-scale=20  约 20 秒跑完
 *   默认倍率 1.0          约 4~5 分钟（人口 30 游戏秒一个结算周期：涨满 24 人要 4 个周期，
 *                         再把口粮吃到断供、居民开始搬走还要 5 个周期）
 */
const B = process.env.BASE || "http://localhost:8080";

const j = async (u, o) => {
  const r = await fetch(B + u, o);
  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};
const get = (u) => j(u);
const post = (u, b) => j(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
const del = (u) => j(u, { method: "DELETE" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = (r) => (r && r.d ? r.d.data : undefined);
const msg = (r) => (r && r.d && r.d.message) ? r.d.message : JSON.stringify(r && r.d);

/** 轮询直到 cond() 为真或超时；返回最后一次取到的值。
 *  预算给得比"最慢那档时间倍率算出来的时间"还宽，所以本脚本与时间倍率无关 ——
 *  快时钟几秒就过，慢时钟也就是多等一会儿，而不是误报失败。 */
async function pollUntil(fn, cond, budgetMs = 300000, intervalMs = 2000) {
  const t0 = Date.now();
  let v = await fn();
  while (!cond(v) && Date.now() - t0 < budgetMs) {
    await sleep(intervalMs);
    v = await fn();
  }
  return v;
}

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  \u2713", name); }
  else { fail++; console.log("  \u2717", name, extra ? "  << " + extra : ""); }
};

console.log("===== 居民经济：港口 -> 住宅 -> 居民 -> 需求 -> 税收 =====\n");

/* ---------- 0. 服务就绪 ---------- */
let up = false;
for (let i = 0; i < 30; i++) {
  try { if ((await get("/api/players")).s === 200) { up = true; break; } } catch { /* 还没起来 */ }
  await sleep(1000);
}
if (!up) { console.log("服务未就绪，退出"); process.exit(1); }

/* ---------- 1. 注册 + 建岛 + 修路 ---------- */
const reg = await post("/api/players/register", { name: "居民验证" + (Date.now() % 100000) });
const p = data(reg);
ok("注册玩家", !!(p && p.id), msg(reg));
const pid = p.id;

/* 用平岛：岛形是随机生成的（同一个 id 固定一座岛，但不同 id 岸线不同），
   本文件把马路 / 港口 / 住宅的坐标全写死了，随机岛上会在某些 id 上落到海里。
   平岛 = 一整片平原；它的**最外一圈**（x=0 / z=0 / x=35 / z=35）自动算作海岸带，
   所以"贴边是沙滩、往里一格是内陆"这条港口规则照样能验。 */
const islR = await post("/api/islands", { playerId: pid, name: "居民测试岛", flat: true });
const isl = data(islR);
ok("创建平岛", !!(isl && isl.id), msg(islR));
ok("岛屿视图下发海岸带宽度（客户端照它画沙滩）", isl.coastWidth === 1,
  `gridSize=${isl.gridSize} coastWidth=${isl.coastWidth} terrain=${[...new Set(isl.terrain)].join("")}`);

for (let x = 2; x <= 14; x++) {
  await post("/api/roads", { playerId: pid, islandId: isl.id, x, z: 10 });
}
const roads = data(await get(`/api/roads?islandId=${isl.id}`));
ok("修好一条 13 格马路", Array.isArray(roads) && roads.length === 13, `实际 ${roads && roads.length} 格`);

/* ---------- 2. 图鉴：新建筑已下发 ---------- */
const cat = data(await get("/api/buildings/catalog"));
const has = (t) => cat.find((c) => c.type === t);
ok("图鉴含贸易站 / 农夫小屋 / 工人住宅",
  !!(has("TRADING_POST") && has("FARMER_HOUSE") && has("WORKER_HOUSE")));
ok("图鉴下发 kind 与住宅容量",
  has("FARMER_HOUSE").kind === "RESIDENCE" && has("FARMER_HOUSE").residentCapacity === 24
  && has("TRADING_POST").kind === "HARBOR",
  JSON.stringify(has("FARMER_HOUSE")));
ok("工人住宅带人口门槛 120",
  has("WORKER_HOUSE").requiredFarmerPopulation === 120,
  String(has("WORKER_HOUSE").requiredFarmerPopulation));

/* ---------- 3. 没有贸易站时不能盖住宅 ---------- */
const noPost = await post("/api/buildings", { playerId: pid, islandId: isl.id, type: "FARMER_HOUSE", x: 3, z: 8 });
ok("没有港口时建住宅被拒（先有港口）",
  noPost.s === 400 && /贸易站/.test(msg(noPost)), `HTTP ${noPost.s} ${msg(noPost)}`);

/* ---------- 3.5 港口必须建在海边：内陆 (6,11) 外圈压着那条马路，物流够，
     但它是港口，得落在"离水不超过 coast-width 格"的沙滩上 —— 这是贸易站和厂房唯一的区别 ---------- */
const inlandTp = await post("/api/buildings", { playerId: pid, islandId: isl.id, type: "TRADING_POST", x: 6, z: 11 });
ok("内陆建贸易站被拒（港口得建在海边，有马路也不行）",
  inlandTp.s === 400 && /海边/.test(msg(inlandTp)), `HTTP ${inlandTp.s} ${msg(inlandTp)}`);

/* ---------- 4. 建贸易站：落在西岸沙滩上（平岛最外一圈 x=0 就是海岸带，北边 z=10 是那条马路） ---------- */
const tpR = await post("/api/buildings", { playerId: pid, islandId: isl.id, type: "TRADING_POST", x: 0, z: 11 });
const tp = data(tpR);
ok("海岸带上建贸易站成功", tpR.s === 200 && !!tp.id, msg(tpR));
ok("贸易站 kind=HARBOR、无配方、进度为 0",
  tp.kind === "HARBOR" && tp.progress === 0, JSON.stringify(tp));
ok("港口大门自动朝海（270°=西；出网格那侧才是海，马路只是物流接口）",
  tp.rotation === 270, `rotation=${tp.rotation}`);

/* ---------- 5. 先备货，再盖房子 ----------
   备货量是算过的：涨满 24 人（4 个周期）大约吃掉 7 土豆 + 2 烈酒，
   之后还要留够"再吃 4~5 个周期才见底"的量 —— 备太多的话，断供那一段要等很久才发生。 */
await post("/api/market/buy", { playerId: pid, good: "POTATO", quantity: 30 });
await post("/api/market/buy", { playerId: pid, good: "SCHNAPPS", quantity: 10 });
// 建房要材料（纪元1800式）：工人住宅要 9 木板，开局只带 4 —— 找市场补
await post("/api/market/buy", { playerId: pid, good: "TIMBER", quantity: 10 });
const q = (list, g) => { const it = (list || []).find((s) => s.good === g); return it ? it.quantity : 0; };
const st0 = data(await get(`/api/market/stock/${pid}`));
const potato0 = q(st0, "POTATO"), schnapps0 = q(st0, "SCHNAPPS");
ok("已备好口粮（土豆 30 / 烈酒 10）", potato0 === 30 && schnapps0 === 10, `土豆=${potato0} 烈酒=${schnapps0}`);

const houseR = await post("/api/buildings", { playerId: pid, islandId: isl.id, type: "FARMER_HOUSE", x: 3, z: 8 });
const house = data(houseR);
ok("有港口后建农夫小屋成功", houseR.s === 200 && !!house.id, msg(houseR));

/* ---------- 6. 人口面板初始状态 ---------- */
const pop0 = data(await get(`/api/islands/${isl.id}/population`));
ok("人口接口可用", !!(pop0 && Array.isArray(pop0.tiers)), JSON.stringify(pop0));
ok("hasTradingPost=true", pop0.hasTradingPost === true);
const f0 = (pop0.tiers || []).find((t) => t.tier === "FARMER");
ok("农夫容量 = 24（来自住宅）", f0 && f0.capacity === 24, JSON.stringify(f0));
ok("农夫小屋落成自动迁入 8 名初始移民（不再从 0 开始）",
  f0 && f0.population === 8, String(f0 && f0.population));
ok("需求明细含土豆 + 烈酒", f0 && f0.needs.length === 2
  && f0.needs.some((n) => n.good === "POTATO") && f0.needs.some((n) => n.good === "SCHNAPPS"),
  JSON.stringify(f0 && f0.needs));
const w0 = (pop0.tiers || []).find((t) => t.tier === "WORKER");
ok("工人阶层未解锁（农夫不够 120）", w0 && w0.unlocked === false, JSON.stringify(w0));

/* ---------- 7. 居民入住（需求被满足 -> 人口增长） ---------- */
console.log("  … 等居民搬进来（轮询，时间倍率越高越快）");
const readFarmer = async () => ((data(await get(`/api/islands/${isl.id}/population`))).tiers || [])
  .find((t) => t.tier === "FARMER");
let farmer = await pollUntil(readFarmer, (f) => f && f.population >= 24);
ok("居民陆续搬进来（人口增长）", farmer.population > 0, `当前人口=${farmer.population}`);
ok("人口涨到住宅容量上限 24", farmer.population === 24, `当前=${farmer.population}`);
ok("需求被满足 -> 满足度良好", farmer.satisfaction >= 0.9, `满足度=${farmer.satisfaction}`);

/* ---------- 8. 消费与税收：这条链真正产出了钱 ---------- */
const st1 = data(await get(`/api/market/stock/${pid}`));
const potato1 = q(st1, "POTATO"), schnapps1 = q(st1, "SCHNAPPS");
ok("土豆被居民吃掉（库存下降）", potato1 < potato0, `${potato0} -> ${potato1}`);
ok("烈酒被居民喝掉（库存下降）", schnapps1 < schnapps0, `${schnapps0} -> ${schnapps1}`);

// 税收一个结算周期才入账一次，所以不能"睡 5 秒就断言"，得轮询到金库真的涨了
const money0 = data(await get(`/api/players/${pid}`)).treasury;
const readMoney = async () => data(await get(`/api/players/${pid}`)).treasury;
const money1 = await pollUntil(readMoney, (m) => m > money0, 90000, 2000);
ok("税收入账（金库在不生产、不交易的情况下自己涨）", money1 > money0, `¥${money0} -> ¥${money1}`);
ok("人口面板给出每分钟税收", farmer.taxPerMinute > 0, `¥${farmer.taxPerMinute}/分钟`);

/* ---------- 9. 人口门槛：农夫不够就盖不了工人住宅 ---------- */
const whR = await post("/api/buildings", { playerId: pid, islandId: isl.id, type: "WORKER_HOUSE", x: 10, z: 11 });
ok("农夫不足 120 时建工人住宅被拒（人口门槛解锁）",
  whR.s === 400 && /农夫/.test(msg(whR)), `HTTP ${whR.s} ${msg(whR)}`);

/* ---------- 10. 断供 -> 满足度下降 -> 居民搬走 ---------- */
console.log("  … 等口粮耗尽，居民搬走（轮询）");
let starved = await pollUntil(readFarmer, (f) => f && f.population < 24);
starved = await readFarmer();          // 再多取一次，确保满足度已刷新
ok("口粮耗尽后满足度掉下来", starved.satisfaction < 1, `满足度=${starved.satisfaction}`);
ok("断供后居民开始搬走（人口下降）", starved.population < 24, `人口=${starved.population}`);

/* ---------- 11. 港口是前提：还有住宅就不许拆 ---------- */
const delTp = await del(`/api/buildings/${tp.id}?playerId=${pid}`);
ok("岛上有住宅时拆贸易站被拒",
  delTp.s === 400 && /贸易站/.test(msg(delTp)), `HTTP ${delTp.s} ${msg(delTp)}`);

/* ---------- 12. 拆掉住宅 -> 人口立刻收敛 ---------- */
const delHouse = await del(`/api/buildings/${house.id}?playerId=${pid}`);
ok("拆住宅成功", delHouse.s === 200, msg(delHouse));
const popAfter = data(await get(`/api/islands/${isl.id}/population`));
const fAfter = (popAfter.tiers || []).find((t) => t.tier === "FARMER");
ok("拆房后容量归零、人口立刻清零",
  fAfter.capacity === 0 && fAfter.population === 0, JSON.stringify(fAfter));

/* ---------- 13. 非生产建筑不参与生产心跳 ---------- */
const blds = data(await get(`/api/islands/${isl.id}/buildings`));
const tpB = blds.find((b) => b.type === "TRADING_POST");
ok("贸易站进度恒为 0（不进生产心跳）", tpB.progress === 0, JSON.stringify(tpB));
ok("建筑列表带 kind 字段", blds.every((b) => !!b.kind));

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
