/**
 * 全链路冒烟测试（Node 18+，用内置 fetch / WebSocket）
 * 用法：node smoke-test.mjs
 * 覆盖：注册 -> 建岛 -> 空地自由播种 -> 生长成熟 -> 收获 -> 修路 -> 路网连通 -> 多格占地建筑
 *      -> 大门朝向吸附道路 / 建筑 90° 旋转（横摆竖摆）-> 拆除 -> 市场买卖 -> 玩家挂单成交
 *      -> 港口必须建在海岸带（内陆有路也不行）/ 港口大门自动朝海
 *      -> 居民经济（港口 -> 住宅 -> 居民 -> 需求 -> 税收）-> WebSocket 联机
 *
 * 【为什么测试岛一律用 flat: true】
 * 岛不再是方形了：每座岛由 id 生成一份地形（海面 / 平原 / 山地 / 矿脉），
 * 同一座岛每次长一个样，但**不同岛的岸线和山是随机的** —— 脚本没法写死 "(6,8) 修条路"。
 * 所以造场景用平岛（一整片平原，没有水/山/矿），坐标才确定、断言才稳。
 * 随机地形的正确性由本文件最后一节单独验（那里就是要它"看起来不像方块"）。
 *
 * 提示：居民那一节要等"人口结算周期"（默认 30 游戏秒）才出结果，服务用默认时间倍率跑时
 *      大约要等一分钟；用 `--anno.time-scale=20` 起服务则几秒就过。
 */
const BASE = process.env.BASE || "http://localhost:8080";
const WS = BASE.replace(/^http/, "ws") + "/ws";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let step = 0;
const ok = [];
const bad = [];

async function api(path, method = "GET", body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body) opt.body = JSON.stringify(body);
  const res = await fetch(BASE + path, opt);
  const json = await res.json();
  if (!json.ok) throw new Error(`${path} -> ${json.code}: ${json.message}`);
  return json.data;
}

function check(name, cond, detail) {
  step++;
  (cond ? ok : bad).push(`${step}. ${name}${detail ? " | " + detail : ""}`);
  console.log(`${cond ? "✅" : "❌"} ${step}. ${name}${detail ? "  → " + detail : ""}`);
}

