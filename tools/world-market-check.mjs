/**
 * 世界市场入口验证：
 *  ① 右侧面板不再有"行情"页签（默认仓库）
 *  ② 右下角有"🌍 世界"按钮，点开弹层里有行情表
 *  ③ 点行情里的商品行 → 弹出买卖对话框（prompt），接受后 toast 成交
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '世界验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '世界岛', flat: true });
for (let x = 4; x <= 10; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  let dialogMsg = '';
  page.on('dialog', async d => { dialogMsg = d.message(); await d.accept('3'); });
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);

  // ① 行情页签已撤出右面板
  const marketTab = await page.evaluate(() => document.querySelector('#right [data-tab="market"]'));
  check('右面板没有行情页签', marketTab === null);
  const stockOn = await page.evaluate(() => document.querySelector('#right [data-tab="stock"]').classList.contains('on'));
  check('右面板默认停在仓库', stockOn === true);

  // ② 右下角世界按钮 + 弹层
  const btnVisible = await page.evaluate(() => {
    const b = document.getElementById('worldBtn');
    const r = b.getBoundingClientRect();
    return r.right <= window.innerWidth && r.bottom <= window.innerHeight && r.width > 0;
  });
  check('世界按钮在屏幕内右下角', btnVisible);
  await page.click('#worldBtn');
  await sleep(400);
  const shown = await page.evaluate(() => document.getElementById('worldMask').classList.contains('show'));
  check('点世界按钮 → 弹层打开', shown === true);
  const rows = await page.evaluate(() => document.querySelectorAll('#worldMarket tbody tr').length);
  check('弹层里有行情表', rows > 3, rows + ' 行');
  await page.screenshot({ path: 'target/world-market.png' });

  // ③ 点商品行 → 买卖对话框
  await page.evaluate(() => document.querySelector('#worldMarket tr[data-good]').click());
  await sleep(600);
  check('点商品行弹出买卖对话框', dialogMsg.includes('买入价'), dialogMsg.split('\n')[0]);

  // 关闭：Esc
  await page.keyboard.press('Escape');
  await sleep(300);
  const closed = await page.evaluate(() => !document.getElementById('worldMask').classList.contains('show'));
  check('Esc 关闭弹层', closed === true);

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
