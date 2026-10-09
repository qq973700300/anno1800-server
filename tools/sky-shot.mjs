// 官方 Sky 验证：正午 / 黄昏 / 深夜 / 雷雨 四张
import puppeteer from 'file:///C:/Users/92112/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const BASE = 'http://127.0.0.1:8080';
const NAME = '天穹验证' + Date.now();

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
const i1 = await api('/api/islands', 'POST', { playerId: p.id, name: '天穹岛' });

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
  const mid = Math.floor(G / 2);

  const shoot = async (hour, weather, file) => {
    await page.evaluate(([h, w]) => {
      window.__annoNpcWorld.clock.hour = h;
      window.__annoNpcWorld.clock.day = 1;
      if (w) window.__annoWeather(w);
    }, [hour, weather]);
    await page.evaluate((m) => window.__annoCam(m, m, 55, 1.0, 0.85), mid);
    await new Promise(r => setTimeout(r, 2500));
    await page.screenshot({ path: 'target/' + file });
    console.log('shot:', file);
  };

  await shoot(12, null, 'sky-noon.png');
  await shoot(17.5, null, 'sky-dusk.png');
  await shoot(23, null, 'sky-night.png');
  await shoot(12, 'storm', 'sky-storm.png');

  console.log('pageErrors:', pageErrors.length ? pageErrors : '无');
  console.log('SHOTS_DONE');
} finally {
  await browser.close();
}
