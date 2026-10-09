import * as THREE from 'three';

/* ============================================================
   程序化建筑外观
   ============================================================
   接入《纪元1800》整份建筑表之后，一百多座建筑不可能座座配模型。
   但它们也不該全是"一个盒子加一个屋顶"——那样走在城里根本认不出哪座是面包房、
   哪座是砖厂。所以这里按 **形制（form）** 拼体块：同一种形制共用一套搭法，
   主色由服务端下发的 tint 决定，于是每个建筑**有辨识度又不会各自写一份代码**。

   约定（与 game.html 的 buildBuildings 对齐）：
     - 返回的 Group 原点在**占地中心**、地面高度为 y=0，模型自己往上搭；
     - 尺寸上限是 W × D（已按 0.86 缩过）. 形制内部自行决定占多少；
     - 不建任何发光窗户（2026-09-25 定：窗户交给以后在 Blender 里做的材质）；
     - 所有几何由调用方 traverse 回收，这里只负责拼。

   之后某座建筑有了真正的 glb（同 models/<TYPE>.glb），game.html 会自动摘掉这里的体块。
   ============================================================ */

/* 材质缓存：同样颜色 + 同样参数的材质全场共用一份 ——
   一百多座建筑如果各建各的 material，材质数量会直接吃掉 draw call 预算。 */
const matCache = new Map();

export function procMat(color, opt = {}) {
  const rough = opt.rough ?? 0.78;
  const metal = opt.metal ?? 0.0;
  const emis  = opt.emissive ?? 0x000000;
  const ei    = opt.emissiveIntensity ?? 1;
  const key = `${color}|${rough}|${metal}|${emis}|${ei}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color, roughness: rough, metalness: metal,
      emissive: emis, emissiveIntensity: ei,
    });
    matCache.set(key, m);
  }
  return m;
}

/* ------------------------------------------------------------
   体块小工具：把"拿尺寸造 ёymes 放到某个位置"这三件事合成一行。
   坐标系：y 向上，原点在地面；dz 是"往门的方向"(见 game.html 的 +Z 为正面)。
   ------------------------------------------------------------ */

const BOX_CACHE = new Map();
function boxGeo(w, h, d) {
  // 同一种盒子尺寸在几十座建筑之间反复出现，缓存后只有一份 BufferGeometry
  const k = `b${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = BOX_CACHE.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); BOX_CACHE.set(k, g); }
  return g;
}

/** 一个立方体块 */
function box(parent, color, w, h, d, x, y, z, opt) {
  const m = new THREE.Mesh(boxGeo(w, h, d), procMat(color, opt));
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}

const CYL_CACHE = new Map();
function cylGeo(rt, rb, h, seg = 10) {
  const k = `c${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${seg}`;
  let g = CYL_CACHE.get(k);
  if (!g) { g = new THREE.CylinderGeometry(rt, rb, h, seg); CYL_CACHE.set(k, g); }
  return g;
}

/** 一段圆柱（底 y=0 起算） */
function cyl(parent, color, rt, rb, h, x, y, z, opt, seg) {
  const m = new THREE.Mesh(cylGeo(rt, rb, h, seg), procMat(color, opt));
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}

const CONE_CACHE = new Map();
function coneGeo(r, h, seg = 4) {
  const k = `k${r.toFixed(3)}|${h.toFixed(3)}|${seg}`;
  let g = CONE_CACHE.get(k);
  if (!g) { g = new THREE.ConeGeometry(r, h, seg); CONE_CACHE.set(k, g); }
  return g;
}

/** 圆锥 / 棱锥（默认四棱锥旋 45° 对齐方格） */
function cone(parent, color, r, h, x, y, z, seg = 4, opt) {
  const m = new THREE.Mesh(coneGeo(r, h, seg), procMat(color, opt));
  m.position.set(x, y + h / 2, z);
  if (seg === 4) m.rotation.y = Math.PI / 4;
  parent.add(m);
  return m;
}

/** 球 （用于圆顶 / 树冠） */
function sphere(parent, color, r, x, y, z, opt) {
  const g = new THREE.SphereGeometry(r, 10, 8);
  const m = new THREE.Mesh(g, procMat(color, opt));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/**
 * 人字屋顶（三棱柱）：底面贴着建筑宽度 W，前后各伸一点屋檐。
 * 用旋转过的盒子做山墙，视觉上比四棱锥更接近"欧陆排屋"。
 */
function gable(parent, color, W, D, y, ridgeH, opt) {
  const roofH = ridgeH;
  const geo = new THREE.BufferGeometry();
  // 手工五面体：两个坡面 + 两个山墙
  const hw = W / 2, hd = D / 2;
  const v = [
    // 前坡
    -hw, 0, hd,  hw, 0, hd,  hw, roofH, 0,
    -hw, 0, hd,  hw, roofH, 0,  -hw, roofH, 0,
    // 后坡
    hw, 0, -hd,  -hw, 0, -hd,  -hw, roofH, 0,
    hw, 0, -hd,  -hw, roofH, 0,  hw, roofH, 0,
    // 东山墙
    hw, 0, hd,  hw, 0, -hd,  hw, roofH, 0,
    // 西山墙
    -hw, 0, -hd,  -hw, 0, hd,  -hw, roofH, 0,
  ];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, procMat(color, opt));
  m.position.y = y;
  parent.add(m);
  return m;
}

/** 一排并列的小物件（卷帘门 / 柱廊柱子 / 摊位支腿） */
function repeatX(parent, n, fn) {
  for (let i = 0; i < n; i++) fn(i, n);
}

/* ------------------------------------------------------------
   配色：由 tint 推一个"屋顶/基座/装饰"三件套，
   免得每加一座建筑都要手配四种颜色。
   ------------------------------------------------------------ */
function palette(tint) {
  const base = new THREE.Color(tint);
  const roof = base.clone().multiplyScalar(0.62);
  const trim = base.clone().lerp(new THREE.Color(0xffffff), 0.25);
  const dark = base.clone().multiplyScalar(0.45);
  return {
    base: base.getHex(),
    roof: roof.getHex(),
    trim: trim.getHex(),
    dark: dark.getHex(),
  };
}

/* ============================================================
   形制表：一个 form -> 一个搭放函数
   ctx: { W, D, s, seed }（s = min(W,D) 作为通用尺寸基准）
   ============================================================ */

