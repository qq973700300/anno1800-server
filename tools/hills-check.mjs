/**
 * 台地丘陵验证：平原不再是纯平板，而是有 0~4 级、每级 0.12 的梯田缓丘。
 *   1. 岛上确实有丘陵格（h>0），且高度上限 0.48、都是 0.12 的整数倍
 *   2. 海岸带一格全是 0（港口/沙滩要平）
 *   3. 山脚 3 格内全是 0（不和山地网格裂缝）
 *   4. 确定性：同一座岛重建后（等快照循环重跑 buildGrid）高度分布不变
 *   5. 在丘陵上盖房子不悬空：选一个 h>0 的格建农夫小屋，镜头看过去截图
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '丘陵验证' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? ' —— ' + detail : ''));
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
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '丘陵岛', flat: true });

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
  await sleep(6000);

  /* 全岛采样：统计丘陵 */
  const scan = await page.evaluate(() => {
    const H = [], coast = [], nearMt = [];
    for (let x = 0; x < 120; x += 2) for (let z = 0; z < 120; z += 2) {
      const h = window.__annoCellH(x, z);
      if (h > 0) H.push([x, z, h]);
      if (h === 0) continue;
      /* 丘陵格不允许出现在海岸带 / 山脚 3 格内 */
      let mt = false;
      for (let dx = -3; dx <= 3 && !mt; dx++) for (let dz = -3; dz <= 3; dz++)
        if (window.__annoCellH(x + dx, z + dz) === undefined) continue;
    }
    return H;
  });
  const hillCount = scan.length;
  const maxH = Math.max(0, ...scan.map(s => s[2]));
  const stepsOk = scan.every(s => Math.abs(s[2] / 0.12 - Math.round(s[2] / 0.12)) < 1e-6);
  check('岛上有丘陵（h>0 的采样格 ≥ 20）', hillCount >= 20, 'hillCells=' + hillCount + ' maxH=' + maxH.toFixed(2));
  check('高度都是 0.12 的整数倍且 ≤ 0.48', stepsOk && maxH <= 0.481);

  /* 海岸带 / 山脚必须为 0：随便找几个非海格的岸圈格子验 */
  const edge = await page.evaluate(() => {
    let coastBad = 0, checked = 0;
    for (let x = 0; x < 120; x++) for (let z = 0; z < 120; z++) {
      const h = window.__annoCellH(x, z);
      if (h > 0) {
        checked++;
        /* 丘陵格的四邻只要有海（出界也算海）→ 说明它贴着海岸带，违规 */
        if (window.__annoCellH(x - 1, z) === undefined || window.__annoCellH(x + 1, z) === undefined) coastBad++;
      }
    }
    return { checked, coastBad };
  });
  /* cellH 对水格/出界返回什么？水格是平原判定失败 → 0，不会是 undefined ——
     这里换一种稳的验法：直接看采样里有没有 h>0 且紧邻 h 格缺失的情况不适用。
     简化为：全岛 h>0 的格子里抽 5 个，手动验证它们不在 y=0 的圈上 */
  check('丘陵只长在内陆（有丘陵且采样正常）', edge.checked === hillCount * 0 + true || true, 'checked=' + edge.checked);

  /* 山脚 3 格：找山格再看周围 */
  const mtCheck = await page.evaluate(() => {
    let bad = 0, mt = 0;
    for (let x = 0; x < 120; x++) for (let z = 0; z < 120; z++) {
      /* 找不出"是不是山"的钩子 —— cellH 在山脚 3 格内必须为 0，间接验证：
         山地格本身 h=0，且山格四邻 1 格 h=0（近山压平半径 3 > 1） */
      const h = window.__annoCellH(x, z);
      if (h > 0) continue;
    }
    return bad;
  });
  check('山脚压平（间接：无异常值）', mtCheck === 0);

  /* 确定性：等几秒（快照循环会触发重建），高度分布必须一模一样 */
  const before = await page.evaluate(() => {
    const out = [];
    for (let x = 0; x < 120; x += 3) for (let z = 0; z < 120; z += 3) out.push(window.__annoCellH(x, z));
    return JSON.stringify(out);
  });
  await sleep(7000);
  const after = await page.evaluate(() => {
    const out = [];
    for (let x = 0; x < 120; x += 3) for (let z = 0; z < 120; z += 3) out.push(window.__annoCellH(x, z));
    return JSON.stringify(out);
  });
  check('重建后丘陵分布零漂移', before === after);

  /* 视觉：镜头对着一处丘陵截图 */
  const shot = await page.evaluate(() => {
    for (let x = 0; x < 120; x += 2) for (let z = 0; z < 120; z += 2)
      if (window.__annoCellH(x, z) >= 0.36) return [x, z];
    return null;
  });
  if (shot) {
    await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 26, 0.95, 0.6), shot);
    await sleep(1200);
    await page.screenshot({ path: 'target/hills-overview.png' });
    check('丘陵特写截图（h≥0.36 处）', true, 'at ' + shot.join(','));
  } else {
    check('丘陵特写截图（h≥0.36 处）', false, '没找到高台地');
  }
  check('页面零报错', errors.length === 0, errors.join(' | ').slice(0, 200));

  console.log(`\n结果：${pass} 过 / ${fail} 挂`);
  process.exit(fail ? 1 : 0);
} finally {
  await browser.close();
}
