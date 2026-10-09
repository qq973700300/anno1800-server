/**
 * 建造材料成本验证（纪元1800式：建房不只要钱，还要木头）
 * 用法：node tools/build-cost-check.mjs   （需服务已启动，纯 HTTP 数据断言，无截图）
 *
 * 覆盖：
 *  1. 开局赠料（旗舰带料）：新玩家 WOOD=20 / TIMBER=4
 *  2. 建筑图鉴下发 goodsCost（FARMER_HOUSE 木材×5 / WORKER_HOUSE 木板×9 / 豁免建筑为空）
 *  3. 豁免建筑（贸易站）不扣材料
 *  4. 建房扣材料 + 扣钱（FARMER_HOUSE 一座 -5 木 -240 金）
 *  5. 木头不够 → 400 "库存不足：木材…"，且钱不被扣（事务整体回滚）
 *  6. 拆除只退钱不退材料
 *  7. 工人档建筑扣木板（MILL -5 木板）
 */
const BASE = process.env.BASE || "http://localhost:8080";
const NAME = "建材验证" + (Date.now() % 100000);

let step = 0, fails = 0;
const check = (name, cond, extra = "") => {
  step++;
  console.log(`${cond ? "✅" : "❌"} ${step}. ${name}${extra ? "  → " + extra : ""}`);
  if (!cond) fails++;
};

