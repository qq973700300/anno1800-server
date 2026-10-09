/**
 * 音效模块验证（无头听不到，断言状态）：
 *  ① 进游戏后 sfx 总线就绪
 *  ② 17 种音色逐个触发（含节流重复触发）→ 零页面报错
 *  ③ HUD 🔔 开关切换 + localStorage 偏好
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '音效验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '音效岛', flat: true });
for (let x = 4; x <= 8; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);

  const s1 = await page.evaluate(() => window.__annoSfx());
  check('进游戏后音效总线就绪', s1.bus === true && s1.on === true);
  check('按钮显示 🔔', (await page.evaluate(() => document.getElementById('sfxBtn').textContent)) === '🔔');

  // 17 种音色逐个触发，每种连发 3 次（测节流），零报错才算过
  const names = ['place','demolish','plant','ripe','harvest','wither','pop','coin','ship','trot','knock','alert','ok','bad','tick','thunder'];
  const trig = await page.evaluate(names => {
    names.forEach(n => { for (let i = 0; i < 3; i++) window.__annoSfxPlay(n, 1); });
    return names.length;
  }, names);
  await sleep(2500);   // 让所有 oscillator 走完生命周期
  check(`${trig} 种音色连发无报错`, errs.length === 0, errs.length ? errs[0] : 'clean');

  // 开关
  await page.click('#sfxBtn');
  await sleep(300);
  const s2 = await page.evaluate(() => window.__annoSfx());
  check('点按钮 → 关（🔕）', s2.on === false && (await page.evaluate(() => document.getElementById('sfxBtn').textContent)) === '🔕');
  await page.click('#sfxBtn');
  await sleep(300);
  const s3 = await page.evaluate(() => window.__annoSfx());
  check('再点 → 恢复（🔔）', s3.on === true);
  const stored = await page.evaluate(() => localStorage.getItem('anno1800_sfx'));
  check('偏好写入 localStorage', stored === '1');

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
