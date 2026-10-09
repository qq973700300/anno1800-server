// 山体渲染验证：API 建号+建岛 → 无头 Edge 打开 game.html 登录 → 调视角 → 截图
// 跑完自己用 Read 看 png（多模态），别只看"截图成功"。
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '山景验证' + stamp;

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

/* 1. 建号 + 建随机岛（正式岛才有山地；随机岛形由 id 决定，山占陆地约 13%）。
      岛形是抽卡：挑一座山占比正常（5%~20%、且 ≥40 格）的岛再截图，免得抽到满岛雪山。 */
const p = await api('/api/players/register', 'POST', { name: NAME });
let i1;
for (let tries = 1; tries <= 6; tries++) {
  i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '山景岛' + tries });
  const peaks = (i1.terrain.match(/\^/g) || []).length;
  const land = (i1.terrain.match(/[.^ic]/g) || []).length;
  console.log(`try${tries} island=${i1.id} 山地=${peaks} 陆地=${land} (${(peaks / land * 100).toFixed(1)}%)`);
  if (peaks >= 40 && peaks / land <= 0.20) break;
  i1 = null;
}
if (!i1) { console.log('NO_SUITABLE_ISLAND'); process.exit(1); }

/* 2. 无头 Edge 打开页面登录 */
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
  await new Promise(r => setTimeout(r, 6000));   // 等登录 + 地形网格构建

  /* 3. 调视角：拉近看山脊细节，再拉远看整岛大势（全景位 = 净 +1600，实测刚好框住全岛） */
  await page.mouse.wheel({ deltaY: -600 });
  await new Promise(r => setTimeout(r, 800));
  await page.mouse.move(750, 475);
  await page.mouse.down();
  await page.mouse.move(950, 600, { steps: 12 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/mountain-shot-1.png' });

  await page.mouse.wheel({ deltaY: 2200 });
  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: 'target/mountain-shot-2.png' });

  /* 4. 海岸线特写：用地形串挑一个"贴水沙滩格"（四邻有水的陆地），__annoLookAt 把镜头钉过去。
        不再用鼠标盲拖平移 —— 80 格大岛，拖多远全靠猜。 */
  const G = Math.sqrt(i1.terrain.length);
  const at = (x, z) => (x < 0 || z < 0 || x >= G || z >= G) ? '~' : i1.terrain[z * G + x];
  let coastCell = null;
  outer:
  for (let z = G - 2; z >= 2; z--) for (let x = 2; x < G - 2; x++) {   // 从下往上扫，挑下缘的岸
    if (at(x, z) !== '.' && at(x, z) !== 'i' && at(x, z) !== 'c') continue;
    if ([[1,0],[-1,0],[0,1],[0,-1]].some(([a, b]) => at(x + a, z + b) === '~')) { coastCell = [x, z]; break outer; }
  }
  console.log('coastCell:', coastCell);
  await page.evaluate(([gx, gz]) => window.__annoLookAt(gx, gz, 16), coastCell);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/beach-shot-3.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
