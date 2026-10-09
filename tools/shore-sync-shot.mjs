// 岸边浪与官方 Water 的契合度验证：贴岸特写 / 中距 / 高位机位
// 看点：① 浅水泡沫是否跟着海面波光同频动（同一张法线贴图同一时钟）
//       ② 浅水外圈与海面过渡是否无缝 ③ 页面无 JS 报错（shader 编译错会在这里现形）
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '岸浪验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '岸浪岛' });

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
  let coast = null;
  outer:
  for (let z = 4; z < G - 4; z++) for (let x = 4; x < G - 4; x++) {
    if (at(x, z) === '~' || at(x, z) === '^') continue;
    const w = [[1,0],[-1,0],[0,1],[0,-1]].filter(([a, b]) => at(x + a, z + b) === '~').length;
    if (w >= 2) { coast = [x, z]; break outer; }
  }
  console.log('coast:', coast, 'island:', i1.id);
  console.log('hook:', await page.evaluate(() => typeof window.__annoLookAt));

  // 贴岸特写：浅水/裙边/海面同框
  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 7), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/shore-sync-1-near.png' });

  // 中距：泡沫带全貌 + 与海面波光衔接
  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 16), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/shore-sync-2-mid.png' });

  // 稍高机位：浅水外圈与整片海的过渡
  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 34), coast);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/shore-sync-3-high.png' });

  // 间隔 2 秒再拍一张同机位特写：对比两张图泡沫形态是否在动且与波光同节奏
  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 7), coast);
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'target/shore-sync-4-near-later.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
