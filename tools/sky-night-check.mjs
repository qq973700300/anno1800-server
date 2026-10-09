/**
 * 昼夜天空风格统一验证：
 *  同一座岛、同一机位，强制时钟到 正午12:00 / 黄昏18:20 / 深夜00:00 各截一张。
 *  断言：① 夜里 uNight≈1 且天空像素不是死黑（有月光蓝）② 正午 uNight≈0 ③ 黄昏过渡中。
 */
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { PNG } from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/pngjs/lib/png.js';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8080';
const NAME = '夜空验证' + Date.now();
const api = async (path, method, body) => {
  const r = await fetch(BASE + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(path + ' -> ' + (j.message || r.status));
  return j.data;
};
const p = await api('/api/players/register', 'POST', { name: NAME });
const isl = await api('/api/islands', 'POST', { playerId: p.id, name: '夜空岛', flat: true });
for (let x = 4; x <= 14; x++) await api('/api/roads', 'POST', { playerId: p.id, islandId: isl.id, x, z: 8 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'TRADING_POST', x: 0, z: 11 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'FARMER_HOUSE', x: 5, z: 9 });
await api('/api/buildings', 'POST', { playerId: p.id, islandId: isl.id, type: 'LUMBERJACK', x: 5, z: 6 });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1200, height: 800 },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : '')); if (!ok) fails++; };

  // 左上天空区采样（避开右侧日志面板 / 顶部 HUD / 中央 toast）
  function skyStats(pngPath) {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    let sum = 0, blue = 0, n = 0;
    for (let y = 40; y < 300; y += 4) {
      for (let x = 80; x < 480; x += 8) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      sum += r + g + b;
      blue += (b > r) ? 1 : 0;      // 夜空月光蓝：蓝>红
      n++;
    }
  }
  return { lum: sum / n / 3, blueRatio: blue / n };
}

try {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await sleep(8000);

  // 抬头看天的机位
  await page.evaluate(() => window.__annoCam(18, 4, 26, 1.35, 2.2));
  await sleep(1500);

  // 强制时钟：正午
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 12; });
  await sleep(1500);
  const noonNight = await page.evaluate(() => window.__annoSkyNight());
  await page.screenshot({ path: 'target/sky-noon.png' });
  check('正午 uNight≈0', Math.abs(noonNight) < 0.05, 'uNight=' + noonNight.toFixed(3));

  // 黄昏（太阳 18:00 整落山，up 的过渡带在 17:15~18:00）
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 17.5; });
  await sleep(1500);
  const duskNight = await page.evaluate(() => window.__annoSkyNight());
  await page.screenshot({ path: 'target/sky-dusk.png' });
  check('黄昏 uNight 过渡中 (0.1~0.9)', duskNight > 0.1 && duskNight < 0.95, 'uNight=' + duskNight.toFixed(3));

  // 深夜
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 0; });
  await sleep(1500);
  const midNight = await page.evaluate(() => window.__annoSkyNight());
  await page.screenshot({ path: 'target/sky-midnight.png' });
  check('深夜 uNight≈1', midNight > 0.95, 'uNight=' + midNight.toFixed(3));

  const st = skyStats('target/sky-midnight.png');
  check('深夜天空不是死黑 (亮度>6)', st.lum > 6, 'lum=' + st.lum.toFixed(1));
  check('深夜天空是月光蓝 (蓝>红占比>70%)', st.blueRatio > 0.7, 'blueRatio=' + st.blueRatio.toFixed(2));
  const stNoon = skyStats('target/sky-noon.png');
  check('正午天空亮度正常 (>100)', stNoon.lum > 100, 'lum=' + stNoon.lum.toFixed(1));
  check('深夜比正午暗 (夜 < 正午×0.5)', st.lum < stNoon.lum * 0.5, `夜${st.lum.toFixed(1)} vs 昼${stNoon.lum.toFixed(1)}`);

  console.log('errs:', errs.length ? errs : '无');
  console.log(fails === 0 ? 'ALL PASS' : fails + ' FAILED');
  process.exitCode = fails === 0 && errs.length === 0 ? 0 : 1;
} finally { await browser.close(); }
