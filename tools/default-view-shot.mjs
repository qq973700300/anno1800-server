// 常规视角：默认俯角看一段海岸 —— 验证整体观感
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '常规视角' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '常规岛' });

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

  const G = Math.sqrt(i1.terrain.length);
  const at = (x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? '~' : i1.terrain[z * G + x];
  let coast = null;
  outer:
  for (let z = 6; z < G - 6; z++) for (let x = 6; x < G - 6; x++) {
    if (at(x, z) === '~' || at(x, z) === '^') continue;
    if (at(x, z+1) === '~' && at(x, z+2) === '~') { coast = [x, z]; break outer; }
  }
  console.log('coast:', coast, 'island:', i1.id);

  // 默认俯角 polar 0.95、中距离 40 —— 玩家平时看岛的角度
  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 40, 0.95, 0.85), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/default-view.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
