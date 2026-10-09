// 水线特写：镜头架在海面上方平视海岸 —— 验证"贴图感"修复
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '特写验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '特写岛' });

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
  // 找一段"南边连续 7 格都是水"的海岸，保证镜头架在水上
  let coast = null;
  outer:
  for (let z = 6; z < G - 10; z++) for (let x = 6; x < G - 6; x++) {
    if (at(x, z) === '~' || at(x, z) === '^') continue;
    let ok = true;
    for (let k = 1; k <= 7; k++) if (at(x, z + k) !== '~') { ok = false; break; }
    if (ok) { coast = [x, z]; break outer; }
  }
  console.log('coast:', coast, 'island:', i1.id);

  const seaTarget = [coast[0], coast[1] + 3];
  // azim≈0：镜头在目标正南方（更靠海），看向北边的海岸
  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 10, 1.72, 0.02), seaTarget);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/close-1.png' });

  await page.evaluate(([gx, gz]) => window.__annoCam(gx, gz, 5.5, 1.78, 0.02), seaTarget);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/close-2.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
