/**
 * 建造预览验证：**拿在手里的幽灵必须和落下去那座长得一样**。
 *   1. 幽灵不是"一个方块"：程序化形制有多个零件
 *   2. 幽灵的包围盒 = 落下去那座建筑的包围盒（宽/深/高误差 <10%，允许 90° 转向对调）
 *   3. 有 GLB 模型的类型：幽灵同样用真模型（零件数与实体一致）
 *   4. 放不下时幽灵变红（材质切到"禁止"档）
 *   5. 页面零报错
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '预览验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✅ ' : '  ❌ ') + name + (detail ? ' —— ' + detail : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + r.status + ' ' + JSON.stringify(j));
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '预览岛', flat: true });
/* 一条横马路：(4,10)~(12,10)，建筑贴着它往北放 */
for (let x = 4; x <= 12; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 10 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox', '--window-size=1280,800'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(7000);

  const modelHave = await page.evaluate(() => window.__annoModelHave());
  console.log(`     已有 GLB 模型的类型：${modelHave.join(', ') || '（无）'}`);

  /** 等某个类型的 GLB 真的进了缓存（大模型要下几秒，预览会先从占位体块切成真模型） */
  const waitModel = async (type) => {
    for (let t = 0; t < 30; t++) {
      const c = await page.evaluate(() => window.__annoModelCache());
      if (c.includes(type)) return true;
      await sleep(1000);
    }
    return false;
  };

  /** 拿一张建造卡 → 把鼠标移到目标格 → 读幽灵 → 点下去 → 读落成实体 */
  const tryOne = async (type, gx, gz) => {
    await page.evaluate(t => {
      const b = document.querySelector(`button[data-build="${t}"]`);
      if (b) b.click();
    }, type);
    await sleep(300);
    const px = await page.evaluate((x, z) => window.__annoProject(x, z), gx, gz);   // [屏幕x, 屏幕y]
    await page.mouse.move(px[0], px[1]);
    await sleep(400);
    if (modelHave.includes(type)) {
      const loaded = await waitModel(type);
      await page.mouse.move(px[0] + 1, px[1]);        // 抖一下让预览重画（模型到位后换成本体）
      await sleep(500);
      if (!loaded) console.log(`     （${type} 的模型 30s 没进缓存，预览可能还停在占位体块）`);
    }
    const ghost = await page.evaluate(() => window.__annoGhost());
    await page.mouse.click(px[0], px[1]);
    /* 快照是 3 秒一拍：轮询等它出现，别用固定 sleep */
    let b = null;
    for (let t = 0; t < 15 && !b; t++) {
      await sleep(1000);
      const built = await page.evaluate(() => window.__annoBuildingViews());
      b = built.find(v => v.type === type) || null;
    }
    const box = b ? await page.evaluate(id => window.__annoBldBox(id), b.id) : null;
    return { ghost, box, placed: !!b };
  };

  const cmp = (g, r) => {
    if (!g || !r) return '缺数据';
    const gs = [g.size[0], g.size[2]].sort((a, b) => a - b);   // 90° 转向会把宽深对调
    const rs = [r.size[0], r.size[2]].sort((a, b) => a - b);
    const dw = Math.abs(gs[0] - rs[0]) / Math.max(0.001, rs[0]);
    const dd = Math.abs(gs[1] - rs[1]) / Math.max(0.001, rs[1]);
    const dh = Math.abs(g.size[1] - r.size[1]) / Math.max(0.001, r.size[1]);
    return { dw, dd, dh, gs, rs, g, r };
  };

  /* 1~2. 程序化形制：伐木场（2×2，hover 格要按锚点公式反推，否则外圈不贴路） */
  {
    const { ghost, box, placed } = await tryOne('LUMBERJACK', 7, 9);
    check('幽灵可见、且不是"一个方块"（程序化形制有多个零件）',
      ghost && ghost.visible !== false && ghost.meshes > 1,
      `零件 ${ghost && ghost.meshes} 个，缓存键 ${ghost && ghost.key}`);
    check('伐木场真的落成了（看得见实体才能比尺寸）', placed, placed ? '' : '没建成，先检查外圈是否贴路');
    const c = cmp(ghost, box);
    check('幽灵尺寸 = 落成建筑尺寸（伐木场，宽/深/高误差 <10%）',
      !!c.gs && c.dw < 0.1 && c.dd < 0.1 && c.dh < 0.1,
      typeof c === 'string' ? c
        : `幽灵 ${c.gs.map(v => v.toFixed(2))} 高 ${c.g.size[1].toFixed(2)} · 实体 ${c.rs.map(v => v.toFixed(2))} 高 ${c.r.size[1].toFixed(2)}`);
  }

  /* 3. 有 GLB 模型的类型：幽灵同样用真模型 */
  {
    /* 挑一栋**开局就能建**的带模型建筑：住宅要先有贸易站、工人层的会被人口门槛挡住，
       所以优先用农夫层的烈酒厂（它也是目前唯一的"真模型厂房"） */
    const withModel = modelHave.includes('SCHNAPPS_DISTILLERY')
      ? 'SCHNAPPS_DISTILLERY'
      : modelHave.find(t => ['MILL', 'FARMER_HOUSE'].includes(t));
    if (!withModel) {
      check('有 GLB 模型的类型：幽灵用真模型', false, '当前没有已接入模型的类型，跳过验证的前提不满足');
    } else {
      const { ghost, box, placed } = await tryOne(withModel, 10, 8);
      const c = cmp(ghost, box);
      check(`有 GLB 模型的类型（${withModel}）：幽灵与实体同为模型（零件数一致、尺寸一致）`,
        placed && !!box && Math.abs(ghost.meshes - box.meshes) <= 2 && c.dw < 0.1 && c.dd < 0.1 && c.dh < 0.12,
        !box ? `没落成（${placed}）`
          : `零件 幽灵 ${ghost.meshes} / 实体 ${box.meshes}；尺寸 ${c.gs.map(v => v.toFixed(2))} vs ${c.rs.map(v => v.toFixed(2))}，高 ${c.g.size[1].toFixed(2)} vs ${c.r.size[1].toFixed(2)}`);
    }
  }

  /* 4. 放不下时幽灵变红 */
  {
    await page.evaluate(() => {
      const b = document.querySelector('button[data-build="LUMBERJACK"]');
      if (b) b.click();
    });
    await sleep(300);
    const px = await page.evaluate(() => window.__annoProject(6, 8));   // 刚建过伐木场，这里压着建筑
    await page.mouse.move(px[0], px[1]);
    await sleep(400);
    const bad = await page.evaluate(() => window.__annoGhost());
    check('放不下时幽灵变红（材质切到禁止档）', bad && bad.ok === false, `ok=${bad && bad.ok}`);
  }

  check('页面零报错', errors.length === 0, errors.join(' | ') || '无');
} finally {
  await browser.close();
}
console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
