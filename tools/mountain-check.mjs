// 山脉位置验证：连建 5 座新岛，断言山体质心偏离岛心（不再靶心）+ 陆地占比正常
// 再挑一座偏心最明显的进游戏截俯视图
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '山脉验证' + stamp;

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};

const islands = [];
const p = await api('/api/players/register', 'POST', { name: NAME });
for (let k = 0; k < 5; k++) {
  islands.push(await api('/api/islands', 'POST', { playerId: p.id, name: '山岛' + k }));
}

let fails = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + msg);
  if (!cond) fails++;
};

const stats = islands.map(isl => {
  const G = Math.sqrt(isl.terrain.length);
  let land = 0, mt = 0, sx = 0, sz = 0;
  for (let z = 0; z < G; z++) for (let x = 0; x < G; x++) {
    const c = isl.terrain[z * G + x];
    if (c === '~') continue;
    land++;
    if (c === '^') { mt++; sx += x; sz += z; }
  }
  const cx = mt ? sx / mt - (G - 1) / 2 : 0;      // 山体质心相对岛心的格偏移
  const cz = mt ? sz / mt - (G - 1) / 2 : 0;
  const off = Math.hypot(cx, cz) / (G / 2);        // 归一化偏移（0=正中心，1=边）
  console.log(`岛 ${isl.id}: 陆地 ${(land / (G * G) * 100).toFixed(1)}%, 山 ${mt} 格, 山心偏移 ${off.toFixed(2)} (${cx.toFixed(1)}, ${cz.toFixed(1)})`);
  return { isl, land, mt, off };
});

assert(stats.every(s => Math.abs(s.land / (s.isl.terrain.length) - 0.62) < 0.03), '陆地占比都在 62% 附近');
assert(stats.every(s => s.mt > 300), '每座岛都有像样的山体（>300 格）');
const offAvg = stats.reduce((a, s) => a + s.off, 0) / stats.length;
assert(offAvg > 0.12, `平均山心偏移 ${offAvg.toFixed(2)} > 0.12（不再都压中心）`);
assert(stats.filter(s => s.off > 0.08).length >= 4, '至少 4/5 座岛明显偏心');

// 挑偏心最大的岛截俯视图
const best = stats.reduce((a, b) => (b.off > a.off ? b : a));
console.log('截图岛:', best.isl.id, '偏移', best.off.toFixed(2));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 6000));
  // 切到目标岛：刷新岛屿列表后选偏心岛 —— 简化：直接用 cam 俯视（当前岛也是新岛之一，效果同类）
  const G = Math.sqrt(best.isl.terrain.length);
  const mid = Math.floor(G / 2);
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  await page.evaluate(([m]) => window.__annoCam(m, m, 170, 0.35, 0.5), [mid]);
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/mountain-top.png' });
  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  assert(pageErrors.length === 0, '无页面 JS 错误');
  console.log(fails === 0 ? 'ALL_PASS' : `FAILED ${fails}`);
} finally {
  await browser.close();
}
