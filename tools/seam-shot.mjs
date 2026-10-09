// 复现用户截图：海面高度低角度望向海滩 —— 浅水带与海面"隔空"问题
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '水线衔接' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '衔接岛' });

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
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => { el.style.display = 'none'; });
  });

  const G = Math.sqrt(i1.terrain.length);
  const at = (x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? '~' : i1.terrain[z * G + x];
  // 找南侧海岸（用户截图是从海上往岛上看）
  let coast = null;
  outer:
  for (let z = G - 5; z > 4; z--) for (let x = 5; x < G - 5; x++) {
    if (at(x, z) === '~' || at(x, z) === '^') continue;
    if (at(x, z + 1) === '~' && at(x, z + 2) === '~') { coast = [x, z]; break outer; }
  }
  console.log('coast:', coast, 'island:', i1.id);

  // 低角度贴海面：polar 1.45（略俯）、距离 26 —— 模拟用户截图机位
  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 26, 1.45, Math.PI / 2), coast);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/seam-low.png' });

  // 更贴近水面：polar 1.62（几乎水平）
  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 18, 1.62, Math.PI / 2), coast);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/seam-lower.png' });

  // 略高一点俯视海岸
  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 40, 1.15, Math.PI / 2), coast);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/seam-mid.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
