/**
 * NPC 世界 —— 街上的行人：行为状态机 + 路网寻路 + 三级 LOD 渲染。
 *
 * ============================================================
 * 【一、为什么整套跑在客户端】
 * NPC 走街是**氛围**，不是玩法规则。服务端要是为几百个路人跑寻路 + 心跳 + 同步，
 * 光网络流量就压死；而客户端手里本来就有全量路网、建筑坐标和地形 ——
 * 它自己有本事在 60fps 里把这件事算完。
 * 所以规矩是：**服务端仍然是玩法权威（人口、税收、建造），NPC 只是人口的可视化。**
 * 岛上住了 240 个人，街上就该有 240 个路人；人口掉到 0，街就空 —— 不许凭空捏人。
 *
 * ============================================================
 * 【二、状态机（用户画的九个格子，落在六个状态上）】
 *
 *     出门        →  SLEEP ──(到点)──▶ PLAN ──▶ WALK   （在家 → 出门上路）
 *     沿道路行走  →  WALK           （沿路网一格一格走，goal 决定去哪）
 *     去工作/商店/市场 → WALK，由 goal = WORK / SHOP / MARKET 区分
 *     路边停留    →  DWELL（goal = LOITER）
 *     与其他NPC交谈 →  CHAT          （两两配对，面对面冒气泡）
 *     回家睡觉    →  WALK(goal=HOME) ──▶ ENTER ──▶ SLEEP
 *
 * 每个 NPC 的目标完全由**一条纯函数** `goalFor(npc, hour)` 决定 ——
 * 输入是"现在几点"和"这个人是谁"，输出是"此刻该去哪"。
 * 没有 per-NPC 的剧本表，所以：改日程只改一个函数；同一个人每天都过一样的日子；
 * 加减人数不会打乱别人的作息。
 *
 * ============================================================
 * 【三、三级 LOD + 人群层（用户要的"几百人看起来在活动"）】
 *
 *     镜头附近  →  detail  完整低模 + 摆臂摆腿 + 说话气泡
 *     中距离    →  detail  但**收起手臂**，只做整体起伏（少 2 个 draw call）
 *     更远      →  detail  但只留躯干，动画降频
 *     再远到 detailMax 名额之外 → crowd  进 InstancedMesh，2 个 draw call 画几百人
 *     超过 cullDist 或在家睡觉 →  完全不画
 *
 * 关键点：**名额（detailMax）和距离是两把尺子**。哪怕全岛都在镜头里，
 * 也只有最靠近镜头的 detailMax 个人拿到"完整动画"的编制 ——
 * 这正是"城市里看起来有几百人，但同时做完整动画的只有几十个"。
 */
import * as THREE from 'three';
import {
  NPC_MAT, ARCHETYPES, ARCHETYPE_MAP, makeLook, makeRnd, buildNpcBody, buildCrowdGeometries,
} from './npc-roster.js';

/* ============================================================
   0. 可以拧的旋钮
   ============================================================ */
export const NPC_CONFIG = {
  daySeconds: 600,      // 一个游戏日 = 多少**真实**秒。600 → 白天黑夜各 5 分钟，夜景值得停留；再小黑夜还没看够就天亮了
  startHour: 7.0,       // 进游戏时是早上 7 点
  detailMax: 72,        // 最多几个人配"完整动画 + 摆臂摆腿"（性能阀门）
  crowdMax: 512,        // 人群层最多画几个剪影
  maxTotal: 480,        // 一帧最多模拟几个 NPC（再多就只按人口截断）
  lodNear: 15,          // 这个距离内：完整动画
  lodMid: 30,           // 这个距离内：收起手臂
  lodFar: 62,           // 这个距离内：只留躯干
  cullDist: 105,        // 超出这个距离直接不画
  lodInterval: 0.35,    // 每隔多久重新分一次档（秒）
  pathBudget: 6,        // 每帧最多跑几次 BFS 寻路（用完的下一帧再排队）
  crowdInterval: 32,    // 人群层每隔多少**毫秒**写一次实例矩阵（远处看不出抖动，省的是 CPU）
  chatScan: 0.5,        // 每隔多久扫描一次"谁可以和谁聊两句"
  turnRate: 6.0,        // 转身速度（弧度/秒）
};

/** 商店 / 市场：街上有哪些"目的地"建筑。没有这类建筑时，居民会退化成在路边闲逛。 */
const SHOP_TYPES = ['BAKERY', 'BREWERY', 'SCHNAPPS_DISTILLERY'];
const MARKET_TYPES = ['TRADING_POST'];
/** 采掘类 vs 工业类：农民去前者、工人去后者（和原型里的 workBias 对应） */
const RAW_TYPES = ['LUMBERJACK', 'CLAY_PIT', 'IRON_MINE'];
const INDUSTRY_TYPES = ['SAWMILL', 'BRICKWORKS', 'MILL', 'BAKERY', 'SCHNAPPS_DISTILLERY',
                        'TEXTILE_MILL', 'STEEL_WORKS', 'BREWERY', 'CLOTHING_FACTORY'];

/** 每栋住宅按阶层决定"住着哪些人"的权重表（想调人口构成就调这里） */
const TIER_POOL = {
  FARMER: { FARMER_M:12, FARMER_F:12, VILLAGER_M:10, VILLAGER_F:10, WORKER_M:3, WORKER_F:3,
            YOUTH_M:6, YOUTH_F:6, ELDER_M:5, ELDER_F:5, BOY:7, GIRL:7 },
  WORKER: { WORKER_M:13, WORKER_F:13, VILLAGER_M:8, VILLAGER_F:8, FARMER_M:3, FARMER_F:3,
            YOUTH_M:6, YOUTH_F:6, ELDER_M:4, ELDER_F:4, BOY:6, GIRL:6 },
};

const TWO_PI = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;

/* ============================================================
   1. 气泡贴图：一句"…"共用一张，几百个 NPC 也只花一张纹理
   ============================================================ */
