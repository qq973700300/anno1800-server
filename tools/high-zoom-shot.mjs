// 高空全图视角：复现"整屏被雾洗白"，验证雾修复 + 云
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '高空验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '高空岛' });

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
  // 岛中心
  const mid = Math.floor(G / 2);
  console.log('island:', i1.id, 'G=' + G);

  // 最远缩放：正对岛中心（复现用户截图的机位）
  await page.evaluate((m) => window.__annoCam(m, m, 850, 0.95, 0.85), mid);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/high-zoom-1.png' });

  // 高空 + 俯角更大（接近俯瞰全岛）
  await page.evaluate((m) => window.__annoCam(m, m, 480, 0.6, 0.85), mid);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/high-zoom-2.png' });

  // 常规距离：确认云在正常游玩视角可见
  await page.evaluate((m) => window.__annoCam(m, m, 90, 1.05, 0.85), mid);
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: 'target/high-zoom-3.png' });

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