const FORMS = {

  /* ---------------- 住宅系列 ---------------- */

  // 伐木人住的那种小木屋：一层 + 四棱锥顶 + 烟囱
  HUT(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.78, 0.9, D * 0.78, 0, 0, 0);
    cone(g, p.roof, Math.max(W, D) * 0.52, 0.7, 0, 0.9, 0, 4);
    box(g, 0x5d4037, 0.22, 0.55, 0.22, W * 0.26, 1.0, -D * 0.22, { rough: 0.9 });
  },

  // 农舍：二层不到、人字顶、门口一畦32花坛
  COTTAGE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.82, 1.15, D * 0.82, 0, 0, 0);
    gable(g, p.roof, W * 0.88, D * 0.88, 1.15, 0.75);
    box(g, p.dark, W * 0.26, 0.62, 0.08, 0, 0, D * 0.42, { rough: 0.9 });       // 门
    repeatX(g, 2, i => box(g, 0x9fd0ff, 0.3, 0.34, 0.06,
      (i ? 1 : -1) * W * 0.27, 0.55, D * 0.42, { rough: 0.4, metal: 0.2 }));    // 两扇窗
    box(g, 0x6d4c41, W * 0.9, 0.12, D * 0.28, 0, 0, D * 0.5, { rough: 0.95 });   // 门前小花坛
  },

  // 工人排屋：更高更窄，三层窗 + 阁楼窗
  ROWHOUSE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.88, 1.85, D * 0.84, 0, 0, 0);
    gable(g, p.roof, W * 0.94, D * 0.9, 1.85, 0.7);
    for (let row = 0; row < 2; row++) {
      repeatX(g, 3, i => box(g, 0x9fd0ff, W * 0.2, 0.42, 0.06,
        (i - 1) * W * 0.29, 0.42 + row * 0.72, D * 0.43, { rough: 0.4, metal: 0.2 }));
    }
    box(g, p.dark, W * 0.22, 0.85, 0.08, 0, 0, D * 0.43, { rough: 0.9 });
    box(g, 0x455a64, 0.2, 0.6, 0.2, W * 0.3, 2.1, -D * 0.2, { rough: 0.85 });
  },

  // 工匠洋楼：带挑檐、露台与科林斯柱
  TOWNHOUSE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.9, 2.35, D * 0.86, 0, 0, 0);
    gable(g, p.roof, W * 0.96, D * 0.92, 2.35, 0.62);
    box(g, p.trim, W * 0.96, 0.12, D * 0.92, 0, 1.55, 0);                       // 腰线
    for (let r = 0; r < 2; r++)repeatX(g, 2, i => box(g, 0x9fd0ff, W * 0.22, 0.46, 0.06,
      (i ? 1 : -1) * W * 0.24, 0.5 + r * 0.8, D * 0.44, { rough: 0.35, metal: 0.25 }));
    repeatX(g, 3, i => cyl(g, p.trim, 0.07, 0.07, 1.0, (i - 1) * W * 0.3, 0, D * 0.46, null, 8));
    box(g, p.trim, W * 0.92, 0.1, D * 0.3, 0, 1.0, D * 0.5, { rough: 0.7 });     // 露台板
    box(g, p.dark, W * 0.2, 0.9, 0.08, 0, 0, D * 0.44, { rough: 0.9 });
  },

  // 投资者豪宅 / 酒店：主体 + 侧翼 + 圆顶 + 旗杆
  MANSION(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.86, 2.2, D * 0.7, 0, 0, -D * 0.06);
    box(g, p.trim, W * 0.5, 1.5, D * 0.4, -W * 0.34, 0, D * 0.28);               // 左侧翼
    box(g, p.trim, W * 0.5, 1.5, D * 0.4, W * 0.34, 0, D * 0.28);                // 右侧翼
    gable(g, p.roof, W * 0.5, D * 0.42, 1.5, 0.4, {});
    box(g, p.roof, W * 0.9, 0.16, D * 0.74, 0, 2.2, -D * 0.06);
    cyl(g, p.trim, D * 0.2, D * 0.2, 0.5, 0, 2.36, -D * 0.06, null, 12);         // 圆顶鼓座
    sphere(g, p.roof, D * 0.22, 0, 3.1, -D * 0.06, { metal: 0.2, rough: 0.5 });
    repeatX(g, 5, i => cyl(g, p.trim, 0.08, 0.08, 1.7, (i - 2) * W * 0.18, 0, D * 0.42, null, 8));
    cyl(g, 0x8d6e63, 0.04, 0.04, 1.2, 0, 3.2, -D * 0.06, null, 6);               // 旗杆
    box(g, 0xd84315, 0.5, 0.3, 0.04, 0.26, 4.1, -D * 0.06, { rough: 0.8 });
  },

  /* ---------------- 作坊 / 工厂系列 ---------------- */

  // 手工作坊：一层斜顶 + 烟囱 + 门口雨棚
  WORKSHOP(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.86, 1.05, D * 0.82, 0, 0, 0);
    gable(g, p.roof, W * 0.92, D * 0.88, 1.05, 0.6);
    box(g, 0x455a64, 0.24, 0.9, 0.24, -W * 0.32, 1.1, -D * 0.24, { rough: 0.85 });
    box(g, p.dark, W * 0.3, 0.75, 0.08, 0, 0, D * 0.42, { rough: 0.9 });
    // 门口雨棚
    box(g, p.trim, W * 0.42, 0.08, D * 0.2, 0, 0.95, D * 0.46, { rough: 0.7 });
    repeatX(g, 2, i => cyl(g, 0x6d4c41, 0.05, 0.05, 0.9, (i ? 1 : -1) * W * 0.2, 0, D * 0.52, null, 6));
  },

  // 厂房：锯齿顶 + 两根烟囱 + 待运货箱由 game.html 自己加
  FACTORY(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.92, 1.35, D * 0.88, 0, 0, -D * 0.02);
    const n = Math.max(2, Math.round(W / 0.9));
    repeatX(g, n, i => {
      const wUnit = (W * 0.92) / n;
      gable(g, p.roof, wUnit * 1.02, D * 0.9, 1.35, 0.42, {});
    });
    // 锯齿之间用矮墙填平（免得全是尖）
    box(g, p.trim, W * 0.94, 0.1, D * 0.92, 0, 1.34, -D * 0.02);
    cyl(g, 0x546e7a, 0.16, 0.2, 1.9, -W * 0.36, 1.0, -D * 0.3, null, 8);
    cyl(g, 0x546e7a, 0.14, 0.18, 1.5, -W * 0.24, 1.0, -D * 0.3, null, 8);
    box(g, p.dark, W * 0.34, 0.8, 0.08, 0, 0, D * 0.45, { rough: 0.9 });
  },

  // 熔炼（砖厂/钢铁厂/黄铜）：双烟囱 + 炉膛火光
  SMELTER(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.9, 1.5, D * 0.86, 0, 0, 0);
    box(g, p.dark, W * 0.94, 0.22, D * 0.9, 0, 1.5, 0);
    cyl(g, 0x455a64, 0.18, 0.26, 2.4, -W * 0.3, 1.5, -D * 0.24, null, 8);
    cyl(g, 0x455a64, 0.15, 0.22, 2.0, W * 0.1, 1.5, -D * 0.3, null, 8);
    // 炉口：一块自发光的小红砖，夜里看得见"这炉子烧着"
    box(g, 0xff6d00, W * 0.22, 0.42, 0.06, W * 0.24, 0.3, D * 0.44,
      { emissive: 0xff3d00, emissiveIntensity: 0.9, rough: 0.6 });
    box(g, p.dark, W * 0.3, 0.72, 0.08, -W * 0.2, 0, D * 0.44, { rough: 0.9 });
  },

  // 窑：圆锥 + 烟道（砖厂 / 炭窑 / 水泥）
  KILN(g, p, ctx) {
    const { W, D } = ctx;
    const r = Math.min(W, D) * 0.36;
    cyl(g, p.base, r, r * 1.08, 1.3, 0, 0, 0, null, 12);
    cone(g, p.roof, r * 1.05, 0.6, 0, 1.3, 0, 12);
    cyl(g, 0x4e4a44, 0.13, 0.15, 0.8, r * 0.55, 1.9, 0, null, 8);
    box(g, 0x3e2723, r * 0.7, 0.34, 0.06, 0, 0.1, r * 1.02, { rough: 0.95 });     // 窑门
    box(g, p.dark, W * 0.2, 0.4, D * 0.3, -W * 0.34, 0, D * 0.3, { rough: 0.95 }); // 堆料
  },

  // 风车磨坊：塔身 + 锥帽 + 四片叶子（game.html 会让它慢慢转）
  MILL(g, p, ctx) {
    const { W, D } = ctx;
    const r = Math.min(W, D) * 0.34;
    cyl(g, p.base, r * 0.85, r, 2.0, 0, 0, 0, null, 12);
    cone(g, p.roof, r * 0.95, 0.7, 0, 2.0, 0, 12);
    const blades = new THREE.Group();
    box(blades, 0xe0e0e0, 0.12, 1.5, 0.1, 0, -0.75, 0, { rough: 0.7 });
    box(blades, 0xe0e0e0, 0.12, 1.5, 0.1, 0, 0.75, 0, { rough: 0.7 });
    box(blades, 0xd8cbb0, 1.5, 0.12, 0.1, -0.75, 0, 0, { rough: 0.7 });
    box(blades, 0xd8cbb0, 1.5, 0.12, 0.1, 0.75, 0, 0, { rough: 0.7 });
    blades.position.set(0, 1.75, r * 0.9);
    blades.name = 'windmill';
    g.add(blades);
    box(g, p.dark, r * 0.7, 0.5, 0.06, 0, 0, r * 1.0, { rough: 0.9 });
  },

  // 炼厂：几个罐体 + 管架 + 梯子
  REFINERY(g, p, ctx) {
    const { W, D } = ctx;
    const r = Math.min(W, D) * 0.22;
    cyl(g, p.base, r, r, 1.4, -W * 0.26, 0, -D * 0.16, null, 12);
    cyl(g, p.trim, r * 0.8, r * 0.8, 1.1, W * 0.05, 0, -D * 0.2, null, 12);
    cyl(g, p.base, r * 0.7, r * 0.7, 1.7, W * 0.32, 0, -D * 0.14, { metal: 0.35, rough: 0.5 }, 12);
    // 管架
    box(g, 0x90a4ae, W * 0.9, 0.1, 0.1, 0, 1.55, 0, { metal: 0.5, rough: 0.5 });
    repeatX(g, 4, i => box(g, 0x78909c, 0.1, 0.9, 0.1, (i - 1.5) * W * 0.24, 0.65, 0, { metal: 0.4 }));
    box(g, 0x546e7a, W * 0.5, 0.7, D * 0.24, -W * 0.2, 0, D * 0.3, { rough: 0.9 });
    box(g, p.dark, W * 0.26, 0.62, 0.08, W * 0.3, 0, D * 0.32, { rough: 0.9 });
  },

  // 发电厂：主厂房 + 两座冷却塔 + 三根烟囱
  POWER_PLANT(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.62, 1.2, D * 0.6, -W * 0.16, 0, -D * 0.12);
    gable(g, p.roof, W * 0.66, D * 0.64, 1.2, 0.4);
    const tr = Math.min(W, D) * 0.2;
    cyl(g, 0xbdb9ac, tr * 0.78, tr, 1.7, W * 0.24, 0, -D * 0.24, null, 14);
    cyl(g, 0xbdb9ac, tr * 0.78, tr, 1.7, W * 0.24, 0, D * 0.2, null, 14);
    repeatX(g, 3, i => cyl(g, 0x455a64, 0.13, 0.16, 2.2, -W * 0.38 + i * 0.32, 1.2, -D * 0.24, null, 8));
  },

  // 兵工厂：矮堡 + 女儿墙 + 角楼
  ARSENAL(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.92, 1.0, D * 0.88, 0, 0, 0);
    box(g, p.dark, W * 0.96, 0.22, D * 0.92, 0, 1.0, 0);                          // 女儿墙
    repeatX(g, 4, i => box(g, p.trim, 0.16, 0.24, 0.14, (i - 1.5) * W * 0.26, 1.05, D * 0.44, { rough: 0.9 }));
    cyl(g, p.base, 0.26, 0.3, 1.6, -W * 0.38, 0, -D * 0.32, null, 8);
    cone(g, p.roof, 0.3, 0.4, -W * 0.38, 1.6, -D * 0.32, 8);
    box(g, 0x37474f, W * 0.28, 0.7, 0.08, W * 0.2, 0, D * 0.45, { rough: 0.9 });
  },

  /* ---------------- 采掘系列 ---------------- */

  // 矿井架：A 型井架 + 天轮 + 矿车轨 + 矿渣堆
  MINEHEAD(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.dark, W * 0.5, 0.9, D * 0.5, W * 0.16, 0, -D * 0.18, { rough: 0.95 });
    const leg = (sx) => {
      const m = new THREE.Mesh(boxGeo(0.09, 1.9, 0.09), procMat(0x455a64, { metal: 0.4, rough: 0.5 }));
      m.position.set(sx * 0.42, 0.95, D * 0.1);
      m.rotation.z = -sx * 0.22;
      g.add(m);
    };
    leg(-1); leg(1);
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 6, 14),
      procMat(0x78909c, { metal: 0.6, rough: 0.4 }));
    wheel.position.set(0, 1.95, D * 0.1);
    wheel.name = 'minewheel';
    g.add(wheel);
    cone(g, 0x5d4037, 0.34, 0.4, -W * 0.3, 0, D * 0.3, 8);                        // 矿渣堆
    cone(g, 0x4e342e, 0.26, 0.3, -W * 0.12, 0, D * 0.36, 8);
    box(g, 0x8d6e63, W * 0.7, 0.08, 0.16, 0, 0.02, -D * 0.3, { rough: 0.95 });     // 枕木
  },

  // 采石场：凹下去的坑 + 石料堆 + 小吊臂
  QUARRY(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x6d5f4a, W * 0.86, 0.28, D * 0.86, 0, -0.24, 0, { rough: 1 });         // 坑底
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      box(g, p.dark, W * 0.9, 0.26, 0.12, 0, -0.12, sz * D * 0.44, { rough: 1 });
      box(g, p.dark, 0.12, 0.26, D * 0.9, sx * W * 0.44, -0.12, 0, { rough: 1 });
    }
    repeatX(g, 3, i => box(g, p.trim, 0.36, 0.3, 0.36, (i - 1) * 0.42, 0, D * 0.28, { rough: 0.9 }));
    box(g, 0x546e7a, 0.16, 1.3, 0.16, W * 0.3, 0, -D * 0.24, { metal: 0.4 });
    box(g, 0x546e7a, 0.9, 0.1, 0.1, W * 0.3, 1.25, -D * 0.24, { metal: 0.4 });
  },

  // 油井：格构塔（钻塔）+ 泵底座
  DERRICK(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x455a64, W * 0.7, 0.35, D * 0.7, 0, 0, 0, { metal: 0.3, rough: 0.7 });
    const h = 2.6;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = new THREE.Mesh(boxGeo(0.08, h, 0.08), procMat(0x607d8b, { metal: 0.5, rough: 0.5 }));
      m.position.set(sx * W * 0.24, h / 2, sz * D * 0.24);
      m.rotation.x = -sz * 0.16; m.rotation.z = -sx * 0.16;
      g.add(m);
    }
    for (let i = 1; i <= 3; i++) {
      const y = (h / 4) * i, k = 1 - i * 0.16;
      box(g, 0x78909c, W * 0.5 * k, 0.06, 0.06, 0, y, D * 0.24 * k, { metal: 0.5 });
      box(g, 0x78909c, W * 0.5 * k, 0.06, 0.06, 0, y, -D * 0.24 * k, { metal: 0.5 });
    }
    cyl(g, 0x37474f, 0.1, 0.1, 0.9, 0, 0.35, 0, null, 8);
  },

  /* ---------------- 农业系列 ---------------- */

  // 农田：垄沟 + 谷仓 + 筒仓
  FARM_FIELD(g, p, ctx) {
    const { W, D, seed } = ctx;
    const rows = Math.max(3, Math.round(D / 0.45));
    for (let i = 0; i < rows; i++) {
      const z = -D / 2 + (i + 0.5) * (D / rows);
      box(g, i % 2 ? 0x6d5a35 : 0x7a6438, W * 0.92, 0.1, D / rows * 0.62, 0, 0, z, { rough: 1 });
    }
    box(g, p.base, W * 0.5, 1.1, D * 0.4, -W * 0.24, 0.02, -D * 0.26);            // 谷仓
    gable(g, p.roof, W * 0.54, D * 0.44, 1.12, 0.55);
    cyl(g, 0xc0b298, 0.24, 0.26, 1.5, W * 0.3, 0.02, -D * 0.22, null, 12);        // 筒仓
    cone(g, p.dark, 0.28, 0.35, W * 0.3, 1.52, -D * 0.22, 12);
  },

  // 牧场：栅栏圈 + 棚 + 干草堆
  FARM_PASTURE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x8d6e63, 0.08, 0.55, 0.08, -W * 0.42, 0, -D * 0.42, { rough: 0.95 });
    repeatX(g, 5, i => box(g, 0x8d6e63, W * 0.9, 0.07, 0.07, 0, 0.24, -D * 0.42 + i * 0.02, { rough: 0.95 }));
    box(g, p.base, W * 0.44, 0.85, D * 0.36, -W * 0.24, 0, D * 0.24);
    gable(g, p.roof, W * 0.48, D * 0.4, 0.85, 0.42);
    cone(g, 0xd9c27e, 0.3, 0.44, W * 0.3, 0, D * 0.26, 8);                        // 干草堆
    cone(g, 0xd4b96a, 0.24, 0.34, W * 0.12, 0, D * 0.32, 8);
  },

  // 果园：成排果树 + 工具棚
  ORCHARD(g, p, ctx) {
    const { W, D, seed } = ctx;
    const cols = 3, rows = 2;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = -W / 2 + (i + 0.5) * (W / cols);
      const z = -D / 2 + (j + 0.5) * (D / rows) + D * 0.08;
      const jitter = ((seed * (i * 7 + j * 13)) % 10) / 10;
      cyl(g, 0x6d4c41, 0.055, 0.075, 0.42 + jitter * 0.16, x, 0, z, null, 6);
      sphere(g, 0x4f7a3a, 0.3 + jitter * 0.08, x, 0.62 + jitter * 0.16, z, { rough: 0.9 });
    }
    box(g, p.base, W * 0.26, 0.6, D * 0.26, W * 0.34, 0, D * 0.34, { rough: 0.9 });
    gable(g, p.roof, W * 0.3, D * 0.3, 0.6, 0.3);
  },

  // 种植园：一排排藤架
  PLANTATION(g, p, ctx) {
    const { W, D } = ctx;
    const rows = Math.max(3, Math.round(D / 0.5));
    for (let i = 0; i < rows; i++) {
      const z = -D / 2 + (i + 0.5) * (D / rows);
      box(g, 0x558b2f, W * 0.9, 0.34, D / rows * 0.5, 0, 0.28, z, { rough: 0.95 });
      box(g, 0x6d4c41, 0.05, 0.3, 0.05, -W * 0.44, 0, z, { rough: 0.95 });
    }
    box(g, p.base, W * 0.3, 0.8, D * 0.26, -W * 0.3, 0, -D * 0.3, { rough: 0.85 });
    gable(g, p.roof, W * 0.34, D * 0.3, 0.8, 0.34);
  },

  // 渔场：木栈桥 + 披棚 + 晒网架
  FISHERY(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0xa1887f, W * 0.9, 0.1, D * 0.9, 0, 0, 0, { rough: 0.95 });
    box(g, p.base, W * 0.44, 0.9, D * 0.36, -W * 0.2, 0.1, -D * 0.2);
    gable(g, p.roof, W * 0.48, D * 0.4, 1.0, 0.4);
    // 晒网架：两根柱子之间一条横杆
    cyl(g, 0x8d6e63, 0.05, 0.05, 1.0, W * 0.2, 0.1, D * 0.3, null, 6);
    cyl(g, 0x8d6e63, 0.05, 0.05, 1.0, W * 0.36, 0.1, D * 0.3, null, 6);
    box(g, 0xd8cbb0, 0.2, 0.05, 0.05, W * 0.28, 1.0, D * 0.3, { rough: 0.9 });
    box(g, 0x81d4fa, W * 0.3, 0.06, D * 0.16, W * 0.28, 0.14, -D * 0.3, { rough: 0.6 }); // 水盆
  },

  /* ---------------- 商业 / 公共系列 ---------------- */

  // 集市：一排彩色遮阳棚 + 果蔬箱
  STALL(g, p, ctx) {
    const { W, D } = ctx;
    const n = 3;
    const colors = [0xe0a458, 0xd84315, 0x4f7a3a];
    repeatX(g, n, i => {
      const cx = (i - 1) * W * 0.3;
      box(g, 0x8d6e63, 0.06, 0.9, 0.06, cx - W * 0.12, 0, D * 0.34, { rough: 0.95 });
      box(g, 0x8d6e63, 0.06, 0.9, 0.06, cx + W * 0.12, 0, D * 0.34, { rough: 0.95 });
      gable(g, colors[i % 3], W * 0.3, D * 0.7, 0.9, 0.3);
      box(g, 0xd7ccc8, W * 0.24, 0.34, D * 0.3, cx, 0, -D * 0.1, { rough: 0.9 });  // 台面
      box(g, 0xb98b4f, 0.22, 0.2, 0.22, cx - 0.1, 0.34, -D * 0.1, { rough: 0.9 });
      sphere(g, 0xd84315, 0.1, cx + 0.14, 0.44, -D * 0.1, { rough: 0.85 });
    });
  },

  // 商店：大橱窗 + 条纹雨棚 + 招牌
  STORE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.86, 1.3, D * 0.8, 0, 0, -D * 0.06);
    box(g, p.roof, W * 0.92, 0.14, D * 0.86, 0, 1.3, -D * 0.06);
    box(g, 0x9fd0ff, W * 0.7, 0.7, 0.06, 0, 0.3, D * 0.42, { rough: 0.25, metal: 0.35 }); // 橱窗
    box(g, p.dark, W * 0.2, 0.85, 0.08, W * 0.3, 0, D * 0.44, { rough: 0.9 });
    // 雨棚
    for (let i = 0; i < 4; i++) {
      box(g, i % 2 ? 0xffffff : p.roof, W * 0.22, 0.06, D * 0.22, (i - 1.5) * W * 0.22, 1.0, D * 0.46, { rough: 0.8 });
    }
    box(g, 0x37474f, W * 0.6, 0.26, 0.06, 0, 1.6, -D * 0.02, { rough: 0.7 });      // 招牌
  },

  // 公共厅堂：山墙 + 门廊 + 台阶
  HALL(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.86, 1.4, D * 0.76, 0, 0, -D * 0.06);
    gable(g, p.roof, W * 0.92, D * 0.82, 1.4, 0.7);
    repeatX(g, 4, i => cyl(g, p.trim, 0.09, 0.09, 1.2, (i - 1.5) * W * 0.24, 0, D * 0.4, null, 10));
    box(g, p.trim, W * 0.92, 0.12, D * 0.28, 0, 1.2, D * 0.44, { rough: 0.7 });
    box(g, p.dark, W * 0.24, 0.95, 0.08, 0, 0, D * 0.4, { rough: 0.9 });
    box(g, p.roof, W * 0.24, 0.2, 0.06, 0, 0.95, D * 0.4);                        // 门楣
    box(g, 0xcfc7b8, W * 0.5, 0.1, D * 0.16, 0, 0.02, D * 0.5, { rough: 0.95 });   // 台阶
  },

  // 市政厅：台基 + 一列柱 + 山花 + 穹顶
  COLONNADE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0xcfc7b8, W * 0.94, 0.24, D * 0.94, 0, 0, 0, { rough: 0.95 });          // 台基
    box(g, p.base, W * 0.84, 1.6, D * 0.76, 0, 0.24, -D * 0.06);
    gable(g, p.roof, W * 0.9, D * 0.82, 1.84, 0.66);
    repeatX(g, 6, i => cyl(g, p.trim, 0.09, 0.09, 1.35, (i - 2.5) * W * 0.16, 0.24, D * 0.4, null, 10));
    cyl(g, p.trim, D * 0.2, D * 0.2, 0.4, 0, 2.5, -D * 0.06, null, 14);
    sphere(g, p.roof, D * 0.22, 0, 3.1, -D * 0.06, { metal: 0.15, rough: 0.6 });
    box(g, 0xcfc7b8, W * 0.6, 0.14, D * 0.2, 0, 0.24, D * 0.5, { rough: 0.95 });
  },

  // 教堂：钟楼 + 尖塔 + 十字
  CHURCH(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.84, 1.5, D * 0.7, W * 0.06, 0, -D * 0.1);
    gable(g, p.roof, W * 0.9, D * 0.76, 1.5, 0.8);
    box(g, p.trim, W * 0.3, 2.6, D * 0.3, -W * 0.32, 0, D * 0.24);                // 钟楼
    cone(g, p.roof, W * 0.22, 1.3, -W * 0.32, 2.6, D * 0.24, 4);
    // 十字
    box(g, 0xd4af37, 0.07, 0.5, 0.07, -W * 0.32, 4.0, D * 0.24, { metal: 0.5, rough: 0.4 });
    box(g, 0xd4af37, 0.32, 0.07, 0.07, -W * 0.32, 4.2, D * 0.24, { metal: 0.5, rough: 0.4 });
    box(g, 0x6d4c41, W * 0.22, 1.0, 0.08, W * 0.06, 0, D * 0.38, { rough: 0.9 });  // 正门（拱形近似）
    box(g, 0x9fd0ff, 0.3, 0.5, 0.06, -W * 0.1, 0.8, D * 0.38, { rough: 0.3, metal: 0.3 });
  },

  // 学校：主楼 + 钟塔 + 操场矮墙
  SCHOOL(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.9, 1.3, D * 0.8, 0, 0, -D * 0.04);
    gable(g, p.roof, W * 0.96, D * 0.86, 1.3, 0.6);
    box(g, p.trim, W * 0.24, 1.9, D * 0.24, W * 0.3, 0, D * 0.3);
    cone(g, p.roof, W * 0.16, 0.6, W * 0.3, 1.9, D * 0.3, 4);
    box(g, 0xd4af37, 0.2, 0.2, 0.06, W * 0.3, 2.2, D * 0.42, { metal: 0.6, rough: 0.4 });  // 校钟
    repeatX(g, 4, i => box(g, 0x9fd0ff, W * 0.18, 0.44, 0.06, (i - 1.5) * W * 0.22, 0.5, D * 0.42, { rough: 0.35, metal: 0.25 }));
    box(g, p.dark, W * 0.22, 0.8, 0.08, -W * 0.32, 0, D * 0.42, { rough: 0.9 });
  },

  // 医院：白楼 +红十字 + 入口雨棚
  HOSPITAL(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.88, 1.6, D * 0.82, 0, 0, -D * 0.04);
    box(g, p.roof, W * 0.94, 0.16, D * 0.88, 0, 1.6, -D * 0.04);
    box(g, 0xd32f2f, W * 0.34, 0.12, 0.06, 0, 1.9, -D * 0.02, { rough: 0.7 });     // 红十字
    box(g, 0xd32f2f, 0.12, 0.34, 0.06, 0, 1.9, -D * 0.02, { rough: 0.7 });
    repeatX(g, 4, i => box(g, 0x9fd0ff, W * 0.17, 0.4, 0.06, (i - 1.5) * W * 0.22, 0.9, D * 0.43, { rough: 0.3, metal: 0.3 }));
    box(g, p.trim, W * 0.5, 0.1, D * 0.26, 0, 1.15, D * 0.46, { rough: 0.7 });
    box(g, p.dark, W * 0.24, 0.9, 0.08, 0, 0, D * 0.44, { rough: 0.9 });
  },

  // 剧院：圆门廊 + 装饰灯 + 霓虹招牌
  THEATRE(g, p, ctx) {
    const { W, D } = ctx;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.4, W * 0.42, 1.5, 16, 1, false, 0, Math.PI),
      procMat(p.base));
    body.position.set(0, 0.75, -D * 0.1);
    body.rotation.y = Math.PI / 2;
    g.add(body);
    cone(g, p.roof, W * 0.42, 0.5, 0, 1.5, -D * 0.1, 16);
    repeatX(g, 5, i => cyl(g, p.trim, 0.08, 0.08, 1.2, (i - 2) * W * 0.16, 0, D * 0.34, null, 10));
    box(g, 0x2b1b3a, W * 0.7, 0.3, 0.08, 0, 1.35, D * 0.36, { emissive: 0x6a1b9a, emissiveIntensity: 0.7, rough: 0.6 });
    box(g, p.trim, W * 0.9, 0.1, D * 0.2, 0, 0.04, D * 0.44, { rough: 0.9 });
  },

  // 公园：草地圆盘 + 树 + 喷泉 + 长椅
  PARK(g, p, ctx) {
    const { W, D, seed } = ctx;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(W, D) * 0.46, Math.min(W, D) * 0.46, 0.08, 20),
      procMat(0x558b2f, { rough: 1 }));
    disc.position.y = 0.04; g.add(disc);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + (seed % 7) * 0.2, r = Math.min(W, D) * 0.32;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      cyl(g, 0x6d4c41, 0.06, 0.08, 0.4, x, 0.06, z, null, 6);
      sphere(g, 0x4f7a3a, 0.34, x, 0.62, z, { rough: 0.95 });
    }
    cyl(g, 0xcfc7b8, 0.34, 0.4, 0.18, 0, 0.08, 0, null, 16);                      // 喷泉池
    cyl(g, 0x81d4fa, 0.24, 0.24, 0.1, 0, 0.2, 0, { rough: 0.3, metal: 0.2 }, 16);
    cyl(g, 0xcfc7b8, 0.05, 0.05, 0.5, 0, 0.24, 0, null, 8);
    repeatX(g, 2, i => box(g, 0x8d6e63, 0.5, 0.1, 0.16, (i ? 1 : -1) * W * 0.3, 0.42, D * 0.36, { rough: 0.95 }));
  },

  // 滨海大道：木栈道 + 灯柱 + 长椅
  ESPLANADE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0xa1887f, W * 0.96, 0.1, D * 0.7, 0, 0, 0, { rough: 0.95 });
    repeatX(g, 4, i => {
      const x = (i - 1.5) * W * 0.24;
      cyl(g, 0x455a64, 0.05, 0.06, 1.1, x, 0.1, -D * 0.28, null, 6);
      sphere(g, 0xffe082, 0.1, x, 1.28, -D * 0.28, { emissive: 0xffca28, emissiveIntensity: 0.8, rough: 0.5 });
      box(g, 0x8d6e63, 0.44, 0.1, 0.16, x + 0.2, 0.42, D * 0.3, { rough: 0.95 });
    });
  },

  /* ---------------- 塔与地标 ---------------- */

  TOWER_GENERIC(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.dark, W * 0.7, 0.3, D * 0.7, 0, 0, 0, { rough: 0.95 });
    cyl(g, p.base, W * 0.22, W * 0.26, 2.6, 0, 0.3, 0, null, 10);
    cyl(g, p.trim, W * 0.28, W * 0.28, 0.24, 0, 2.9, 0, null, 10);
    repeatX(g, 6, i => box(g, p.trim, 0.16, 0.26, 0.16,
      Math.cos(i / 6 * Math.PI * 2) * W * 0.26, 3.14, Math.sin(i / 6 * Math.PI * 2) * D * 0.26, { rough: 0.9 }));
    cone(g, p.roof, W * 0.24, 0.6, 0, 3.4, 0, 8);
  },

  RADIO_TOWER(g, p, ctx) {
    const { W, D } = ctx;
    const h = 4.2;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const m = new THREE.Mesh(boxGeo(0.07, h, 0.07), procMat(0x90a4ae, { metal: 0.6, rough: 0.5 }));
      m.position.set(sx * 0.22, h / 2, sz * 0.22);
      m.rotation.x = -sz * 0.12; m.rotation.z = -sx * 0.12;
      g.add(m);
    }
    for (let i = 1; i <= 5; i++) {
      const y = (h / 6) * i, k = 1 - i * 0.14;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const m = new THREE.Mesh(boxGeo(0.05, 0.05, 0.42 * k), procMat(0x78909c, { metal: 0.6 }));
        m.position.set(sx * 0.18 * k, y, 0);
        g.add(m);
      }
    }
    cyl(g, 0xb0bec5, 0.03, 0.03, 0.8, 0, h, 0, { metal: 0.7 }, 6);
    sphere(g, 0xff5252, 0.1, 0, h + 0.9, 0, { emissive: 0xd32f2f, emissiveIntensity: 0.9, rough: 0.5 });
  },

  IRON_TOWER(g, p, ctx) {
    const { W, D } = ctx;
    const h = 4.6, spread = Math.min(W, D) * 0.42;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // 用两段折线近似埃菲尔那四条外张的腿
      const seg1 = new THREE.Mesh(boxGeo(0.09, h * 0.55, 0.09), procMat(p.base, { metal: 0.55, rough: 0.6 }));
      seg1.position.set(sx * spread * 0.5, h * 0.28, sz * spread * 0.5);
      seg1.rotation.x = -sz * 0.22; seg1.rotation.z = -sx * 0.22;
      g.add(seg1);
      const seg2 = new THREE.Mesh(boxGeo(0.08, h * 0.5, 0.08), procMat(p.base, { metal: 0.55, rough: 0.6 }));
      seg2.position.set(sx * spread * 0.18, h * 0.78, sz * spread * 0.18);
      seg2.rotation.x = -sz * 0.09; seg2.rotation.z = -sx * 0.09;
      g.add(seg2);
    }
    box(g, p.trim, spread * 1.4, 0.16, spread * 1.4, 0, h * 0.5, 0, { metal: 0.5 });
    box(g, p.trim, spread * 0.9, 0.14, spread * 0.9, 0, h * 0.78, 0, { metal: 0.5 });
    cone(g, p.roof, spread * 0.26, 0.7, 0, h, 0, 4);
  },

  SKYSCRAPER(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.9, 1.6, D * 0.9, 0, 0, 0);
    box(g, p.trim, W * 0.72, 1.4, D * 0.72, 0, 1.6, 0);
    box(g, p.base, W * 0.5, 1.3, D * 0.5, 0, 3.0, 0);
    box(g, p.roof, W * 0.3, 0.6, D * 0.3, 0, 4.3, 0);
    cyl(g, 0x90a4ae, 0.04, 0.04, 1.0, 0, 4.9, 0, { metal: 0.6 }, 6);
    for (let i = 0; i < 3; i++) {
      box(g, 0x9fd0ff, W * 0.9, 0.22, D * 0.92, 0, 0.5 + i * 0.5, 0, { rough: 0.25, metal: 0.4 });
    }
  },

  PALACE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0xcfc7b8, W * 0.96, 0.26, D * 0.96, 0, 0, 0, { rough: 0.95 });
    box(g, p.base, W * 0.8, 1.9, D * 0.66, 0, 0.26, -D * 0.08);
    box(g, p.roof, W * 0.86, 0.18, D * 0.72, 0, 2.16, -D * 0.08);
    repeatX(g, 8, i => cyl(g, p.trim, 0.1, 0.1, 1.7, (i - 3.5) * W * 0.115, 0.26, D * 0.36, null, 10));
    // 中央穹顶
    cyl(g, p.trim, D * 0.24, D * 0.24, 0.6, 0, 2.34, -D * 0.08, null, 16);
    sphere(g, p.roof, D * 0.26, 0, 3.2, -D * 0.08, { metal: 0.25, rough: 0.45 });
    cyl(g, 0xd4af37, 0.03, 0.03, 0.5, 0, 3.5, -D * 0.08, { metal: 0.7 }, 6);
    repeatX(g, 2, i => {         // 两侧旗帜
      const x = (i ? 1 : -1) * W * 0.42;
      cyl(g, 0x8d6e63, 0.04, 0.04, 1.4, x, 0.26, D * 0.3, null, 6);
      box(g, 0xd84315, 0.36, 0.24, 0.04, x + 0.18, 1.4, D * 0.3, { rough: 0.8 });
    });
  },

  EXPO(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0xcfc7b8, W * 0.96, 0.2, D * 0.96, 0, 0, 0, { rough: 0.95 });
    // 中央大拱
    const arch = new THREE.Mesh(new THREE.TorusGeometry(Math.min(W, D) * 0.36, 0.09, 8, 24, Math.PI),
      procMat(p.trim, { metal: 0.2, rough: 0.6 }));
    arch.position.set(0, 0.2, 0); g.add(arch);
    box(g, p.base, W * 0.34, 0.3, D * 0.34, -W * 0.3, 0.2, -D * 0.2);
    box(g, p.base, W * 0.34, 0.3, D * 0.34, W * 0.3, 0.2, -D * 0.2);
    // 玻璃展馆
    const hall = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.28, D * 0.28, 0.9, 16),
      procMat(0x9fd0ff, { rough: 0.2, metal: 0.4 }));
    hall.position.set(W * 0.28, 0.65, D * 0.26); g.add(hall);
    sphere(g, 0x9fd0ff, D * 0.28, W * 0.28, 1.1, D * 0.26, { rough: 0.2, metal: 0.4 });
  },

  /* ---------------- 港口系列 ---------------- */

  WAREHOUSE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.94, 1.1, D * 0.86, 0, 0, 0);
    gable(g, p.roof, W, D * 0.92, 1.1, 0.4);
    repeatX(g, 3, i => box(g, p.dark, W * 0.24, 0.7, 0.08, (i - 1) * W * 0.3, 0, D * 0.44, { rough: 0.85 }));
    repeatX(g, 3, i => box(g, 0xb98b4f, 0.3, 0.3, 0.3, (i - 1) * 0.36, 0, -D * 0.42, { rough: 0.92 }));
    box(g, p.trim, W * 0.96, 0.08, D * 0.2, 0, 0.7, D * 0.48, { rough: 0.8 });     // 装卸雨棚
  },

  // 码头吊机（贸易站 / 修理起重机 / 港区）
  QUAY_CRANE(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.6, 1.0, D * 0.6, -W * 0.16, 0, -D * 0.16);
    gable(g, p.roof, W * 0.64, D * 0.64, 1.0, 0.36);
    cyl(g, 0x546e7a, 0.11, 0.14, 2.2, W * 0.26, 0, D * 0.2, { metal: 0.5, rough: 0.5 }, 8);
    box(g, 0x546e7a, 1.4, 0.1, 0.1, W * 0.26 - 0.6, 2.05, D * 0.2, { metal: 0.5 });
    cyl(g, 0x37474f, 0.02, 0.02, 0.7, W * 0.26 - 1.2, 1.4, D * 0.2, null, 4);
    box(g, 0xb08a52, 0.34, 0.3, 0.34, W * 0.26 - 1.2, 0.7, D * 0.2, { rough: 0.92 }); // 吊着的货箱
    repeatX(g, 2, i => box(g, 0xb08a52, 0.34, 0.34, 0.34, -W * 0.3, 0, D * 0.34 - i * 0.4, { rough: 0.92 }));
  },

  JETTY(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x8d8577, W * 0.94, 0.24, D * 0.94, 0, 0, 0, { rough: 0.98 });          // 石砌台
    box(g, 0xa1887f, W * 0.5, 0.08, D * 0.5, W * 0.2, 0.24, 0, { rough: 0.95 });   // 木铺面
    repeatX(g, 3, i => cyl(g, 0x6d4c41, 0.07, 0.07, 0.7, (i - 1) * W * 0.3, 0.24, D * 0.42, null, 6));
    box(g, p.base, W * 0.28, 0.7, D * 0.3, -W * 0.32, 0.24, -D * 0.24);
    gable(g, p.roof, W * 0.32, D * 0.34, 0.94, 0.3);
  },

  MOORING(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x8d9db6, W * 0.9, 0.2, D * 0.9, 0, 0, 0, { rough: 0.9 });              // 浮码头
    repeatX(g, 4, i => cyl(g, 0x455a64, 0.05, 0.05, 0.5,
      (i % 2 ? 1 : -1) * W * 0.4, 0, (i < 2 ? 1 : -1) * D * 0.4, null, 6));
    box(g, p.base, W * 0.26, 0.7, D * 0.26, -W * 0.3, 0.2, -D * 0.28);
    gable(g, p.roof, W * 0.3, D * 0.3, 0.9, 0.28);
  },

  DRYDOCK(g, p, ctx) {
    const { W, D } = ctx;
    box(g, 0x6d5f4a, W * 0.9, 0.2, D * 0.86, 0, -0.1, 0, { rough: 1 });            // 坞底
    for (const sx of [-1, 1]) box(g, p.dark, 0.14, 0.6, D * 0.9, sx * W * 0.44, -0.1, 0, { rough: 0.95 });
    box(g, p.dark, W * 0.9, 0.6, 0.14, 0, -0.1, -D * 0.44, { rough: 0.95 });
    // 龙骨墩 + 门式吊架
    repeatX(g, 4, i => box(g, 0x8d6e63, 0.1, 0.3, D * 0.7, (i - 1.5) * W * 0.22, 0.0, 0, { rough: 0.95 }));
    box(g, 0x546e7a, W * 0.9, 0.1, 0.1, 0, 1.5, D * 0.3, { metal: 0.5 });
    cyl(g, 0x546e7a, 0.08, 0.08, 1.5, -W * 0.4, 0, D * 0.3, { metal: 0.5 }, 6);
    cyl(g, 0x546e7a, 0.08, 0.08, 1.5, W * 0.4, 0, D * 0.3, { metal: 0.5 }, 6);
  },

  /* ---------------- 军事系列 ---------------- */

  GUN_BATTERY(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.dark, W * 0.9, 0.5, D * 0.9, 0, 0, 0, { rough: 0.95 });              // 胸墙
    repeatX(g, 3, i => box(g, p.trim, 0.2, 0.3, 0.16, (i - 1) * W * 0.3, 0.5, D * 0.42, { rough: 0.9 }));
    for (const sx of [-1, 1]) {
      const barrel = new THREE.Mesh(cylGeo(0.07, 0.09, 1.0, 8), procMat(0x37474f, { metal: 0.6, rough: 0.5 }));
      barrel.position.set(sx * W * 0.22, 0.78, D * 0.16);
      barrel.rotation.x = -0.55;
      g.add(barrel);
      box(g, 0x455a64, 0.26, 0.24, 0.26, sx * W * 0.22, 0.5, D * 0.3, { metal: 0.4 });
    }
    box(g, p.base, W * 0.3, 0.6, D * 0.3, -W * 0.34, 0, -D * 0.3, { rough: 0.9 });
  },

  BIG_GUN(g, p, ctx) {
    const { W, D } = ctx;
    cyl(g, p.dark, W * 0.34, W * 0.4, 0.3, 0, 0, 0, null, 16);                     // 炮座
    const turret = new THREE.Mesh(cylGeo(W * 0.22, W * 0.26, 0.5, 12), procMat(p.base, { metal: 0.3, rough: 0.7 }));
    turret.position.y = 0.5; g.add(turret);
    const barrel = new THREE.Mesh(cylGeo(0.11, 0.14, 1.7, 10), procMat(0x37474f, { metal: 0.65, rough: 0.45 }));
    barrel.position.set(0, 0.68, D * 0.36);
    barrel.rotation.x = Math.PI / 2 - 0.35;
    g.add(barrel);
    repeatX(g, 4, i => box(g, p.dark, 0.18, 0.24, 0.18,
      Math.cos(i / 4 * Math.PI * 2) * W * 0.36, 0.3, Math.sin(i / 4 * Math.PI * 2) * D * 0.36, { rough: 0.95 }));
  },

  /* ---------------- 交通小件 ---------------- */

  RAIL_STATION(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.44, 1.0, D * 0.6, -W * 0.24, 0, -D * 0.1);
    gable(g, p.roof, W * 0.48, D * 0.66, 1.0, 0.4);
    // 雨棚 + 站台 + 两条轨道
    repeatX(g, 4, i => cyl(g, 0x455a64, 0.05, 0.05, 1.2, (i - 1.5) * W * 0.13 + W * 0.1, 0, D * 0.36, null, 6));
    box(g, p.trim, W * 0.6, 0.08, D * 0.5, W * 0.1, 1.2, D * 0.24, { rough: 0.7 });
    box(g, 0xcfc7b8, W * 0.9, 0.1, D * 0.4, 0, 0.02, D * 0.34, { rough: 0.95 });
    for (const z of [D * 0.22, D * 0.44]) {
      box(g, 0x455a64, W * 0.9, 0.05, 0.05, 0, 0.1, z, { metal: 0.6, rough: 0.5 });
      box(g, 0x455a64, W * 0.9, 0.05, 0.05, 0, 0.1, z + 0.12, { metal: 0.6, rough: 0.5 });
    }
  },

  BUS_STOP(g, p, ctx) {
    const { W, D } = ctx;
    box(g, p.base, W * 0.7, 0.5, 0.06, 0, 1.0, -D * 0.24, { rough: 0.85 });        // 背板
    box(g, p.trim, W * 0.8, 0.08, D * 0.6, 0, 1.5, 0, { rough: 0.7 });             // 顶棚
    cyl(g, 0x455a64, 0.05, 0.05, 1.5, -W * 0.34, 0, D * 0.24, null, 6);
    cyl(g, 0x455a64, 0.05, 0.05, 1.5, W * 0.34, 0, D * 0.24, null, 6);
    box(g, 0x8d6e63, W * 0.5, 0.1, 0.2, 0, 0.42, 0, { rough: 0.95 });              // 长凳
    box(g, 0xd84315, 0.3, 0.22, 0.04, W * 0.24, 1.7, -D * 0.24, { rough: 0.8 });   // 站牌
  },

  POSTBOX(g, p, ctx) {
    cyl(g, p.base, 0.16, 0.18, 0.7, 0, 0, 0, null, 10);
    sphere(g, p.trim, 0.17, 0, 0.7, 0, { rough: 0.7 });
    box(g, 0x263238, 0.2, 0.06, 0.04, 0, 0.5, 0.16, { rough: 0.8 });               // 投信口
    box(g, p.dark, 0.4, 0.06, 0.06, 0, 0.86, 0, { rough: 0.85 });
  },
};

