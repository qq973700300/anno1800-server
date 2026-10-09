// 夜景评估：把游戏时钟拨到 20 点（黄昏）/ 23 点（深夜）截图
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '夜景验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '夜景岛' });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 7000));

  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });

  const G = Math.sqrt(i1.terrain.length);
  const at = (x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? '~' : i1.terrain[z * G + x];
  // 找岛中心附近一块有建筑感的位置（就用岛中心）
  const mid = Math.floor(G / 2);
  console.log('island:', i1.id, 'G=' + G);

  const shoot = async (hour, file) => {
    await page.evaluate(([h, m]) => {
      window.__annoNpcWorld.clock.hour = h; window.__annoNpcWorld.clock.day = 1;
    }, [hour, mid]);
    await page.evaluate((m) => window.__annoCam(m, m, 55, 1.0, 0.85), mid);
    await new Promise(r => setTimeout(r, 1500));
    await page.screenshot({ path: 'target/' + file });
  };

  await shoot(17.5, 'night-dusk.png');   // 黄昏，霞光
  await shoot(23, 'night-deep.png');     // 深夜
  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
