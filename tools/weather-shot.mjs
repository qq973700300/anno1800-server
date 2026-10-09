// 天气 + 小动物验证：四种天气各截一张，顺带断言动物数量 / 天气钩子生效
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '天气验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '天气岛' });

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

  // 动物都建出来了没
  const fa = await page.evaluate(() => window.__annoFauna && window.__annoFauna());
  console.log('fauna:', JSON.stringify(fa));
  assert(fa && fa.gulls === 12, '海鸥 12 只（3 群 × 4）');
  assert(fa && fa.fishes === 4, '跳鱼 4 条');
  assert(fa && fa.sheep >= 4, '羊 ≥ 4 只（平原足够时应为 6）');

  // 天空视角 + 隐藏 UI
  const G = Math.sqrt(i1.terrain.length);
  const mid = Math.floor(G / 2);
  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  await page.evaluate(([m]) => window.__annoCam(m, m, 80, 1.75, 0.85), [mid]);
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });   // 上午顺光
  await new Promise(r => setTimeout(r, 800));

  const shoot = async (weather, file, waitMs) => {
    await page.evaluate((wn) => window.__annoWeather(wn), weather);
    /* 无头环境 ~23fps 且 dt 被钳位，游戏时间比墙钟慢 —— 6 秒过渡得等 11 秒才走完 */
    await new Promise(r => setTimeout(r, waitMs || 11000));
    const cur = await page.evaluate(() => window.__annoFauna().weather);
    assert(cur === weather, `天气切到 ${weather}（当前 ${cur}）`);
    await page.screenshot({ path: 'target/' + file });
    console.log('  shot:', file);
  };

  await shoot('cloudy', 'weather-cloudy.png');
  await shoot('rain', 'weather-rain.png');
  await shoot('storm', 'weather-storm.png', 13000);
  await shoot('clear', 'weather-clear.png');

  // 恢复自动轮换
  await page.evaluate(() => window.__annoWeather('auto'));

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  assert(pageErrors.length === 0, '无页面 JS 错误');
  console.log(fails === 0 ? 'ALL_PASS' : `FAILED ${fails}`);
} finally {
  await browser.close();
}
