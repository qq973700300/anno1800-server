/**
 * NPC 花名册与外观生成器 —— 「街上的人」长什么样，全在这一个文件里。
 *
 * 【为什么不是一个模型一套资产】
 * 想让街道有意思，靠的不是单个 NPC 有多精细，而是**种类多**。所以这里走的两条路：
 *   ① 花名册：14 种原型（男/女各 6 种 + 男孩/女孩），每种都有自己的体型、配色池、
 *      行为倾向与步速 —— 商人圆胖、工人宽肩、老人驼背、儿童矮小头大。
 *   ② 换装：**同一副低模骨架**，按 6 个变化轴随机组合：
 *      帽子 / 衣服颜色 / 发型 / 配饰 / 身高 / 肤色。
 *      14 原型 × 各轴配色池 ≈ 上千种不重样的路人，但只用了 `buildNpcBody` 一份建模代码。
 *
 * 【性能约定（很重要，别破坏）】
 *   - 所有身体部件都是**顶点着色**（vertexColors），于是全场 NPC 共用**同一个材质对象**
 *     `NPC_MAT`。几十上百个 NPC 也不会把材质数量顶上去。
 *   - 每个 NPC 只产 5 个网格：上身（合并网格，含头/发/帽/配饰）+ 双臂 + 双腿。
 *     四肢必须独立，不然走路没有摆臂摆腿；上半身合并不影响动画（它整体做起伏）。
 *   - 几何体是每 NPC 一份的（因为比例和配色都不同），但每个只有几百个顶点，
 *     `dispose()` 由调用方在回收 NPC 时负责。
 *
 * 【坐标系约定】
 *   原点在**脚底**，+Y 朝上，**+Z 是正面**（鼻子、围裙、门都朝 +Z）。
 *   身高以 world unit 计：成年人约 0.95~1.05，儿童约 0.58~0.66。
 *   参照物：一格 CELL = 1.7，马路总宽 1.02 —— 一个成年人站在路上约占路宽的 1/3，
 *   这个比例是照着现有厂房高度（2×2 厂房约 1.94 高）调的，改身高前先看一眼房子。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ============================================================
   0. 共用材质与工具
   ============================================================ */

/** 全场唯一的人体材质：颜色全靠顶点色，所以一个材质就够所有人用 */
export const NPC_MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: .88, metalness: 0, flatShading: true,
});

