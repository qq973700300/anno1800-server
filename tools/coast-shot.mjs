// 海岸线特写：复现"岛屿边切割现象" —— 从海侧与俯视两个机位拍贴岸沙滩/裙边
// 跑完自己用 Read 看 png（多模态），别只看"截图成功"。
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '海岸验证' + stamp;

const api = async (path, method, body) => {
  const r = await fetch(BASE + path, {
    method: method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} -> ${j.message || r.status}`);
  return j.data;
};

const p = await api('/api/players/register', 'POST', { name: NAME });
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '海岸岛' });

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: 'new',
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
  defaultViewport: { width: 1500, height: 950 },
});
const pageErrors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(BASE + '/game.html', { waitUntil: 'networkidle2' });
  await page.type('#nameIn', NAME);
  await page.click('#enterBtn');
  await new Promise(r => setTimeout(r, 6000));

  /* 挑一段"凸向海"的岸（半岛尖），海侧平视 + 高角俯拍各一张 */
  const G = Math.sqrt(i1.terrain.length);
  const at = (x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? '~' : i1.terrain[z * G + x];
  let coast = null;
  outer:
  for (let z = 4; z < G - 4; z++) for (let x = 4; x < G - 4; x++) {
    if (at(x, z) === '~' || at(x, z) === '^') continue;
    // 陆格，且上/左/右至少两个方向是水 → 突出岸段
    const w = [[1,0],[-1,0],[0,1],[0,-1]].filter(([a, b]) => at(x + a, z + b) === '~').length;
    if (w >= 2) { coast = [x, z]; break outer; }
  }
  console.log('coast:', coast, 'island:', i1.id);

  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 9), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/coast-shot-1.png' });

  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 20), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/coast-shot-2.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