function makeBubbleTexture() {
  const cv = document.createElement('canvas');
  cv.width = 96; cv.height = 72;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 96, 72);
  const r = 14;
  g.fillStyle = 'rgba(250,250,245,0.95)';
  g.strokeStyle = 'rgba(40,50,60,0.55)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(12 + r, 8);
  g.lineTo(84 - r, 8); g.quadraticCurveTo(84, 8, 84, 8 + r);
  g.lineTo(84, 40 - r); g.quadraticCurveTo(84, 40, 84 - r, 40);
  g.lineTo(50, 40); g.lineTo(36, 60); g.lineTo(40, 40);
  g.lineTo(12 + r, 40); g.quadraticCurveTo(12, 40, 12, 40 - r);
  g.lineTo(12, 8 + r); g.quadraticCurveTo(12, 8, 12 + r, 8);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = 'rgba(45,55,65,0.85)';
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(32 + i * 16, 24, 3.4, 0, TWO_PI); g.fill(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let bubbleTex = null;

/* ============================================================
   2. 主体
   ============================================================ */
export class NpcWorld {

  /**
   * @param deps 由 game.html 注入的"世界查询接口"（NPC 只读世界，不碰世界）：
   *   parent        挂到哪个分组下（一般是 island）
   *   cellToWorld(x,z) → [wx, wz]
   *   hasRoad(x,z)   → bool
   *   isLandCell(x,z)→ bool
   *   keyOf(x,z)     → 'x,z'
   *   gridSize()     → 网格边长
   *   sideCells(x,z,w,h,rot) → 那一侧的格子（门朝哪就查哪侧的道路）
   *   groundAt(wx,wz) → 这个**世界坐标**上脚底该踩多高（路面比草地高一点）
   *   roadCells()    → 全部马路格 [[x,z], ...]
   */
  constructor(deps) {
    this.deps = deps;
    this.group = new THREE.Group();
    this.group.name = 'npcs';
    deps.parent.add(this.group);

    /* 人群层：两颗积木、两个 draw call 画下几百人。颜色走 instanceColor，
       几何体顶点色刷成纯白，两者相乘就是这个人衣服/皮肤的颜色。 */
    const cg = buildCrowdGeometries();
    this.crowdGeo = cg;
    this.crowdBody = new THREE.InstancedMesh(cg.body, NPC_MAT, NPC_CONFIG.crowdMax);
    this.crowdHead = new THREE.InstancedMesh(cg.head, NPC_MAT, NPC_CONFIG.crowdMax);
    for (const m of [this.crowdBody, this.crowdHead]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      m.setColorAt(0, new THREE.Color(0xffffff));   // 触发 instanceColor 的创建
      this.group.add(m);
    }
    this._crowdCol = new THREE.Color();
    this._dummy = new THREE.Object3D();

    if (!bubbleTex) bubbleTex = makeBubbleTexture();
    this.bubbleMat = new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthWrite: false });

    this.npcs = [];
    this.pathCache = new Map();
    this.sites = { homes: [], works: [], shops: [], markets: [] };
    this.roadCells = [];
    this.clock = { day: 1, hour: NPC_CONFIG.startHour };
    this.islandId = null;
    this.forceCount = null;      // 调试/演示：强制街上的人数（null = 老实按人口）
    this.lastError = '';         // 给 HUD 用的一句话诊断

    this._crowdList = [];
    this._time = 0;
    this._frame = 0;
    /* 定时器一律走**墙钟**（performance.now），不走"累加 dt"：
       dt 被 clamp 到 0.1，帧率一低（无头浏览器 1fps 很正常）累加就会严重滞后 ——
       实测表现为"人都醒了好几个身位，LOD 还按睡觉时的快照算"，全城渲染成 hidden。 */
    this._lodAt = -1e9;
    this._chatAt = -1e9;
    this._crowdAt = -1e9;
    this._pathBudget = NPC_CONFIG.pathBudget;
    this._roadSig = '';
    this._lastSig = '';
    this._stats = { total:0, detail:0, crowd:0, hidden:0, sleeping:0, walking:0, atWork:0,
                    chatting:0, byArch:{}, byState:{} };
  }

  /* ==========================================================
     3. 与世界同步（马路/建筑/人口变了就调它）
     ========================================================== */
  sync(world) {
    const { islandId, buildings, population, roadSig } = world;

    /* 换岛 = 全部推倒重来（人、路径缓存、建筑索引都不通用） */
    if (islandId !== this.islandId) {
      this.clearAll();
      this.islandId = islandId;
    }
    /* 路网变了：路径缓存全部作废（旧的 BFS 结果是按旧路网算的），
       并且正在路上的人要重新规划，否则会沿着"已经不存在的那条路"穿墙走 */
    if (roadSig !== this._roadSig) {
      this.pathCache.clear();
      for (const n of this.npcs) { n.dest = null; if (n.state === 'WALK') n.state = 'PLAN'; }
      this._roadSig = roadSig;
      this.roadCells = this.deps.roadCells() || [];
    }

    /* 建筑索引：住宅（住哪）、厂房（去哪上班）、商店/市场（去哪买东西） */
    const list = (buildings || []).filter(b => b.gridX != null && b.gridZ != null);
    this.sites.homes = list.filter(b => b.kind === 'RESIDENCE').map(b => this.makeSite(b));
    this.sites.works = list.filter(b => b.kind === 'PRODUCTION').map(b => this.makeSite(b));
    this.sites.shops = list.filter(b => SHOP_TYPES.includes(b.type)).map(b => this.makeSite(b));
    this.sites.markets = list.filter(b => MARKET_TYPES.includes(b.type)).map(b => this.makeSite(b));

    /* 每人手里的三个"常去的地方"要跟着重算（房子拆了 / 新开了面包房） */
    for (const n of this.npcs) this.assignSites(n);

    /* 人数：**来自人口**，不是拍脑袋定的 */
    const pop = population && Number.isFinite(population.totalPopulation) ? population.totalPopulation : 0;
    let target = this.forceCount != null ? this.forceCount : pop;
    target = Math.max(0, Math.min(NPC_CONFIG.maxTotal, Math.round(target)));
    /* 没有住宅就没有"住的人"—— 有房子才往街上放人 */
    if (!this.sites.homes.length) target = 0;
    this.ensureCount(target);

    this.lastError = !this.sites.homes.length
      ? ''   /* 没住宅不弹说教文案（面板显示"街上暂时没人"即可） */
      : !this.sites.homes.some(h => h.door)
        ? '住宅旁边还没有马路：修一条路，居民才出得了门'
        : target === 0
          ? '岛上还没有居民：满足居民需求让人口涨起来，街上就会有人'
          : '';
  }

  /** 把一个建筑实体变成"可到达的站点"：临路格、门口站位、楼心世界坐标 */
  makeSite(b) {
    const w = b.sizeW || 1, h = b.sizeH || 1;
    const { hasRoad, keyOf, cellToWorld, sideCells } = this.deps;
    const x0 = b.gridX, z0 = b.gridZ;

    /* 临路格：占地外圈**任意一格**是马路就能走到（和建造时的"外圈临路"同一套） */
    const cells = [];
    const push = (x, z) => { if (hasRoad(x, z) && !cells.some(c => c[0] === x && c[1] === z)) cells.push([x, z]); };
    for (let x = x0 - 1; x <= x0 + w; x++) { push(x, z0 - 1); push(x, z0 + h); }
    for (let z = z0; z < z0 + h; z++) { push(x0 - 1, z); push(x0 + w, z); }

    /* 优先用**门那一侧**的路（服务端建的时候就按门朝路吸附过），没有就退回任意临路格 */
    let door = null;
    const doorSide = sideCells ? sideCells(x0, z0, w, h, b.rotation || 0) : [];
    for (const [cx, cz] of doorSide) if (hasRoad(cx, cz)) { door = [cx, cz]; break; }
    if (!door && cells.length) door = cells[0];

    const [cw, cwz] = cellToWorld(x0 + (w - 1) / 2, z0 + (h - 1) / 2);
    let stand = null;
    if (door) {
      const [dx, dz] = cellToWorld(door[0], door[1]);
      /* 站位往楼那边挪半格：不然所有人都站在路中央，看起来像堵路 */
      const vx = cw - dx, vz = cwz - dz, len = Math.hypot(vx, vz) || 1;
      stand = [dx + vx / len * 0.42, dz + vz / len * 0.42];
    }
    return { id: b.id, type: b.type, kind: b.kind, tier: b.residentTier || null,
             gridX: x0, gridZ: z0, center: [cw, cwz], cells, door, stand,
             capacity: b.capacity || 0 };
  }

  /* ==========================================================
     4. 生 / 死（人数随人口涨落）
     ========================================================== */
  ensureCount(target) {
    const sig = target + '|' + this.sites.homes.map(h => h.id).join(',');
    if (sig === this._lastSig) return;
    this._lastSig = sig;
    /* 只有**门口有路**的住宅才能住人 —— 没路的房子居民出不了门，硬放人只会在墙里打转。
       加个计数上限是防死循环：万一 spawnOne 一直失败，这里必须能退出来。 */
    const ok = this.sites.homes.filter(h => h.door);
    let guard = (target - this.npcs.length) + 2;
    while (this.npcs.length < target && guard-- > 0) { if (!this.spawnOne(ok)) break; }
    /* 人口掉了：从后面往回收（先收回原来排在最后的，避免整体换脸） */
    while (this.npcs.length > target) this.despawnOne();
  }

  spawnOne(homes) {
    const idx = this.npcs.length;
    const seed = hash32(this.islandId || 1, idx * 2654435761);
    const rnd = makeRnd(seed);
    if (!homes || !homes.length) return null;

    /* 住在哪栋房子：按容量加权轮转，让小屋和大宅都住得满 */
    let home = null;
    {
      let acc = 0; const total = homes.reduce((s, h) => s + Math.max(1, h.capacity), 0);
      const r = rnd() * total;
      for (const h of homes) { acc += Math.max(1, h.capacity); if (r <= acc) { home = h; break; } }
      home = home || homes[idx % homes.length];
    }

    const arch = pickArchetype(rnd, home.tier, this.sites.markets.length > 0);
    const look = makeLook(seed, arch.key);
    const body = buildNpcBody(look);

    /* 气泡：出场率不高，也不是谁都爱说话 */
    const bubble = new THREE.Sprite(this.bubbleMat);
    bubble.scale.set(0.46, 0.35, 1);
    bubble.position.y = body.headTopY + 0.24;
    bubble.visible = false;
    body.upperGroup.add(bubble);

    const npc = {
      id: idx, seed, look, arch, body, bubble,
      home, work: null, shop: null, market: null,
      px: home.stand[0], pz: home.stand[1], yaw: 0, targetYaw: 0,
      state: 'SLEEP', goal: 'HOME', path: null, pathIdx: 0, dest: null, atCell: home.door,
      dwell: 0, chatWith: null, chatT: 0, chatCool: 0,
      phase: rnd() * TWO_PI, amp: 0, baseUpperY: body.upperGroup.position.y,
      jitter: (rnd() - 0.5) * 1.5,            // 作息偏移：所有人错开半小时，不会整点钟一起涌出门
      /* 车道偏移：固定靠一侧、贴着路的边线走（0.36~0.46，路半宽 0.5）。
         中间整条让给马车（车斗半宽 0.24 + 轮子），人车不再互相穿模；
         方向每人固定，同一条路上迎面走的两人自然各走一边。 */
      lane: (rnd() < 0.5 ? -1 : 1) * (0.36 + rnd() * 0.10),
      speed: look.speed * 1.0,
      tier: 'hidden', dist: 0, visible: false, crowdColor: null,
    };
    this.assignSites(npc);
    npc.crowdColor = new THREE.Color(look.clothes);
    npc.crowdSkin = new THREE.Color(look.skin);

    body.group.position.set(npc.px, this.deps.groundAt(npc.px, npc.pz), npc.pz);
    body.group.rotation.y = npc.yaw;
    body.group.visible = false;
    this.group.add(body.group);
    this.npcs.push(npc);
    return npc;
  }

  despawnOne() {
    const npc = this.npcs.pop();
    if (!npc) return;
    this.group.remove(npc.body.group);
    for (const g of npc.body.geos) g.dispose();
    npc.body.group.clear();
  }

  /** 给一个 NPC 配"常去的地方"：工作地（按原型的 workBias 就近选）、商店、市场 */
  assignSites(npc) {
    if (npc.home && !this.sites.homes.some(h => h.id === npc.home.id)) {
      /* 家被拆了：就近换一栋，没有就回家待着（会在 sync 里被回收） */
      npc.home = this.nearestSite(this.sites.homes, npc.px, npc.pz);
      npc.atCell = npc.home ? npc.home.door : npc.atCell;
    }
    const bias = npc.look.workBias;
    if (bias) {
      const types = bias === 'RAW' ? RAW_TYPES : bias === 'INDUSTRY' ? INDUSTRY_TYPES : null;
      const pool = types ? this.sites.works.filter(w => types.includes(w.type)) : this.sites.works;
      npc.work = this.nearestSite(pool.length ? pool : this.sites.works, npc.px, npc.pz);
    } else npc.work = null;
    npc.shop = this.nearestSite(this.sites.shops, npc.px, npc.pz);
    npc.market = this.nearestSite(this.sites.markets, npc.px, npc.pz);
    /* 目标可能失效：清掉已定下的目的，让它重新规划 */
    if (npc.dest && npc.dest.site && !this.siteAlive(npc.dest.site)) { npc.dest = null; if (npc.state === 'WALK') npc.state = 'PLAN'; }
  }

  siteAlive(site) {
    if (site.kind === 'RESIDENCE' || site.tier) return this.sites.homes.some(h => h.id === site.id);
    if (site.kind === 'HARBOR') return this.sites.markets.some(h => h.id === site.id);
    return this.sites.works.some(h => h.id === site.id)
        || this.sites.shops.some(h => h.id === site.id)
        || this.sites.markets.some(h => h.id === site.id);
  }

  nearestSite(list, px, pz) {
    let best = null, bestD = Infinity;
    for (const s of list) {
      if (!s.door) continue;
      const d = (s.center[0] - px) ** 2 + (s.center[1] - pz) ** 2;
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  clearAll() {
    for (const n of this.npcs) { this.group.remove(n.body.group); for (const g of n.body.geos) g.dispose(); n.body.group.clear(); }
    this.npcs = [];
    this.pathCache.clear();
    this._lastSig = '';
  }

  /* ==========================================================
     5. 日程：一条纯函数决定"此刻该去哪"
     ========================================================== */
  goalFor(npc) {
    const h = ((this.clock.hour + npc.jitter) % 24 + 24) % 24;
    switch (npc.look.schedule) {
      case 'CHILD':          // 孩子：睡到 7 点半，中午去面包房，傍晚回家
        if (h < 7.6 || h >= 18.4) return 'HOME';
        if (h >= 11.6 && h < 13.2) return 'SHOP';
        return (h > 15 && h < 15.8) ? 'MARKET' : 'LOITER';
      case 'ELDER':          // 老人：起得早、走得慢，白天在路边晒太阳、和人聊天
        if (h < 7.9 || h >= 19.2) return 'HOME';
        if (h >= 10.8 && h < 12.6) return 'SHOP';
        return (h > 14 && h < 16.4) ? 'MARKET' : 'LOITER';
      case 'MERCHANT':       // 商人：一整天泡在港口/市集
        if (h < 6.4 || h >= 21.6) return 'HOME';
        return h >= 7.4 ? 'MARKET' : 'WORK';
      default:               // 上班族：出门 → 干活 → 午饭 → 干活 → 买东西 → 聊天 → 回家
        if (h < 6.4 || h >= 21.8) return 'HOME';
        if (h < 7.2) return 'SHOP';
        if (h < 12.0) return 'WORK';
        if (h < 13.1) return 'SHOP';
        if (h < 17.9) return 'WORK';
        if (h < 19.4) return 'MARKET';
        return 'LOITER';
    }
  }

  /* ==========================================================
     6. 寻路：在马路格上做 BFS（不是 A*，因为路网太规整，A* 的启发式省不了多少）
     ========================================================== */
  findPath(from, to) {
    if (!from || !to) return [];
    const ka = this.deps.keyOf(from[0], from[1]);
    const kb = this.deps.keyOf(to[0], to[1]);
    if (ka === kb) return [from];
    const ck = ka < kb ? ka + '>' + kb : kb + '>' + ka;
    const hit = this.pathCache.get(ck);
    /* 缓存键是**方向无关**的（同一条路从哪头问都是同一串格子），所以命中时要按本次
       的起点判方向：BFS 的结果永远是从"当时那个起点"排到终点的。反着走还照原样用，
       第一个路点就是对面那一头 —— 人会朝目的地直线插过去、横穿整片空地，再沿路绕回来。
       反向命中返回一份倒序副本，不能就地 reverse（那会把缓存本身改坏）。 */
    if (hit !== undefined) return hit.from === ka ? hit.cells : hit.cells.slice().reverse();
    if (this._pathBudget <= 0) return null;          // 预算用完：返回 null = "还没算，下帧再来"
    this._pathBudget--;

    const { hasRoad, keyOf } = this.deps;
    const prev = new Map([[ka, null]]);
    const q = [from];
    let found = false;
    for (let i = 0; i < q.length && !found; i++) {
      const [x, z] = q[i];
      const k = keyOf(x, z);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, nk = keyOf(nx, nz);
        if (prev.has(nk) || !hasRoad(nx, nz)) continue;
        prev.set(nk, k);
        if (nk === kb) { found = true; break; }
        q.push([nx, nz]);
      }
    }
    let path = [];
    if (found) {
      const rev = [];
      let k = kb;
      while (k) { const [x, z] = k.split(',').map(Number); rev.push([x, z]); k = prev.get(k); }
      path = rev.reverse();
    }
    if (this.pathCache.size > 4096) this.pathCache.clear();
    this.pathCache.set(ck, { from: ka, cells: path });
    return path;
  }

  /* ==========================================================
     7. 每帧推进
     ========================================================== */
  update(dt, camera) {
    dt = Math.min(dt, 0.1);
    this._time += dt;
    this._frame++;
    this._pathBudget = NPC_CONFIG.pathBudget;

    /* 游戏时钟：整座岛共用，GUI 和 NPC 作息都读它 */
    this.clock.hour += dt / NPC_CONFIG.daySeconds * 24;
    while (this.clock.hour >= 24) { this.clock.hour -= 24; this.clock.day++; }

    for (const n of this.npcs) {
      if (n.chatCool > 0) n.chatCool -= dt;
      this.tick(n, dt);
    }

    const now = performance.now();
    if (now - this._chatAt >= NPC_CONFIG.chatScan * 1000) { this._chatAt = now; this.pairChatters(); }

    if (now - this._lodAt >= NPC_CONFIG.lodInterval * 1000) { this._lodAt = now; this.applyLod(camera); }

    this.animate(dt);
    if (now - this._crowdAt >= NPC_CONFIG.crowdInterval) { this._crowdAt = now; this.writeCrowd(); }
    this.writeGroupTransforms(dt);
  }

  tick(npc, dt) {
    switch (npc.state) {
      /* ---- 在家睡觉 ---- */
      case 'SLEEP': {
        if (this.goalFor(npc) === 'HOME') return;
        if (!npc.home || !npc.home.door) return;
        npc.px = npc.home.stand[0]; npc.pz = npc.home.stand[1];
        npc.atCell = npc.home.door;
        npc.path = null; npc.pathIdx = 0; npc.dest = null;
        npc.state = 'PLAN';                              // 出门
        return;
      }

      /* ---- 规划这一趟去哪（BFS 预算不够就下一帧接着算） ---- */
      case 'PLAN': {
        if (!npc.dest) this.decideDest(npc);
        if (!npc.dest || !npc.dest.cell) { this.sendHome(npc); return; }
        const path = this.findPath(npc.atCell, npc.dest.cell);
        if (path === null) return;                       // 排队等预算
        if (!path.length) {
          /* 到不了。注意这里**不能**写成 "npc.goal='HOME' 然后 return"：
             decideDest 下一帧会拿 goalFor() 把 goal 改回去，于是变成
             "想上班→走不通→回家→又想上班" 的无限循环。
             正确做法是直接把 dest 换成自己家门口 —— dest 一旦非空，
             下一帧就不会再调 decideDest，只会在 PLAN 里继续算这条回家的路。 */
          if (npc.goal === 'HOME' || !npc.home || !npc.home.door) { this.sendHome(npc); return; }
          npc.goal = 'HOME';
          npc.dest = { site: npc.home, cell: npc.home.door, stand: npc.home.stand };
          return;
        }
        npc.path = path; npc.pathIdx = 0;
        npc.state = 'WALK';
        return;
      }

      /* ---- 沿道路行走 ---- */
      case 'WALK': {
        if (!npc.path || npc.pathIdx >= npc.path.length) { this.arrive(npc); return; }
        const cell = npc.path[npc.pathIdx];
        const last = npc.pathIdx === npc.path.length - 1;
        /* 最后一格不偏道 —— 要准确站到门口那个站位上 */
        const [tx, tz] = last && npc.dest && npc.dest.stand
          ? npc.dest.stand
          : this.waypoint(npc, cell, npc.pathIdx);
        if (this.step(npc, tx, tz, dt)) {
          npc.atCell = cell;
          npc.pathIdx++;
          if (npc.pathIdx >= npc.path.length) this.arrive(npc);
        }
        return;
      }

      /* ---- 在目的地停留：上班 / 买东西 / 路边站着 ---- */
      case 'DWELL': {
        npc.dwell -= dt;
        const g = this.goalFor(npc);
        /* dwell 是"最少待多久"，防的是刚坐下就换目标导致人来回横跳。
           但**该回家了就不等**：下班了还因为"在岗时间没待够"赖在街上，
           玩家看到的就是"深夜街上还有人闲逛"。 */
        if (g !== npc.goal && (npc.dwell <= 0 || g === 'HOME')) {
          npc.goal = g; npc.dest = null; npc.path = null; npc.state = 'PLAN';
        }
        return;
      }

      /* ---- 和别人聊天 ---- */
      case 'CHAT': {
        npc.chatT -= dt;
        const o = npc.chatWith;
        if (o && this.npcs[o.id] === o) npc.targetYaw = Math.atan2(o.px - npc.px, o.pz - npc.pz);
        if (npc.chatT <= 0) this.endChat(npc);
        return;
      }

      /* ---- 走到家门口，进门（下一帧起不可见） ---- */
      case 'ENTER': {
        const st = npc.home ? npc.home.stand : null;
        if (!st || this.step(npc, st[0], st[1], dt)) this.sendHome(npc);
        return;
      }
    }
  }

  /** 定下这趟的目的地：普通站点用门口站位，闲逛用随机一处马路 */
  decideDest(npc) {
    npc.goal = this.goalFor(npc);
    npc.dest = null;
    if (npc.goal === 'HOME') {
      if (npc.home && npc.home.door) npc.dest = { site: npc.home, cell: npc.home.door, stand: npc.home.stand };
      return;
    }
    if (npc.goal === 'LOITER') {
      const cell = this.randomLeisureCell(npc);
      if (cell) npc.dest = { site: null, cell, stand: this.standSpot(cell, npc) };
      return;
    }
    const site = npc.goal === 'WORK' ? npc.work
               : npc.goal === 'SHOP' ? (npc.shop || npc.market)
               : (npc.market || npc.shop);
    if (!site || !site.door) {
      /* 岛上还没有这种建筑（比如没盖面包房），退化成路边闲逛 */
      npc.goal = 'LOITER';
      const cell = this.randomLeisureCell(npc);
      if (cell) npc.dest = { site: null, cell, stand: this.standSpot(cell, npc) };
      return;
    }
    npc.dest = { site, cell: site.door, stand: site.stand };
  }

  /**
   * 闲逛点：在离家不远的一段路里挑一格。
   * <p>
   * **关键的一条：人爱扎堆。** 纯随机撒点的话，十几二十个人撒在几十格马路上几乎碰不到面，
   * "路边闲逛"和"和人聊天"这两条就永远看不到。所以默认有 2/3 的概率**凑到附近已经在闲逛的人那儿去** ——
   * 既像真的（街口、广场就是这么聚起来的），也顺带把聊天配对的机会做出来了。
   */
  randomLeisureCell(npc) {
    const cells = this.roadCells;
    if (!cells.length) return npc.home && npc.home.door ? npc.home.door : null;

    if (Math.random() < 0.66) {
      let best = null, bestD = Infinity;
      for (const o of this.npcs) {
        if (o === npc || !o.atCell || o.state === 'SLEEP') continue;
        if (o.goal !== 'LOITER' || o.state !== 'DWELL') continue;
        const d = (o.px - npc.px) ** 2 + (o.pz - npc.pz) ** 2;
        if (d < bestD) { bestD = d; best = o.atCell; }
      }
      if (best) return best;
    }

    const hx = npc.home ? npc.home.gridX : 0, hz = npc.home ? npc.home.gridZ : 0;
    const near = [];
    for (const c of cells) {
      if (Math.abs(c[0] - hx) <= 9 && Math.abs(c[1] - hz) <= 9) near.push(c);
    }
    const pool = near.length ? near : cells;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** 同一格马路可能同时站着好几个人：先按邻格推断这条路往哪头走，
      再把每人沿垂直方向挪到自己固定的那一侧（和走路同一套 lane），别站在车道正中挨马车撞 */
  standSpot(cell, npc) {
    const { hasRoad } = this.deps;
    const [wx, wz] = this.deps.cellToWorld(cell[0], cell[1]);
    /* 路若沿 X 铺（左右邻是路），垂直方向就是 Z，反之亦然；两头都不通就随便 */
    const alongX = hasRoad(cell[0] - 1, cell[1]) || hasRoad(cell[0] + 1, cell[1]);
    const lane = npc.lane || 0.4;
    const jitter = ((npc.seed >>> 11) % 100) / 100 * 0.3 - 0.15;   // 同侧再错开一点，别排队
    return alongX ? [wx + jitter, wz + lane] : [wx + lane, wz + jitter];
  }

  arrive(npc) {
    if (npc.goal === 'HOME') { npc.state = 'ENTER'; return; }
    npc.state = 'DWELL';
    /* dwell 只是"最少待多久"（防在作息边界上刚到就走）。真正的"什么时候离开"
       由日程决定 —— 所以这几个数别调大：调大了就会出现"该下班了还赖在厂里"。
       时间都给得比"一个活动时段"短，于是人到了就安心待着，作息一变立刻动身。 */
    npc.dwell = npc.goal === 'WORK' ? 14
              : npc.goal === 'SHOP' ? 6
              : npc.goal === 'MARKET' ? 7 : 7;
    npc.atCell = npc.dest && npc.dest.cell ? npc.dest.cell : npc.atCell;
    /* 到了就面朝目的地（上班的朝着厂房、买东西的朝着店门） */
    const s = npc.dest && npc.dest.site;
    if (s) npc.targetYaw = Math.atan2(s.center[0] - npc.px, s.center[1] - npc.pz);
    npc.dest = null;
  }

  /**
   * 一步走向 (tx,tz)；到了返回 true。同时平滑转身。
   * <p>
   * 注意：**这里不管车道偏移**。偏移在调用方按"这一段路的方向"算好再传进来。
   * 曾经把偏移写在这里（按"人指向目标"的方向算垂线），结果是个死循环：
   * 目标点会随着人的位置一起转，人在离路点约一个偏移量的地方绕小圈，
   * 永远追不上 → 实测所有人卡在 pathIdx = 0 原地打转。教训：**目标点必须是死点**。
   */
  step(npc, tx, tz, dt) {
    const dx = tx - npc.px, dz = tz - npc.pz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) npc.targetYaw = Math.atan2(dx, dz);
    const sp = npc.speed * dt;
    if (d <= sp) { npc.px = tx; npc.pz = tz; return true; }
    npc.px += dx / d * sp;
    npc.pz += dz / d * sp;
    return false;
  }

  /**
   * 这一段的落脚点：格子中心 + 一条车道的横向偏移。
   * <p>
   * 偏移方向取**路段的走向**（上一格 → 这一格），不是"人 → 目标"：
   * 后者会让目标点跟着人转、人永远追不上（见 step 的注释）。
   * 有了它，同一条路上迎面走的两个人自然分成两股，不会叠成一条糖葫芦。
   */
  waypoint(npc, cell, pathIdx) {
    const [wx, wz] = this.deps.cellToWorld(cell[0], cell[1]);
    if (!npc.lane || pathIdx <= 0) return [wx, wz];
    const prev = npc.path[pathIdx - 1];
    const [ax, az] = this.deps.cellToWorld(prev[0], prev[1]);
    const l = Math.hypot(wx - ax, wz - az) || 1;
    const ux = (wx - ax) / l, uz = (wz - az) / l;
    /* 垂线 (-uz, ux) */
    return [wx - uz * npc.lane, wz + ux * npc.lane];
  }

  /* ---- 社交：附近站着的两个人，聊聊 ---- */
  /**
   * 配对规则：**同一格马路，或者紧挨着的一格**（隔 1.7 个世界单位，就是并肩站着聊天）。
   * <p>
   * 只认"同一格"是不够的：马路上站着的人被站位偏移岔开一点，就可能落到隔壁格，
   * 于是明明肩并肩却一辈子聊不上。所以这里把右邻 / 下邻两格的名单并进来一起配，
   * 只往一个方向并，保证同一对人不会被处理两次。
   */
  pairChatters() {
    const buckets = new Map();
    for (const n of this.npcs) {
      if (n.state !== 'DWELL' || n.goal !== 'LOITER' || n.chatCool > 0 || n.chatWith) continue;
      if (!n.atCell) continue;
      const k = n.atCell[0] + ',' + n.atCell[1];
      let b = buckets.get(k);
      if (!b) { b = []; buckets.set(k, b); }
      b.push(n);
    }
    for (const [k, list] of buckets) {
      const [bx, bz] = k.split(',').map(Number);
      const group = list.slice();
      for (const nk of [(bx + 1) + ',' + bz, bx + ',' + (bz + 1)]) {
        const l = buckets.get(nk);
        if (l) group.push(...l);
      }
      for (let i = 0; i + 1 < group.length; i += 2) {
        const a = group[i], b = group[i + 1];
        if (a.chatWith || b.chatWith || a === b) continue;
        this.startChat(a, b);
      }
    }
  }

  startChat(a, b) {
    const t = 3 + Math.random() * 3.5;
    a.chatWith = b; b.chatWith = a;
    a.chatT = t; b.chatT = t;
    a.state = 'CHAT'; b.state = 'CHAT';
  }

  endChat(npc) {
    const o = npc.chatWith;
    npc.chatWith = null;
    npc.state = 'DWELL'; npc.dwell = 3 + Math.random() * 4; npc.chatCool = 18 + Math.random() * 25;
    if (o) {
      if (o.chatWith === npc) o.chatWith = null;
      if (o.state === 'CHAT') { o.state = 'DWELL'; o.dwell = 3 + Math.random() * 4; o.chatCool = npc.chatCool; }
    }
  }

  /** 回家并隐身（进门 / 兜底收工都走这里） */
  sendHome(npc) {
    if (npc.chatWith) this.endChat(npc);
    npc.state = 'SLEEP'; npc.goal = 'HOME';
    npc.dest = null; npc.path = null; npc.pathIdx = 0;
    if (npc.home && npc.home.stand) {
      npc.px = npc.home.stand[0]; npc.pz = npc.home.stand[1];
      npc.atCell = npc.home.door;
    }
    npc.body.group.visible = false;
    npc.visible = false;
  }

  /* ==========================================================
     8. 动画：走路摆臂摆腿 / 站着轻微呼吸 / 上班挥手 / 聊天比划
     ========================================================== */
  animate(dt) {
    for (const n of this.npcs) {
      if (!n.visible) continue;
      const walking = n.state === 'WALK' || n.state === 'ENTER';
      /* 幅度用阻尼过渡：起步不是"唰"一下摆到最大，站住也不是"啪"一下定住 */
      const want = walking ? Math.min(0.62, n.speed / 1.15 * 0.5) : 0;
      n.amp += (want - n.amp) * Math.min(1, dt * 6);
      n.phase += dt * (walking ? n.speed * 8.4 : 1.6);

      const body = n.body;
      if (n.tier === 'detail' && n.dist < NPC_CONFIG.lodFar) {
        const sw = Math.sin(n.phase) * n.amp;
        body.legL.rotation.x = sw;
        body.legR.rotation.x = -sw;
        if (n.state === 'CHAT') {
          /* 聊天：一只手来回比划，身体跟着晃 */
          const g = Math.sin(this._time * 5.2 + n.phase) * 0.55;
          body.armL.rotation.x = -0.35 - Math.abs(g) * 0.5;
          body.armR.rotation.x = 0.18 + g * 0.22;
          body.upperGroup.rotation.y = Math.sin(this._time * 3.1 + n.seed) * 0.10;
        } else if (n.state === 'DWELL' && n.goal === 'WORK') {
          /* 上班：两只手小幅上下，像在干活 */
          const g = Math.sin(this._time * 3.4 + n.phase);
          body.armL.rotation.x = -0.42 + g * 0.34;
          body.armR.rotation.x = -0.42 - g * 0.34;
          body.upperGroup.rotation.y = 0;
        } else {
          body.armL.rotation.x = -sw * 0.85;
          body.armR.rotation.x = sw * 0.85;
          body.upperGroup.rotation.y = 0;
        }
        /* 起伏：走一步颠一下；站着则是很轻的呼吸 */
        const bob = walking ? Math.abs(Math.sin(n.phase)) * 0.032 : Math.sin(this._time * 1.9 + n.phase) * 0.008;
        body.upperGroup.position.y = n.baseUpperY + bob;
        body.upperGroup.rotation.z = 0;
      } else {
        /* 中远距离：不做四肢动画，但身体仍要有个"在走"的感觉 */
        body.upperGroup.position.y = n.baseUpperY + Math.abs(Math.sin(n.phase)) * 0.012;
      }
    }
  }

  /* ==========================================================
     9. LOD 分档：谁是"完整动画"，谁是"人群中一个剪影"
     ========================================================== */
  applyLod(camera) {
    const cam = camera.position;
    const live = [];
    for (const n of this.npcs) {
      if (n.state === 'SLEEP') { n.tier = 'hidden'; n.dist = Infinity; n.visible = false; continue; }
      n.dist = Math.hypot(n.px - cam.x, n.pz - cam.z);
      n.visible = n.dist < NPC_CONFIG.cullDist;
      live.push(n);
    }
    /* 按离镜头的远近挑"完整动画"的名额 */
    live.sort((a, b) => a.dist - b.dist);
    const max = NPC_CONFIG.detailMax;
    this._crowdList = [];
    for (let i = 0; i < live.length; i++) {
      const n = live[i];
      if (!n.visible) { n.tier = 'hidden'; continue; }
      if (i < max) {
        n.tier = 'detail';
        const dist = n.dist;
        /* 中距离收起手臂、更远只留躯干：省的是 draw call，不是逻辑 */
        const showArms = dist < NPC_CONFIG.lodMid;
        const showLegs = dist < NPC_CONFIG.lodFar;
        n.body.armL.visible = showArms;
        n.body.armR.visible = showArms;
        n.body.legL.visible = showLegs;
        n.body.legR.visible = showLegs;
        n.body.upperMesh.visible = true;
        n.bubble.visible = n.state === 'CHAT';
      } else {
        n.tier = this._crowdList.length < NPC_CONFIG.crowdMax ? 'crowd' : 'hidden';
        if (n.tier === 'crowd') this._crowdList.push(n);
      }
    }
  }

  /** 把人群层写进 InstancedMesh —— 几百个人只花 2 个 draw call */
  writeCrowd() {
    const list = this._crowdList || [];
    const d = this._dummy;
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      d.position.set(n.px, this.deps.groundAt(n.px, n.pz), n.pz);
      d.rotation.set(0, n.yaw, 0);
      d.scale.setScalar(n.look.height);
      d.updateMatrix();
      this.crowdBody.setMatrixAt(i, d.matrix);
      this.crowdHead.setMatrixAt(i, d.matrix);
      this.crowdBody.setColorAt(i, n.crowdColor);
      this.crowdHead.setColorAt(i, n.crowdSkin);
    }
    this.crowdBody.count = list.length;
    this.crowdHead.count = list.length;
    this.crowdBody.instanceMatrix.needsUpdate = true;
    this.crowdHead.instanceMatrix.needsUpdate = true;
    if (this.crowdBody.instanceColor) this.crowdBody.instanceColor.needsUpdate = true;
    if (this.crowdHead.instanceColor) this.crowdHead.instanceColor.needsUpdate = true;
  }

  /** 把逻辑位置写进 3D 节点（只有 detail 档需要） */
  writeGroupTransforms(dt) {
    const maxTurn = NPC_CONFIG.turnRate * dt;
    for (const n of this.npcs) {
      const g = n.body.group;
      if (n.tier !== 'detail') {
        if (g.visible) g.visible = false;
        continue;
      }
      g.visible = true;
      /* 转身限速：不会瞬间扭头，看起来像人而不是指针。要把角度差折到 [-π, π]，
         否则从 350° 转到 10° 会绕远路转一大圈。 */
      const diff = ((n.targetYaw - n.yaw + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
      n.yaw += clamp(diff, -maxTurn, maxTurn);
      /* 台地上相邻格有 ±0.12 的台阶：直接赋值每过一格"咯噔"一下，按帧平滑追过去像迈坎 */
      const gy = this.deps.groundAt(n.px, n.pz);
      n.sy = n.sy === undefined ? gy : n.sy + (gy - n.sy) * Math.min(1, dt * 9);
      g.position.set(n.px, n.sy, n.pz);
      g.rotation.y = n.yaw;
    }
  }

  /* ==========================================================
     10. HUD 用：一眼看清"街上这些人都在干嘛"
     ========================================================== */
  get stats() {
    const s = this._stats;
    s.total = this.npcs.length;
    s.detail = s.crowd = s.hidden = s.sleeping = s.walking = s.atWork = s.chatting = 0;
    for (const k of Object.keys(s.byArch)) delete s.byArch[k];
    for (const k of Object.keys(s.byState)) delete s.byState[k];
    for (const n of this.npcs) {
      s.byArch[n.arch.label] = (s.byArch[n.arch.label] || 0) + 1;
      s.byState[n.state] = (s.byState[n.state] || 0) + 1;
      if (n.tier === 'detail') s.detail++; else if (n.tier === 'crowd') s.crowd++; else s.hidden++;
      if (n.state === 'SLEEP') s.sleeping++;
      else if (n.state === 'WALK') s.walking++;
      else if (n.state === 'CHAT') s.chatting++;
      else if (n.state === 'DWELL' && n.goal === 'WORK') s.atWork++;
    }
    s.day = this.clock.day;
    s.hour = this.clock.hour;
    s.residents = this.forceCount != null ? null : this.npcs.length;
    s.forced = this.forceCount;
    return s;
  }

  /** "第 3 天 08:20" */
  get clockText() {
    const h = Math.floor(this.clock.hour), m = Math.floor((this.clock.hour - h) * 60);
    return `第 ${this.clock.day} 天 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  /**
   * 服务端下发的游戏时刻（岛屿模拟时钟推导，见服务端 IslandEntity#gameHourAt）。
   * <p>
   * 进游戏（换岛）时对一次表：不再"永远早上 7 点开局"，而是从这座岛上次被模拟到的
   * 时刻续走 —— 离线期间岛上时间与作物、商船一起停摆，回来接着走。
   * <p>
   * 【为什么之后不再随快照回拨】本地推进速率与服务端同为 daySeconds 真实秒/日，
   * 稳态偏差≈0；而且"跳到早晨"按钮和测试里强制时刻若被 3 秒一份的快照冲掉就没法用了。
   * 跨 24 点取最短方向，避免整圈倒拨。
   */
  setServerClock(hour, daySeconds) {
    if (Number.isFinite(daySeconds) && daySeconds >= 30) NPC_CONFIG.daySeconds = daySeconds;
    if (!Number.isFinite(hour)) return;
    const target = ((hour % 24) + 24) % 24;
    const cur = ((this.clock.hour % 24) + 24) % 24;
    let d = target - cur;
    if (d > 12) d -= 24; else if (d < -12) d += 24;
    this.clock.hour += d;
    if (this.clock.hour < 0) { this.clock.hour += 24; this.clock.day--; }
    while (this.clock.hour >= 24) { this.clock.hour -= 24; this.clock.day++; }
  }

  /** 昼夜：给场景用的光照系数（0 = 正午，1 = 深夜）。game.html 拿它调阳光与雾色 */
  get nightFactor() {
    const h = this.clock.hour;
    if (h >= 7.5 && h <= 17.5) return 0;                       // 白天
    if (h > 17.5 && h < 20.5) return (h - 17.5) / 3;           // 黄昏渐暗
    if (h >= 20.5 || h < 5.0) return 1;                        // 深夜
    return 1 - (h - 5.0) / 2.5;                                // 黎明渐亮
  }

  dispose() {
    this.clearAll();
    this.crowdBody.geometry.dispose();
    this.crowdHead.geometry.dispose();
    this.group.clear();
  }
}

/* ============================================================
   11. 小工具
   ============================================================ */
function hash32(a, b) {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (b | 0), 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** 按住宅阶层挑原型（商人只在有港口/市场时才出现 —— 没生意可做就没有商人上街） */
function pickArchetype(rnd, tier, hasMarket) {
  const pool = TIER_POOL[tier] || TIER_POOL.FARMER;
  const entries = Object.entries(pool).filter(([k]) => hasMarket || !k.startsWith('MERCHANT'));
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rnd() * total;
  for (const [k, w] of entries) { r -= w; if (r <= 0) return ARCHETYPE_MAP[k] || ARCHETYPES[0]; }
  return ARCHETYPES[0];
}
