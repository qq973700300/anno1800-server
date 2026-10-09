/** 密集采样磨坊转角：看 rotation.z 是连续增长还是被周期性清零（锯齿） */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const BASE = 'http://127.0.0.1:8080';
const NAME = '风车采样' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '采样岛', flat: true });
await api('/api/market/buy', 'POST', { playerId: p.id, good: 'TIMBER', quantity: 6 });   // 磨坊要 5 木板，开局只带 4
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
for (let x = 4; x <= 10; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 4, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'MILL', x: 7, z: 9 });
await api('/api/market/buy', 'POST', { playerId: p.id, good: 'GRAIN', quantity: 40 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);
  await page.evaluate(() => window.__annoMills());          // 等模型挂上
  await sleep(3000);

  const rows = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const r = await page.evaluate(() => {
      const m = (window.__annoMills() || [])[0] || {};
      return { rot: m.rot, spd: m.spd, stall: m.stall, n: (window.__annoMills() || []).length,
               blds: (window.__annoBuildingViews() || []).length,
               fpsMs: Math.round(performance.now()) };
    });
    rows.push({ dt: Date.now() - t0, ...r });
    await sleep(120);
  }
  let prev = null;
  for (const r of rows) {
    const d = prev == null ? 0 : r.rot - prev;
    console.log(`t=${String(r.dt).padStart(5)} rot=${String(r.rot?.toFixed(3)).padStart(7)} Δ=${(d >= 0 ? '+' : '') + d.toFixed(3)} spd=${r.spd} stall=${r.stall} mills=${r.n} blds=${r.blds} pageClock=${r.fpsMs}`);
    prev = r.rot;
  }
} finally { await browser.close(); }
