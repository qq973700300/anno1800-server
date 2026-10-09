/* 商船 GLB 模型接入验证（纯数据断言，无截图）：
   ① /models/SHIP.glb 可达  ② 页面加载就位（ready）  ③ 海上航行的船换成了真模型
   ④ 模型在线期间页面零报错 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';

const BASE = 'http://127.0.0.1:8080';
const NAME = 'sm' + Date.now();
let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  ok ? pass++ : fail++;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ① 静态文件可达 */
const head = await fetch(BASE + '/models/SHIP.glb', { headers: { Range: 'bytes=0-1023' } });
check('SHIP.glb 静态可达', head.status === 206 || head.status === 200, 'HTTP ' + head.status);
head.body?.cancel();

/* 服务端：注册 + 建岛 + 贸易站（船从港口出） */
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET',
    headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); if (!r.ok) throw new Error(path + ' -> ' + r.status); return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '船模', flat: true });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });

/* ② 页面进游戏（页面自己的 WS 挂 auth，懒结算才会推进） */
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME); await page.click('#enterBtn');

  /* 36MB 模型 + 快照到船出现，给足时间；轮询到就位提前退 */
  let model = null;
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    model = await page.evaluate(() => window.__annoShipModel ? window.__annoShipModel() : null);
    if (model && model.ready && model.ships > 0) break;
  }
  check('模型加载就位（ready）', !!model && model.ready, JSON.stringify(model));
  check('海上已有船在跑', !!model && model.ships > 0, 'ships=' + (model ? model.ships : 0));

  /* ③ 真模型判定：热替换后 fleet 里所有船的 mesh 都是 proto 克隆（带我们补的 wake userData） */
  const protoUsed = await page.evaluate(() => {
    const f = window.__annoFleet;
    if (!f || !f.ships.size) return false;
    for (const n of f.ships.values())
      if (!(n.mesh.userData && n.mesh.userData.wake && n.mesh.userData.crate)) return false;
    return true;
  });
  check('航行的船用的是真模型', protoUsed);

  /* ④ 页面零报错：console 里的 resource 400 是"API 先注册同名 → 页面注册撞名转登录"
     的既有流程噪音，不算数；pageerror / 其他 console error 才是真雷 */
  const realErrors = errors.filter(e => !/status of 400|Failed to load resource/.test(e));
  check('页面零报错', realErrors.length === 0, realErrors.slice(0, 3).join(' / '));
} finally { await browser.close(); }

console.log(`\n${pass + fail} 项：${pass} 过 / ${fail} 挂`);
process.exit(fail ? 1 : 0);
