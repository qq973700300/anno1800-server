import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '日志面板' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '日志岛', flat: true });
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));
  // 灌一批日志：分 6 次修路（每次都走"我的"事件 → logLine），再让队友事件来几条
  for (let k = 0; k < 6; k++) {
    await api('/api/roads/batch', 'POST', {
      playerId: p.id, islandId: i1.id,
      cells: Array.from({ length: 8 }, (_, n) => ({ x: 8 + k, z: 8 + n })),
    }).catch(() => {});
    await new Promise(r => setTimeout(r, 400));
  }
  await new Promise(r => setTimeout(r, 1500));
  const info = await page.evaluate(() => {
    const el = document.getElementById('log');
    const r = el.getBoundingClientRect();
    return {
      count: el.children.length,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      scrollable: el.scrollHeight > el.clientHeight,
      first: el.firstChild ? el.firstChild.textContent : null,
    };
  });
  console.log('log info:', JSON.stringify(info));
  // 滚到底看历史还在
  await page.evaluate(() => { const el = document.getElementById('log'); el.scrollTop = el.scrollHeight; });
  await new Promise(r => setTimeout(r, 300));
  const last = await page.evaluate(() => {
    const el = document.getElementById('log');
    return el.lastChild ? el.lastChild.textContent : null;
  });
  console.log('last entry after scroll:', last);
  // 整页截图看位置
  await page.screenshot({ path: 'target/log-position.png' });
  console.log('errs:', errs.length ? errs : '无');
  console.log('DONE');
} finally { await browser.close(); }
