const BASE = 'http://127.0.0.1:8080';
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method||'GET', headers: {'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status)); return j.data;
};
const tag = Date.now().toString().slice(-6);
const p = await api('/api/players/register', 'POST', { name: '弹框实拍' + tag });
const island = await api('/api/islands', 'POST', { playerId: p.id, name: '实拍岛', flat: true });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: island.id, type: 'TRADING_POST', x: 0, z: 8 });
// 纪元式拉田：路 (11..15,14) → 马铃薯农场 (12,11)（3×3 贴路）→ 14 株土豆夹农场两行（z=10 / z=15 各 7 株）
for (const x of [11, 12, 13, 14, 15]) {
  await api('/api/roads', 'POST', { playerId: p.id, islandId: island.id, x, z: 14 });
}
const farm = await api('/api/buildings', 'POST',
  { playerId: p.id, islandId: island.id, type: 'POTATO_FARM', x: 12, z: 11 });
let n = 0;
for (const z of [10, 15]) for (let x = 10; x <= 16; x++) {
  await api('/api/farm/plant', 'POST',
    { playerId: p.id, islandId: island.id, x, z, crop: 'POTATO', buildingId: farm.id });
  n++;
}
console.log(`planted=${n}`);

import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
try {
  const page = await browser.newPage();
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', p.name);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 6000));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'target/toast-merged.png' });
  console.log('SHOTS_DONE');
} finally { await browser.close(); }
