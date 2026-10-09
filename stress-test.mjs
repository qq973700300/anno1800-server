/**
 * 并发压测：一边让世界心跳（每秒）跑生产/行情，一边让多个玩家疯狂买卖，
 * 验证不会再出现 @Version 乐观锁冲突（StaleObjectStateException）。
 *
 * 用法：先启动服务，再 node stress-test.mjs
 *      LOG=target/it-server.log node stress-test.mjs     # 指定服务端日志，脚本自己 grep 报错
 *      BASE=http://localhost:8080 node stress-test.mjs
 *
 * 【2026-09-23 修】此前这个脚本**其实什么都没压到**：
 *   ① 岛是随机生成的，但坐标是写死的 (6,8)/(6,7)，随机岛上大概率是海；
 *   ② 就算在平岛上，LUMBERJACK 2×2 放 (6,7) 会占 (6,7)(7,7)(6,8)(7,8) —— **正好压住 (6,8) 那条马路**，
 *      于是返回 "占地压到了马路，工厂不能盖在路上"；CLAY_PIT 同理，而且平岛压根没有黏土矿脉。
 *   结果：两台"造库存的机器"一个都没落地，压测只压了市场买卖这一条路，
 *   而并发一致性最容易出事的**心跳写库存 vs 玩家交易**那一面完全没被覆盖。
 *   现在改成：平岛 + 四格马路 + 两台**真的挨着路**的伐木场，并且**断言它们建起来了**。
 */
const BASE = process.env.BASE || "http://localhost:8080";
const { readFileSync, statSync, existsSync } = await import("node:fs");

async function api(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = (r) => (r && r.json ? r.json.data : undefined);

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) console.log(`  ✓ ${name}${extra ? "  → " + extra : ""}`);
  else { fail++; console.log(`  ✗ ${name}${extra ? "  << " + extra : ""}`); }
};

/** 轮询直到 cond 为真或超时 */
async function pollUntil(fn, cond, budgetMs = 60000, intervalMs = 1500) {
  const t0 = Date.now();
  let v = await fn();
  while (!cond(v) && Date.now() - t0 < budgetMs) { await sleep(intervalMs); v = await fn(); }
  return v;
}

/** 找服务端日志：LOG 环境变量 > target/it-server.log > server.log。找不到就跳过日志检查。 */
function pickLog() {
  const cands = [process.env.LOG, "target/it-server.log", "server.log"].filter(Boolean);
  for (const p of cands) if (existsSync(p)) return p;
  return null;
}

console.log("=== 并发压测：心跳 vs 玩家交易 ===");

/* 日志取样点必须在**建岛之前**：
   压测岛没有住宅 → 不产生"【人口】"那种每 30 秒一条的日志，
   而 960 次请求只要几秒，很可能一条新日志都没写出来。
   从脚本开头就记偏移，至少能圈进"岛屿 #N 地形：…"这类建岛日志。 */
const LOG = pickLog();
const logFrom = LOG ? statSync(LOG).size : 0;

/* ---------- 1. 建 4 个玩家，每人一座平岛 + 一条马路 + 港口/住宅 + 两台伐木场 ----------
   平岛：坐标确定。马路铺在 z=8 一整排（x=5..10），
   两台 2×2 伐木场摆在 **z=6 的北侧**，底边 z=7 紧挨 z=8 的马路 ——
   不压路（压路会被 ④ 挡掉），只贴着路（满足 ⑥ 临路）。
   【港口 + 农夫小屋】产出要马车运到港口才入库、厂房要工人才能开工：
   港口建在西岸沙滩 (0,11)，农夫小屋 (5,9) 落成即迁入 8 名初始移民 ——
   两台伐木场共需 4 名工人，招得到、产得出、运得走，这才是"库存写入源"。 */
const ROAD_ROW = [5, 6, 7, 8, 9, 10];
const MILLS = [[5, 6], [8, 6]];

const players = [];
for (let i = 1; i <= 4; i++) {
  const name = "压测商人" + Date.now() + "_" + i;
  const p = await api("/api/players/register", "POST", { name });
  if (p.status !== 200) { console.log("注册失败", p.json); process.exit(1); }
  const pid = data(p).id;

  const isl = await api("/api/islands", "POST", { playerId: pid, name: "压力岛" + i, flat: true });
  const islandId = data(isl).id;

  let roadsOk = 0;
  for (const x of ROAD_ROW) {
    if ((await api("/api/roads", "POST", { playerId: pid, islandId, x, z: 8 })).status === 200) roadsOk++;
  }

  const portOk = (await api("/api/buildings", "POST",
    { playerId: pid, islandId, type: "TRADING_POST", x: 0, z: 11 })).status === 200;
  const houseOk = (await api("/api/buildings", "POST",
    { playerId: pid, islandId, type: "FARMER_HOUSE", x: 5, z: 9 })).status === 200;

  /* 【必须挂 WS】岛屿模拟是懒结算，只推**在线**玩家的岛：不连线心跳根本不会推进，
     伐木场一格进度都不走。开一条长连接并 auth，让服务端认定这名玩家在线。 */
  const ws = new WebSocket(BASE.replace(/^http/, "ws") + "/ws");
  const wsOk = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: "auth", playerId: pid }));
    ws.onmessage = (e) => { if (JSON.parse(e.data).type === "authed") { clearTimeout(t); resolve(true); } };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });

  let millsOk = 0;
  const millMsgs = [];
  for (const [x, z] of MILLS) {
    const b = await api("/api/buildings", "POST", { playerId: pid, islandId, type: "LUMBERJACK", x, z });
    if (b.status === 200) millsOk++;
    else millMsgs.push(`(${x},${z}) → ${b.json && b.json.message}`);
  }

  players.push({ pid, islandId, name, roadsOk, millsOk, millMsgs, ws });
  console.log(`  玩家 ${pid} 岛 ${islandId}：马路 ${roadsOk}/${ROAD_ROW.length} 格，`
    + `港口${portOk ? "✓" : "✗"} 住宅${houseOk ? "✓" : "✗"} WS${wsOk ? "✓" : "✗"}，伐木场 ${millsOk}/${MILLS.length} 台`
    + (millMsgs.length ? `  ${millMsgs.join("；")}` : ""));
}