async function api(path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method, headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${path} -> ${json.code}: ${json.message}`);
  return json.data;
}
const qtyOf = (stock, good) => (stock.find((s) => s.good === good) || { quantity: 0 }).quantity;
const treasuryOf = async (pid) => (await api(`/api/players/${pid}`)).treasury;

async function main() {
  console.log("=== 建造材料成本验证 ===\n");

  /* 1. 注册：开局赠料 */
  const p = await api("/api/players/register", "POST", { name: NAME });
  let stock = await api(`/api/market/stock/${p.id}`);
  check("开局赠料（纪元1800式旗舰带料）：木材 20 / 木板 4",
    qtyOf(stock, "WOOD") === 20 && qtyOf(stock, "TIMBER") === 4,
    `WOOD=${qtyOf(stock, "WOOD")} TIMBER=${qtyOf(stock, "TIMBER")}`);

  /* 2. 图鉴下发材料成本（与服务端 getBuildGoods 同源） */
  const cat = await api("/api/buildings/catalog");
  const gcOf = (t) => (cat.find((c) => c.type === t) || {}).goodsCost || [];
  const fh = gcOf("FARMER_HOUSE"), wh = gcOf("WORKER_HOUSE"),
        tp = gcOf("TRADING_POST"), lj = gcOf("LUMBERJACK");
  check("图鉴：农夫住宅 = 木材×5（240/50 公式派生）",
    fh.length === 1 && fh[0].good === "WOOD" && fh[0].label === "木材" && fh[0].qty === 5,
    JSON.stringify(fh));
  check("图鉴：工人住宅 = 木板×9（520/60，工人档换木板）",
    wh.length === 1 && wh[0].good === "TIMBER" && wh[0].qty === 9, JSON.stringify(wh));
  check("图鉴：贸易站 / 伐木场豁免（自举链只扣钱）", tp.length === 0 && lj.length === 0,
    `TP=${JSON.stringify(tp)} LJ=${JSON.stringify(lj)}`);

  /* 3. 平岛 + 贸易站（豁免：不扣木头） */
  const isl = await api("/api/islands", "POST", { playerId: p.id, name: "建材岛", flat: true });
  const money0 = await treasuryOf(p.id);
  await api("/api/buildings", "POST", { playerId: p.id, islandId: isl.id, type: "TRADING_POST", x: 0, z: 11 });
  stock = await api(`/api/market/stock/${p.id}`);
  check("贸易站落成不扣材料（豁免）", qtyOf(stock, "WOOD") === 20 && qtyOf(stock, "TIMBER") === 4,
    `WOOD=${qtyOf(stock, "WOOD")}`);
  const tpDelta = money0 - (await treasuryOf(p.id));
  check("贸易站照常扣钱 600", Math.abs(tpDelta - 600) < 0.01, `Δ=${tpDelta}`);

  /* 4. 铺一条路 + 连盖 4 座农夫住宅：20 木正好花完 */
  for (let x = 4; x <= 14; x++) {
    await api("/api/roads", "POST", { playerId: p.id, islandId: isl.id, x, z: 8 });
  }
  const houseSpots = [[5, 9], [8, 9], [11, 9], [14, 9]];
  for (const [x, z] of houseSpots) {
    const before = await treasuryOf(p.id);
    await api("/api/buildings", "POST",
      { playerId: p.id, islandId: isl.id, type: "FARMER_HOUSE", x, z });
    const delta = before - (await treasuryOf(p.id));
    stock = await api(`/api/market/stock/${p.id}`);
    check(`农夫住宅 (${x},${z}) 落成：-5 木 -240 金`,
      Math.abs(delta - 240) < 0.01, `WOOD=${qtyOf(stock, "WOOD")} Δ¥=${delta}`);
  }
  stock = await api(`/api/market/stock/${p.id}`);
  check("4 座房正好把 20 木花光", qtyOf(stock, "WOOD") === 0, `WOOD=${qtyOf(stock, "WOOD")}`);

  /* 5. 拆除：只退钱、不退材料（拆掉 (14,9) 那座，腾出的格子给下一步当试金石） */
  const blds = await api(`/api/islands/${isl.id}/buildings`);
  const house4 = blds.find((b) => b.type === "FARMER_HOUSE" && b.gridX === 14 && b.gridZ === 9);
  const moneyDel = await treasuryOf(p.id);
  const del = await api(`/api/buildings/${house4.id}?playerId=${p.id}`, "DELETE");
  stock = await api(`/api/market/stock/${p.id}`);
  const delDelta = (await treasuryOf(p.id)) - moneyDel;
  check("拆除返还一半造价（钱）", del.refund > 0 && Math.abs(delDelta - del.refund) < 0.01,
    `refund=${del.refund} Δ¥=${delDelta}`);
  check("拆除不退材料（木头仍是 0）", qtyOf(stock, "WOOD") === 0);

  /* 6. 第 5 座：木头不够 → 400，钱也不许扣（整体回滚）。
     放 (14,9)：刚拆空的格子，"放得下"才轮得到材料校验拦 —— 校验顺序先占位后扣钱料。 */
  const money5 = await treasuryOf(p.id);
  let err5 = "";
  try {
    await api("/api/buildings", "POST",
      { playerId: p.id, islandId: isl.id, type: "FARMER_HOUSE", x: 14, z: 9 });
  } catch (e) { err5 = e.message; }
  check("材料不足被拒：报错文案点明木材与缺口",
    err5.includes("库存不足") && err5.includes("木材"), `"${err5}"`);
  check("被拒的建造一分钱不扣（事务回滚）",
    Math.abs(money5 - (await treasuryOf(p.id))) < 0.01);

  /* 7. 工人档建筑扣木板：买 10 木板 → 盖磨坊（2×3，占 (13..14, 9..11)，与拆空的格子错位不重叠） */
  await api("/api/market/buy", "POST", { playerId: p.id, good: "TIMBER", quantity: 10 });
  const beforeMill = await treasuryOf(p.id);
  await api("/api/buildings", "POST", { playerId: p.id, islandId: isl.id, type: "MILL", x: 13, z: 9 });
  stock = await api(`/api/market/stock/${p.id}`);
  const millDelta = beforeMill - (await treasuryOf(p.id));
  check("磨坊（工人档）落成：-5 木板 -280 金",
    qtyOf(stock, "TIMBER") === 9 && Math.abs(millDelta - 280) < 0.01,
    `TIMBER=${qtyOf(stock, "TIMBER")}（开局 4 + 买 10 - 磨坊 5）Δ¥=${millDelta}`);

  console.log(`\n=== ${step} 项，失败 ${fails} 项 ===`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error("💥 " + e.message); process.exit(1); });