/**
 * 按形制拼出一栋建筑。
 *
 * @param form  形制名（服务端 BuildingType.form.name()）
 * @param tint  主色（服务端下发）
 * @param w,h   占地格数（未旋转前的基准尺寸）
 * @param seed  稳定随机数（用建筑 id 推导，保证同一座楼每次重建长得一样）
 * @returns {THREE.Group} 原点在**占地中心**、地面 y=0 的体块组；几何由调用方回收
 */
export function makeProcBuilding(form, tint, w, h, seed = 1) {
  const g = new THREE.Group();
  const W = w * 1.7 * 0.86;      // 与 game.html 的 bw/bd 同一套换算
  const D = h * 1.7 * 0.86;
  const p = palette(tint);
  const ctx = { W, D, s: Math.min(W, D), seed: Math.abs(seed | 0) };
  const fn = FORMS[form] || FORMS.FACTORY;
  try {
    fn(g, p, ctx);
  } catch (e) {
    // 形制拼装失败时退回"一个盒子加一个屋顶"，绝不让整座岛的渲染挂掉
    box(g, p.base, W * 0.9, 1.2, D * 0.9, 0, 0, 0);
    cone(g, p.roof, W * 0.5, 0.6, 0, 1.2, 0, 4);
  }
  return g;
}

/** 所有形制名（自检用：服务端下发的 form 必须都在这张表里） */
export function procForms() {
  return Object.keys(FORMS);
}
