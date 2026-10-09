// 树木分布验证：俯视全岛截图 + 断言树量、东西两半都有树（不再半边光秃）
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '树木验证' + stamp;

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

const p = await api('/api/players/register', 'POST', { name: NAME });
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '森林岛' });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
const pageErrors = [];
let fails = 0;
const assert = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + msg);
  if (!cond) fails++;
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  // 树量 + 空间分布：把实例矩阵读出来，按世界 x 正负分半数
  const stat = await page.evaluate(() => {
    const out = [];
    const m = window.__annoTreeStats && window.__annoTreeStats();
    return m;
  });
  console.log('treeStats:', JSON.stringify(stat));
  assert(stat && stat.count > 300, `树量 ${stat && stat.count} > 300`);
  assert(stat && stat.east > 40 && stat.west > 40, `东西两半都有树（东 ${stat.east} / 西 ${stat.west}）`);
  assert(stat && stat.north > 40 && stat.south > 40, `南北两半都有树（北 ${stat.north} / 南 ${stat.south}）`);

  // 俯视全岛截图
  const G = Math.sqrt(i1.terrain.length);
  const mid = Math.floor(G / 2);
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  await page.evaluate(([m]) => window.__annoCam(m, m, 165, 0.32, 0.4), [mid]);
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/trees-top.png' });
  // 低角度看林子
  await page.evaluate(([m]) => window.__annoCam(m, m, 70, 1.35, 1.2), [mid]);
  await new Promise(r => setTimeout(r, 800));
  await page.screenshot({ path: 'target/trees-low.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  assert(pageErrors.length === 0, '无页面 JS 错误');
  console.log(fails === 0 ? 'ALL_PASS' : `FAILED ${fails}`);
} finally {
  await browser.close();
}
