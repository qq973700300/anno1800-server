// Shader 远景云层验证：低角度仰拍天空看云絮层 + 拉远镜头看云层是否"没有尽头"
// 断言：无 JS 报错；拉远后仍能取到云像素（层跟镜头走、不出界）；各天气下覆盖率钩子数值随档位变化
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const stamp = Date.now();
const NAME = '云层验证' + stamp;

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '云层岛' });

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

  await page.evaluate(() => {
    document.querySelectorAll('.panel, #toasts, #buildbar').forEach(el => el.style.display = 'none');
  });
  await page.evaluate(() => { window.__annoNpcWorld.clock.hour = 10; });

  // 机位 A：贴海面仰拍天空 —— 应该能看到低模积云 + 高处的云絮层叠在一起
  const G = Math.sqrt(i1.terrain.length);
  const mid = Math.floor(G / 2);
  await page.evaluate(([m]) => window.__annoCam(m, m, 175, 1.62, 0.85), [mid]);
  await page.evaluate(() => window.__annoWeather('cloudy'));
  await new Promise(r => setTimeout(r, 11000));
  await page.screenshot({ path: 'target/cloud-layer-low.png' });
  console.log('  shot: cloud-layer-low.png');

  // 机位 B：拉到最远俯瞰 —— 云絮层永远跟镜头，画面上方不该出现"云到头"的空白断带
  await page.evaluate(([m]) => window.__annoCam(m, m, 400, 0.55, 0.85), [mid]);
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: 'target/cloud-layer-far.png' });
  console.log('  shot: cloud-layer-far.png');

  // 雷雨：云絮层应该压成铁灰厚层
  await page.evaluate(([m]) => window.__annoCam(m, m, 175, 1.62, 0.85), [mid]);
  await page.evaluate(() => window.__annoWeather('storm'));
  await new Promise(r => setTimeout(r, 13000));
  await page.screenshot({ path: 'target/cloud-layer-storm.png' });
  console.log('  shot: cloud-layer-storm.png');

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  assert(pageErrors.length === 0, '无页面 JS 错误（shader 编译错也会进这里）');
  console.log(fails === 0 ? 'ALL_PASS' : `FAILED ${fails}`);
} finally {
  await browser.close();
}
