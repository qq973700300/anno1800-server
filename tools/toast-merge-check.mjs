// Toast 合并验证：页面开着，用 API 连播 6 株土豆 + 修 4 格马路，
// 服务端会逐格广播 CROP_PLANTED ×6 / ROAD_BUILT ×4 —— 页面应只各显示 1 条（×6 / ×4）
const BASE = 'http://127.0.0.1:8080';
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method||'GET', headers: {'Content-Type':'application/json'}, body: body?JSON.stringify(body):undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status)); return j.data;
};

const tag = Date.now().toString().slice(-6);
const p = await api('/api/players/register', 'POST', { name: '弹框验证' + tag });
const island = await api('/api/islands', 'POST', { playerId: p.id, name: '合并岛', flat: true });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: island.id, type: 'TRADING_POST', x: 0, z: 8 });

import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', p.name);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 6000));

  // 连修 4 格马路（服务端逐格广播）
  for (let i = 0; i < 4; i++) {
    await api('/api/roads', 'POST', { playerId: p.id, islandId: island.id, x: 12, z: 6 + i });
  }
  // 纪元式拉田：路铺好后建马铃薯农场（(13,5) 3×3，外圈贴 x=12 列的路），
  // 6 株土豆 (10..15,10) 全在农场周围 3 格内
  const farm = await api('/api/buildings', 'POST',
    { playerId: p.id, islandId: island.id, type: 'POTATO_FARM', x: 13, z: 5 });
  for (let i = 0; i < 6; i++) {
    await api('/api/farm/plant', 'POST', { playerId: p.id, islandId: island.id, x: 10 + i, z: 10, crop: 'POTATO', buildingId: farm.id });
  }
  await new Promise(r => setTimeout(r, 500));   // toast 寿命 2.6s，取样要赶在到期前

  const toasts = await page.evaluate(() =>
    [...document.querySelectorAll('#toasts .toast')].map(el => el.textContent));
  console.log('当前屏幕上的 toast:', JSON.stringify(toasts, null, 1));

  const planted = toasts.filter(t => t.includes('播种'));
  const roads = toasts.filter(t => t.includes('马路'));
  console.log(planted.length === 1 && planted[0].includes('×6') ? 'PLANT_MERGED_OK' : 'PLANT_MERGE_FAIL',
              '|', roads.length === 1 && roads[0].includes('×4') ? 'ROAD_MERGED_OK' : 'ROAD_MERGE_FAIL');
} finally {
  await browser.close();
}
