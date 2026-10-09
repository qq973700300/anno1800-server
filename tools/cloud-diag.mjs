// 云层诊断：同一机位、云层开/关对比，确定海面灰斑来源 + 仰拍云絮是否可见
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '云诊断' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '诊断岛' });

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
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });
  const G = Math.sqrt(i1.terrain.length);
  const mid = Math.floor(G / 2);

  // 俯瞰对比：多云天气下 云层开 vs 关
  await page.evaluate(([m]) => window.__annoCam(m, m, 400, 0.55, 0.85), [mid]);
  await page.evaluate(() => window.__annoWeather('cloudy'));
  await new Promise(r => setTimeout(r, 11000));
  await page.screenshot({ path: 'target/diag-far-on.png' });
  await page.evaluate(() => window.__annoCloudLayer(true));
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: 'target/diag-far-off.png' });
  await page.evaluate(() => window.__annoCloudLayer(false));
  console.log('  shots: diag-far-on/off.png');

  // 仰拍：雷雨满覆盖率，云絮应该明显
  await page.evaluate(([m]) => window.__annoCam(m, m, 95, 1.62, 0.85), [mid]);
  await page.evaluate(() => window.__annoWeather('storm'));
  await new Promise(r => setTimeout(r, 13000));
  await page.screenshot({ path: 'target/diag-low-storm.png' });
  console.log('  shot: diag-low-storm.png');

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
} finally {
  await browser.close();
}
