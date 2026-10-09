import * as THREE from 'three';

/* ============================================================
   商船：贸易站的自动航线
   —— 服务端只给"这趟走到哪了"（相位），位置全在客户端算。
      所以船在海面上是连续航行的，而服务端每 3 秒才推一次快照。
   ============================================================ */

/**
 * 相位分段：**必须与服务端 ShipService 里的 OUT_END / DWELL_END / BACK_END 一致**，
 * 否则面板写着"返航中"而船还在往外开。
 */
export const SHIP_CONFIG = {
  outEnd: 0.42,        // 0 ~ 0.42 出海
  dwellEnd: 0.50,      // 0.42 ~ 0.50 在外海市场停靠
  backEnd: 0.92,       // 0.50 ~ 0.92 返航
  cruise: 132,         // 离港后往外海开多远（世界单位）
  bow: 30,             // 航线往侧面鼓出去多少：去程鼓一侧、回程鼓另一侧，看起来是个环
  draft: 0.16,         // 吃水深度（船体中心相对水面的高度）
  turnRate: 2.2,       // 转向快慢（弧度/秒）
};

/* 低多边形的小船就这几块：船体 + 四棱锥船头 + 舱室 + 桅杆 + 帆 + 货箱。
   材质全局共用一份 —— 十几条船共用同一套材质，省 draw call 也省显存。 */
const MAT = {
  hull:  new THREE.MeshStandardMaterial({ color:0x6d4c33, flatShading:true, roughness:.85 }),
  deck:  new THREE.MeshStandardMaterial({ color:0xc9a97a, flatShading:true, roughness:.8 }),
  sail:  new THREE.MeshStandardMaterial({ color:0xf2ece0, flatShading:true, roughness:.9,
                                          side:THREE.DoubleSide }),
  trim:  new THREE.MeshStandardMaterial({ color:0x8d3b2f, flatShading:true, roughness:.85 }),
  crate: new THREE.MeshStandardMaterial({ color:0xa3703f, flatShading:true, roughness:.9 }),
  wake:  new THREE.MeshBasicMaterial({ color:0xffffff, transparent:true, opacity:.22,
                                       depthWrite:false }),
};

/** 拼一条小船（朝 +z 为正前方）。整体长约 3.8 个世界单位 ≈ 2.2 格，跟贸易站(3×3)成比例 */
function buildBoat() {
  const g = new THREE.Group();

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 2.6), MAT.hull);
  hull.position.y = 0.2; g.add(hull);

  /* 船头：四棱锥。先压扁再绕 x 转 90° —— 转完锥尖朝 +z，
     而局部 z 轴映射到世界的竖直方向，所以压的是局部 z（顺序不能反） */
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.78, 1.2, 4), MAT.hull);
  bow.scale.set(1, 1, 0.42);
  bow.rotation.x = Math.PI / 2;
  bow.position.set(0, 0.2, 1.88); g.add(bow);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 2.6), MAT.deck);
  deck.position.y = 0.46; g.add(deck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.5, 0.85), MAT.trim);
  cabin.position.set(0, 0.72, -0.62); g.add(cabin);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.3, 5), MAT.hull);
  mast.position.set(0, 1.62, 0.15); g.add(mast);

  const sail = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.55), MAT.sail);
  sail.position.set(0, 1.78, 0.15); g.add(sail);

  /* 货箱：只有返航那一段才露出来（去程空着舱，回程装着货） */
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.62), MAT.crate);
  crate.position.set(0.3, 0.8, 0.78); g.add(crate);

  /* 尾迹：一块贴在水面上的半透明白布。它自己也要跟着浪起伏，
     否则浪一高就从水里穿出来了（见 update 里的 seaHeight 采样）。 */
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 6.5), MAT.wake);
  wake.rotation.x = -Math.PI / 2;
  wake.position.set(0, 0, -3.4); g.add(wake);

  g.userData = { crate, wake, sail };
  return g;
}