async function main() {
  console.log("=== 纪元1800 后端冒烟测试 ===\n");

  /* 1. 注册两名玩家 */
  const tag = Date.now().toString().slice(-6);   // MySQL 是持久库，用唯一后缀避免重名
  const A = await api("/api/players/register", "POST", { name: "南海贸易公司" + tag });
  const B = await api("/api/players/register", "POST", { name: "北境商会" + tag });
  check("注册玩家 A / B", !!A.id && !!B.id, `A#${A.id} ¥${A.treasury} / B#${B.id} ¥${B.treasury}`);

  /* 2. 建岛：平岛（一整片平原），且不预生成农田，玩家自己在空地上播种 */
  const island = await api("/api/islands", "POST", { playerId: A.id, name: "主岛", flat: true });
  const plots0 = await api(`/api/islands/${island.id}/plots`);
  check("开辟空白平岛（无预生成农田）", plots0.length === 0 && island.gridSize >= 48,
    `岛#${island.id} 肥力${island.fertility}，${island.gridSize}x${island.gridSize} 格，农田上限 ${island.plotLimit} 株`);

  /* 2.5 建房要材料（纪元1800式）：开局赠料只带少量木材，两座纺织厂要的 20 木板直接找市场买。
     只买 TIMBER 不买 WOOD —— 后面"马车运木入库"的断言靠 WOOD 差值保持诚实（买了木头就变假绿）。 */
  await api("/api/market/buy", "POST", { playerId: A.id, good: "TIMBER", quantity: 20 });
  check("平岛地形串下发：全长 = 边长²，且全是一整片平原（没有水 / 山 / 矿）",
    typeof island.terrain === "string" && island.terrain.length === island.gridSize * island.gridSize
      && !/[~^ic]/.test(island.terrain),
    `${island.terrain.length} 格，字符集 {${[...new Set(island.terrain)].join("")}}（. 平原 / ~ 水 / ^ 山 / i 铁 / c 黏土）`);

  const corner = await api("/api/roads", "POST",
    { playerId: A.id, islandId: island.id, x: 1, z: 1 });
  check("平岛：角落格子也是陆地（可修路）", !!corner.id, "(1, 1) 修路成功");

  /* 3. 建马铃薯农场，再从农场"拉田"（纪元1800式：田是农场的，不能凭空种）。
        农场 3×3 落 (1,4)——占 (1..3,4..6)，先铺 (1,7) 一格马路给它临路；
        老剧本的三块田 (3,3)(4,3)(5,3) 都在农场周围 3 格内，坐标不用动。 */
  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 1, z: 7 });
  const farm1 = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "POTATO_FARM", x: 1, z: 4 });
  const seeds = [[3, 3], [4, 3], [5, 3]];
  for (const [x, z] of seeds) {
    await api("/api/farm/plant", "POST",
      { playerId: A.id, islandId: island.id, x, z, crop: "POTATO", buildingId: farm1.id });
  }
  let afterPlant = await api(`/api/islands/${island.id}/plots`);
  check("建起马铃薯农场并从它拉出 3 株土豆", afterPlant.filter((p) => p.state === "GROWING").length === 3,
    `农场占 (1..3,4..6)，位置 ${afterPlant.map((p) => `(${p.cellX},${p.cellZ})`).join(" ")}，预计产量 ${afterPlant[0].plannedYield}`);

  /* 4. 同一格不能种两株（带 buildingId 且作物一致 —— 让拦截真的发生在"重复播种"这一环，
        而不是被上游"作物跟农场不匹配"抢先挡掉，那样就是假通过） */
  let dupFailed = false;
  try {
    await api("/api/farm/plant", "POST",
      { playerId: A.id, islandId: island.id, x: 3, z: 3, crop: "POTATO", buildingId: farm1.id });
  } catch { dupFailed = true; }
  check("同一格不能重复播种", dupFailed);

  /* 5. 未成熟时收获应失败 */
  let earlyHarvestFailed = false;
  try {
    await api("/api/farm/harvest", "POST", { playerId: A.id, plotId: afterPlant[0].id });
  } catch {
    earlyHarvestFailed = true;
  }
  check("未成熟不可收获（业务校验）", earlyHarvestFailed);

  /* 6. 修路 + 多格占地建筑（像纪元1800：伐木场 2x2、锯木厂 3x3、炼钢厂 4x4） */
  let buildWithoutRoadFailed = false;
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island.id, type: "LUMBERJACK", x: 5, z: 10 });
  } catch { buildWithoutRoadFailed = true; }
  check("外圈不挨马路不能盖工厂（布局规则）", buildWithoutRoadFailed);

  const road = await api("/api/roads", "POST",
    { playerId: A.id, islandId: island.id, x: 6, z: 8 });
  check("修马路", !!road.id, `格子 (${road.cellX}, ${road.cellZ})`);
  check("岛屿网格参数下发（岛够大，不是小沙盘）", island.gridSize >= 48 && typeof island.roadCost === "number",
    `${island.gridSize}x${island.gridSize} 平岛，修路 ¥${island.roadCost}/格`);

  let onCropFailed = false;
  try {
    await api("/api/roads", "POST",
      { playerId: A.id, islandId: island.id, x: 4, z: 3 });
  } catch { onCropFailed = true; }
  check("作物上不能修马路", onCropFailed);

  /* 「占地压到马路」用普通厂房验：采掘类（黏土矿坑 / 铁矿）会先被"必须压在矿脉上"挡掉，
     那样虽然也报错，但验的是另一条规则 —— 断言报错文案里得真的提到马路才算数。 */
  let roadOnFootprintErr = "";
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island.id, type: "LUMBERJACK", x: 6, z: 8 });
  } catch (e) { roadOnFootprintErr = e.message; }
  check("占地压到马路不能盖工厂", roadOnFootprintErr.includes("马路"),
    `2×2 锚点 (6,8) 就是马路 → "${roadOnFootprintErr}"`);

  /* 采掘类的矿脉规则：平岛上一格矿都没有，所以铁矿厂怎么放都得被拒 —— 且理由必须是"矿脉" */
  let noVeinErr = "";
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island.id, type: "IRON_MINE", x: 20, z: 20 });
  } catch (e) { noVeinErr = e.message; }
  check("采掘类必须压在矿脉上（平岛无矿 → 建不出来，理由提到矿脉）",
    noVeinErr.includes("矿脉"), noVeinErr || "竟然建成了");

  /* 7. 建筑图鉴：客户端照它渲染造价与占地尺寸，不会两边打架 */
  const catalog = await api("/api/buildings/catalog");
  const lumb = catalog.find((c) => c.type === "LUMBERJACK");
  const steel = catalog.find((c) => c.type === "STEEL_WORKS");
  check("建筑图鉴下发占地尺寸", catalog.length >= 150 && lumb.sizeW === 2 && steel.sizeW === 4
      && steel.sizeCells === 16,
    `${catalog.length} 种建筑（七阶层全表）；伐木场 ${lumb.sizeW}x${lumb.sizeH}，炼钢厂 ${steel.sizeW}x${steel.sizeH}（${steel.sizeCells} 格）`);
  check("图鉴下发工人需求（厂房要人上班，住宅 / 港口为 0）",
    lumb.workers === 2 && steel.workers === 5
      && catalog.find((c) => c.type === "FARMER_HOUSE").workers === 0,
    `伐木场 ${lumb.workers} 人，炼钢厂 ${steel.workers} 人，农夫小屋 ${catalog.find((c) => c.type === "FARMER_HOUSE").workers} 人`);

  /* 8. 多格建筑：整块占地冲突判定 */
  const bld = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "LUMBERJACK", x: 5, z: 6 });
  check("沿马路建造 2x2 伐木场", bld.gridX === 5 && bld.gridZ === 6 && bld.sizeW === 2 && bld.sizeH === 2,
    `锚点 (5,6)，占 (5,6)(6,6)(5,7)(6,7) 共 4 格`);

  let roadOnBldFailed = false;
  try {
    await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 6, z: 7 });
  } catch { roadOnBldFailed = true; }
  check("占地之内不能修路", roadOnBldFailed, "(6,7) 落在伐木场占地里");

  let plantOnBldFailed = false;
  try {
    await api("/api/farm/plant", "POST",
      { playerId: A.id, islandId: island.id, x: 5, z: 7, crop: "POTATO", buildingId: farm1.id });
  } catch { plantOnBldFailed = true; }
  check("占地之内不能播种", plantOnBldFailed, "(5,7) 落在伐木场占地里");

  let overlapFailed = false;
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island.id, type: "SAWMILL", x: 6, z: 6 });
  } catch { overlapFailed = true; }
  check("占地与已有建筑重叠被拒", overlapFailed, "3x3 锯木厂与伐木场占地的 (6,6)(6,7) 相交");

  /* 越界判定用网格尺寸现算：岛的大小由 anno.grid-size 决定，写死坐标会随配置漂移 */
  const edge = island.gridSize - 1;
  let outOfBoundsFailed = false;
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island.id, type: "STEEL_WORKS", x: edge, z: edge });
  } catch { outOfBoundsFailed = true; }
  check("占地超出岛屿边界被拒", outOfBoundsFailed,
    `4x4 放 (${edge},${edge}) 会伸到 (${edge + 3},${edge + 3})，出界`);

  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 8, z: 8 });
  const mill = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "TEXTILE_MILL", x: 9, z: 6 });
  check("大门自动吸附到马路那一侧（4×3 转成竖着摆）",
    mill.rotation === 270 && mill.sizeW === 3 && mill.sizeH === 4,
    `锚点 (9,6)，外圈只有 (8,8) 一格马路在西侧 → 门朝西、自动竖着摆占 3×4（而不是默认的 4×3）`);

  /* 8·补 朝向与旋转：横着摆 / 竖着摆，以及"旋转要绕中心、放不下就明确拒绝" */
  for (const x of [15, 16, 17, 18]) {
    await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x, z: 14 });
  }
  const horizon = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "TEXTILE_MILL", x: 15, z: 15, rotation: 0 });
  check("玩家显式指定朝向：rotation=0 横着摆",
    horizon.rotation === 0 && horizon.sizeW === 4 && horizon.sizeH === 3,
    `锚点 (15,15)，占 4×3 格（北边那排路在南侧，但玩家指定了门朝南）`);

  const rotated = await api(`/api/buildings/${horizon.id}/rotate`, "POST", { playerId: A.id });
  check("原地旋转 90°：绕占地中心、宽高对调",
    rotated.rotation === 90 && rotated.sizeW === 3 && rotated.sizeH === 4
      && rotated.gridX === 16 && rotated.gridZ === 15,
    `4×3 横摆 → 3×4 竖摆，锚点 (15,15) → (16,15)，那块地的中心没动`);

  const squareRot = await api(`/api/buildings/${bld.id}/rotate`, "POST", { playerId: A.id });
  check("方形建筑旋转只换门朝向、占地不变",
    squareRot.rotation === 90 && squareRot.sizeW === 2 && squareRot.sizeH === 2
      && squareRot.gridX === 5 && squareRot.gridZ === 6,
    `伐木场 2×2 在原地转 90°，锚点不动`);

  let rotLoseRoadFailed = false;
  try {
    await api(`/api/buildings/${horizon.id}/rotate`, "POST", { playerId: A.id });
  } catch { rotLoseRoadFailed = true; }
  check("旋转后不再临路会被拒（不硬转）", rotLoseRoadFailed,
    "3×4 再转 90° 会挪开北边那排马路，转完就不临路了");

  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 3, z: 20 });
  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 4, z: 20 });
  const odd = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "LUMBERJACK", x: 3, z: 18, rotation: 450 });
  check("非法角度被归一化到 90° 的整数倍", odd.rotation === 90,
    `rotation=450 → ${odd.rotation}°`);

  /* 9. 马路连通：再补两格成 L 形，客户端据此判断"朝哪几个方向接路" */
  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 7, z: 8 });
  await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 7, z: 7 });
  const net = await api(`/api/roads?islandId=${island.id}`);
  const hasRoadAt = (x, z) => net.some((r) => r.cellX === x && r.cellZ === z);
  const seen = new Set(["6,8"]);                       // 从 (6,8) 按四邻洪水填充
  const queue = [[6, 8]];
  while (queue.length) {
    const [cx, cz] = queue.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz, k = `${nx},${nz}`;
      if (hasRoadAt(nx, nz) && !seen.has(k)) { seen.add(k); queue.push([nx, nz]); }
    }
  }
  check("马路相邻自动连成路网", seen.size === 4 && seen.has("7,8") && seen.has("7,7")
      && seen.has("8,8") && !seen.has("1,1"),
    `从 (6,8) 连通 ${seen.size} 格（拐角 / 直路 / 尽头三种形态）；(1,1) 是孤立场不连通`);

  /* 9.5 劳动力 + 物流的前置布置：
     岛上还没有人口 → 伐木场招不到工人（noWorkers）；先在 WS 上线后再验一遍，
     然后建港口（马车目的地 = 仓库）+ 农夫小屋（落成自动迁入 8 名初始移民），
     劳动力池一有工人，伐木场就该恢复开工。 */
  const online = new WebSocket(WS);
  const wsEvents = [];                       // 顺手收集事件：后面验马车 DISPATCHED / ARRIVED
  const authedOnline = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5000);
    online.onopen = () => online.send(JSON.stringify({ type: "auth", playerId: A.id }));
    online.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === "authed") { clearTimeout(timer); resolve(true); }
      if (m.type === "event") wsEvents.push(m.data);
    };
    online.onerror = () => { clearTimeout(timer); resolve(false); };
  });
  check("挂上联机（懒结算只推在线玩家的岛）", authedOnline);

  const readBuilding = async (id) =>
    (await api(`/api/islands/${island.id}/buildings`)).find((b) => b.id === id);
  const pollBuild = async (cond, initial) => {
    let v = initial;
    const t0 = Date.now();
    while (!cond(v) && Date.now() - t0 < 30000) { await sleep(2000); v = await readBuilding(initial.id); }
    return v;
  };
  const lumber = await readBuilding(bld.id);
  const starved = await pollBuild((v) => v && v.noWorkers === true, lumber);
  check("没人上班厂房停摆（noWorkers 标记）",
    starved && starved.noWorkers === true,
    `伐木场 noWorkers=${starved && starved.noWorkers}，待运 ${starved && starved.pendingQty}`);

  const port1 = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "TRADING_POST", x: 0, z: 11 });
  check("主岛西岸建起贸易站（马车有地方卸货了）",
    port1.kind === "HARBOR" && port1.rotation === 270, `锚点 (${port1.gridX}, ${port1.gridZ})`);
  const house1 = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island.id, type: "FARMER_HOUSE", x: 5, z: 9 });
  const popIsland1 = await api(`/api/islands/${island.id}/population`);
  check("农夫小屋落成自动迁入 8 名初始移民（劳动力系统的启动器）",
    (popIsland1.tiers.find((t) => t.tier === "FARMER") || {}).population === 8,
    `岛上农夫 ${(popIsland1.tiers.find((t) => t.tier === "FARMER") || {}).population} 人`);
  const staffed = await pollBuild((v) => v && v.noWorkers === false, lumber);
  check("招到工人后伐木场恢复开工（noWorkers 解除）",
    staffed && staffed.noWorkers === false, `noWorkers=${staffed && staffed.noWorkers}`);

  console.log("\n⏳ 等待生产 + 马车运输：产出先进待运区，攒够一车由马车运到港口才入库…\n");

  /* 建房要材料后，开局赠料让仓库天然有木头 —— "马车入库"断言改看**差值**：
     本岛没有任何消耗木头的厂房（锯木厂只出现在负例里），木头只进不出，变多 = 生产 + 马车送到了 */
  const stockNow = await api(`/api/market/stock/${A.id}`);
  const woodBase = (stockNow.find((s) => s.good === "WOOD") || { quantity: 0 }).quantity;

  /* 3 株一茬的总产量。默认时间倍率下 40 秒刚够熟一茬（土豆 30s × 肥力 0.8~1.2 = 24~36s），
     调高 anno.time-scale 则会连着收好几茬 —— 所以下面按 >= 断言，多收了也是对的 */
  const expectedPotato = afterPlant.reduce((s, p) => s + p.plannedYield, 0);

  /* 产出不再即时入库：伐木场 5s/轮产 1 木，攒满一车（6）才派马车，路上还有行程 ——
     所以这里轮询到木材**比基线变多**为止（顺便等土豆成熟，一举两得） */
  let wood = null;
  const woodT0 = Date.now();
  while (Date.now() - woodT0 < 150000) {
    await sleep(3000);
    const st = await api(`/api/market/stock/${A.id}`);
    wood = st.find((s) => s.good === "WOOD");
    if (wood && wood.quantity > woodBase) break;
  }
  const woodWaited = Math.round((Date.now() - woodT0) / 1000);
  check("产出经马车运抵港口后入库（WOOD 较基线增加）", !!wood && wood.quantity > woodBase,
    `木材 ${woodBase} → ${wood ? wood.quantity : 0}（等了 ${woodWaited}s：生产攒车 + 马车行程）`);
  check("马车事件全链路广播（出发 + 到港卸货）",
    wsEvents.some((e) => e.type === "CART_DISPATCHED") && wsEvents.some((e) => e.type === "CART_ARRIVED"),
    `事件流里有 DISPATCHED=${wsEvents.some((e) => e.type === "CART_DISPATCHED")}，`
    + `ARRIVED=${wsEvents.some((e) => e.type === "CART_ARRIVED")}（共收到 ${wsEvents.length} 条事件）`);

  const grown = await api(`/api/islands/${island.id}/plots`);
  check("成熟后自动收获并原地重种（地块不消失）",
    grown.length === 3 && grown.every((p) => p.state === "GROWING"),
    `${grown.length} 株仍在田里，状态 ${grown.map((p) => p.state).join("/")}`);

  /* 8. 作物成熟即自动入库，全程不需要玩家点收获
        （断言 >= 而不是 ==：万一机器卡了一下多收了一茬，那也是对的行为，不该判失败）
        【扣除居民口粮】主岛上住着初始移民，他们吃的就是这个仓库的土豆
        （0.4/人·分）—— 等马车 + 成熟的这几分钟里被吃掉几个是正常经营损耗，
        所以按"预期产量 - 口粮余量"断言， detail 里把这笔账算清楚。 */
  const stockAfter = await api(`/api/market/stock/${A.id}`);
  const potato = stockAfter.find((s) => s.good === "POTATO");
  const pop1 = await api(`/api/islands/${island.id}/population`);
  const pop1N = (pop1.tiers.find((t) => t.tier === "FARMER") || {}).population || 0;
  const ateAllowance = Math.ceil(pop1N * 0.4 * (woodWaited / 60)) + 4;
  check("作物成熟自动入库（无需手动收获，扣除居民口粮消耗）",
    !!potato && potato.quantity >= expectedPotato - ateAllowance,
    `土豆 ${potato ? potato.quantity : 0} 个（3 株一茬共 ${expectedPotato}，`
    + `岛上 ${pop1N} 名居民按 0.4/人·分 至多吃 ${ateAllowance} 个）`);

  /* 10. 拆除建筑：返还一半造价 + 占地整块释放（多格建筑放错位置时唯一能反悔的办法） */
  const goldBefore = (await api(`/api/players/${A.id}`)).treasury;
  const demo = await api(`/api/buildings/${mill.id}?playerId=${A.id}`, "DELETE");
  const goldAfter = (await api(`/api/players/${A.id}`)).treasury;
  let freedRoadOk = false;
  try {                       // (10,7) 原本在纺织厂 3×4 占地里，拆完应当能修路 —— 修路是最便宜的"腾地"探针
    await api("/api/roads", "POST", { playerId: A.id, islandId: island.id, x: 10, z: 7 });
    freedRoadOk = true;
  } catch { freedRoadOk = false; }
  check("拆除建筑返还一半造价并腾出整块占地",
    demo.sizeW === 3 && demo.sizeH === 4 && demo.rotation === 270
      && Math.abs(goldAfter - goldBefore - demo.refund) < 0.01 && freedRoadOk,
    `${demo.label} 竖着摆占 3×4（朝西 270°），返还 ¥${demo.refund}（${goldBefore} → ${goldAfter}），原占地里的 (10,7) 已能修路`);

  /* 9. NPC 市场卖出 */
  const before = (await api(`/api/players/${A.id}`)).treasury;
  const sell = await api("/api/market/sell", "POST",
    { playerId: A.id, good: "POTATO", quantity: 5 });
  const after = (await api(`/api/players/${A.id}`)).treasury;
  check("向市场卖出获得金币", after > before,
    `卖 5 土豆 @¥${sell.unitPrice} 收 ¥${sell.total}`);

  /* 10. B 挂买单（冻结资金），A 接单出货 */
  const bBefore = (await api(`/api/players/${B.id}`)).treasury;
  const offer = await api("/api/trade/offers", "POST",
    { playerId: B.id, side: "BUY", good: "POTATO", quantity: 10, unitPrice: 15 });
  const bFrozen = (await api(`/api/players/${B.id}`)).treasury;
  check("挂买单冻结资金", bFrozen === bBefore - 150,
    `冻结 ¥150（${bBefore} → ${bFrozen}）`);

  const deal = await api(`/api/trade/offers/${offer.id}/accept`, "POST", { takerId: A.id });
  const bStock = await api(`/api/market/stock/${B.id}`);
  const bGot = bStock.find((s) => s.good === "POTATO");
  check("玩家间挂单成交", !!bGot && bGot.quantity === 10,
    `B 收到土豆 10，A 收 ¥${deal.total}`);

  /* 11. 撤单退回 */
  const offer2 = await api("/api/trade/offers", "POST",
    { playerId: A.id, side: "SELL", good: "WOOD", quantity: 5, unitPrice: 30 });
  const beforeCancel = (await api(`/api/market/stock/${A.id}`)).find((s) => s.good === "WOOD").quantity;
  await api(`/api/trade/offers/${offer2.id}/cancel`, "POST", { takerId: A.id });
  const afterCancel = (await api(`/api/market/stock/${A.id}`)).find((s) => s.good === "WOOD").quantity;
  check("撤单退回托管货物", afterCancel === beforeCancel + 5,
    `木材 ${beforeCancel} → ${afterCancel}`);

  /* 12. 行情波动 */
  const market = await api("/api/market");
  check("市场行情有波动", market.some((m) => Math.abs(m.changeRatio) > 0),
    `${market.length} 种商品，例：${market[0].label} ¥${market[0].price} (${(market[0].changeRatio * 100).toFixed(2)}%)`);

  /* 12.5 开拔去岛 2 之前清一波仓：建房要材料后开销变大（农场 / 木板采购都是真金白银），
     纺织厂功成身退拆掉回血一半造价，余粮换军饷 —— 木材留 12 根（岛 2 两座房要 10，
     撤单测试还要 5 根托管周转），土豆全出。 */
  const millLeft = (await api(`/api/islands/${island.id}/buildings`))
    .find((b) => b.type === "TEXTILE_MILL");
  if (millLeft) await api(`/api/buildings/${millLeft.id}?playerId=${A.id}`, "DELETE");
  const sweep = await api(`/api/market/stock/${A.id}`);
  const qOf = (g) => { const it = sweep.find((s) => s.good === g); return it ? it.quantity : 0; };
  if (qOf("WOOD") > 12) {
    await api("/api/market/sell", "POST", { playerId: A.id, good: "WOOD", quantity: qOf("WOOD") - 12 });
  }
  if (qOf("POTATO") > 0) {
    await api("/api/market/sell", "POST", { playerId: A.id, good: "POTATO", quantity: qOf("POTATO") });
  }

  /* ==================================================================
     13. 居民经济：港口 -> 住宅 -> 居民 -> 需求 -> 税收
     前面几节验证的是"造厂 -> 产出 -> 卖给 NPC 市场"，钱来自抽象买家；
     这一节验证产出**被岛上的人吃掉**、并且吃掉之后换来税收 —— 这才是《纪元1800》
     真正的主循环，也是本项目此前完全缺失的一环。
     单开一座岛来测，免得和上面那堆马路/厂房抢地盘。
     ⚠ 坐标硬编码的地方一律用平岛：贸易站得建在"最外一圈沙滩"上，
     随机岛的岸线每次都不一样，写死 (0,11) 会在某些 id 上落到海里。
     ⚠ 平岛的最外一圈（x=0 / z=0 / x=35 / z=35）就是海岸带 —— 出界当作海，
     所以"贴边 = 沙滩、往里一格 = 内陆"这条判定照样能验。
     ================================================================== */
  console.log("\n🏘️  测试居民经济闭环（港口 -> 住宅 -> 需求 -> 税收）…");

  const island2 = await api("/api/islands", "POST", { playerId: A.id, name: "居民岛", flat: true });
  for (let x = 2; x <= 14; x++) {
    await api("/api/roads", "POST", { playerId: A.id, islandId: island2.id, x, z: 10 });
  }
  check("居民岛：修好一条 13 格马路",
    (await api(`/api/roads?islandId=${island2.id}`)).length === 13,
    `岛#${island2.id}`);

  /* 13.1 图鉴补上了三种"非生产建筑"，客户端照它分组渲染、照它算门槛 */
  const harborCat = catalog.find((c) => c.type === "TRADING_POST");
  const houseCat = catalog.find((c) => c.type === "FARMER_HOUSE");
  const workerCat = catalog.find((c) => c.type === "WORKER_HOUSE");
  check("图鉴含港口与两座住宅，且标明用途 kind",
    harborCat.kind === "HARBOR" && houseCat.kind === "RESIDENCE" && workerCat.kind === "RESIDENCE",
    `贸易站=${harborCat.kind}，农夫小屋=${houseCat.kind}，工人住宅=${workerCat.kind}`);
  check("图鉴下发住宅容量与人口门槛",
    houseCat.residentCapacity === 24 && houseCat.residentTier === "FARMER"
      && workerCat.residentCapacity === 40 && workerCat.requiredFarmerPopulation === 120,
    `农夫小屋住 ${houseCat.residentCapacity} 人，工人住宅住 ${workerCat.residentCapacity} 人`
      + `（需岛上先有 ${workerCat.requiredFarmerPopulation} 名农夫）`);

  /* 13.2 顺序约束：没有港口，生活物资运不上岛，住宅不该盖得起来 */
  let noHarborFailed = false;
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island2.id, type: "FARMER_HOUSE", x: 3, z: 8 });
  } catch { noHarborFailed = true; }
  check("还没有港口就盖住宅被拒（顺序：先港口、后居民）", noHarborFailed,
    "3×3 贸易站还没影儿，2×2 农夫小屋被挡在门外");

  /* 13.3 港口必须建在海边：这是贸易站和厂房**唯一**的区别。
     内陆 (6,11) 外圈就压着上面修的那条马路，物流条件是够的 ——
     但它是港口，得压在"离水不超过 coast-width 格"的沙滩上，所以照样得被拒。 */
  let inlandHarborErr = null;
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island2.id, type: "TRADING_POST", x: 6, z: 11 });
  } catch (e) { inlandHarborErr = e.message; }
  check("内陆建贸易站被拒（港口得骑在岸线上，有马路也不行）",
    !!inlandHarborErr && (inlandHarborErr.includes("岸线") || inlandHarborErr.includes("海边")), inlandHarborErr || "竟然建成了");

  /* 13.4 建港口（贸易站）到西岸沙滩上：(0,11) 占地 x0-2 / z11-13，
     x=0 那一列就是海岸带（平岛的最外一圈），北边 z=10 正好压着上面那条马路。
     门会自动朝**西**（270°）—— 那边出了网格就是海，而不是朝那条马路。 */
  const harbor = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island2.id, type: "TRADING_POST", x: 0, z: 11 });
  check("海岸带上建贸易站成功，且它不进生产心跳",
    harbor.kind === "HARBOR" && harbor.progress === 0,
    `锚点 (${harbor.gridX}, ${harbor.gridZ})，占地 ${harbor.sizeW}×${harbor.sizeH}，进度 ${harbor.progress}`);
  check("港口大门自动朝海（不是朝马路）", harbor.rotation === 270,
    `门朝 ${harbor.rotation}°（270=西=朝海；北边那条马路只是物流接口，门不该开向它）`);

  /* 13.5 备口粮：农夫每人每分钟要吃 0.4 土豆 + 0.15 烈酒，先从市场买一批 */
  const qtyOf = (list, g) => { const it = (list || []).find((s) => s.good === g); return it ? it.quantity : 0; };
  const stockBefore = await api(`/api/market/stock/${A.id}`);
  const potatoBefore = qtyOf(stockBefore, "POTATO");
  const schnappsBefore = qtyOf(stockBefore, "SCHNAPPS");
  await api("/api/market/buy", "POST", { playerId: A.id, good: "POTATO", quantity: 40 });
  await api("/api/market/buy", "POST", { playerId: A.id, good: "SCHNAPPS", quantity: 15 });
  const stockStocked = await api(`/api/market/stock/${A.id}`);
  const potato0 = qtyOf(stockStocked, "POTATO");
  const schnapps0 = qtyOf(stockStocked, "SCHNAPPS");
  check("从 NPC 市场备好口粮（土豆 +40 / 烈酒 +15）",
    potato0 === potatoBefore + 40 && schnapps0 === schnappsBefore + 15,
    `土豆 ${potatoBefore} -> ${potato0}，烈酒 ${schnappsBefore} -> ${schnapps0}`);

  /* 13.6 港口到位后，住宅才盖得起来 */
  const house = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island2.id, type: "FARMER_HOUSE", x: 3, z: 8 });
  check("有港口后盖农夫小屋成功", house.kind === "RESIDENCE" && house.sizeW === 2 && house.sizeH === 2,
    `第 1 座 ${house.label} 2×2，占地 ${house.sizeW * house.sizeH} 格`);

  /* 13.7 人口面板：玩家看"需求 -> 满足度 -> 税收"的地方 */
  const pop0 = await api(`/api/islands/${island2.id}/population`);
  const farmer0 = pop0.tiers.find((t) => t.tier === "FARMER");
  check("人口接口可用，港口状态已认定",
    pop0.hasTradingPost === true && Array.isArray(pop0.tiers) && pop0.tiers.length === 7,
    `hasTradingPost=${pop0.hasTradingPost}，下发 ${pop0.tiers.length} 个阶层`);
  check("居住容量来自住宅实时汇总（不落库，拆房即掉）；新房带初始移民",
    farmer0.capacity === 24 && farmer0.population === 8,
    `一座农夫小屋 → 农夫容量 ${farmer0.capacity}，落成即迁入 ${farmer0.population} 人`);
  check("需求表下发到客户端（按每人每分钟）",
    farmer0.needs.length === 2 && farmer0.needs.every((n) => n.perResidentPerMinute > 0)
      && farmer0.needs.some((n) => n.good === "POTATO") && farmer0.needs.some((n) => n.good === "SCHNAPPS"),
    farmer0.needs.map((n) => `${n.label} ${n.perResidentPerMinute}/人·分`).join("，"));
  const worker0 = pop0.tiers.find((t) => t.tier === "WORKER");
  check("工人阶层未解锁（岛上农夫不够 120）", worker0.unlocked === false,
    `unlocked=${worker0.unlocked}，容量 ${worker0.capacity}`);

  /* 13.8 再盖第二座：容量累加 —— 顺便让一个结算周期里土豆和烈酒都被吃掉，
     否则首周期人口太少，烈酒 round(0.15×12×0.5)=round(0.9) 会取整成 0，白等一个周期 */
  const house2 = await api("/api/buildings", "POST",
    { playerId: A.id, islandId: island2.id, type: "FARMER_HOUSE", x: 9, z: 8 });
  const cap2 = (await api(`/api/islands/${island2.id}/population`))
    .tiers.find((t) => t.tier === "FARMER").capacity;
  check("多座住宅的容量会累加（容量是实时汇总出来的）",
    house2.kind === "RESIDENCE" && cap2 === 48,
    `第 2 座农夫小屋落地后，农夫容量 24 -> ${cap2}`);

  /* 13.9 等结算周期：需求满足 -> 有人搬进来 + 口粮被吃掉 + 税收进账
     居民消费按"每人每分钟"定义，攒够一个结算周期（默认 30 游戏秒）才结算一次，
     所以这里必须等真实时间。轮询到条件满足就提前退出，倍速越高越快。 */
  const moneyBeforeTax = (await api(`/api/players/${A.id}`)).treasury;
  console.log("⏳ 等居民搬进来并把口粮吃掉（人口按周期结算，时间加速倍率越高越快）…");
  const waitStart = Date.now();
  let farmer = farmer0;
  let potatoNow = potato0, schnappsNow = schnapps0;
  while (Date.now() - waitStart < 120000) {
    await sleep(2000);
    farmer = (await api(`/api/islands/${island2.id}/population`))
      .tiers.find((t) => t.tier === "FARMER");
    const st = await api(`/api/market/stock/${A.id}`);
    potatoNow = qtyOf(st, "POTATO");
    schnappsNow = qtyOf(st, "SCHNAPPS");
    if (farmer.population > 0 && farmer.satisfaction >= 0.9
        && schnappsNow < schnapps0) break;
  }
  const waitedSec = Math.round((Date.now() - waitStart) / 1000);
  check("需求被满足后居民陆续搬进来（世界心跳生效）",
    farmer.population > 0,
    `人口 ${farmer.population}/${farmer.capacity}（等了 ${waitedSec}s）`);
  check("满足度良好", farmer.satisfaction >= 0.9,
    `满足度 ${Math.round(farmer.satisfaction * 100)}%`);
  /* 消耗证据用**烈酒**：测试全程没有烈酒产能，只出不进，仓库必然单调下降。
     土豆不能用 —— 前半段种下的农田是"收完原地重种"的永久循环，
     观察窗口里还在往同一个仓库进货，净额可能不降反升（以前靠肥力随机摇出低产岛才偶尔通过）。 */
  check("居民真的在消耗口粮（烈酒只出不进，仓库下降，不是白吃）",
    schnappsNow < schnapps0,
    `烈酒 ${schnapps0} -> ${schnappsNow}；土豆 ${potato0} -> ${potatoNow}（农田自动收获在补货，净额不作数）`);

  const moneyAfterTax = (await api(`/api/players/${A.id}`)).treasury;
  check("税收入账：这段时间不生产、不交易，金库自己涨了",
    moneyAfterTax > moneyBeforeTax,
    `¥${moneyBeforeTax} -> ¥${moneyAfterTax}，面板口径 ¥${farmer.taxPerMinute}/分`);

  /* 13.10 人口门槛：人口够了才解锁新建筑 —— 纪元1800 那条进阶线 */
  let gateFailed = false, gateMsg = "";
  try {
    await api("/api/buildings", "POST",
      { playerId: A.id, islandId: island2.id, type: "WORKER_HOUSE", x: 10, z: 11 });
  } catch (e) { gateFailed = true; gateMsg = e.message; }
  check("农夫不足 120 时建工人住宅被拒（人口解锁新建筑）", gateFailed,
    `岛上农夫 ${farmer.population} 人 < 120`);

  /* 13.11 拆贸易站不需要先拆住宅（规则已移除）：港口直接可拆，照常返款。
     拆之前顺手验一把"港口不进生产心跳"（原来的 13.13，港口拆了就没得验了）。 */
  const island2Blds = await api(`/api/islands/${island2.id}/buildings`);
  const harborBeforeDel = island2Blds.find((b) => b.type === "TRADING_POST");
  check("贸易站运行很久后进度依然是 0（不进生产心跳），且建筑列表全部带 kind 字段",
    harborBeforeDel.progress === 0 && island2Blds.every((b) => !!b.kind),
    `进度 ${harborBeforeDel.progress}；${island2Blds.length} 座建筑全带 kind`);
  const delHarborRes = await api(`/api/buildings/${harbor.id}?playerId=${A.id}`, "DELETE");
  check("岛上有住宅也能直接拆贸易站（拆除无前置限制）",
    delHarborRes.type === "TRADING_POST" && delHarborRes.refund > 0,
    `拆掉 ${delHarborRes.type}，返款 ¥${delHarborRes.refund}`);

  /* 13.12 拆掉住宅：容量归零、人口立刻收敛（不等下一个心跳） */
  const popBeforeDemo = farmer.population;
  await api(`/api/buildings/${house.id}?playerId=${A.id}`, "DELETE");
  const farmedHalf = (await api(`/api/islands/${island2.id}/population`))
    .tiers.find((t) => t.tier === "FARMER");
  await api(`/api/buildings/${house2.id}?playerId=${A.id}`, "DELETE");
  const farmedAfter = (await api(`/api/islands/${island2.id}/population`))
    .tiers.find((t) => t.tier === "FARMER");
  check("拆掉一座房容量立刻掉一半（不落库、不用同步代码）",
    farmedHalf.capacity === 24,
    `容量 48 -> ${farmedHalf.capacity}，人口 ${farmedHalf.population}（没超容量就不赶人）`);
  check("住宅拆光后容量归零、人口立刻清零",
    farmedAfter.capacity === 0 && farmedAfter.population === 0,
    `人口 ${popBeforeDemo} -> ${farmedAfter.population}，容量 48 -> ${farmedAfter.capacity}`);

  /* ==================================================================
     13.14 随机地形：岛不是方块，是"算"出来的
     前面所有布局都跑在平岛上（坐标才确定）。这一节专门验随机岛 ——
     这才是玩家真看到的那种岛：有海、有山、有矿脉、轮廓不规则，
     而且**同一个 id 永远是同一座岛**（种子由 id 推导，不掷骰子，刷新页面不变脸）。
     ================================================================== */
  const wild = await api("/api/islands", "POST", { playerId: A.id, name: "随机岛" });
  const cells = [...wild.terrain];
  const n = (c) => cells.filter((x) => x === c).length;
  const land = n(".") + n("^") + n("i") + n("c");
  const total = wild.gridSize * wild.gridSize;
  check("随机岛下发地形串：长度 = 边长²，且只含合法地形字符",
    typeof wild.terrain === "string" && wild.terrain.length === total
      && [...new Set(cells)].every((c) => ".~^ic".includes(c)),
    `${wild.gridSize}×${wild.gridSize}，用到的字符 {${[...new Set(cells)].join("")}}`
      + `（. 平原 / ~ 水 / ^ 山 / i 铁矿 / c 黏土）`);

  check("岛形不是方块：陆地与海都有，陆地占比落在配置区间（anno.terrain.land-ratio=0.62）",
    land > 0 && n("~") > 0 && land / total > 0.3 && land / total < 0.9,
    `陆地 ${land}/${total} = ${(land / total * 100).toFixed(1)}%，其中平原 ${n(".")} / 山地 ${n("^")}`
      + `，水 ${n("~")}，铁矿脉 ${n("i")}，黏土矿脉 ${n("c")}`);

  check("水面不是零星几格：岸线退让出了港湾（水占比 > 5%）",
    n("~") > total * 0.05,
    `水面占比 ${(n("~") / total * 100).toFixed(1)}%`);

  const wildAgain = (await api(`/api/islands?playerId=${A.id}`)).find((i) => i.id === wild.id);
  check("同一座岛的地形是**存下来的**（种子由 id 推导）：再读一次一模一样，刷新不变脸",
    wildAgain.terrain === wild.terrain && wildAgain.terrainSeed === wild.terrainSeed,
    `terrainSeed=${wild.terrainSeed}，两次读到 ${wildAgain.terrain === wild.terrain ? "完全相同" : "不一致"}`
      + `；摘要：${wild.terrainSummary}`);

  let wildWaterRoadErr = "";
  let wildWaterCell = null;
  for (let z = 0; z < wild.gridSize && !wildWaterCell; z++) {
    for (let x = 0; x < wild.gridSize; x++) {
      if (wild.terrain[z * wild.gridSize + x] === "~") { wildWaterCell = [x, z]; break; }
    }
  }
  if (wildWaterCell) {
    try {
      await api("/api/roads", "POST",
        { playerId: A.id, islandId: wild.id, x: wildWaterCell[0], z: wildWaterCell[1] });
    } catch (e) { wildWaterRoadErr = e.message; }
  }
  check("海面上修不了马路（随机岛真的把水当水）",
    !!wildWaterCell && wildWaterRoadErr.includes("水面"),
    `${wildWaterCell ? `(${wildWaterCell[0]},${wildWaterCell[1]}) → "${wildWaterRoadErr}"` : "这座岛没找到水面格子"}`);

  /* 14. WebSocket 联机 */
  online.close();          // 前面那条"让 A 保持在线"的连接到这里才退休，后面的 wsTest 自己再开一条
  await wsTest(A.id);

  console.log(`\n=== 结果：通过 ${ok.length} / 失败 ${bad.length} ===`);
  if (bad.length) {
    console.log(bad.join("\n"));
    process.exit(1);
  }
}

async function wsTest(playerId) {
  console.log("\n🔌 测试 WebSocket 联机…");
  const seen = new Set();
  let authed = false;
  try {
    const ws = new WebSocket(WS);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 9000);
      ws.onopen = () => ws.send(JSON.stringify({ type: "auth", playerId }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        seen.add(m.type);
        if (m.type === "authed") authed = true;
        if (m.type === "world") {
          console.log(`   收到世界快照：tick=${m.data.tick}，在线=${m.data.onlinePlayers}，行情 ${m.data.market.length} 条`);
        }
        if (seen.has("world") && authed) { clearTimeout(timer); resolve(); }
      };
      ws.onerror = () => { clearTimeout(timer); resolve(); };
    });
    ws.close();
  } catch (e) {
    console.log("   WebSocket 不可用：" + e.message);
  }
  check("WebSocket 认证 + 世界广播", authed && seen.has("world"),
    `收到消息类型：${[...seen].join(", ") || "无"}`);
}

main().catch((e) => {
  console.error("💥 测试中断：" + e.message);
  process.exit(1);
});