ok("4 座平岛的马路全部铺好", players.every((p) => p.roadsOk === ROAD_ROW.length));
ok("每座岛都真的立起了 2 台伐木场（这才是库存写入源）",
  players.every((p) => p.millsOk === MILLS.length),
  players.flatMap((p) => p.millMsgs).join("；") || "全部 200");

/* ---------- 2. 等心跳把木材**真的**写进仓库 ----------
   光"建成了"不算数：必须确认产出确实在发生，否则下面的并发只是空转。
   用轮询而不是固定 sleep —— 建不起来时会**明确失败**而不是悄悄跑完。 */
const stockOf = async (pid, g) => {
  const list = data(await api(`/api/market/stock/${pid}`));
  const it = (list || []).find((s) => s.good === g);
  return it ? it.quantity : 0;
};
const wood0 = players.map((p) => p.pid);
console.log("\n  等心跳把木材写进仓库（轮询，证明生产真的在跑）…");
const produced = await pollUntil(
  async () => Promise.all(wood0.map((pid) => stockOf(pid, "WOOD"))),
  (v) => v.every((q) => q > 0), 60000, 2000);
ok("每位玩家的仓库里都出现了木材（心跳真的在写库存）",
  produced.every((q) => q > 0), `木材 ${produced.join(" / ")}`);

/* ---------- 3. 40 轮 × 每轮 24 个并发请求（买 / 卖 / 查行情 / 查仓库 混合） ---------- */
let okN = 0, biz = 0, conflict = 0, err = 0;
const ROUNDS = 40, PAR = 24;
for (let r = 0; r < ROUNDS; r++) {
  const tasks = [];
  for (let k = 0; k < PAR; k++) {
    const p = players[(r + k) % players.length];
    const goods = ["WOOD", "CLAY", "POTATO"];
    const g = goods[(r + k) % goods.length];
    const mode = (r + k) % 4;
    if (mode === 0) tasks.push(api("/api/market/buy", "POST", { playerId: p.pid, good: g, quantity: 1 }));
    else if (mode === 1) tasks.push(api("/api/market/sell", "POST", { playerId: p.pid, good: g, quantity: 1 }));
    else if (mode === 2) tasks.push(api(`/api/market/stock/${p.pid}`));
    else tasks.push(api("/api/market"));
  }
  const results = await Promise.all(tasks);
  for (const res of results) {
    if (res.status === 200) okN++;
    else if (res.status === 409) conflict++;
    else if (res.status === 400) biz++;
    else err++;
  }
}
const total = ROUNDS * PAR;
console.log(`\n  请求统计：共 ${total} 次 → 成功 ${okN} / 业务拒绝(余额或库存不足) ${biz} / 并发冲突 409 ${conflict} / 其它错误 ${err}`);

ok("压测期间没有 5xx / 连接类错误", err === 0, `其它错误 ${err}`);
ok("没有乐观锁冲突（409）", conflict === 0, `并发冲突 ${conflict}`);

/* ---------- 4. 自己去看服务端日志（比让用户手工 grep 靠谱） ---------- */
if (!LOG) {
  console.log("\n  （没找到服务端日志文件，跳过日志检查；可以用 LOG=<路径> 指定）");
} else {
  // 注意：statSync().size 是**字节**，而 readFileSync(p,'utf8') 给的是**字符串**，
  // 字符串下标按**字符**算。日志里全是中文（UTF-8 下一个字 3 字节），
  // 用字节偏移去 slice 字符串会切在末尾之外 → 永远得到空串、检查静默失效。
  // 所以先按字节读成 Buffer、按字节切，再转字符串。
  const tail = readFileSync(LOG).subarray(logFrom).toString("utf8");
  const bad = [
    ["StaleObjectStateException", /StaleObjectStateException/],
    ["推进失败", /推进失败/],
    ["连续 3 次并发冲突", /连续 3 次并发冲突/],
  ].map(([label, re]) => [label, (tail.match(new RegExp(re, "g")) || []).length]);
  console.log(`\n  服务端日志（${LOG}，只看本轮新增的 ${tail.length} 字符）：`);
  for (const [label, n] of bad) console.log(`    ${label} × ${n}`);
  if (tail.length === 0) {
    // 空字符串里当然什么都搜不到 —— 把它当"通过"是假绿，必须显式降级
    console.log("  ! 本轮没有新日志产生，无法判定（不是失败）：服务端可能没在写该文件，");
    console.log("    或者压测这几秒恰好没跨过任何一次日志输出。可用 LOG=<路径> 指定正在写入的日志。");
  } else {
    ok("本轮服务端日志里零并发冲突 / 零推进失败", bad.every(([, n]) => n === 0),
      bad.filter(([, n]) => n > 0).map(([l, n]) => `${l}×${n}`).join("，") || "全 0");
  }
}

for (const p of players) { try { p.ws && p.ws.close(); } catch { /* 无所谓 */ } }
console.log(`\n===== 结果：${fail === 0 ? "全部通过" : fail + " 项失败"} =====`);
process.exit(fail ? 1 : 0);