/* ============ 泡沫粒子池：船与水的"真接触"演出 ============
   水面是平的（官方 Water，浪只是法线贴图），任何挂在船身上的白面片都会像贴纸。
   所以泡沫是**独立粒子**：软圆点贴图 + 加法混合 + InstancedMesh 池，
   粒子落在水面上（不是船身上），出生小而亮 → 边扩散边变淡 → 沉掉。
   船头破浪、船尾拖尾全用它。 */
function foamTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.4, 'rgba(255,255,255,.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

class FoamPool {
  /** @param flatY 可见水面的世界高度（平的）——粒子必须贴它，贴船身就成贴图了 */
  constructor(scene, flatY) {
    this.flatY = flatY;
    this.cap = 360;
    const mat = new THREE.MeshBasicMaterial({
      map: foamTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};                    // 泡沫不参与拾取
    /* 逐实例颜色当透明度用：加法混合下乘到黑 = 消失（InstancedMesh 不支持逐实例 opacity） */
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.parts = new Array(this.cap).fill(null);
    this.cursor = 0;
    this._q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(); this._c = new THREE.Color();
    scene.add(this.mesh);
  }
  spawn(x, z, size, life) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.cap;
    this.parts[i] = { x, z, age: 0, max: life, s0: size * 0.4, s1: size };
  }
  update(dt, t) {
    const { _m, _p, _s, _q, _c } = this;
    for (let i = 0; i < this.cap; i++) {
      const p = this.parts[i];
      if (!p) continue;
      p.age += dt;
      if (p.age >= p.max) {
        this.parts[i] = null;
        _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m);
        continue;
      }
      const k = p.age / p.max;
      const s = p.s0 + (p.s1 - p.s0) * k;                        // 扩散
      _p.set(p.x, this.flatY + 0.03, p.z);                       // 贴水面
      _s.set(s, s, 1);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      const a = (1 - k) * (1 - k) * 0.9;                         // 先亮后淡
      _c.setRGB(a, a, a);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 角度插值：走最短的那一边，避免掉头时船原地转一大圈 */
function turnTo(cur, target, k) {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

/* 真船模型（models/SHIP.glb）：game.html 加载就位后调 setShipProto 装进来。
   没装上一律程序化小船；装上那刻做**热替换** —— 海上已有的小船整体换成模型
   （相位/朝向不用迁移动作，update() 每帧都重算位置）。 */
let SHIP_PROTO = null;

function buildShipMesh() {
  if (!SHIP_PROTO) return buildBoat();
  const inst = SHIP_PROTO.clone(true);
  const size = new THREE.Box3().setFromObject(inst).getSize(new THREE.Vector3());
  /* 不再挂任何"白面片尾迹"——水面是平的，挂在船身上的面片就是贴纸观感。
     水花全走 FoamPool 粒子（贴水面、独立于船），喷射位置按船体实际长宽（dims）算，
     吃水深度由 game.html 归一化时把船底压进水里。
     crate 空壳只为 update() 写 userData.crate.visible 不炸。 */
  inst.userData = { crate: new THREE.Object3D(), dims: { len: size.z, beam: size.x } };
  return inst;
}

/** 船此刻的显示相位（毫秒，已取模到 [0, cycle)）：锚点 + 墙上外推 + 未吸收完的重锚差值 */
export function shipPhaseMs(n, now) {
  const cycle = (n.data && n.data.cycleMs) || 96000;
  const k = n.correct ? Math.min(1, (now - n.correctT) / 1200) : 0;
  const ms = n.data.phaseMs + (now - n.data.snapAt) + (n.correct || 0) * k;
  return ((ms % cycle) + cycle) % cycle;
}

export class ShipFleet {
  /**
   * @param scene     three.js 场景
   * @param seaHeight (x, z, t) => 浪高。船要浮在浪上，尾迹也要贴着水面
   */
  constructor(scene, { seaHeight, flatY = 0 }) {
    this.seaHeight = seaHeight;
    this.foam = new FoamPool(scene, flatY);       // 泡沫粒子池：船与水的接触演出
    this.group = new THREE.Group();
    scene.add(this.group);
    /** harborId -> { mesh, data, heading, seed, correct, correctT } */
    this.ships = new Map();
  }

  /** 装上真船模型：海上已有的程序化小船热替换成模型（相位照旧，位置每帧重算） */
  setShipProto(proto) {
    SHIP_PROTO = proto;
    this.protoSet = true;
    for (const n of this.ships.values()) {
      this.group.remove(n.mesh);
      n.mesh = buildShipMesh();
      n.usesProto = true;
      this.group.add(n.mesh);
    }
  }

  /**
   * 用服务端那份船列表对齐画面：新增的开进来，消失的（贸易站被拆了）开走。
   *
   * @param list 每项要带：harborId / name / x / z（港口出海口）/ dirX / dirZ（出海方向）/
   *             phaseMs（本趟走了多少毫秒）/ cycleMs（一趟多久）/ cargoQty / state ...
   */
  sync(list) {
    const now = Date.now();
    const seen = new Set();
    for (const s of list) {
      seen.add(s.harborId);
      let n = this.ships.get(s.harborId);
      if (!n) {
        const mesh = buildShipMesh();
        n = { mesh, heading: Math.atan2(s.dirX, s.dirZ), seed: (s.harborId % 7) * 1.7,
              correct: 0, correctT: 0, usesProto: !!SHIP_PROTO, fAcc: 0 };
        this.ships.set(s.harborId, n);
        this.group.add(mesh);
      }
      /* 【平滑重锚，不做硬跳】直接拿服务端 phaseMs 当新锚点，船会在快照边界上瞬移：
         - 服务端处理 / 网络抖动几十上百毫秒，每次快照船都"顿"一下；
         - 服务端重启 / 断线重连期间，客户端还在按墙上时间外推让船继续开，
           而服务端把离线时间冻结了 —— 回连后服务端相位落后一大截，
           船会肉眼可见地"倒退"，这就是玩家报的"船有延迟"。
         正确姿势：保留当前外推相位作为新锚点（画面连续），算出与目标相位
         的最短圈差，交给 update() 在 ~1.2 秒内匀速吸收 —— 船只是轻微
         加速/减速滑到该在的位置，永不瞬移。 */
      const cycle = s.cycleMs || 96000;
      const cur = n.data ? shipPhaseMs(n, now) : (((s.phaseMs % cycle) + cycle) % cycle);
      const target = (((s.phaseMs % cycle) + cycle) % cycle);
      let dph = (target - cur) % cycle;
      if (dph > cycle / 2) dph -= cycle;
      if (dph < -cycle / 2) dph += cycle;
      n.correct = dph;
      n.correctT = now;
      n.data = { ...s, phaseMs: cur, snapAt: now };
    }
    for (const [id, n] of this.ships) {
      if (seen.has(id)) continue;
      this.group.remove(n.mesh);
      this.ships.delete(id);
    }
  }

  /** 每帧推进：算相位 → 算航点 → 摆位置、转向、随浪起伏 → 泡沫粒子生灭 */
  update(dt, t) {
    const C = SHIP_CONFIG;
    this.foam.update(dt, t);
    for (const n of this.ships.values()) {
      const d = n.data;
      if (!d) continue;

      const cycle = d.cycleMs || 96000;
      const now = Date.now();
      let ms = d.phaseMs + (now - d.snapAt);
      /* 吸收重锚差值：1.2 秒线性匀速补完（补完就地入锚，防止重复计算） */
      if (n.correct) {
        const k = Math.min(1, (now - n.correctT) / 1200);
        ms += n.correct * k;
        if (k >= 1) { d.phaseMs += n.correct; d.snapAt = now; n.correct = 0; }
      }
      const p = (((ms % cycle) + cycle) % cycle) / cycle;

      /* 相位 → 航点 u（0=港内，1=外海市场）。
         去程 u 从 0 涨到 1，回程再退回 0，所以船是"开出去、绕一圈、开回来"。 */
      let u, side;
      if (p < C.outEnd) { u = p / C.outEnd; side = 1; }
      else if (p < C.dwellEnd) { u = 1; side = 1; }
      else if (p < C.backEnd) { u = 1 - (p - C.dwellEnd) / (C.backEnd - C.dwellEnd); side = -1; }
      else { u = 0; side = -1; }

      /* 二次贝塞尔：控制点落在中点往侧面偏一点的地方。
         去程与回程各偏一侧，于是往返走的是两条不同的弧 —— 直来直去太像摆锤。 */
      const hx = d.x, hz = d.z;
      const fx = hx + d.dirX * C.cruise, fz = hz + d.dirZ * C.cruise;
      const px = -d.dirZ, pz = d.dirX;
      const mx = (hx + fx) / 2 + px * C.bow * side;
      const mz = (hz + fz) / 2 + pz * C.bow * side;

      const iu = 1 - u;
      const x = iu * iu * hx + 2 * iu * u * mx + u * u * fx;
      const z = iu * iu * hz + 2 * iu * u * mz + u * u * fz;

      /* 船头朝向：贝塞尔在当前 u 处的切线方向。停靠那一段没有位移，
         目标改成"掉头朝回港方向"，看起来就像在码头前打了个转。 */
      const back = p >= C.dwellEnd;
      const tx = (2 * iu * (mx - hx) + 2 * u * (fx - mx)) * (back ? -1 : 1);
      const tz = (2 * iu * (mz - hz) + 2 * u * (fz - mz)) * (back ? -1 : 1);
      const target = Math.atan2(tx, tz);
      n.heading = turnTo(n.heading, target, Math.min(1, dt * C.turnRate));
      n.mesh.rotation.y = n.heading;

      /* 浮在浪上：船身跟着浪高上下，再补一点摇晃 —— 静止的船在动海里会很假 */
      const wave = this.seaHeight(x, z, t);
      n.mesh.position.set(x, wave + C.draft, z);
      n.mesh.rotation.z = Math.sin(t * 1.5 + n.seed) * 0.05;
      n.mesh.rotation.x = Math.sin(t * 1.1 + n.seed * 2) * 0.03;

      /* 尾迹面片：只有程序化小船还有（真模型船的水花走粒子池），有才更新 */
      const w = n.mesh.userData.wake;
      if (w) {
        w.position.y = this.seaHeight(x, z - 3.4, t) - (wave + C.draft) + 0.04;
        w.material.opacity = 0.1 + (1 - u) * 0.16;    // 出港越远尾迹越淡
      }

      /* 泡沫粒子：船头破浪 + 船尾拖尾，贴着水面生灭 —— 只有真模型船且在动时喷 */
      if (n.usesProto && u > 0.04 && u < 0.96) {
        const dim = n.mesh.userData.dims || { len: 5.6, beam: 1.8 };
        const fx = Math.sin(n.heading), fz = Math.cos(n.heading);
        n.fAcc += dt * 26;                            // 每秒约 26 粒
        while (n.fAcc >= 1) {
          n.fAcc -= 1;
          const r = Math.random;
          const bx = x + fx * dim.len * 0.48, bz = z + fz * dim.len * 0.48;
          this.foam.spawn(bx + (r() - .5) * dim.beam * 0.9, bz + (r() - .5) * dim.beam * 0.9,
            0.55 + r() * 0.5, 1.4 + r() * 1.2);
          if (r() < 0.6) {
            const tx = x - fx * dim.len * 0.52, tz = z - fz * dim.len * 0.52;
            this.foam.spawn(tx + (r() - .5) * dim.beam, tz + (r() - .5) * dim.beam,
              0.8 + r() * 0.9, 2.2 + r() * 1.6);
          }
        }
      }

      /* 货箱：回程那一段才在甲板上（去程是空舱出去的） */
      n.mesh.userData.crate.visible = back && p < C.backEnd && (d.cargoQty || 0) > 0;
    }
  }
}