/** 给几何体刷一层顶点色（three.js 的 Color 会把 sRGB 十六进制转成线性，和材质色同一套口径） */
export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** mulberry32：小而稳的确定性伪随机。同一个种子永远给出同一串数（同一个路人永远长一个样） */
export function makeRnd(seed) {
  let a = (seed >>> 0) || 1;
  return function rnd() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const between = (rnd, lo, hi) => lo + rnd() * (hi - lo);

/* ============================================================
   1. 配色池与零件池
   ============================================================ */

/** 肤色：从北欧白到南欧棕，6 档足够看出"码头上有各国水手" */
export const SKIN_POOL = [0xf6dcc2, 0xefcba6, 0xdfae82, 0xc8925f, 0xa4713f, 0x7a5334];

const HAIR_COLOR = [0x2a1c12, 0x3d2717, 0x5a3821, 0x7a5230, 0xa8803f, 0x8c8c8c, 0xd8d3c8];

/** 衣料主色：亚麻 / 靛蓝 / 橄榄 / 赭石 / 酒红 / 烟灰 —— 刻意压暗，别抢了建筑的色 */
const CLOTH = [0x9c5a3c, 0x4e6b8a, 0x6d7a45, 0x8a6a45, 0x7d3f3f, 0x5d5f66,
               0xa8865c, 0x46655e, 0x8f7a9c, 0xb4764f];
const CLOTH_DARK = [0x4a3b2c, 0x36485c, 0x454f2c, 0x54402c, 0x512c2c, 0x3b3d42];
const ACCENT = [0xe8dcc0, 0xcfc0a0, 0xb9c4cc, 0xd9b98a, 0x9fb0a0, 0xc9a2a2];

const HAT = ['NONE', 'STRAW', 'CAP', 'BOWLER', 'TOPHAT', 'KERCHIEF', 'WORKCAP', 'BONNET'];
const HAT_COLOR = {
  STRAW:   [0xd8c47e, 0xc9b06a, 0xe2d29a],
  CAP:     [0x3f5570, 0x5b4636, 0x4a5a45],
  BOWLER:  [0x33302e, 0x4a4038, 0x5d5145],
  TOPHAT:  [0x24222a, 0x33291f],
  KERCHIEF:[0xc2604f, 0x4e6b8a, 0xa8865c, 0x6d7a45],
  WORKCAP: [0x3a4a5c, 0x4d4438],
  BONNET:  [0xe8dcc0, 0xd6c3a6, 0xc7d2dc],
};
const HAIR = ['SHORT', 'LONG', 'BUN', 'BRAID', 'CURLY', 'CROP', 'BALD'];
const ACCESSORY = ['NONE', 'NONE', 'APRON', 'BASKET', 'BAG', 'CANE', 'GLASSES', 'SCARF', 'PIPE', 'BROOM'];

/* ============================================================
   2. 14 种原型
   ------------------------------------------------------------
   每个原型的字段含义：
     body.shoulder/head/leg  体型倍率（1 = 成年男性标准）
     body.hunch              驼背角（弧度，只对老人/苦力有用）
     body.girth              肚子（商人）——躯干厚度倍率
     body.skirt              穿裙子/长下摆（不画两条裤腿的胯块）
     hats/hair/accessory     该原型可用的零件池（不是所有人都戴礼帽）
     speed                   步速区间（world unit / 秒）：老人慢、青年快
     schedule                日程模板（决定几点出门、去哪，见 npc.js 的 goalFor）
     workBias                去哪类厂房上班（用来和工作建筑配对）
   ============================================================ */
export const ARCHETYPES = [
  /* ---------- 男性 6 种 ---------- */
  {
    key:'VILLAGER_M', label:'男村民', sex:'M', weight:10,
    body:{ shoulder:1.00, head:1.00, leg:1.00, hunch:0.02, girth:1.00, skirt:false },
    hats:['NONE','NONE','STRAW','CAP','WORKCAP'], hair:['SHORT','CROP','CURLY','BALD'],
    accessory:['NONE','NONE','NONE','BAG','SCARF'],
    speed:[0.95, 1.25], schedule:'WORKER', workBias:'RAW',
  },
  {
    key:'WORKER_M', label:'男工人', sex:'M', weight:11,
    body:{ shoulder:1.16, head:0.98, leg:1.00, hunch:0.07, girth:1.05, skirt:false },
    hats:['WORKCAP','WORKCAP','CAP','NONE'], hair:['CROP','SHORT','BALD'],
    accessory:['NONE','APRON','NONE','BROOM','PIPE'],
    speed:[0.92, 1.18], schedule:'WORKER', workBias:'INDUSTRY',
  },
  {
    key:'FARMER_M', label:'男农民', sex:'M', weight:10,
    body:{ shoulder:1.08, head:1.00, leg:0.98, hunch:0.05, girth:1.00, skirt:false },
    hats:['STRAW','STRAW','NONE','CAP'], hair:['SHORT','CROP','CURLY'],
    accessory:['NONE','NONE','BASKET','BROOM','APRON'],
    speed:[0.88, 1.10], schedule:'WORKER', workBias:'RAW',
  },
  {
    key:'MERCHANT_M', label:'男商人', sex:'M', weight:4,
    body:{ shoulder:1.04, head:1.00, leg:0.96, hunch:0.0, girth:1.34, skirt:false },
    hats:['TOPHAT','BOWLER','BOWLER'], hair:['SHORT','BALD'],
    accessory:['NONE','GLASSES','PIPE','CANE'], cloth:[0x6d2f2f, 0x2f3d52, 0x3f4a3a, 0x4a3a5a],
    speed:[0.82, 1.00], schedule:'MERCHANT', workBias:'TRADE',
  },
  {
    key:'ELDER_M', label:'男老人', sex:'M', weight:5,
    body:{ shoulder:0.96, head:1.00, leg:0.96, hunch:0.22, girth:1.06, skirt:false },
    hats:['NONE','BOWLER','CAP','NONE'], hair:['BALD','SHORT','CROP'], hairColor:[0x8c8c8c, 0xd8d3c8, 0xb9b4a8],
    accessory:['CANE','CANE','NONE','GLASSES','PIPE'],
    speed:[0.50, 0.72], schedule:'ELDER', workBias:null,
  },
  {
    key:'YOUTH_M', label:'男青年', sex:'M', weight:8,
    body:{ shoulder:0.92, head:1.02, leg:1.04, hunch:0.0, girth:0.94, skirt:false },
    hats:['CAP','NONE','NONE','STRAW'], hair:['SHORT','CURLY','CROP','LONG'],
    accessory:['NONE','NONE','NONE','BAG'],
    speed:[1.15, 1.50], schedule:'WORKER', workBias:'INDUSTRY',
  },

  /* ---------- 女性 6 种 ---------- */
  {
    key:'VILLAGER_F', label:'女村民', sex:'F', weight:10,
    body:{ shoulder:0.88, head:1.00, leg:1.00, hunch:0.02, girth:1.00, skirt:true },
    hats:['NONE','NONE','KERCHIEF','BONNET','STRAW'], hair:['LONG','BUN','BRAID','SHORT'],
    accessory:['NONE','NONE','NONE','BASKET','SCARF'],
    speed:[0.92, 1.20], schedule:'WORKER', workBias:'RAW',
  },
  {
    key:'WORKER_F', label:'女工人', sex:'F', weight:11,
    body:{ shoulder:0.94, head:1.00, leg:1.00, hunch:0.05, girth:1.02, skirt:true },
    hats:['KERCHIEF','KERCHIEF','BONNET','NONE'], hair:['BUN','BRAID','SHORT'],
    accessory:['APRON','APRON','NONE','BASKET'],
    speed:[0.90, 1.16], schedule:'WORKER', workBias:'INDUSTRY',
  },
  {
    key:'FARMER_F', label:'女农民', sex:'F', weight:10,
    body:{ shoulder:0.90, head:1.00, leg:0.98, hunch:0.04, girth:1.00, skirt:true },
    hats:['STRAW','KERCHIEF','STRAW','NONE'], hair:['BRAID','BUN','LONG'],
    accessory:['NONE','BASKET','APRON','NONE'],
    speed:[0.86, 1.08], schedule:'WORKER', workBias:'RAW',
  },
  {
    key:'MERCHANT_F', label:'女商人', sex:'F', weight:4,
    body:{ shoulder:0.90, head:1.00, leg:0.96, hunch:0.0, girth:1.22, skirt:true },
    hats:['BONNET','BOWLER','NONE'], hair:['BUN','LONG'],
    accessory:['NONE','GLASSES','BASKET'], cloth:[0x7d4a5c, 0x35506b, 0x4a4a6a, 0x6a5a3a],
    speed:[0.80, 0.98], schedule:'MERCHANT', workBias:'TRADE',
  },
  {
    key:'ELDER_F', label:'女老人', sex:'F', weight:5,
    body:{ shoulder:0.86, head:1.00, leg:0.94, hunch:0.24, girth:1.06, skirt:true },
    hats:['BONNET','KERCHIEF','NONE'], hair:['BUN','SHORT','BRAID'], hairColor:[0x8c8c8c, 0xd8d3c8, 0xb9b4a8],
    accessory:['CANE','CANE','NONE','GLASSES','BASKET','SCARF'],
    speed:[0.46, 0.68], schedule:'ELDER', workBias:null,
  },
  {
    key:'YOUTH_F', label:'女青年', sex:'F', weight:8,
    body:{ shoulder:0.84, head:1.02, leg:1.04, hunch:0.0, girth:0.94, skirt:true },
    hats:['NONE','NONE','BONNET','STRAW'], hair:['LONG','BRAID','BUN','CURLY'],
    accessory:['NONE','NONE','BASKET','NONE'],
    speed:[1.12, 1.46], schedule:'WORKER', workBias:'INDUSTRY',
  },

  /* ---------- 儿童 2 种 ---------- */
  {
    key:'BOY', label:'男孩', sex:'C', weight:7,
    body:{ shoulder:0.80, head:1.30, leg:0.90, hunch:0.0, girth:0.96, skirt:false },
    hats:['CAP','NONE','NONE'], hair:['CROP','SHORT','CURLY'],
    accessory:['NONE','NONE','NONE','TOY','TOY'],
    speed:[1.00, 1.40], schedule:'CHILD', workBias:null,
  },
  {
    key:'GIRL', label:'女孩', sex:'C', weight:7,
    body:{ shoulder:0.78, head:1.30, leg:0.90, hunch:0.0, girth:0.96, skirt:true },
    hats:['NONE','NONE','BONNET','KERCHIEF'], hair:['LONG','BRAID','BUN','CURLY'],
    accessory:['NONE','NONE','BASKET','TOY'],
    speed:[0.98, 1.36], schedule:'CHILD', workBias:null,
  },
];

export const ARCHETYPE_MAP = Object.fromEntries(ARCHETYPES.map(a => [a.key, a]));

/* ============================================================
   3. 换装：6 个变化轴一次性抽完
   ============================================================ */

/**
 * 抽一个"路人长相"。同一个 seed 永远得到同一套穿搭（刷新页面不会换脸）。
 * <p>
 * 6 个变化轴：帽子 / 衣服颜色 / 发型 / 配饰 / 身高 / 肤色。
 * 另外顺手抽了裤色、领口撞色、鞋色 —— 这几样不占"轴"，但能让同款衣服看起来不一样。
 */
export function makeLook(seed, archKey) {
  const arch = ARCHETYPE_MAP[archKey] || ARCHETYPES[0];
  const rnd = makeRnd(seed);

  const child = arch.sex === 'C';
  const base = child ? between(rnd, 0.58, 0.66) : between(rnd, 0.93, 1.05);

  const clothPool = arch.cloth || CLOTH;
  const clothes = pick(rnd, clothPool);
  /* 女性穿裙时腿是露在外面的，裤色只用来画那不存在的"裤腿"，随便给一个深色就行 */
  const pantsPool = arch.sex === 'M' || child ? CLOTH_DARK : CLOTH_DARK;
  const hairPool = arch.hairColor || HAIR_COLOR;
  /* 帽子要先抽出来，颜色得从**这顶帽子自己的**配色池里取（否则会出现粉色礼帽） */
  const hat = pick(rnd, arch.hats);

  return {
    seed, arch: arch.key, archLabel: arch.label, sex: arch.sex,

    /* ① 身高（整体缩放）。乘 0.85：路上还要跑马车（车斗半宽 0.28），
       人缩小一档才好让到路边走 —— 人群层 InstancedMesh 也读这个值，两边自动一致 */
    height: base * 0.85,
    /* ② 体型（原型决定，带一点个体抖动） */
    shoulderMul: arch.body.shoulder * between(rnd, 0.94, 1.07),
    headScale:   arch.body.head * between(rnd, 0.95, 1.06),
    legLen:      arch.body.leg * between(rnd, 0.95, 1.06),
    hunch:       arch.body.hunch * between(rnd, 0.7, 1.3),
    girth:       arch.body.girth * between(rnd, 0.92, 1.10),
    skirt:       arch.body.skirt && rnd() < 0.88,

    /* ③ 肤色 */
    skin: pick(rnd, SKIN_POOL),
    /* ④ 衣服颜色（主色 + 撞色领口 + 裤色 + 鞋色） */
    clothes,
    pants:   pick(rnd, pantsPool),
    accent:  pick(rnd, ACCENT),
    shoe:    pick(rnd, [0x2f2a24, 0x3d3128, 0x24211d]),
    /* ⑤ 发型 + 发色 */
    hair:      pick(rnd, arch.hair),
    hairColor: pick(rnd, hairPool),
    /* ⑥ 帽子 + 配饰 */
    hat,
    hatColor:   pick(rnd, HAT_COLOR[hat] || [0x555555]),
    accessory:  pick(rnd, arch.accessory),

    speed: between(rnd, arch.speed[0], arch.speed[1]),
    schedule: arch.schedule,
    workBias: arch.workBias,
  };
}

/* ============================================================
   4. 建模：把 look 拼成一副能动的人形
   ------------------------------------------------------------
   返回 { group, upperMesh, armL, armR, legL, legR, geos, eyeY }：
     group      —— 根节点，原点在脚底（调用方只改它的 position / rotation.y）
     upperMesh  —— 合并后的上半身（在一个 upperGroup 里，可整体做起伏/前倾）
     armL/armR  —— 左右臂，**几何原点在肩关节**，绕 rotation.x 摆动就是摆臂
     legL/legR  —— 左右腿，**几何原点在髋关节**，绕 rotation.x 摆动就是迈步
     geos       —— 本 NPC 私有、回收时要 dispose 的几何体
     look       —— 原样带回，方便 HUD 统计
   ============================================================ */
export function buildNpcBody(look) {
  const H = look.height;
  /* 竖直分层：腿 36% / 躯干 38% / 脖子 4% / 头 22%，加起来正好 1.0 */
  const legH   = H * 0.36 * look.legLen;
  const torsoH = H * 0.38;
  const headH  = H * 0.22;
  const neckH  = H * 0.04;

  const shoulder = H * 0.27 * look.shoulderMul;      // 躯干宽
  const depth    = shoulder * 0.60 * look.girth;     // 躯干厚
  const headW    = H * 0.150 * look.headScale;
  const headD    = H * 0.145 * look.headScale;
  const armW     = H * 0.060 * (0.9 + look.shoulderMul * 0.15);
  const armLen   = H * 0.34;
  const legW     = H * 0.078 * (look.sex === 'C' ? 0.9 : 1);

  const hipY   = legH;
  const chestY = legH + torsoH * 0.54;               // 躯干块中心
  const neckY  = legH + torsoH + neckH * 0.1;
  const headCY = legH + torsoH + neckH + headH / 2;  // 头块中心

  const geos = [];
  const upper = [];          // 待合并进上半身的零件
  const add = (geo) => { upper.push(geo); return geo; };

  /* ---------- 下半身：胯 / 裙摆（并入上半身，让腰能一起扭） ---------- */
  if (look.skirt) {
    /* 四棱台裙摆：CylinderGeometry 取 4 个径向段再转 45°，正好是"上窄下宽的方裙"，
       和厂房屋顶用 ConeGeometry(...,4) 转 45° 是同一个把戏。 */
    const sg = new THREE.CylinderGeometry(shoulder * 0.50, shoulder * 0.92, torsoH * 0.52, 4);
    sg.rotateY(Math.PI / 4);
    sg.translate(0, hipY - torsoH * 0.06 + torsoH * 0.26, 0);
    add(tint(sg, look.clothes));
  } else {
    const pg = new THREE.BoxGeometry(shoulder * 0.94, torsoH * 0.26, depth * 0.98);
    pg.translate(0, hipY + torsoH * 0.10, 0);
    add(tint(pg, look.pants));
  }

  /* ---------- 躯干 ---------- */
  const tg = new THREE.BoxGeometry(shoulder, torsoH * 0.80, depth);
  tg.translate(0, chestY, 0);
  add(tint(tg, look.clothes));

  /* 领口 / 肩章：撞色一条，衣服立刻不像"一整块色块" */
  const cg = new THREE.BoxGeometry(shoulder * 1.05, torsoH * 0.13, depth * 1.04);
  cg.translate(0, legH + torsoH * 0.90, 0);
  add(tint(cg, look.accent));

  /* ---------- 脖子 + 头 ---------- */
  const ng = new THREE.BoxGeometry(H * 0.065, neckH * 1.6, H * 0.065);
  ng.translate(0, neckY + neckH * 0.3, 0);
  add(tint(ng, look.skin));

  const hg = new THREE.BoxGeometry(headW, headH, headD);
  hg.translate(0, headCY, 0);
  add(tint(hg, look.skin));

  /* 鼻子朝 +Z：低模人形没有它就像根柱子，有了立刻有正反面 */
  const nose = new THREE.BoxGeometry(headW * 0.20, headH * 0.24, headD * 0.16);
  nose.translate(0, headCY - headH * 0.04, headD * 0.52);
  add(tint(nose, look.skin));

  /* 眼睛：两颗深色小方块，间隔着鼻子两侧 */
  for (const sx of [-1, 1]) {
    const eg = new THREE.BoxGeometry(headW * 0.17, headH * 0.13, headD * 0.06);
    eg.translate(sx * headW * 0.23, headCY + headH * 0.10, headD * 0.50);
    add(tint(eg, 0x2b2b33));
  }

  addHair(add, look, { headW, headD, headH, headCY });
  addHat(add, look, { headW, headD, headH, headCY, H });
  addAccessory(add, look, { H, torsoH, depth, shoulder, hipY, chestY, headCY, headH, headW, headD, armLen, armW });

  /* ---------- 把所有零件合并成一个网格 ---------- */
  const upperGeo = mergeGeometries(upper, false);
  for (const g of upper) g.dispose();               // 合并完原始零件就没用了
  geos.push(upperGeo);
  const upperMesh = new THREE.Mesh(upperGeo, NPC_MAT);

  /* 驼背：绕**髋部**前倾（不是绕脚底，不然人是"整体歪"而不是"弯着腰"）。
     先平移到髋、转、再移回去。 */
  const upperGroup = new THREE.Group();
  upperGroup.add(upperMesh);
  if (look.hunch > 0.001) {
    upperGroup.position.set(0, hipY, 0);
    upperGroup.rotation.x = look.hunch;
    upperMesh.position.set(0, -hipY, 0);
  }

  /* ---------- 四肢：几何原点挪到关节上，直接转 rotation.x 就是摆臂/迈步 ---------- */
  const mkLimb = (w, len, hex) => {
    const g = new THREE.BoxGeometry(w, len, w * 1.12);
    g.translate(0, -len / 2, 0);                     // 原点 = 顶端（关节）
    return tint(g, hex);
  };

  const armGeo = mkLimb(armW, armLen, look.clothes);
  const handGeo = new THREE.BoxGeometry(armW * 1.05, armLen * 0.22, armW * 1.15);
  handGeo.translate(0, -armLen + armLen * 0.11, 0);
  tint(handGeo, look.skin);
  const armFull = mergeGeometries([armGeo, handGeo], false);
  armGeo.dispose(); handGeo.dispose();
  geos.push(armFull);

  const legGeo = mkLimb(legW, legH, look.skirt ? look.skin : look.pants);
  const shoeGeo = new THREE.BoxGeometry(legW * 1.05, legH * 0.16, legW * 1.55);
  shoeGeo.translate(0, -legH + legH * 0.08, legW * 0.22);
  tint(shoeGeo, look.shoe);
  const legFull = mergeGeometries([legGeo, shoeGeo], false);
  legGeo.dispose(); shoeGeo.dispose();
  geos.push(legFull);

  const shoulderX = shoulder * 0.5 + armW * 0.62;
  const armL = new THREE.Mesh(armFull, NPC_MAT);
  const armR = new THREE.Mesh(armFull, NPC_MAT);
  armL.position.set(-shoulderX, legH + torsoH * 0.86, 0);
  armR.position.set( shoulderX, legH + torsoH * 0.86, 0);

  const legL = new THREE.Mesh(legFull, NPC_MAT);
  const legR = new THREE.Mesh(legFull, NPC_MAT);
  const hipX = shoulder * 0.24;
  legL.position.set(-hipX, hipY, 0);
  legR.position.set( hipX, hipY, 0);

  const group = new THREE.Group();
  group.add(legL, legR, upperGroup, armL, armR);
  return { group, upperGroup, upperMesh, armL, armR, legL, legR, geos, look,
           eyeY: headCY + headH * 0.2, headTopY: headCY + headH * 0.6 };
}

/* ---------- 头发 ---------- */
function addHair(add, look, m) {
  const { headW, headD, headH, headCY } = m;
  const c = look.hairColor;
  const capY = headCY + headH * 0.30;
  switch (look.hair) {
    case 'BALD': break;
    case 'CROP': {
      const g = new THREE.BoxGeometry(headW * 1.02, headH * 0.24, headD * 1.02);
      g.translate(0, headCY + headH * 0.42, 0);
      add(tint(g, c)); break;
    }
    case 'SHORT': {
      const g = new THREE.BoxGeometry(headW * 1.06, headH * 0.42, headD * 1.06);
      g.translate(0, capY + headH * 0.06, -headD * 0.03);
      add(tint(g, c)); break;
    }
    case 'CURLY': {
      const g = new THREE.SphereGeometry(headW * 0.72, 7, 5);
      g.scale(1.05, 0.72, 1.05);
      g.translate(0, capY + headH * 0.04, -headD * 0.02);
      add(tint(g, c));
      const b = new THREE.SphereGeometry(headW * 0.40, 6, 4);
      b.translate(0, headCY - headH * 0.18, -headD * 0.55);
      add(tint(b, c)); break;
    }
    case 'LONG': {
      const g = new THREE.BoxGeometry(headW * 1.05, headH * 0.42, headD * 1.05);
      g.translate(0, capY + headH * 0.06, -headD * 0.02);
      add(tint(g, c));
      const back = new THREE.BoxGeometry(headW * 1.04, headH * 1.65, headD * 0.42);
      back.translate(0, headCY - headH * 0.52, -headD * 0.44);
      add(tint(back, c)); break;
    }
    case 'BUN': {
      const g = new THREE.BoxGeometry(headW * 1.05, headH * 0.44, headD * 1.05);
      g.translate(0, capY + headH * 0.06, -headD * 0.02);
      add(tint(g, c));
      const bun = new THREE.SphereGeometry(headW * 0.30, 6, 5);
      bun.translate(0, headCY + headH * 0.44, -headD * 0.52);
      add(tint(bun, c)); break;
    }
    case 'BRAID': {
      const g = new THREE.BoxGeometry(headW * 1.05, headH * 0.42, headD * 1.05);
      g.translate(0, capY + headH * 0.06, -headD * 0.02);
      add(tint(g, c));
      for (const sx of [-1, 1]) {
        const b = new THREE.BoxGeometry(headW * 0.20, headH * 1.30, headD * 0.22);
        b.translate(sx * headW * 0.52, headCY - headH * 0.36, -headD * 0.18);
        add(tint(b, c));
      }
      break;
    }
  }
}

/* ---------- 帽子 ---------- */
function addHat(add, look, m) {
  if (look.hat === 'NONE') return;
  const { headW, headD, headH, headCY, H } = m;
  const c = look.hatColor;
  const crownBase = headCY + headH * 0.46;
  switch (look.hat) {
    case 'STRAW': {                     // 宽檐草帽：一圈薄檐 + 一顶矮帽冠
      const brim = new THREE.CylinderGeometry(headW * 1.10, headW * 1.16, H * 0.014, 10);
      brim.translate(0, crownBase, 0);
      add(tint(brim, c));
      const crown = new THREE.CylinderGeometry(headW * 0.48, headW * 0.54, headH * 0.36, 8);
      crown.translate(0, crownBase + headH * 0.18, 0);
      add(tint(crown, c)); break;
    }
    case 'BONNET': {                    // 软帽：半个球扣在头上
      const g = new THREE.SphereGeometry(headW * 0.66, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
      g.scale(1.0, 0.85, 1.0);
      g.translate(0, headCY + headH * 0.30, 0);
      add(tint(g, c)); break;
    }
    case 'CAP': {                       // 便帽：半球 + 一截前檐
      const g = new THREE.SphereGeometry(headW * 0.62, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
      g.translate(0, headCY + headH * 0.26, 0);
      add(tint(g, c));
      const b = new THREE.BoxGeometry(headW * 0.78, headH * 0.09, headD * 0.34);
      b.translate(0, headCY + headH * 0.34, headD * 0.56);
      add(tint(b, c)); break;
    }
    case 'BOWLER': {                    // 圆顶礼帽
      const g = new THREE.SphereGeometry(headW * 0.60, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
      g.scale(1.0, 0.80, 1.0);
      g.translate(0, headCY + headH * 0.34, 0);
      add(tint(g, c));
      const brim = new THREE.CylinderGeometry(headW * 1.00, headW * 1.02, H * 0.013, 10);
      brim.translate(0, headCY + headH * 0.36, 0);
      add(tint(brim, c)); break;
    }
    case 'TOPHAT': {                    // 高筒礼帽：商人的招牌
      const brim = new THREE.CylinderGeometry(headW * 1.02, headW * 1.04, H * 0.014, 10);
      brim.translate(0, crownBase, 0);
      add(tint(brim, c));
      const crown = new THREE.CylinderGeometry(headW * 0.50, headW * 0.52, headH * 0.78, 8);
      crown.translate(0, crownBase + headH * 0.39, 0);
      add(tint(crown, c)); break;
    }
    case 'KERCHIEF': {                  // 头巾：一个包住头顶的方块 + 后脑的打结
      const g = new THREE.BoxGeometry(headW * 1.10, headH * 0.44, headD * 1.10);
      g.translate(0, headCY + headH * 0.30, -headD * 0.03);
      add(tint(g, c));
      const knot = new THREE.BoxGeometry(headW * 0.26, headH * 0.24, headD * 0.20);
      knot.translate(headW * 0.42, headCY + headH * 0.18, -headD * 0.58);
      add(tint(knot, c)); break;
    }
    case 'WORKCAP': {                   // 工作帽：一顶压扁的方帽 + 短檐
      const g = new THREE.BoxGeometry(headW * 1.08, headH * 0.32, headD * 1.08);
      g.translate(0, headCY + headH * 0.36, 0);
      add(tint(g, c));
      const b = new THREE.BoxGeometry(headW * 0.86, headH * 0.08, headD * 0.30);
      b.translate(0, headCY + headH * 0.30, headD * 0.60);
      add(tint(b, c)); break;
    }
  }
}

/* ---------- 配饰 ---------- */
function addAccessory(add, look, m) {
  const a = look.accessory;
  if (a === 'NONE') return;
  const { H, torsoH, depth, shoulder, hipY, chestY, headCY, headH, headW, headD, armLen, armW } = m;
  const handY = hipY + torsoH * 0.86 - armLen * 0.92;   // 大致的手部高度
  const handX = shoulder * 0.5 + armW * 1.6;
  switch (a) {
    case 'APRON': {
      const g = new THREE.BoxGeometry(shoulder * 0.66, torsoH * 0.72, depth * 0.10);
      g.translate(0, chestY - torsoH * 0.08, depth * 0.53);
      add(tint(g, 0xe6dcc6)); break;
    }
    case 'BAG': {
      const g = new THREE.BoxGeometry(shoulder * 0.62, torsoH * 0.46, depth * 0.30);
      g.translate(0, chestY - torsoH * 0.06, -depth * 0.68);
      add(tint(g, 0x6b5236)); break;
    }
    case 'BASKET': {
      const g = new THREE.CylinderGeometry(armW * 0.95, armW * 0.72, H * 0.11, 7);
      g.translate(handX, handY + H * 0.02, 0);
      add(tint(g, 0xb98f52)); break;
    }
    case 'BROOM': {
      const stick = new THREE.CylinderGeometry(H * 0.013, H * 0.013, H * 0.62, 5);
      stick.translate(handX, handY - H * 0.14, 0);
      add(tint(stick, 0x8a6a45));
      const head = new THREE.BoxGeometry(H * 0.05, H * 0.14, H * 0.13);
      head.translate(handX, handY - H * 0.44, 0);
      add(tint(head, 0xc8a45e)); break;
    }
    case 'CANE': {
      const g = new THREE.CylinderGeometry(H * 0.014, H * 0.016, H * 0.56, 6);
      g.translate(handX, handY - H * 0.18, 0);
      add(tint(g, 0x53381f)); break;
    }
    case 'GLASSES': {
      const g = new THREE.BoxGeometry(headW * 1.02, headH * 0.13, headD * 0.10);
      g.translate(0, headCY + headH * 0.10, headD * 0.54);
      add(tint(g, 0x2e2a26)); break;
    }
    case 'SCARF': {
      const g = new THREE.BoxGeometry(shoulder * 0.94, H * 0.05, depth * 1.06);
      g.translate(0, hipY + torsoH * 0.94, 0);
      add(tint(g, look.accent)); break;
    }
    case 'PIPE': {
      const g = new THREE.BoxGeometry(headW * 0.10, headH * 0.10, headD * 0.42);
      g.translate(headW * 0.20, headCY - headH * 0.22, headD * 0.66);
      add(tint(g, 0x4a3722)); break;
    }
    case 'TOY': {                       // 小孩手里的球
      const g = new THREE.SphereGeometry(H * 0.045, 6, 5);
      g.translate(handX, handY, 0);
      add(tint(g, 0xcf6a5a)); break;
    }
  }
}

/* ============================================================
   5. 远景人群剪影
   ------------------------------------------------------------
   "镜头很远时只显示人群" —— 这几颗积木就是那群人。
   顶点色一律刷成**白色**，真正的颜色交给 InstancedMesh 的 instanceColor，
   于是几百个人只花 2 个 draw call（身体一个、脑袋一个）。
   ============================================================ */
export function buildCrowdGeometries() {
  /* 身体：腿 + 躯干 + 肩，按"身高 1.0"建模，实例矩阵里再缩放到真人身高 */
  const parts = [];
  const legs = new THREE.BoxGeometry(0.21, 0.36, 0.13);  legs.translate(0, 0.18, 0);
  const torso = new THREE.BoxGeometry(0.28, 0.40, 0.17); torso.translate(0, 0.56, 0);
  const shldr = new THREE.BoxGeometry(0.33, 0.07, 0.18); shldr.translate(0, 0.73, 0);
  parts.push(tint(legs, 0xffffff), tint(torso, 0xffffff), tint(shldr, 0xffffff));
  const body = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();

  const headParts = [];
  const head = new THREE.BoxGeometry(0.17, 0.22, 0.16); head.translate(0, 0.89, 0);
  headParts.push(tint(head, 0xffffff));
  const headGeo = mergeGeometries(headParts, false);
  for (const g of headParts) g.dispose();

  return { body, head: headGeo };
}
